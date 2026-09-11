from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session, joinedload

from app.core.models import (
    Customer,
    Dispatch,
    Product,
    Purchase,
    Quotation,
    RoleName,
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    StockBalance,
    Company,
    User,
    Vehicle,
)
from app.core.schemas import OrderDeskLine, OrderDeskOut, OutstandingDeliveryOut
from app.inventory.routes import _default_warehouse


def qty_short(ordered: Decimal, available: Decimal) -> Decimal:
    return max(Decimal("0"), Decimal(str(ordered or 0)) - Decimal(str(available or 0)))


def on_hand(db: Session, warehouse_id: int, product_id: int) -> Decimal:
    row = (
        db.query(StockBalance)
        .filter(StockBalance.warehouse_id == warehouse_id, StockBalance.product_id == product_id)
        .first()
    )
    return row.quantity if row else Decimal("0")


def normalize_delivery_mode(mode: str | None) -> str | None:
    """Return own_vehicle | manufacturer | None (legacy / unset)."""
    if mode is None:
        return None
    m = str(mode).strip().lower().replace("-", "_").replace(" ", "_")
    if not m:
        return None
    if m in ("manufacturer", "manufactor", "manuvacture", "manufacture"):
        return "manufacturer"
    if m in ("own_vehicle", "own", "vehicle", "fleet"):
        return "own_vehicle"
    return "own_vehicle"


def apply_delivery_plan(
    target: Quotation | SalesOrder,
    *,
    delivery_mode: str | None = None,
    planned_vehicle_id: int | None = None,
    planned_driver_user_id: int | None = None,
    planned_slot: str | None = None,
    planned_on_date=None,
) -> None:
    mode = normalize_delivery_mode(delivery_mode if delivery_mode is not None else getattr(target, "delivery_mode", None))
    if mode is None:
        mode = "own_vehicle"
    target.delivery_mode = mode
    if mode == "manufacturer":
        target.planned_vehicle_id = None
        target.planned_driver_user_id = None
        target.planned_slot = None
        target.planned_on_date = None
        return
    if planned_vehicle_id is not None:
        target.planned_vehicle_id = planned_vehicle_id
    if planned_driver_user_id is not None:
        target.planned_driver_user_id = planned_driver_user_id
    if planned_slot is not None:
        target.planned_slot = planned_slot
    if planned_on_date is not None:
        target.planned_on_date = planned_on_date


def delivery_labels(db: Session, so: SalesOrder) -> tuple[str | None, str | None]:
    """Vehicle plate + driver name from dispatch/plan for invoice / desk display."""
    load = (
        db.query(Dispatch)
        .filter(Dispatch.sales_order_id == so.id)
        .order_by(Dispatch.id.desc())
        .first()
    )
    vehicle = load.vehicle if load and load.vehicle else None
    driver = load.transporter if load and load.transporter else None
    if not vehicle and getattr(so, "planned_vehicle_id", None):
        veh = db.query(Vehicle).filter(Vehicle.id == so.planned_vehicle_id).first()
        vehicle = veh.plate if veh else None
    if not driver and getattr(so, "planned_driver_user_id", None):
        user = db.query(User).filter(User.id == so.planned_driver_user_id).first()
        driver = user.full_name if user else None
    if normalize_delivery_mode(getattr(so, "delivery_mode", None)) == "manufacturer":
        return ("Manufacturer", None)
    return vehicle, driver


def can_raise_invoice(so: SalesOrder) -> tuple[bool, str | None]:
    """Own-vehicle orders need vehicle + driver before Accounts can invoice.

    Legacy orders (delivery_mode unset) stay billable without assignment.
    """
    mode = normalize_delivery_mode(getattr(so, "delivery_mode", None))
    if mode is None:
        return True, None
    if mode == "manufacturer":
        return True, None
    if (so.ops_status or "") in ("allocated", "dispatched"):
        return True, None
    if getattr(so, "planned_vehicle_id", None) and getattr(so, "planned_driver_user_id", None):
        return True, None
    return False, "Assign vehicle and driver before raising the invoice"


def publish_planned_delivery_to_driver(
    db: Session,
    *,
    org_id: int,
    company_id: int,
    so: SalesOrder,
    user_id: int | None,
) -> bool:
    """After Owner approves: if truck+driver are planned, book the logistics run so the driver sees it.

    Before Owner approval, planned_* stays on the SO only — drivers must not see it yet.
    """
    from fastapi import HTTPException
    from app.logistics.routes import assign_order_to_window

    status = so.status.value if hasattr(so.status, "value") else str(so.status)
    if status not in ("confirmed", "invoiced"):
        return False
    if normalize_delivery_mode(getattr(so, "delivery_mode", None)) == "manufacturer":
        return False
    if not getattr(so, "planned_vehicle_id", None) or not getattr(so, "planned_driver_user_id", None):
        return False
    if (so.ops_status or "") in ("allocated", "dispatched"):
        return False

    veh = (
        db.query(Vehicle)
        .filter(
            Vehicle.id == so.planned_vehicle_id,
            Vehicle.organization_id == org_id,
            Vehicle.is_active.is_(True),
        )
        .first()
    )
    driver = (
        db.query(User)
        .options(joinedload(User.role))
        .filter(
            User.id == so.planned_driver_user_id,
            User.organization_id == org_id,
            User.is_active.is_(True),
        )
        .first()
    )
    if not veh or not driver or driver.role.name != RoleName.LOGISTICS:
        return False

    on_date = getattr(so, "planned_on_date", None) or date.today()
    slot = getattr(so, "planned_slot", None) or "afternoon"
    so.planned_on_date = on_date
    so.planned_slot = slot

    try:
        assign_order_to_window(
            db,
            org_id=org_id,
            company_id=company_id,
            so=so,
            on_date=on_date,
            slot=slot,
            veh=veh,
            user_id=user_id,
            driver_name=driver.full_name,
            require_ready=False,
        )
        return True
    except HTTPException:
        return False


def line_stock(db: Session, warehouse_id: int, lines) -> list[OrderDeskLine]:
    out: list[OrderDeskLine] = []
    for ln in lines:
        product = db.query(Product).filter(Product.id == ln.product_id).first()
        have = on_hand(db, warehouse_id, ln.product_id)
        outstanding = getattr(ln, "outstanding_qty", None)
        if outstanding is None:
            outstanding = qty_short(ln.quantity, have)
        out.append(
            OrderDeskLine(
                product_id=ln.product_id,
                product_name=product.name if product else f"Product #{ln.product_id}",
                quantity=ln.quantity,
                unit_price=ln.unit_price,
                on_hand=have,
                ok=have >= ln.quantity,
                outstanding_qty=outstanding or Decimal("0"),
            )
        )
    return out


def open_confirmed_from_quotation(db: Session, *, auth, quotation: Quotation) -> SalesOrder | None:
    """After quote approval, open a sales order for Superadmin to approve — not Supervisor yet."""
    existing = (
        db.query(SalesOrder)
        .filter(SalesOrder.quotation_id == quotation.id, SalesOrder.company_id == quotation.company_id)
        .first()
    )
    if existing:
        return existing
    warehouse = _default_warehouse(db, quotation.company_id, auth.organization_id)
    so = SalesOrder(
        organization_id=auth.organization_id,
        company_id=quotation.company_id,
        customer_id=quotation.customer_id,
        quotation_id=quotation.id,
        warehouse_id=warehouse.id,
        notes=quotation.notes,
        created_by_id=auth.user.id,
        status=SalesOrderStatus.DRAFT,
        ops_status="pending_approval",
        delivery_mode=normalize_delivery_mode(getattr(quotation, "delivery_mode", None)) or "own_vehicle",
        planned_vehicle_id=getattr(quotation, "planned_vehicle_id", None),
        planned_driver_user_id=getattr(quotation, "planned_driver_user_id", None),
        planned_slot=getattr(quotation, "planned_slot", None),
        planned_on_date=getattr(quotation, "planned_on_date", None),
    )
    if so.delivery_mode == "manufacturer":
        so.planned_vehicle_id = None
        so.planned_driver_user_id = None
        so.planned_slot = None
        so.planned_on_date = None
    db.add(so)
    db.flush()
    for ln in quotation.lines:
        have = on_hand(db, warehouse.id, ln.product_id)
        outstanding = qty_short(ln.quantity, have)
        db.add(
            SalesOrderLine(
                sales_order_id=so.id,
                product_id=ln.product_id,
                quantity=ln.quantity,
                unit_price=ln.unit_price,
                outstanding_qty=outstanding,
            )
        )
    quotation.status  # leave caller to set CONVERTED if desired
    return so


def desk_out(db: Session, so: SalesOrder) -> OrderDeskOut:
    so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == so.id).first() or so
    customer = db.query(Customer).filter(Customer.id == so.customer_id).first()
    company = db.query(Company).filter(Company.id == so.company_id).first()
    lines = line_stock(db, so.warehouse_id, so.lines)
    purchase = (
        db.query(Purchase)
        .filter(Purchase.sales_order_id == so.id)
        .order_by(Purchase.id.desc())
        .first()
    )
    load = (
        db.query(Dispatch)
        .filter(Dispatch.sales_order_id == so.id)
        .order_by(Dispatch.id.desc())
        .first()
    )
    vehicle, driver = delivery_labels(db, so)
    ok, _ = can_raise_invoice(so)
    return OrderDeskOut(
        id=so.id,
        company_id=so.company_id,
        company_name=(company.trade_name or company.legal_name) if company else None,
        customer_id=so.customer_id,
        customer_name=customer.name if customer else f"Customer #{so.customer_id}",
        quotation_id=so.quotation_id,
        warehouse_id=so.warehouse_id,
        status=so.status.value if hasattr(so.status, "value") else str(so.status),
        ops_status=so.ops_status or "pending_approval",
        notes=so.notes,
        confirmed_at=so.confirmed_at,
        created_at=so.created_at,
        lines=lines,
        stock_ok=all(ln.ok for ln in lines) if lines else False,
        dispatch_id=load.id if load else None,
        purchase_id=purchase.id if purchase else None,
        purchase_status=purchase.status if purchase else None,
        slot_date=load.slot_date if load else getattr(so, "planned_on_date", None),
        slot=load.slot if load else getattr(so, "planned_slot", None),
        vehicle=vehicle or (load.vehicle if load else None),
        delivery_mode=normalize_delivery_mode(getattr(so, "delivery_mode", None)) or "own_vehicle",
        planned_vehicle_id=getattr(so, "planned_vehicle_id", None),
        planned_driver_user_id=getattr(so, "planned_driver_user_id", None),
        planned_slot=getattr(so, "planned_slot", None),
        planned_on_date=getattr(so, "planned_on_date", None),
        driver_name=driver,
        can_invoice=ok,
    )


def apply_inbound_to_outstanding(db: Session, *, company_id: int, product_id: int, qty: Decimal) -> None:
    remaining = Decimal(str(qty or 0))
    if remaining <= 0:
        return
    lines = (
        db.query(SalesOrderLine)
        .join(SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id)
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.status.in_([SalesOrderStatus.CONFIRMED, SalesOrderStatus.INVOICED]),
            SalesOrderLine.product_id == product_id,
            SalesOrderLine.outstanding_qty > 0,
        )
        .order_by(SalesOrder.id.asc())
        .all()
    )
    touched: set[int] = set()
    for ln in lines:
        if remaining <= 0:
            break
        have = ln.outstanding_qty or Decimal("0")
        take = min(have, remaining)
        ln.outstanding_qty = have - take
        remaining -= take
        touched.add(ln.sales_order_id)
    for so_id in touched:
        so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == so_id).first()
        if so and all((x.outstanding_qty or Decimal("0")) <= 0 for x in so.lines):
            if (so.ops_status or "") in ("shortage", "procuring", "pending_verify"):
                so.ops_status = "ready"


def outstanding_rows(db: Session, *, company_id: int | None, org_id: int) -> list[OutstandingDeliveryOut]:
    q = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.organization_id == org_id,
            SalesOrder.status.in_([SalesOrderStatus.CONFIRMED, SalesOrderStatus.INVOICED]),
        )
    )
    if company_id is not None:
        q = q.filter(SalesOrder.company_id == company_id)
    rows = q.order_by(SalesOrder.id.desc()).all()
    companies = {
        c.id: (c.trade_name or c.legal_name)
        for c in db.query(Company).filter(Company.organization_id == org_id).all()
    }
    out: list[OutstandingDeliveryOut] = []
    for so in rows:
        customer = db.query(Customer).filter(Customer.id == so.customer_id).first()
        for ln in so.lines:
            qty_out = ln.outstanding_qty or Decimal("0")
            if qty_out <= 0:
                continue
            product = db.query(Product).filter(Product.id == ln.product_id).first()
            have = on_hand(db, so.warehouse_id, ln.product_id)
            out.append(
                OutstandingDeliveryOut(
                    order_id=so.id,
                    company_id=so.company_id,
                    company_name=companies.get(so.company_id),
                    customer_name=customer.name if customer else f"Customer #{so.customer_id}",
                    product_id=ln.product_id,
                    product_name=product.name if product else f"Product #{ln.product_id}",
                    unit=product.unit if product else "KG",
                    ordered_qty=ln.quantity,
                    outstanding_qty=qty_out,
                    on_hand=have,
                    ops_status=so.ops_status or "shortage",
                    can_complete=have >= qty_out,
                )
            )
    return out
