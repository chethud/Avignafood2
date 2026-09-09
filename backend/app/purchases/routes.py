from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.audit.service import write_audit
from app.core.database import get_db
from app.core.deps import AuthContext, require_owner, require_perms
from app.core.models import Customer, Purchase, SalesOrder, SalesOrderStatus
from app.core.schemas import PurchaseCreate, PurchaseOut, PurchaseReceiveIn
from app.dispatches.routes import create_load_for_purchase
from app.inventory.routes import stock_inbound
from app.core.schemas import StockInwardIn

router = APIRouter(prefix="/purchases", tags=["purchases"])


@router.get("", response_model=list[PurchaseOut])
def list_purchases(
    auth: AuthContext = Depends(require_perms("purchases.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    q = db.query(Purchase).filter(Purchase.organization_id == auth.organization_id)
    if company_id is not None:
        q = q.filter(Purchase.company_id == company_id)
    return q.order_by(Purchase.id.desc()).all()


@router.post("", response_model=PurchaseOut)
def create_purchase(
    body: PurchaseCreate,
    auth: AuthContext = Depends(require_perms("purchases.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    customer = (
        db.query(Customer)
        .filter(
            Customer.id == body.customer_id,
            Customer.company_id == company_id,
            Customer.organization_id == auth.organization_id,
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=400, detail="Customer not found — create the customer first")
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")

    data = body.model_dump()
    is_pr = bool(data.get("sales_order_id"))
    if is_pr:
        data["status"] = "pending_approval"
        data["source"] = data.get("source") or "sales_referral"

    row = Purchase(
        organization_id=auth.organization_id,
        company_id=company_id,
        created_by_id=auth.user.id,
        **data,
    )
    db.add(row)
    db.flush()
    write_audit(
        db,
        action="create",
        entity_type="purchase",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"customer={body.customer_id} product={body.product} source={body.source}",
    )

    dispatch_id = None
    if not is_pr:
        load = create_load_for_purchase(
            db,
            auth=auth,
            company_id=company_id,
            customer_id=body.customer_id,
            product=body.product,
            quantity=body.quantity,
            eta=body.eta,
            purchase_id=row.id,
        )
        dispatch_id = load.id
        write_audit(
            db,
            action="create",
            entity_type="dispatch",
            entity_id=load.id,
            organization_id=auth.organization_id,
            company_id=company_id,
            user_id=auth.user.id,
            detail=f"auto_from_purchase={row.id} vehicle={load.vehicle or 'none'}",
        )

    db.commit()
    db.refresh(row)
    return PurchaseOut.model_validate(row).model_copy(update={"dispatch_id": dispatch_id})


@router.post("/{purchase_id}/approve", response_model=PurchaseOut)
def approve_purchase(
    purchase_id: int,
    auth: AuthContext = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    row = (
        db.query(Purchase)
        .filter(Purchase.id == purchase_id, Purchase.company_id == company_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if row.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Purchase is not pending approval")
    row.status = "approved"
    write_audit(
        db,
        action="approve",
        entity_type="purchase",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    db.refresh(row)
    return row


@router.post("/{purchase_id}/reject", response_model=PurchaseOut)
def reject_purchase(
    purchase_id: int,
    auth: AuthContext = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    row = (
        db.query(Purchase)
        .filter(Purchase.id == purchase_id, Purchase.company_id == company_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if row.status != "pending_approval":
        raise HTTPException(status_code=400, detail="Purchase is not pending approval")
    row.status = "rejected"
    if row.sales_order_id:
        so = db.query(SalesOrder).filter(SalesOrder.id == row.sales_order_id).first()
        if so and so.status in (SalesOrderStatus.CONFIRMED, SalesOrderStatus.INVOICED):
            so.ops_status = "shortage"
    write_audit(
        db,
        action="reject",
        entity_type="purchase",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    db.refresh(row)
    return row


@router.post("/{purchase_id}/receive", response_model=PurchaseOut)
def receive_purchase(
    purchase_id: int,
    body: PurchaseReceiveIn,
    auth: AuthContext = Depends(require_perms("purchases.edit")),
    db: Session = Depends(get_db),
):
    """Receive manufacturer stock + batch inward, then SO can be allocated."""
    company_id = auth.require_company()
    row = (
        db.query(Purchase)
        .filter(Purchase.id == purchase_id, Purchase.company_id == company_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if row.status not in ("approved", "Confirmed", "confirmed"):
        raise HTTPException(status_code=400, detail="Purchase must be approved before receive")
    if not row.product_id:
        raise HTTPException(status_code=400, detail="No product linked — receive via Inventory inward instead")

    stock_inbound(
        StockInwardIn(
            product_id=row.product_id,
            quantity=row.quantity,
            batch=body.batch,
            manufacturer=body.manufacturer or row.manufacturer,
            notes=body.notes or f"GRN PO-{row.id}",
        ),
        auth,
        db,
    )
    # stock_inbound commits — reload purchase
    row = db.query(Purchase).filter(Purchase.id == purchase_id).first()
    row.received = row.quantity
    row.status = "received"
    if row.sales_order_id:
        so = db.query(SalesOrder).filter(SalesOrder.id == row.sales_order_id).first()
        if so and so.status in (SalesOrderStatus.CONFIRMED, SalesOrderStatus.INVOICED):
            so.ops_status = "ready"
    write_audit(
        db,
        action="receive",
        entity_type="purchase",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"batch={body.batch}",
    )
    db.commit()
    db.refresh(row)
    return row
