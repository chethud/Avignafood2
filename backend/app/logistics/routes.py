from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.audit.service import write_audit
from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import (
    Company,
    Customer,
    Dispatch,
    Invoice,
    LogisticsException,
    LogisticsRun,
    LogisticsStop,
    Product,
    RoleName,
    SalesOrder,
    SalesOrderStatus,
    StockBalance,
    Vehicle,
    VehicleSlot,
)
from app.core.schemas import (
    LogisticsDeliverIn,
    LogisticsExceptionOut,
    LogisticsExceptionPatch,
    LogisticsPodIn,
    LogisticsRunCreate,
    LogisticsRunOut,
    LogisticsRunPatch,
    LogisticsStatusIn,
    LogisticsStopOut,
    ReadyOrderOut,
)

router = APIRouter(prefix="/logistics", tags=["logistics"])

SLOTS = ("morning", "afternoon", "evening")
SLOT_LABEL = {"morning": "Morning", "afternoon": "Afternoon", "evening": "Evening"}

RUN_NEXT = {
    "planned": ("loaded", "dispatched", "going"),
    "loading": ("loaded", "dispatched", "going"),
    "loaded": ("dispatched", "going"),
    "dispatched": ("in_transit", "out_for_delivery", "returning"),
    "in_transit": ("out_for_delivery", "returning"),
    "out_for_delivery": ("delivered", "partial", "failed", "returning"),
    "returning": ("completed",),
}

OPEN_RUN = (
    "planned",
    "loading",
    "loaded",
    "dispatched",
    "in_transit",
    "out_for_delivery",
    "partial",
    "returning",
)
BOOKED_RUN = ("planned", "loading", "loaded")
LIVE_RUN = ("dispatched", "in_transit", "out_for_delivery", "partial")


def _truck_state(live: str | None) -> str:
    s = live or "idle"
    if s in ("traveling", "going"):
        return "going"
    if s in ("returning", "coming_back"):
        return "coming_back"
    return "idle"


def _qty_value(so: SalesOrder) -> tuple[Decimal, Decimal]:
    qty = sum((ln.quantity for ln in so.lines), Decimal("0"))
    value = sum((ln.quantity * ln.unit_price for ln in so.lines), Decimal("0"))
    return qty, value


def _fmt_qty(qty: Decimal, unit: str) -> str:
    unit = (unit or "KG").upper()
    n = float(qty)
    if unit == "KG" and n >= 1000:
        mt = n / 1000
        shown = str(int(mt)) if mt == int(mt) else f"{mt:g}"
        return f"{shown} MT"
    shown = str(int(n)) if n == int(n) else f"{n:g}"
    return f"{shown} {unit}"


def _product_summary(db: Session, so: SalesOrder) -> str:
    parts: list[str] = []
    for ln in so.lines:
        product = db.query(Product).filter(Product.id == ln.product_id).first()
        name = product.name if product else f"Item {ln.product_id}"
        unit = product.unit if product else "KG"
        parts.append(f"{name} {_fmt_qty(ln.quantity, unit)}")
    return " · ".join(parts) or "Load"


def _company_name(db: Session, company_id: int) -> str:
    co = db.query(Company).filter(Company.id == company_id).first()
    if not co:
        return ""
    return (co.trade_name or co.legal_name or "").upper()


def _set_vehicle_live(db: Session, vehicle_id: int | None, status: str) -> None:
    if not vehicle_id:
        return
    veh = db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
    if veh:
        veh.live_status = status


def _latest_run(db: Session, org_id: int, statuses: tuple[str, ...], vehicle_id: int | None = None) -> LogisticsRun | None:
    q = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(LogisticsRun.organization_id == org_id, LogisticsRun.status.in_(statuses))
    )
    if vehicle_id:
        q = q.filter(LogisticsRun.vehicle_id == vehicle_id)
    # For booked windows, prefer today's (or next) assignment so drivers see the allotted drop
    if set(statuses) <= set(BOOKED_RUN):
        today = date.today()
        return (
            q.filter(LogisticsRun.on_date >= today)
            .order_by(LogisticsRun.on_date.asc(), LogisticsRun.id.asc())
            .first()
        ) or q.order_by(LogisticsRun.on_date.desc(), LogisticsRun.id.desc()).first()
    return q.order_by(LogisticsRun.dispatched_at.desc().nulls_last(), LogisticsRun.id.desc()).first()


def _truck_payload(db: Session, org_id: int) -> dict:
    # Prefer the run that is actually assigned (any vehicle), not always fleet vehicle #1
    live_probe = _latest_run(db, org_id, LIVE_RUN)
    back_probe = _latest_run(db, org_id, ("returning",))
    booked_probe = _latest_run(db, org_id, BOOKED_RUN)
    active = live_probe or back_probe or booked_probe
    veh = None
    if active and active.vehicle_id:
        veh = db.query(Vehicle).filter(Vehicle.id == active.vehicle_id).first()
    if not veh:
        veh = _first_vehicle(db, org_id)
    live = _truck_state(veh.live_status if veh else "idle")
    if live == "going":
        run = live_probe or _latest_run(db, org_id, LIVE_RUN, veh.id if veh else None)
    elif live == "coming_back":
        run = back_probe or _latest_run(db, org_id, ("returning",), veh.id if veh else None)
    else:
        run = booked_probe or _latest_run(db, org_id, BOOKED_RUN, veh.id if veh else None)
    if run and run.vehicle_id:
        v2 = db.query(Vehicle).filter(Vehicle.id == run.vehicle_id).first()
        if v2:
            veh = v2
            # Sync idle truck display to the assigned vehicle's live flag when still planned
            if live == "idle" and _truck_state(v2.live_status) != "idle":
                live = _truck_state(v2.live_status)
    return {
        "status": live,
        "vehicle_id": veh.id if veh else None,
        "plate": veh.plate if veh else None,
        "name": veh.name if veh else None,
        "driver_name": (run.driver_name if run else None) or (veh.driver_name if veh else None),
        "run_id": run.id if run else None,
        "run_number": run.number if run else None,
        "on_date": run.on_date.isoformat() if run and run.on_date else None,
        "slot": getattr(run, "slot", None) if run else None,
    }


def _set_slot(db: Session, vehicle_id: int | None, on_date: date, slot: str, status: str) -> None:
    if not vehicle_id or slot not in SLOTS:
        return
    row = (
        db.query(VehicleSlot)
        .filter(VehicleSlot.vehicle_id == vehicle_id, VehicleSlot.on_date == on_date, VehicleSlot.slot == slot)
        .first()
    )
    if row:
        row.status = status
    else:
        db.add(VehicleSlot(vehicle_id=vehicle_id, on_date=on_date, slot=slot, status=status))


def _first_vehicle(db: Session, org_id: int) -> Vehicle | None:
    return (
        db.query(Vehicle)
        .filter(Vehicle.organization_id == org_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.id)
        .first()
    )


def _stop_out(db: Session, stop: LogisticsStop, company_id: int) -> LogisticsStopOut:
    customer = db.query(Customer).filter(Customer.id == stop.customer_id).first()
    so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == stop.sales_order_id).first()
    inv = db.query(Invoice).filter(Invoice.sales_order_id == stop.sales_order_id).first()
    return LogisticsStopOut(
        id=stop.id,
        sales_order_id=stop.sales_order_id,
        customer_id=stop.customer_id,
        customer_name=customer.name if customer else f"Customer {stop.customer_id}",
        address=(customer.shipping_address or customer.address) if customer else None,
        phone=customer.phone if customer else None,
        status=stop.status,
        qty_ordered=stop.qty_ordered or 0,
        qty_delivered=stop.qty_delivered or 0,
        receiver_name=stop.receiver_name,
        pod_url=stop.pod_url,
        signature_url=getattr(stop, "signature_url", None),
        fail_reason=stop.fail_reason,
        remarks=stop.remarks,
        product_summary=_product_summary(db, so) if so else "",
        company_name=_company_name(db, company_id),
        invoice_id=inv.id if inv else None,
        invoice_number=inv.number if inv else None,
        return_required=bool(getattr(stop, "return_required", False)),
        reattempt_date=getattr(stop, "reattempt_date", None),
    )


def _run_out(db: Session, run: LogisticsRun) -> LogisticsRunOut:
    run = db.query(LogisticsRun).options(joinedload(LogisticsRun.stops)).filter(LogisticsRun.id == run.id).first() or run
    veh = db.query(Vehicle).filter(Vehicle.id == run.vehicle_id).first() if run.vehicle_id else None
    stops = [_stop_out(db, s, run.company_id) for s in (run.stops or [])]
    total = sum((s.qty_ordered for s in stops), Decimal("0"))
    live = veh.live_status if veh else "idle"
    if run.status in LIVE_RUN:
        live = "going"
    elif run.status == "returning":
        live = "returning"
    elif run.status in ("completed", "delivered"):
        live = "idle"
    return LogisticsRunOut(
        id=run.id,
        number=run.number,
        on_date=run.on_date,
        slot=getattr(run, "slot", None) or "afternoon",
        vehicle_id=run.vehicle_id,
        vehicle_plate=veh.plate if veh else None,
        driver_name=run.driver_name,
        agency=run.agency or "Own Vehicle",
        route=run.route,
        status=run.status,
        notes=run.notes,
        dispatched_at=run.dispatched_at,
        total_qty=total,
        truck_state=_truck_state(live),
        stops=stops,
    )


def _busy_vehicle_ids(db: Session, company_id: int) -> set[int]:
    rows = (
        db.query(LogisticsRun.vehicle_id)
        .filter(LogisticsRun.company_id == company_id, LogisticsRun.status.in_(OPEN_RUN), LogisticsRun.vehicle_id.isnot(None))
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _window_taken(db: Session, org_id: int, on_date: date, slot: str, exclude_run_id: int | None = None) -> bool:
    q = db.query(LogisticsRun).filter(
        LogisticsRun.organization_id == org_id,
        LogisticsRun.on_date == on_date,
        LogisticsRun.status.in_(OPEN_RUN + ("delivered",)),
    )
    if exclude_run_id:
        q = q.filter(LogisticsRun.id != exclude_run_id)
    for run in q.all():
        if (getattr(run, "slot", None) or "afternoon") == slot:
            return True
    return False


def _dispatch_run(db: Session, run: LogisticsRun) -> None:
    if not run.vehicle_id or not run.driver_name:
        raise HTTPException(status_code=400, detail="Assign vehicle and driver before going out")
    run.dispatched_at = datetime.now(timezone.utc)
    run.status = "dispatched"
    _set_vehicle_live(db, run.vehicle_id, "going")
    for stop in run.stops:
        so = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == stop.sales_order_id).first()
        if so and so.ops_status == "allocated":
            _deduct_stock(db, so)
            so.ops_status = "dispatched"
        if stop.dispatch_id:
            load = db.query(Dispatch).filter(Dispatch.id == stop.dispatch_id).first()
            if load:
                load.status = "Dispatched"
        if stop.status == "pending":
            stop.status = "out_for_delivery"


def assign_order_to_window(
    db: Session,
    *,
    org_id: int,
    company_id: int,
    so: SalesOrder,
    on_date: date,
    slot: str,
    veh: Vehicle | None,
    user_id: int | None,
) -> LogisticsRun:
    """Supervisor assigns a READY order to a morning/afternoon/evening run."""
    slot = (slot or "afternoon").lower()
    if slot not in SLOTS:
        raise HTTPException(status_code=400, detail="Window must be morning, afternoon or evening")
    if (so.ops_status or "") != "ready":
        raise HTTPException(status_code=400, detail="Only READY orders can be assigned to logistics")
    taken = (
        db.query(LogisticsStop)
        .join(LogisticsRun, LogisticsRun.id == LogisticsStop.run_id)
        .filter(LogisticsStop.sales_order_id == so.id, LogisticsRun.status.in_(OPEN_RUN + ("delivered",)))
        .first()
    )
    if taken:
        raise HTTPException(status_code=400, detail="This order is already assigned to a run")
    run = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(
            LogisticsRun.organization_id == org_id,
            LogisticsRun.on_date == on_date,
            LogisticsRun.status.in_(BOOKED_RUN),
        )
        .all()
    )
    match = next((r for r in run if (getattr(r, "slot", None) or "afternoon") == slot), None)
    if match:
        if match.company_id != company_id:
            raise HTTPException(status_code=400, detail=f"{SLOT_LABEL[slot]} is already assigned")
        if veh and match.vehicle_id and match.vehicle_id != veh.id:
            raise HTTPException(status_code=400, detail="That window is already on another vehicle")
        target = match
    else:
        if _window_taken(db, org_id, on_date, slot):
            raise HTTPException(status_code=400, detail=f"{SLOT_LABEL[slot]} is already booked")
        year = date.today().year
        seq = (db.query(LogisticsRun).filter(LogisticsRun.company_id == company_id).count() or 0) + 1
        target = LogisticsRun(
            organization_id=org_id,
            company_id=company_id,
            number=f"RUN-{year}-{seq:04d}",
            on_date=on_date,
            slot=slot,
            vehicle_id=veh.id if veh else None,
            driver_name=(veh.driver_name if veh else None) or "Ravi Kumar",
            agency="Own Vehicle",
            status="planned",
            created_by_id=user_id,
        )
        db.add(target)
        db.flush()
        _set_slot(db, target.vehicle_id, on_date, slot, "booked")
    qty, _ = _qty_value(so)
    names = []
    for ln in so.lines:
        product = db.query(Product).filter(Product.id == ln.product_id).first()
        names.append(product.name if product else f"#{ln.product_id}")
    load = Dispatch(
        organization_id=org_id,
        company_id=company_id,
        customer_id=so.customer_id,
        product=", ".join(names) or "Order",
        quantity=qty,
        vehicle=veh.plate if veh else None,
        transporter=target.driver_name,
        status="Ready",
        notes=f"{target.number} · SO-{so.id}",
        created_by_id=user_id,
        sales_order_id=so.id,
        slot_date=on_date,
        slot=slot,
        eta=str(on_date),
    )
    db.add(load)
    db.flush()
    db.add(
        LogisticsStop(
            run_id=target.id,
            sales_order_id=so.id,
            customer_id=so.customer_id,
            dispatch_id=load.id,
            status="pending",
            qty_ordered=qty,
        )
    )
    so.ops_status = "allocated"
    return target


@router.get("/ready", response_model=list[ReadyOrderOut])
def ready_orders(
    auth: AuthContext = Depends(require_perms("dispatch.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    taken = {
        s.sales_order_id
        for s in db.query(LogisticsStop.sales_order_id)
        .join(LogisticsRun, LogisticsRun.id == LogisticsStop.run_id)
        .filter(LogisticsRun.company_id == company_id, LogisticsRun.status.in_(OPEN_RUN + ("delivered",)))
        .all()
    }
    rows = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.organization_id == auth.organization_id,
            SalesOrder.status == SalesOrderStatus.INVOICED,
            SalesOrder.ops_status == "ready",
        )
        .order_by(SalesOrder.id.desc())
        .all()
    )
    out: list[ReadyOrderOut] = []
    for so in rows:
        if so.id in taken:
            continue
        customer = db.query(Customer).filter(Customer.id == so.customer_id).first()
        qty, value = _qty_value(so)
        out.append(
            ReadyOrderOut(
                id=so.id,
                customer_id=so.customer_id,
                customer_name=customer.name if customer else f"Customer {so.customer_id}",
                address=(customer.shipping_address or customer.address) if customer else None,
                phone=customer.phone if customer else None,
                qty=qty,
                value=value,
                ops_status=so.ops_status,
                notes=so.notes,
                product_summary=_product_summary(db, so),
                company_name=_company_name(db, company_id),
            )
        )
    return out


@router.get("/runs", response_model=list[LogisticsRunOut])
def list_runs(
    on_date: date | None = Query(None),
    open_only: bool = Query(False, description="Open assignments for drivers (any company in org)"),
    auth: AuthContext = Depends(require_perms("dispatch.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    q = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(LogisticsRun.organization_id == auth.organization_id)
    )
    # Drivers need every allotted run in the org; Sales/Supervisor stay company-scoped
    if auth.role != RoleName.LOGISTICS and not open_only:
        q = q.filter(LogisticsRun.company_id == company_id)
    if open_only:
        q = q.filter(LogisticsRun.status.in_(OPEN_RUN + ("delivered",)))
    elif on_date:
        q = q.filter(LogisticsRun.on_date == on_date)
    rows = q.order_by(LogisticsRun.on_date.asc(), LogisticsRun.id.desc()).all()
    return [_run_out(db, r) for r in rows]


@router.post("/runs", response_model=LogisticsRunOut)
def plan_run(
    body: LogisticsRunCreate,
    auth: AuthContext = Depends(require_perms("dispatch.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    if auth.role == RoleName.LOGISTICS:
        raise HTTPException(status_code=400, detail="Supervisor assigns orders on Order desk")
    if not body.order_ids:
        raise HTTPException(status_code=400, detail="Pick at least one ready order")
    slot = (body.slot or "afternoon").lower()
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
        veh = _first_vehicle(db, auth.organization_id)
    orders = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.id.in_(body.order_ids),
            SalesOrder.company_id == company_id,
            SalesOrder.ops_status == "ready",
        )
        .all()
    )
    if len(orders) != len(set(body.order_ids)):
        raise HTTPException(status_code=400, detail="Only READY orders can be assigned. Warehouse must finish first.")
    run = None
    for so in orders:
        run = assign_order_to_window(
            db,
            org_id=auth.organization_id,
            company_id=company_id,
            so=so,
            on_date=body.on_date,
            slot=slot,
            veh=veh,
            user_id=auth.user.id,
        )
    write_audit(
        db,
        action="create",
        entity_type="logistics_run",
        entity_id=run.id if run else None,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=run.number if run else None,
    )
    db.commit()
    return _run_out(db, run)


@router.patch("/runs/{run_id}", response_model=LogisticsRunOut)
def patch_run(
    run_id: int,
    body: LogisticsRunPatch,
    auth: AuthContext = Depends(require_perms("dispatch.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    run = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(LogisticsRun.id == run_id, LogisticsRun.company_id == company_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    if (run.status or "planned") not in ("planned", "loading", "loaded"):
        raise HTTPException(status_code=400, detail="Cannot change assignment after dispatch")
    if body.vehicle_id is not None:
        veh = (
            db.query(Vehicle)
            .filter(Vehicle.id == body.vehicle_id, Vehicle.organization_id == auth.organization_id, Vehicle.is_active.is_(True))
            .first()
        )
        if not veh:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        busy = _busy_vehicle_ids(db, company_id) - {run.vehicle_id}
        if veh.id in busy:
            raise HTTPException(status_code=400, detail="Vehicle is already on an open trip")
        run.vehicle_id = veh.id
        if not body.driver_name and veh.driver_name and not run.driver_name:
            run.driver_name = veh.driver_name
    if body.driver_name is not None:
        run.driver_name = body.driver_name.strip() or None
    if body.agency is not None:
        run.agency = body.agency.strip() or "Own Vehicle"
    if body.route is not None:
        run.route = body.route.strip() or None
    if body.notes is not None:
        run.notes = body.notes
    db.commit()
    return _run_out(db, run)


def _deduct_stock(db: Session, so: SalesOrder) -> None:
    for ln in so.lines:
        row = (
            db.query(StockBalance)
            .filter(StockBalance.warehouse_id == so.warehouse_id, StockBalance.product_id == ln.product_id)
            .first()
        )
        if row:
            row.quantity = (row.quantity or Decimal("0")) - ln.quantity


@router.post("/runs/{run_id}/status", response_model=LogisticsRunOut)
def set_run_status(
    run_id: int,
    body: LogisticsStatusIn,
    auth: AuthContext = Depends(require_perms("dispatch.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    run = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(LogisticsRun.id == run_id, LogisticsRun.company_id == company_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    wanted = "dispatched" if body.status == "going" else body.status
    nxt = RUN_NEXT.get(run.status or "planned", ())
    if body.status not in nxt and wanted not in nxt:
        raise HTTPException(status_code=400, detail=f"Cannot move from {run.status} to {body.status}")
    if wanted == "dispatched":
        _dispatch_run(db, run)
    elif wanted == "loaded":
        run.status = "loaded"
    elif wanted == "returning":
        run.status = "returning"
        _set_vehicle_live(db, run.vehicle_id, "returning")
    elif wanted == "completed":
        run.status = "completed"
        _set_vehicle_live(db, run.vehicle_id, "idle")
    else:
        if wanted == "out_for_delivery":
            for stop in run.stops:
                if stop.status == "pending":
                    stop.status = "out_for_delivery"
        run.status = wanted
    db.commit()
    return _run_out(db, run)


@router.post("/runs/{run_id}/free")
def free_run(
    run_id: int,
    auth: AuthContext = Depends(require_perms("dispatch.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    run = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(LogisticsRun.id == run_id, LogisticsRun.company_id == company_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if auth.role == RoleName.LOGISTICS:
        raise HTTPException(status_code=400, detail="Ask supervisor to change the assignment")
    if (run.status or "planned") not in BOOKED_RUN:
        raise HTTPException(status_code=400, detail="Cannot free a run after the vehicle has left")
    slot = getattr(run, "slot", None) or "afternoon"
    _set_slot(db, run.vehicle_id, run.on_date, slot, "free")
    for stop in list(run.stops or []):
        so = db.query(SalesOrder).filter(SalesOrder.id == stop.sales_order_id).first()
        if so and so.ops_status == "allocated":
            so.ops_status = "ready"
        if stop.dispatch_id:
            load = db.query(Dispatch).filter(Dispatch.id == stop.dispatch_id).first()
            if load:
                db.delete(load)
        db.delete(stop)
    db.delete(run)
    db.commit()
    return {"ok": True}


@router.post("/runs/{run_id}/arrive", response_model=LogisticsRunOut)
def arrive_base(
    run_id: int,
    auth: AuthContext = Depends(require_perms("dispatch.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    run = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(LogisticsRun.id == run_id, LogisticsRun.company_id == company_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if (run.status or "") not in ("returning", "delivered", "partial", "failed"):
        raise HTTPException(status_code=400, detail="Finish all drops before arriving at base")
    run.status = "completed"
    _set_vehicle_live(db, run.vehicle_id, "idle")
    db.commit()
    return _run_out(db, run)


@router.get("/truck")
def truck_now(
    auth: AuthContext = Depends(require_perms("vehicles.view")),
    db: Session = Depends(get_db),
):
    return _truck_payload(db, auth.organization_id)


@router.post("/truck")
def set_truck(
    body: LogisticsStatusIn,
    auth: AuthContext = Depends(require_perms("dispatch.edit")),
    db: Session = Depends(get_db),
):
    wanted = (body.status or "").strip().lower()
    if wanted == "returning":
        wanted = "coming_back"
    if wanted not in ("idle", "going", "coming_back"):
        raise HTTPException(status_code=400, detail="Use idle, going or coming_back")
    veh = _first_vehicle(db, auth.organization_id)
    if not veh:
        raise HTTPException(status_code=400, detail="No vehicle in the fleet")
    # Prefer the allotted run (any vehicle), then fall back to fleet #1
    booked = _latest_run(db, auth.organization_id, BOOKED_RUN)
    live = _latest_run(db, auth.organization_id, LIVE_RUN)
    returning = _latest_run(db, auth.organization_id, ("returning",))
    if booked and booked.vehicle_id:
        veh = db.query(Vehicle).filter(Vehicle.id == booked.vehicle_id).first() or veh
    elif live and live.vehicle_id:
        veh = db.query(Vehicle).filter(Vehicle.id == live.vehicle_id).first() or veh
    vid = veh.id
    if wanted == "going":
        if booked:
            _dispatch_run(db, booked)
        elif live:
            _set_vehicle_live(db, live.vehicle_id or vid, "going")
        elif returning:
            returning.status = "dispatched"
            for stop in returning.stops or []:
                if stop.status == "pending":
                    stop.status = "out_for_delivery"
            _set_vehicle_live(db, returning.vehicle_id or vid, "going")
        else:
            raise HTTPException(status_code=400, detail="No assigned run yet. Sales or Supervisor must allot a driver first.")
    elif wanted == "coming_back":
        run = live
        if not run:
            raise HTTPException(status_code=400, detail="Tap Going and finish the drops first.")
        open_stops = [s for s in (run.stops or []) if s.status in ("pending", "out_for_delivery")]
        if open_stops:
            raise HTTPException(status_code=400, detail="Finish each drop (complete, partial or failed) first.")
        run.status = "returning"
        _set_vehicle_live(db, run.vehicle_id or vid, "returning")
    else:
        if not returning:
            raise HTTPException(status_code=400, detail="Coming back first, then tap Idle when you reach base.")
        returning.status = "completed"
        _set_vehicle_live(db, returning.vehicle_id or vid, "idle")
    db.commit()
    return _truck_payload(db, auth.organization_id)


@router.get("/windows")
def list_windows(
    on_date: date = Query(...),
    auth: AuthContext = Depends(require_perms("dispatch.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    rows = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(
            LogisticsRun.organization_id == auth.organization_id,
            LogisticsRun.on_date == on_date,
            LogisticsRun.status != "cancelled",
        )
        .all()
    )
    by_slot: dict[str, LogisticsRun] = {}
    for run in rows:
        if run.status == "completed":
            continue
        slot = getattr(run, "slot", None) or "afternoon"
        if slot not in by_slot:
            by_slot[slot] = run
    truck = truck_now(auth, db)
    windows = []
    for slot in SLOTS:
        run = by_slot.get(slot)
        windows.append(
            {
                "slot": slot,
                "label": SLOT_LABEL[slot],
                "status": "booked" if run else "free",
                "mine": bool(run and run.company_id == company_id),
                "run": _run_out(db, run) if run and run.company_id == company_id else None,
            }
        )
    return {"on_date": on_date.isoformat(), "truck": truck, "windows": windows}


@router.post("/stops/{stop_id}/deliver", response_model=LogisticsRunOut)
def deliver_stop(
    stop_id: int,
    body: LogisticsDeliverIn,
    auth: AuthContext = Depends(require_perms("deliveries.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    stop = db.query(LogisticsStop).filter(LogisticsStop.id == stop_id).first()
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    run = db.query(LogisticsRun).options(joinedload(LogisticsRun.stops)).filter(LogisticsRun.id == stop.run_id).first()
    if not run or run.company_id != company_id:
        raise HTTPException(status_code=404, detail="Stop not found")
    if (run.status or "") not in ("dispatched", "in_transit", "out_for_delivery", "partial"):
        raise HTTPException(status_code=400, detail="Start the run (Going) before recording delivery")
    outcome = body.outcome
    if outcome not in ("delivered", "partial", "failed"):
        raise HTTPException(status_code=400, detail="Outcome must be delivered, partial or failed")
    if outcome == "failed" and not (body.fail_reason or "").strip():
        raise HTTPException(status_code=400, detail="Choose a failure reason")
    stop.status = outcome
    stop.receiver_name = body.receiver_name
    stop.pod_url = body.pod_url
    if body.signature_url:
        stop.signature_url = body.signature_url
    stop.fail_reason = body.fail_reason
    stop.remarks = body.remarks
    stop.return_required = bool(body.return_required)
    stop.reattempt_date = body.reattempt_date
    stop.delivered_at = datetime.now(timezone.utc)
    ordered = stop.qty_ordered or Decimal("0")
    if outcome == "delivered":
        stop.qty_delivered = ordered
    elif outcome == "partial":
        delivered = body.qty_delivered if body.qty_delivered is not None else Decimal("0")
        if delivered <= 0 or delivered >= ordered:
            raise HTTPException(status_code=400, detail="Enter the quantity actually received")
        stop.qty_delivered = delivered
        db.add(
            LogisticsException(
                organization_id=auth.organization_id,
                company_id=company_id,
                sales_order_id=stop.sales_order_id,
                run_id=run.id,
                kind="shortage",
                detail=f"Delivered {delivered} of {ordered}",
            )
        )
    else:
        stop.qty_delivered = Decimal("0")
        db.add(
            LogisticsException(
                organization_id=auth.organization_id,
                company_id=company_id,
                sales_order_id=stop.sales_order_id,
                run_id=run.id,
                kind=body.fail_reason or "failed",
                detail=body.remarks or body.fail_reason or "Delivery failed",
            )
        )
    if body.return_required:
        db.add(
            LogisticsException(
                organization_id=auth.organization_id,
                company_id=company_id,
                sales_order_id=stop.sales_order_id,
                run_id=run.id,
                kind="return",
                detail=body.remarks or "Goods returning to warehouse",
            )
        )
    open_stops = [s for s in run.stops if s.status in ("pending", "out_for_delivery")]
    if not open_stops:
        run.status = "returning"
        _set_vehicle_live(db, run.vehicle_id, "returning")
    db.commit()
    return _run_out(db, run)


@router.post("/stops/{stop_id}/pod", response_model=LogisticsRunOut)
def set_pod(
    stop_id: int,
    body: LogisticsPodIn,
    auth: AuthContext = Depends(require_perms("deliveries.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    stop = db.query(LogisticsStop).filter(LogisticsStop.id == stop_id).first()
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    run = db.query(LogisticsRun).options(joinedload(LogisticsRun.stops)).filter(LogisticsRun.id == stop.run_id).first()
    if not run or run.company_id != company_id:
        raise HTTPException(status_code=404, detail="Stop not found")
    if stop.status not in ("delivered", "partial"):
        raise HTTPException(status_code=400, detail="Record delivery before POD")
    if body.pod_url:
        stop.pod_url = body.pod_url
    if body.signature_url:
        stop.signature_url = body.signature_url
    if body.receiver_name:
        stop.receiver_name = body.receiver_name
    if body.remarks:
        stop.remarks = body.remarks
    # Photo/signature optional — receiver name alone is enough to close POD
    if not stop.pod_url and not stop.signature_url:
        if not (stop.receiver_name or "").strip():
            raise HTTPException(status_code=400, detail="Enter receiver name (photo optional)")
        stop.pod_url = "ack:receiver"
    db.commit()
    return _run_out(db, run)


@router.get("/exceptions", response_model=list[LogisticsExceptionOut])
def list_exceptions(
    auth: AuthContext = Depends(require_perms("dispatch.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    rows = (
        db.query(LogisticsException)
        .filter(LogisticsException.company_id == company_id)
        .order_by(LogisticsException.id.desc())
        .all()
    )
    return [
        LogisticsExceptionOut(
            id=r.id,
            sales_order_id=r.sales_order_id,
            kind=r.kind,
            detail=r.detail,
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.patch("/exceptions/{ex_id}", response_model=LogisticsExceptionOut)
def patch_exception(
    ex_id: int,
    body: LogisticsExceptionPatch,
    auth: AuthContext = Depends(require_perms("dispatch.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    if body.status not in ("open", "under_review", "resolved", "closed"):
        raise HTTPException(status_code=400, detail="Use open, under_review, resolved or closed")
    row = (
        db.query(LogisticsException)
        .filter(LogisticsException.id == ex_id, LogisticsException.company_id == company_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Exception not found")
    row.status = body.status
    db.commit()
    return LogisticsExceptionOut(
        id=row.id,
        sales_order_id=row.sales_order_id,
        kind=row.kind,
        detail=row.detail,
        status=row.status,
        created_at=row.created_at,
    )
