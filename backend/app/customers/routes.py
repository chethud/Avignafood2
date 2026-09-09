from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.audit.service import write_audit
from app.core.database import engine, get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import (
    CollectionFollowUp,
    Customer,
    CustomerContact,
    Invoice,
    InvoiceStatus,
    Payment,
    Product,
    SalesOrder,
    SalesOrderLine,
)
from app.core.schemas import (
    CollectionFollowUpIn,
    CollectionFollowUpOut,
    CustomerContactIn,
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
)
from app.sales.ensure_schema import ensure_sales_schema

router = APIRouter(prefix="/customers", tags=["customers"])


def _ensure() -> None:
    ensure_sales_schema(engine)


def _outstanding(invs: list[Invoice]) -> Decimal:
    return sum(
        (i.total - i.amount_paid for i in invs if i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)),
        Decimal("0"),
    )


def _health(outstanding: Decimal, limit: Decimal, overdue: bool) -> str:
    if overdue or (limit > 0 and outstanding > limit):
        return "RISK"
    if limit > 0 and outstanding > (limit * Decimal("0.6")):
        return "WATCH"
    if outstanding > 0 and overdue:
        return "WATCH"
    return "GOOD"


def _credit_status(outstanding: Decimal, limit: Decimal) -> str:
    if limit > 0 and outstanding > limit:
        return "hold"
    if limit > 0 and outstanding > (limit * Decimal("0.85")):
        return "near_limit"
    return "ok"


def _out(db: Session, customer: Customer, company_id: int) -> CustomerOut:
    invs = (
        db.query(Invoice)
        .filter(Invoice.customer_id == customer.id, Invoice.company_id == company_id, Invoice.status != InvoiceStatus.CANCELLED)
        .all()
    )
    outstanding = _outstanding(invs)
    revenue = sum((i.total for i in invs), Decimal("0"))
    last_inv = max((i.invoice_date for i in invs), default=None)
    pay = (
        db.query(Payment.paid_at)
        .join(Invoice, Payment.invoice_id == Invoice.id)
        .filter(Invoice.customer_id == customer.id, Invoice.company_id == company_id)
        .order_by(Payment.paid_at.desc())
        .first()
    )
    orders = (
        db.query(SalesOrder)
        .filter(SalesOrder.customer_id == customer.id, SalesOrder.company_id == company_id)
        .count()
    )
    today = date.today()
    overdue = any(
        i.due_date and i.due_date < today and (i.total - i.amount_paid) > 0 and i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)
        for i in invs
    )
    limit = customer.credit_limit or Decimal("0")
    countdown = None
    open_dues = [i.due_date for i in invs if i.due_date and (i.total - i.amount_paid) > 0 and i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)]
    if open_dues:
        countdown = (min(open_dues) - today).days
    reorder = [
        r[0]
        for r in (
            db.query(Product.name)
            .join(SalesOrderLine, SalesOrderLine.product_id == Product.id)
            .join(SalesOrder, SalesOrderLine.sales_order_id == SalesOrder.id)
            .filter(SalesOrder.customer_id == customer.id, SalesOrder.company_id == company_id)
            .order_by(SalesOrder.id.desc())
            .limit(5)
            .all()
        )
        if r[0]
    ]
    contacts = getattr(customer, "contacts", None) or []
    return CustomerOut(
        id=customer.id,
        company_id=customer.company_id,
        name=customer.name,
        contact_person=customer.contact_person,
        phone=customer.phone,
        email=customer.email,
        gstin=customer.gstin,
        address=customer.address,
        credit_limit=limit,
        credit_days=customer.credit_days,
        is_active=customer.is_active,
        legal_name=getattr(customer, "legal_name", None),
        trade_name=getattr(customer, "trade_name", None),
        billing_address=getattr(customer, "billing_address", None) or customer.address,
        shipping_address=getattr(customer, "shipping_address", None) or customer.address,
        customer_type=getattr(customer, "customer_type", None),
        outstanding=outstanding,
        lifetime_revenue=revenue,
        order_count=int(orders),
        last_order=last_inv,
        last_payment=pay[0] if pay else None,
        health=_health(outstanding, limit, overdue),
        credit_status=_credit_status(outstanding, limit),
        credit_countdown_days=countdown,
        reorder_suggestions=list(dict.fromkeys(reorder)),
        contacts=contacts,
    )


def _dup(db: Session, company_id: int, phone: str | None, gstin: str | None, exclude_id: int | None = None) -> Customer | None:
    q = db.query(Customer).filter(Customer.company_id == company_id)
    if exclude_id:
        q = q.filter(Customer.id != exclude_id)
    if phone:
        hit = q.filter(Customer.phone == phone).first()
        if hit:
            return hit
    if gstin:
        hit = q.filter(Customer.gstin == gstin).first()
        if hit:
            return hit
    return None


@router.get("", response_model=list[CustomerOut])
def list_customers(
    auth: AuthContext = Depends(require_perms("customers.view")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.company_or_all()
    q = (
        db.query(Customer)
        .options(joinedload(Customer.contacts))
        .filter(Customer.organization_id == auth.organization_id)
    )
    if company_id is not None:
        q = q.filter(Customer.company_id == company_id)
    rows = q.order_by(Customer.id.desc()).all()
    return [_out(db, c, c.company_id) for c in rows]


@router.post("", response_model=CustomerOut)
def create_customer(
    body: CustomerCreate,
    auth: AuthContext = Depends(require_perms("customers.create")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.require_company()
    dup = _dup(db, company_id, body.phone, body.gstin)
    if dup:
        raise HTTPException(status_code=409, detail=f"Duplicate customer {dup.name} — same phone or GSTIN")
    data = body.model_dump()
    if not data.get("legal_name"):
        data["legal_name"] = body.name
    if not data.get("trade_name"):
        data["trade_name"] = body.name
    if not data.get("billing_address"):
        data["billing_address"] = body.address
    customer = Customer(
        organization_id=auth.organization_id,
        company_id=company_id,
        **data,
    )
    db.add(customer)
    db.flush()
    write_audit(
        db,
        action="create",
        entity_type="customer",
        entity_id=customer.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    db.refresh(customer)
    return _out(db, customer, company_id)


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: int,
    auth: AuthContext = Depends(require_perms("customers.view")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.require_company()
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.contacts))
        .filter(
            Customer.id == customer_id,
            Customer.company_id == company_id,
            Customer.organization_id == auth.organization_id,
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _out(db, customer, company_id)


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    body: CustomerUpdate,
    auth: AuthContext = Depends(require_perms("customers.edit")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.require_company()
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.contacts))
        .filter(
            Customer.id == customer_id,
            Customer.company_id == company_id,
            Customer.organization_id == auth.organization_id,
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    data = body.model_dump(exclude_unset=True)
    dup = _dup(db, company_id, data.get("phone") or customer.phone, data.get("gstin") or customer.gstin, exclude_id=customer.id)
    if dup and (data.get("phone") or data.get("gstin")):
        raise HTTPException(status_code=409, detail=f"Duplicate customer {dup.name} — same phone or GSTIN")
    for k, v in data.items():
        setattr(customer, k, v)
    write_audit(
        db,
        action="update",
        entity_type="customer",
        entity_id=customer.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    db.refresh(customer)
    return _out(db, customer, company_id)


@router.post("/{customer_id}/contacts", response_model=CustomerOut)
def add_contact(
    customer_id: int,
    body: CustomerContactIn,
    auth: AuthContext = Depends(require_perms("customers.edit")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.require_company()
    customer = (
        db.query(Customer)
        .options(joinedload(Customer.contacts))
        .filter(
            Customer.id == customer_id,
            Customer.company_id == company_id,
            Customer.organization_id == auth.organization_id,
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    db.add(
        CustomerContact(
            customer_id=customer.id,
            name=body.name,
            phone=body.phone,
            email=body.email,
            designation=body.designation,
            is_primary=body.is_primary,
        )
    )
    db.commit()
    db.refresh(customer)
    return _out(db, customer, company_id)


def _customer(db: Session, auth: AuthContext, customer_id: int, company_id: int) -> Customer:
    customer = (
        db.query(Customer)
        .filter(
            Customer.id == customer_id,
            Customer.company_id == company_id,
            Customer.organization_id == auth.organization_id,
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.get("/{customer_id}/collection-follow-ups", response_model=list[CollectionFollowUpOut])
def list_collection_follow_ups(
    customer_id: int,
    auth: AuthContext = Depends(require_perms("customers.view")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.require_company()
    _customer(db, auth, customer_id, company_id)
    return (
        db.query(CollectionFollowUp)
        .filter(CollectionFollowUp.customer_id == customer_id, CollectionFollowUp.company_id == company_id)
        .order_by(CollectionFollowUp.id.desc())
        .all()
    )


@router.post("/{customer_id}/collection-follow-ups", response_model=CollectionFollowUpOut)
def add_collection_follow_up(
    customer_id: int,
    body: CollectionFollowUpIn,
    auth: AuthContext = Depends(require_perms("customers.edit")),
    db: Session = Depends(get_db),
):
    _ensure()
    company_id = auth.require_company()
    _customer(db, auth, customer_id, company_id)
    row = CollectionFollowUp(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=customer_id,
        invoice_id=body.invoice_id,
        user_id=auth.user.id,
        promised_date=body.promised_date,
        notes=body.notes,
    )
    db.add(row)
    db.flush()
    write_audit(
        db,
        action="create",
        entity_type="collection_follow_up",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    db.refresh(row)
    return row
