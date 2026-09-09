from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.audit.service import write_audit
from app.core.database import engine, get_db
from app.core.deps import AuthContext, require_owner, require_perms
from app.core.models import Customer, Lead, LeadStatus, Product, Quotation, QuotationLine, QuotationStatus
from app.core.schemas import QuotationCreate, QuotationOut
from app.sales.ensure_schema import ensure_sales_schema
from app.sales.ops import open_confirmed_from_quotation

router = APIRouter(prefix="/quotations", tags=["quotations"])


def _out(q: Quotation, customer_name: str | None = None) -> QuotationOut:
    below = any(float(ln.unit_price) < float(ln.base_price) for ln in q.lines)
    return QuotationOut(
        id=q.id,
        company_id=q.company_id,
        customer_id=q.customer_id,
        lead_id=q.lead_id,
        status=q.status.value,
        notes=q.notes,
        lines=[
            {
                "id": ln.id,
                "product_id": ln.product_id,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unit_price),
                "base_price": float(ln.base_price),
            }
            for ln in q.lines
        ],
        customer_name=customer_name,
        below_floor=below,
        needs_approval=q.status == QuotationStatus.PENDING_APPROVAL,
    )


@router.get("", response_model=list[QuotationOut])
def list_quotations(
    auth: AuthContext = Depends(require_perms("quotations.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    q = (
        db.query(Quotation)
        .options(joinedload(Quotation.lines))
        .filter(Quotation.organization_id == auth.organization_id)
    )
    if company_id is not None:
        q = q.filter(Quotation.company_id == company_id)
    rows = q.order_by(Quotation.id.desc()).all()
    names = {
        c.id: c.name
        for c in db.query(Customer).filter(Customer.id.in_({r.customer_id for r in rows} or {0})).all()
    }
    return [_out(r, names.get(r.customer_id)) for r in rows]


@router.post("", response_model=QuotationOut)
def create_quotation(
    body: QuotationCreate,
    auth: AuthContext = Depends(require_perms("quotations.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    ensure_sales_schema(engine)
    if not body.lines:
        raise HTTPException(status_code=400, detail="At least one line required")
    if not body.customer_id and not body.lead_id:
        raise HTTPException(status_code=400, detail="Pick a customer or a lead")

    customer_id = body.customer_id
    lead_id = body.lead_id
    if lead_id:
        lead = (
            db.query(Lead)
            .filter(Lead.id == lead_id, Lead.company_id == company_id, Lead.organization_id == auth.organization_id)
            .first()
        )
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        if not customer_id:
            customer_id = lead.customer_id
        if not customer_id:
            customer = Customer(
                organization_id=auth.organization_id,
                company_id=company_id,
                name=lead.business_name,
                legal_name=lead.business_name,
                trade_name=lead.business_name,
                contact_person=lead.contact_person,
                phone=lead.phone,
                email=lead.email,
                gstin=getattr(lead, "gstin", None),
                address=lead.location,
                customer_type=lead.lead_type,
            )
            db.add(customer)
            db.flush()
            lead.customer_id = customer.id
            customer_id = customer.id
        if lead.status not in (LeadStatus.WON, LeadStatus.LOST, LeadStatus.NEGOTIATION):
            lead.status = LeadStatus.QUOTATION

    needs_approval = False
    q = Quotation(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=customer_id,
        lead_id=lead_id,
        notes=body.notes,
        created_by_id=auth.user.id,
        status=QuotationStatus.DRAFT,
    )
    db.add(q)
    db.flush()

    for line in body.lines:
        product = (
            db.query(Product)
            .filter(Product.id == line.product_id, Product.company_id == company_id)
            .first()
        )
        if not product:
            raise HTTPException(status_code=400, detail=f"Product {line.product_id} not found")
        if line.unit_price < product.base_price:
            needs_approval = True
        db.add(
            QuotationLine(
                quotation_id=q.id,
                product_id=line.product_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                base_price=product.base_price,
            )
        )

    q.status = QuotationStatus.PENDING_APPROVAL if needs_approval else QuotationStatus.APPROVED
    if q.status == QuotationStatus.APPROVED:
        so = open_confirmed_from_quotation(db, auth=auth, quotation=q)
        if so:
            q.status = QuotationStatus.CONVERTED

    write_audit(
        db,
        action="create",
        entity_type="quotation",
        entity_id=q.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"needs_approval={needs_approval}",
    )
    db.commit()
    q = db.query(Quotation).options(joinedload(Quotation.lines)).filter(Quotation.id == q.id).first()
    return _out(q)


@router.post("/{quotation_id}/approve", response_model=QuotationOut)
def approve_quotation(
    quotation_id: int,
    auth: AuthContext = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    q = (
        db.query(Quotation)
        .options(joinedload(Quotation.lines))
        .filter(
            Quotation.id == quotation_id,
            Quotation.company_id == company_id,
            Quotation.organization_id == auth.organization_id,
        )
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if q.status != QuotationStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Quotation is not pending approval")
    q.status = QuotationStatus.APPROVED
    so = open_confirmed_from_quotation(db, auth=auth, quotation=q)
    if so:
        q.status = QuotationStatus.CONVERTED
    write_audit(
        db,
        action="approve",
        entity_type="quotation",
        entity_id=q.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"sales_order={so.id if so else None}",
    )
    db.commit()
    q = db.query(Quotation).options(joinedload(Quotation.lines)).filter(Quotation.id == q.id).first()
    return _out(q)


@router.post("/{quotation_id}/reject", response_model=QuotationOut)
def reject_quotation(
    quotation_id: int,
    auth: AuthContext = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    q = (
        db.query(Quotation)
        .options(joinedload(Quotation.lines))
        .filter(
            Quotation.id == quotation_id,
            Quotation.company_id == company_id,
            Quotation.organization_id == auth.organization_id,
        )
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Quotation not found")
    q.status = QuotationStatus.REJECTED
    write_audit(
        db,
        action="reject",
        entity_type="quotation",
        entity_id=q.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    q = db.query(Quotation).options(joinedload(Quotation.lines)).filter(Quotation.id == q.id).first()
    return _out(q)


@router.post("/{quotation_id}/accept", response_model=QuotationOut)
def accept_quotation(
    quotation_id: int,
    auth: AuthContext = Depends(require_perms("quotations.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    q = (
        db.query(Quotation)
        .options(joinedload(Quotation.lines))
        .filter(
            Quotation.id == quotation_id,
            Quotation.company_id == company_id,
            Quotation.organization_id == auth.organization_id,
        )
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if q.status not in (QuotationStatus.APPROVED, QuotationStatus.ACCEPTED):
        raise HTTPException(status_code=400, detail="Quotation must be approved first")
    q.status = QuotationStatus.ACCEPTED
    write_audit(
        db,
        action="accept",
        entity_type="quotation",
        entity_id=q.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    q = db.query(Quotation).options(joinedload(Quotation.lines)).filter(Quotation.id == q.id).first()
    return _out(q)
