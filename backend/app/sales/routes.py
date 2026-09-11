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
    RoleName,
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    StockBalance,
    User,
    Vehicle,
    VehicleSlot,
    Warehouse,
)

# After Accounts invoices: only Sales / Supervisor allot the truck (Owner/Admin override).
ALLOT_ROLES = {
    RoleName.SALES,
    RoleName.SUPERVISOR,
    RoleName.OWNER,
    RoleName.SUPER_ADMIN,
}


def _require_allot_role(auth: AuthContext) -> None:
    if auth.role not in ALLOT_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only Sales or Supervisor can allot a driver after Accounts raises the invoice",
        )
from app.core.schemas import (
    AllocateDispatchIn,
    OrderDeskOut,
    OutstandingDeliveryOut,
    PlanDeliveryIn,
    RaisePurchaseIn,
    ReassignVehicleIn,
    SalesOrderCreate,
    SalesOrderOut,
)
from app.inventory.routes import _default_warehouse
from app.sales.ensure_schema import ensure_sales_schema
from app.sales.ops import (
    apply_delivery_plan,
    can_raise_invoice,
    delivery_labels,
    desk_out,
    line_stock,
    normalize_delivery_mode,
    on_hand,
    outstanding_rows,
    publish_planned_delivery_to_driver,
    qty_short,
)

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
    created_by_name = None
    company_name = None
    lines_out: list[dict] = []
    if db is not None:
        logistics_status, vehicle, eta = _logistics_for(db, so.id)
        if so.created_by_id:
            creator = db.query(User).filter(User.id == so.created_by_id).first()
            created_by_name = creator.full_name if creator else None
        from app.core.models import Company

        company = db.query(Company).filter(Company.id == so.company_id).first()
        company_name = (company.trade_name or company.legal_name) if company else None
        for ln in so.lines:
            product = db.query(Product).filter(Product.id == ln.product_id).first()
            have = on_hand(db, so.warehouse_id, ln.product_id)
            ordered = Decimal(str(ln.quantity or 0))
            extra = qty_short(ordered, have)  # ordered beyond what we have
            wholesale = Decimal(str(product.base_price if product else 0))
            selling = Decimal(str((product.selling_price if product and product.selling_price else wholesale) or 0))
            requested = Decimal(str(ln.unit_price or 0))
            lines_out.append(
                {
                    "id": ln.id,
                    "product_id": ln.product_id,
                    "product_name": product.name if product else f"Product #{ln.product_id}",
                    "unit": product.unit if product else "KG",
                    "quantity": float(ordered),
                    "on_hand": float(have),
                    "extra_qty": float(extra),
                    "stock_ok": have >= ordered,
                    "unit_price": float(requested),
                    "requested_price": float(requested),
                    "wholesale_price": float(wholesale),
                    "selling_price": float(selling),
                    "below_wholesale": requested < wholesale,
                    "outstanding_qty": float(getattr(ln, "outstanding_qty", 0) or 0),
                }
            )
    else:
        lines_out = [
            {
                "id": ln.id,
                "product_id": ln.product_id,
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unit_price),
                "outstanding_qty": float(getattr(ln, "outstanding_qty", 0) or 0),
            }
            for ln in so.lines
        ]
    v_label, d_label = delivery_labels(db, so) if db else (None, None)
    return SalesOrderOut(
        id=so.id,
        company_id=so.company_id,
        company_name=company_name,
        customer_id=so.customer_id,
        quotation_id=so.quotation_id,
        warehouse_id=so.warehouse_id,
        status=so.status.value,
        notes=so.notes,
        lines=lines_out,
        stock_warnings=warnings or [],
        ops_status=getattr(so, "ops_status", None) or "pending_approval",
        customer_name=customer_name,
        created_by_id=so.created_by_id,
        created_by_name=created_by_name,
        created_at=so.created_at,
        confirmed_at=so.confirmed_at,
        logistics_status=logistics_status,
        vehicle=vehicle or v_label,
        eta=eta,
        delivery_mode=normalize_delivery_mode(getattr(so, "delivery_mode", None)) or "own_vehicle",
        planned_vehicle_id=getattr(so, "planned_vehicle_id", None),
        planned_driver_user_id=getattr(so, "planned_driver_user_id", None),
        planned_slot=getattr(so, "planned_slot", None),
        planned_on_date=getattr(so, "planned_on_date", None),
        driver_name=d_label,
        can_invoice=can_raise_invoice(so)[0],
    )


@router.get("", response_model=list[SalesOrderOut])
def list_orders(
    auth: AuthContext = Depends(require_perms("sales.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    ensure_sales_schema(engine)
    q = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(SalesOrder.organization_id == auth.organization_id)
    )
    if company_id is not None:
        q = q.filter(SalesOrder.company_id == company_id)
    rows = q.order_by(SalesOrder.id.desc()).all()
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
    company_id = auth.company_or_all()
    return outstanding_rows(db, company_id=company_id, org_id=auth.organization_id)


@router.get("/desk", response_model=list[OrderDeskOut])
def order_desk(
    auth: AuthContext = Depends(require_perms("sales.view")),
    db: Session = Depends(get_db),
):
    """Order desk: invoiced orders — Supervisor confirms stock, then Sales/Supervisor allot driver."""
    company_id = auth.company_or_all()
    ensure_sales_schema(engine)
    q = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.organization_id == auth.organization_id,
            SalesOrder.status == SalesOrderStatus.INVOICED,
        )
    )
    if company_id is not None:
        q = q.filter(SalesOrder.company_id == company_id)
    rows = q.order_by(SalesOrder.id.desc()).all()
    return [desk_out(db, so) for so in rows]


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
    apply_delivery_plan(
        so,
        delivery_mode=body.delivery_mode
        or (getattr(quotation, "delivery_mode", None) if quotation else None),
        planned_vehicle_id=body.planned_vehicle_id
        if body.planned_vehicle_id is not None
        else (getattr(quotation, "planned_vehicle_id", None) if quotation else None),
        planned_driver_user_id=body.planned_driver_user_id
        if body.planned_driver_user_id is not None
        else (getattr(quotation, "planned_driver_user_id", None) if quotation else None),
        planned_slot=body.planned_slot
        if body.planned_slot is not None
        else (getattr(quotation, "planned_slot", None) if quotation else None),
        planned_on_date=body.planned_on_date
        if body.planned_on_date is not None
        else (getattr(quotation, "planned_on_date", None) if quotation else None),
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
    # If Sales already planned truck+driver at order time, publish to driver now (not before).
    published = publish_planned_delivery_to_driver(
        db,
        org_id=auth.organization_id,
        company_id=company_id,
        so=so,
        user_id=auth.user.id,
    )
    write_audit(
        db,
        action="approve",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=(credit_note or "") + (" · published to driver" if published else ""),
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


@router.post("/{order_id}/verify-stock", response_model=OrderDeskOut)
def verify_stock(
    order_id: int,
    auth: AuthContext = Depends(require_perms("sales.edit")),
    db: Session = Depends(get_db),
):
    """Sales (or Supervisor) confirms on-hand after Accounts invoice — not a Supervisor-only gate."""
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if so.status != SalesOrderStatus.INVOICED:
        raise HTTPException(status_code=400, detail="Accounts must raise the invoice before stock confirm")
    lines = line_stock(db, so.warehouse_id, so.lines)
    stock_ok = all(ln.ok for ln in lines)
    # Keep allocated/dispatched if truck was published to the driver after Owner approve.
    prior = so.ops_status or ""
    if prior in ("allocated", "dispatched"):
        if not stock_ok:
            so.ops_status = "shortage"
        elif stock_ok:
            for ln in so.lines:
                ln.outstanding_qty = Decimal("0")
            # leave ops_status as allocated/dispatched
    else:
        so.ops_status = "ready" if stock_ok else "shortage"
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
    company_id = auth.company_or_all()
    if company_id is None:
        so = (
            db.query(SalesOrder)
            .options(joinedload(SalesOrder.lines))
            .filter(SalesOrder.id == order_id, SalesOrder.organization_id == auth.organization_id)
            .first()
        )
        if not so:
            raise HTTPException(status_code=404, detail="Sales order not found")
    else:
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
        if (so.ops_status or "") not in ("allocated", "dispatched"):
            so.ops_status = "ready"
    write_audit(
        db,
        action="fulfill_outstanding",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=so.company_id,
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


@router.post("/{order_id}/plan-delivery", response_model=OrderDeskOut)
def plan_delivery(
    order_id: int,
    body: PlanDeliveryIn,
    auth: AuthContext = Depends(require_perms("sales.create")),
    db: Session = Depends(get_db),
):
    """Sales can set manufacturer vs own vehicle (+ optional truck/driver) any time before logistics starts."""
    _require_allot_role(auth)
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if (so.ops_status or "") in ("allocated", "dispatched"):
        raise HTTPException(status_code=400, detail="Delivery already booked with logistics — use reassign if needed")
    mode = normalize_delivery_mode(body.delivery_mode)
    if mode == "manufacturer":
        apply_delivery_plan(so, delivery_mode="manufacturer")
        write_audit(
            db,
            action="plan_delivery",
            entity_type="sales_order",
            entity_id=so.id,
            organization_id=auth.organization_id,
            company_id=company_id,
            user_id=auth.user.id,
            detail="manufacturer",
        )
        db.commit()
        return desk_out(db, so)

    if body.vehicle_id or body.driver_user_id:
        if not body.vehicle_id or not body.driver_user_id:
            raise HTTPException(status_code=400, detail="Pick both vehicle and logistics driver")
        if body.slot and body.slot not in ("morning", "afternoon", "evening"):
            raise HTTPException(status_code=400, detail="Slot must be morning, afternoon or evening")
        veh = (
            db.query(Vehicle)
            .filter(
                Vehicle.id == body.vehicle_id,
                Vehicle.organization_id == auth.organization_id,
                Vehicle.is_active.is_(True),
            )
            .first()
        )
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        driver = (
            db.query(User)
            .options(joinedload(User.role))
            .filter(
                User.id == body.driver_user_id,
                User.organization_id == auth.organization_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if not driver or driver.role.name != RoleName.LOGISTICS:
            raise HTTPException(status_code=400, detail="Pick an active logistics driver account")
        apply_delivery_plan(
            so,
            delivery_mode="own_vehicle",
            planned_vehicle_id=body.vehicle_id,
            planned_driver_user_id=body.driver_user_id,
            planned_slot=body.slot,
            planned_on_date=body.on_date,
        )
        detail = f"vehicle={veh.plate} driver={driver.full_name}"
        # After Owner approval, assigning truck should appear on the driver's phone.
        published = publish_planned_delivery_to_driver(
            db,
            org_id=auth.organization_id,
            company_id=company_id,
            so=so,
            user_id=auth.user.id,
        )
        if published:
            detail += " · published to driver"
    else:
        apply_delivery_plan(so, delivery_mode="own_vehicle")
        detail = "own_vehicle (no truck yet)"

    write_audit(
        db,
        action="plan_delivery",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=detail,
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
    """Sales or Supervisor: pick vehicle, then logistics driver, then book the window.

    Allowed after Owner approval (CONFIRMED) or after Accounts invoices — stock must be ready.
    Planning vehicle earlier (without booking a run) uses /plan-delivery.
    """
    from app.core.models import Role, User
    from app.logistics.routes import assign_order_to_window
    from sqlalchemy.orm import joinedload

    _require_allot_role(auth)
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if normalize_delivery_mode(getattr(so, "delivery_mode", None)) == "manufacturer":
        raise HTTPException(status_code=400, detail="Manufacturer delivery — no vehicle allotment needed")
    if so.status not in (SalesOrderStatus.INVOICED, SalesOrderStatus.CONFIRMED):
        raise HTTPException(status_code=400, detail="Owner must approve the order before assigning a driver")
    if (so.ops_status or "") != "ready":
        raise HTTPException(status_code=400, detail="Verify stock (and receive purchase if short) before assigning")
    if body.slot not in ("morning", "afternoon", "evening"):
        raise HTTPException(status_code=400, detail="Slot must be morning, afternoon or evening")
    if not body.vehicle_id:
        raise HTTPException(status_code=400, detail="Select a vehicle first")
    if not body.driver_user_id:
        raise HTTPException(status_code=400, detail="Select a logistics driver after the vehicle")

    lines = line_stock(db, so.warehouse_id, so.lines)
    if not all(ln.ok for ln in lines):
        raise HTTPException(status_code=400, detail="Stock still short — raise purchase or receive inward first")

    veh = (
        db.query(Vehicle)
        .filter(
            Vehicle.id == body.vehicle_id,
            Vehicle.organization_id == auth.organization_id,
            Vehicle.is_active.is_(True),
        )
        .first()
    )
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    driver = (
        db.query(User)
        .options(joinedload(User.role))
        .filter(
            User.id == body.driver_user_id,
            User.organization_id == auth.organization_id,
            User.is_active.is_(True),
        )
        .first()
    )
    if not driver or driver.role.name != RoleName.LOGISTICS:
        raise HTTPException(status_code=400, detail="Pick an active logistics driver account")

    apply_delivery_plan(
        so,
        delivery_mode="own_vehicle",
        planned_vehicle_id=body.vehicle_id,
        planned_driver_user_id=body.driver_user_id,
        planned_slot=body.slot,
        planned_on_date=body.on_date,
    )

    run = assign_order_to_window(
        db,
        org_id=auth.organization_id,
        company_id=company_id,
        so=so,
        on_date=body.on_date,
        slot=body.slot,
        veh=veh,
        user_id=auth.user.id,
        driver_name=driver.full_name,
    )
    write_audit(
        db,
        action="allocate",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"run={run.number} slot={body.slot} date={body.on_date} vehicle={veh.plate} driver={driver.full_name}",
    )
    db.commit()
    return desk_out(db, so)


@router.post("/{order_id}/reassign-vehicle", response_model=OrderDeskOut)
def reassign_vehicle(
    order_id: int,
    body: ReassignVehicleIn,
    auth: AuthContext = Depends(require_perms("dispatch.create")),
    db: Session = Depends(get_db),
):
    """Sales / Supervisor can switch truck before logistics starts (Going)."""
    from app.core.models import LogisticsRun, LogisticsStop
    from app.logistics.routes import BOOKED_RUN, _set_slot

    _require_allot_role(auth)
    company_id = auth.require_company()
    so = _load_so(db, company_id, auth.organization_id, order_id)
    if (so.ops_status or "") != "allocated":
        raise HTTPException(status_code=400, detail="Order is not assigned to logistics yet")
    if so.status != SalesOrderStatus.INVOICED:
        raise HTTPException(status_code=400, detail="Only invoiced orders can change vehicle")

    stop = (
        db.query(LogisticsStop)
        .join(LogisticsRun, LogisticsRun.id == LogisticsStop.run_id)
        .filter(
            LogisticsStop.sales_order_id == so.id,
            LogisticsRun.status.in_(BOOKED_RUN),
        )
        .order_by(LogisticsStop.id.desc())
        .first()
    )
    if not stop:
        raise HTTPException(
            status_code=400,
            detail="Cannot change vehicle — driver already started this run",
        )
    run = db.query(LogisticsRun).filter(LogisticsRun.id == stop.run_id).first()
    if not run or (run.status or "planned") not in BOOKED_RUN:
        raise HTTPException(
            status_code=400,
            detail="Cannot change vehicle — driver already started this run",
        )

    veh = (
        db.query(Vehicle)
        .filter(
            Vehicle.id == body.vehicle_id,
            Vehicle.organization_id == auth.organization_id,
            Vehicle.is_active.is_(True),
        )
        .first()
    )
    if not veh:
        raise HTTPException(status_code=404, detail="Vehicle not found")

    driver_name = None
    if body.driver_user_id:
        from sqlalchemy.orm import joinedload

        driver = (
            db.query(User)
            .options(joinedload(User.role))
            .filter(
                User.id == body.driver_user_id,
                User.organization_id == auth.organization_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if not driver or driver.role.name != RoleName.LOGISTICS:
            raise HTTPException(status_code=400, detail="Pick an active logistics driver account")
        driver_name = driver.full_name

    old_vehicle_id = run.vehicle_id
    slot = getattr(run, "slot", None) or "afternoon"
    if old_vehicle_id and old_vehicle_id != veh.id:
        _set_slot(db, old_vehicle_id, run.on_date, slot, "free")
    run.vehicle_id = veh.id
    run.driver_name = driver_name or run.driver_name
    _set_slot(db, veh.id, run.on_date, slot, "booked")

    load = (
        db.query(Dispatch)
        .filter(Dispatch.sales_order_id == so.id)
        .order_by(Dispatch.id.desc())
        .first()
    )
    if load:
        load.vehicle = veh.plate
        load.transporter = run.driver_name

    so.ops_status = "allocated"
    write_audit(
        db,
        action="reassign_vehicle",
        entity_type="sales_order",
        entity_id=so.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"run={run.number} vehicle={veh.plate} driver={run.driver_name}",
    )
    db.commit()
    return desk_out(db, so)
