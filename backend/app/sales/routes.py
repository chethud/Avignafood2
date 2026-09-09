from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.audit.service import write_audit
from app.core.database import engine, get_db
from app.core.deps import AuthContext, require_owner, require_perms
from app.core.models import (
    Customer,
    Dispatch,
    Invoice,
    InvoiceStatus,
    Product,
    Purchase,
    Quotation,
    QuotationStatus,
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    StockBalance,
    Vehicle,
    VehicleSlot,
    Warehouse,
)
from app.core.schemas import (
    AllocateDispatchIn,
    OrderDeskOut,
    OutstandingDeliveryOut,
    RaisePurchaseIn,
    SalesOrderCreate,
    SalesOrderOut,
)
from app.inventory.routes import _default_warehouse
from app.sales.ensure_schema import ensure_sales_schema
from app.sales.ops import desk_out, line_stock, on_hand, outstanding_rows, qty_short

router = APIRouter(prefix="/sales-orders", tags=["sales"])


def _stock_qty(db: Session, warehouse_id: int, product_id: int) -> Decimal:
    row = (
        db.query(StockBalance)
        .filter(StockBalance.warehouse_id == warehouse_id, StockBalance.product_id == product_id)
        .first()
    )
    return row.quantity if row else Decimal("0")


def _logistics_for(db: Session, so_id: int) -> tuple[str | None, str | None, str | None]:
    from app.core.models import LogisticsRun, LogisticsStop, Vehicle

    stop = (
        db.query(LogisticsStop)
        .filter(LogisticsStop.sales_order_id == so_id)
        .order_by(LogisticsStop.id.desc())
        .first()
    )
    if not stop:
        return None, None, None
    run = db.query(LogisticsRun).filter(LogisticsRun.id == stop.run_id).first()
    plate = None
    if run and run.vehicle_id:
        veh = db.query(Vehicle).filter(Vehicle.id == run.vehicle_id).first()
        plate = veh.plate if veh else None
    status = stop.status if stop.status != "pending" else (run.status if run else None)
    eta = str(run.on_date) if run else None
    return status, plate, eta


def _out(so: SalesOrder, warnings: list[str] | None = None, customer_name: str | None = None, db: Session | None = None) -> SalesOrderOut:
    logistics_status = vehicle = eta = None
    if db is not None:
        logistics_status, vehicle, eta = _logistics_for(db, so.id)
    return SalesOrderOut(
        id=so.id,
        company_id=so.company_id,
        customer_id=so.customer_id,
        quotation_id=so.quotation_id,
        warehouse_id=so.warehouse_id,
        status=so.status.value,
        notes=so.notes,
        lines=[
            {
                "id": ln.id,
                "product_id": ln.product_id,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unit_price),
                "outstanding_qty": float(getattr(ln, "outstanding_qty", 0) or 0),
            }
            for ln in so.lines
        ],
        stock_warnings=warnings or [],
        ops_status=getattr(so, "ops_status", None) or "pending_approval",
        customer_name=customer_name,
        created_at=so.created_at,
        confirmed_at=so.confirmed_at,
        logistics_status=logistics_status,
        vehicle=vehicle,
        eta=eta,
    )


@router.get("", response_model=list[SalesOrderOut])
def list_orders(
    auth: AuthContext = Depends(require_perms("sales.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    ensure_sales_schema(engine)
    rows = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(SalesOrder.company_id == company_id, SalesOrder.organization_id == auth.organization_id)
        .order_by(SalesOrder.id.desc())
        .all()
    )
    names = {
        c.id: c.name
        for c in db.query(Customer).filter(Customer.id.in_({r.customer_id for r in rows} or {0})).all()
    }
    return [_out(r, customer_name=names.get(r.customer_id), db=db) for r in rows]


@router.get("/outstanding", response_model=list[OutstandingDeliveryOut])
def list_outstanding_delivery(
    auth: AuthContext = Depends(require_perms("sales.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    return outstanding_rows(db, company_id=company_id, org_id=auth.organization_id)


@router.post("", response_model=SalesOrderOut)
def create_order(
    body: SalesOrderCreate,
    auth: AuthContext = Depends(require_perms("sales.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    ensure_sales_schema(engine)
    lines = body.lines
    quotation = None
    if body.quotation_id:
        quotation = (
            db.query(Quotation)
            .options(joinedload(Quotation.lines))
            .filter(Quotation.id == body.quotation_id, Quotation.company_id == company_id)
            .first()
        )
        if not quotation:
            raise HTTPException(status_code=404, detail="Quotation not found")
        if quotation.status not in (QuotationStatus.ACCEPTED, QuotationStatus.APPROVED):
            raise HTTPException(status_code=400, detail="Quotation not accepted/approved")
        lines = [
            type("L", (), {"product_id": ln.product_id, "quantity": ln.quantity, "unit_price": ln.unit_price})()
            for ln in quotation.lines
        ]

    if not lines:
        raise HTTPException(status_code=400, detail="At least one line required")

    warehouse_id = body.warehouse_id
    if warehouse_id is None:
        warehouse_id = _default_warehouse(db, company_id, auth.organization_id).id
    else:
        wh = db.query(Warehouse).filter(Warehouse.id == warehouse_id, Warehouse.company_id == company_id).first()
        if not wh:
            raise HTTPException(status_code=404, detail="Warehouse not found")

    so = SalesOrder(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=body.customer_id if not quotation else quotation.customer_id,
        quotation_id=body.quotation_id,
        warehouse_id=warehouse_id,
        notes=body.notes,
        created_by_id=auth.user.id,
        status=SalesOrderStatus.DRAFT,
        ops_status="pending_approval",
    )
    db.add(so)
    db.flush()
    for line in lines:
        product = (
            db.query(Product)
            .filter(Product.id == line.product_id, Product.company_id == company_id)
            .first()
        )
        if not product:
            raise HTTPException(status_code=400, detail=f"Product {line.product_id} not found")
        outstanding = qty_short(line.quantity, on_hand(db, warehouse_id, line.product_id))
        db.add(
            SalesOrderLine(
                sales_order_id=so.id,
                product_id=line.product_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                outstanding_qty=outstanding,
            )
        )
    if quotation:
        quotation.status = QuotationStatus.CONVERTED
    write_audit(
        db,
        action="create",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == so.id).first()
    return _out(so, db=db)


def _credit_hold(db: Session, company_id: int, so: SalesOrder) -> str | None:
    """Return a credit warning for audit; never blocks Owner / Super Admin approval."""
    customer = db.query(Customer).filter(Customer.id == so.customer_id).first()
    if not customer:
        return None
    open_invs = (
        db.query(Invoice)
        .filter(
            Invoice.customer_id == customer.id,
            Invoice.company_id == company_id,
            Invoice.status.in_([InvoiceStatus.OPEN, InvoiceStatus.PARTIAL]),
        )
        .all()
    )
    outstanding = sum((i.total - i.amount_paid for i in open_invs), Decimal("0"))
    overdue = any(i.due_date and i.due_date < datetime.now(timezone.utc).date() for i in open_invs)
    order_value = sum((ln.quantity * ln.unit_price for ln in so.lines), Decimal("0"))
    limit = customer.credit_limit or Decimal("0")
    notes: list[str] = []
    if overdue:
        notes.append("customer has overdue invoices")
    if limit > 0 and (outstanding + order_value) > limit:
        notes.append(f"exposure {outstanding + order_value} exceeds limit {limit}")
    return "; ".join(notes) if notes else None


@router.post("/{order_id}/confirm", response_model=SalesOrderOut)
def confirm_order(
    order_id: int,
    auth: AuthContext = Depends(require_perms("sales.edit")),
    db: Session = Depends(get_db),
):
    """Sales submits a draft to Super Admin. Does not confirm — Owner/Super Admin must approve."""
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if so.status != SalesOrderStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Only draft orders can be sent for approval")
    so.ops_status = "pending_approval"
    write_audit(
        db,
        action="submit_approval",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == so.id).first()
    return _out(so, db=db)


@router.post("/{order_id}/approve", response_model=SalesOrderOut)
def approve_order(
    order_id: int,
    auth: AuthContext = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    """Super Admin / Owner approves the order. It then goes to Accounts to raise the invoice."""
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if so.status != SalesOrderStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Only draft orders can be approved")
    credit_note = _credit_hold(db, company_id, so)
    so.status = SalesOrderStatus.CONFIRMED
    so.confirmed_at = datetime.now(timezone.utc)
    so.ops_status = "awaiting_invoice"
    write_audit(
        db,
        action="approve",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=credit_note,
    )
    db.commit()
    so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == so.id).first()
    return _out(so, db=db)


@router.post("/{order_id}/reject", response_model=SalesOrderOut)
def reject_order(
    order_id: int,
    auth: AuthContext = Depends(require_owner()),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if so.status != SalesOrderStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Only draft orders can be declined")
    so.status = SalesOrderStatus.CANCELLED
    so.ops_status = "rejected"
    write_audit(
        db,
        action="reject",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == so.id).first()
    return _out(so, db=db)


def _load_so(db: Session, company_id: int, org_id: int, order_id: int) -> SalesOrder:
    so = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.id == order_id,
            SalesOrder.company_id == company_id,
            SalesOrder.organization_id == org_id,
        )
        .first()
    )
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return so


@router.get("/desk", response_model=list[OrderDeskOut])
def order_desk(
    auth: AuthContext = Depends(require_perms("sales.view")),
    db: Session = Depends(get_db),
):
    """Supervisor queue: invoiced orders after Accounts raises the bill. Super Admin approval is already done."""
    company_id = auth.require_company()
    ensure_sales_schema(engine)
    rows = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.organization_id == auth.organization_id,
            SalesOrder.status == SalesOrderStatus.INVOICED,
        )
        .order_by(SalesOrder.id.desc())
        .all()
    )
    return [desk_out(db, so) for so in rows]


@router.post("/{order_id}/verify-stock", response_model=OrderDeskOut)
def verify_stock(
    order_id: int,
    auth: AuthContext = Depends(require_perms("sales.edit")),
    db: Session = Depends(get_db),
):
    """Second stock check — Supervisor confirms after Accounts has raised the invoice."""
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if so.status != SalesOrderStatus.INVOICED:
        raise HTTPException(status_code=400, detail="Accounts must raise the invoice before supervisor confirm")
    lines = line_stock(db, so.warehouse_id, so.lines)
    so.ops_status = "ready" if all(ln.ok for ln in lines) else "shortage"
    if so.ops_status == "ready":
        for ln in so.lines:
            ln.outstanding_qty = Decimal("0")
    write_audit(
        db,
        action="verify_stock",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=so.ops_status,
    )
    db.commit()
    return desk_out(db, so)


@router.post("/{order_id}/fulfill-outstanding", response_model=OrderDeskOut)
def fulfill_outstanding(
    order_id: int,
    auth: AuthContext = Depends(require_perms("sales.edit")),
    db: Session = Depends(get_db),
):
    """After new stock arrives, clear remaining delivery on this order."""
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    for ln in so.lines:
        need = ln.outstanding_qty or Decimal("0")
        if need <= 0:
            continue
        have = _stock_qty(db, so.warehouse_id, ln.product_id)
        if have < need:
            product = db.query(Product).filter(Product.id == ln.product_id).first()
            name = product.name if product else f"Product {ln.product_id}"
            raise HTTPException(
                status_code=400,
                detail=f"Still short on {name}: need {need} more, have {have}",
            )
        ln.outstanding_qty = Decimal("0")
    if all((ln.outstanding_qty or Decimal("0")) <= 0 for ln in so.lines):
        so.ops_status = "ready"
    write_audit(
        db,
        action="fulfill_outstanding",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
    )
    db.commit()
    return desk_out(db, so)


@router.post("/{order_id}/raise-purchase", response_model=OrderDeskOut)
def raise_purchase(
    order_id: int,
    body: RaisePurchaseIn,
    auth: AuthContext = Depends(require_perms("purchases.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    lines = line_stock(db, so.warehouse_id, so.lines)
    short = [ln for ln in lines if not ln.ok]
    if body.product_id:
        short = [ln for ln in lines if ln.product_id == body.product_id] or short
    if not short:
        raise HTTPException(status_code=400, detail="Stock is sufficient — no purchase required")
    target = short[0]
    qty = body.quantity if body.quantity and body.quantity > 0 else (target.quantity - target.on_hand)
    if qty <= 0:
        qty = target.quantity
    row = Purchase(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=so.customer_id,
        source="sales_referral",
        manufacturer=(body.manufacturer or "").strip() or None,
        product=target.product_name,
        product_id=target.product_id,
        quantity=qty,
        received=Decimal("0"),
        value=Decimal("0"),
        status="pending_approval",
        notes=(body.notes or f"Shortage for SO-{so.id}").strip(),
        sales_order_id=so.id,
        created_by_id=auth.user.id,
    )
    db.add(row)
    so.ops_status = "procuring"
    write_audit(
        db,
        action="create",
        entity_type="purchase",
        entity_id=None,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"PR for SO-{so.id} product={target.product_id} qty={qty}",
    )
    db.commit()
    return desk_out(db, so)


@router.post("/{order_id}/allocate", response_model=OrderDeskOut)
def allocate_dispatch(
    order_id: int,
    body: AllocateDispatchIn,
    auth: AuthContext = Depends(require_perms("dispatch.create")),
    db: Session = Depends(get_db),
):
    """Supervisor or Sales assigns a READY order to a logistics window. Stock leaves when the truck goes."""
    from app.logistics.routes import assign_order_to_window

    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if so.status != SalesOrderStatus.INVOICED:
        raise HTTPException(status_code=400, detail="Accounts must raise the invoice before assigning a driver")
    if (so.ops_status or "") != "ready":
        raise HTTPException(status_code=400, detail="Verify stock (and receive purchase if short) before assigning")
    if body.slot not in ("morning", "afternoon", "evening"):
        raise HTTPException(status_code=400, detail="Slot must be morning, afternoon or evening")

    lines = line_stock(db, so.warehouse_id, so.lines)
    if not all(ln.ok for ln in lines):
        raise HTTPException(status_code=400, detail="Stock still short — raise purchase or receive inward first")

    veh = None
    if body.vehicle_id:
        veh = (
            db.query(Vehicle)
            .filter(Vehicle.id == body.vehicle_id, Vehicle.organization_id == auth.organization_id, Vehicle.is_active.is_(True))
            .first()
        )
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
    else:
        veh = (
            db.query(Vehicle)
            .filter(Vehicle.organization_id == auth.organization_id, Vehicle.is_active.is_(True))
            .order_by(Vehicle.id)
            .first()
        )
    if not veh:
        raise HTTPException(status_code=400, detail="No vehicle in fleet")

    run = assign_order_to_window(
        db,
        org_id=auth.organization_id,
        company_id=company_id,
        so=so,
        on_date=body.on_date,
        slot=body.slot,
        veh=veh,
        user_id=auth.user.id,
    )
    write_audit(
        db,
        action="allocate",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"run={run.number} slot={body.slot} date={body.on_date}",
    )
    db.commit()
    return desk_out(db, so)
