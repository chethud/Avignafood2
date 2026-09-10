from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import Customer, LogisticsRun, Role, RoleName, User, Vehicle, VehicleSlot
from app.core.schemas import (
    DriverOut,
    VehicleAvailOut,
    VehicleCreate,
    VehicleLiveSet,
    VehicleOut,
    VehicleSlotSet,
)

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


def _truck(db: Session, org_id: int) -> Vehicle | None:
    return (
        db.query(Vehicle)
        .filter(Vehicle.organization_id == org_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.id)
        .first()
    )


def _slot_status(db: Session, vehicle_id: int, on_date: date, slot: str) -> str:
    row = (
        db.query(VehicleSlot)
        .filter(VehicleSlot.vehicle_id == vehicle_id, VehicleSlot.on_date == on_date, VehicleSlot.slot == slot)
        .first()
    )
    return row.status if row else "free"


def _slot_assignment(db: Session, vehicle_id: int, on_date: date, slot: str) -> str | None:
    """Who/where this truck is booked for in a window (sales can promise around it)."""
    run = (
        db.query(LogisticsRun)
        .options(joinedload(LogisticsRun.stops))
        .filter(
            LogisticsRun.vehicle_id == vehicle_id,
            LogisticsRun.on_date == on_date,
            LogisticsRun.slot == slot,
        )
        .order_by(LogisticsRun.id.desc())
        .first()
    )
    if not run:
        return None
    names: list[str] = []
    for stop in run.stops or []:
        cust = db.query(Customer).filter(Customer.id == stop.customer_id).first()
        if cust and cust.name and cust.name not in names:
            names.append(cust.name)
    parts = [p for p in [", ".join(names[:2]) if names else None, run.route, run.number] if p]
    return " · ".join(parts) if parts else "Assigned"


def _avail(db: Session, v: Vehicle, on_date: date) -> VehicleAvailOut:
    morning = _slot_status(db, v.id, on_date, "morning")
    afternoon = _slot_status(db, v.id, on_date, "afternoon")
    evening = _slot_status(db, v.id, on_date, "evening")
    return VehicleAvailOut(
        vehicle_id=v.id,
        name=v.name,
        plate=v.plate,
        kind=v.kind,
        driver_name=v.driver_name,
        live_status="going" if (v.live_status or "idle") == "traveling" else (v.live_status or "idle"),
        morning=morning,
        afternoon=afternoon,
        evening=evening,
        morning_for=_slot_assignment(db, v.id, on_date, "morning") if morning == "booked" else None,
        afternoon_for=_slot_assignment(db, v.id, on_date, "afternoon") if afternoon == "booked" else None,
        evening_for=_slot_assignment(db, v.id, on_date, "evening") if evening == "booked" else None,
    )


@router.get("", response_model=list[VehicleOut])
def list_vehicles(
    auth: AuthContext = Depends(require_perms("vehicles.view")),
    db: Session = Depends(get_db),
):
    return (
        db.query(Vehicle)
        .filter(Vehicle.organization_id == auth.organization_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.id)
        .all()
    )


@router.post("", response_model=VehicleOut)
def create_vehicle(
    body: VehicleCreate,
    auth: AuthContext = Depends(require_perms("vehicles.edit")),
    db: Session = Depends(get_db),
):
    name = body.name.strip()
    plate = body.plate.strip().upper()
    if not name or not plate:
        raise HTTPException(status_code=400, detail="Enter vehicle name and number")
    exists = (
        db.query(Vehicle)
        .filter(Vehicle.organization_id == auth.organization_id, Vehicle.plate == plate)
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="That vehicle number is already in the fleet")
    v = Vehicle(
        organization_id=auth.organization_id,
        name=name,
        plate=plate,
        kind=body.kind or "truck",
        driver_name=(body.driver_name or "").strip() or None,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


@router.get("/drivers", response_model=list[DriverOut])
def list_drivers(
    auth: AuthContext = Depends(require_perms("vehicles.view")),
    db: Session = Depends(get_db),
):
    """Logistics people Owner created — Sales/Supervisor pick them after choosing a vehicle."""
    rows = (
        db.query(User)
        .join(Role, Role.id == User.role_id)
        .filter(
            User.organization_id == auth.organization_id,
            User.is_active.is_(True),
            Role.name == RoleName.LOGISTICS,
        )
        .order_by(User.full_name)
        .all()
    )
    return [
        DriverOut(id=u.id, full_name=u.full_name, phone=u.phone, email=u.email)
        for u in rows
    ]


@router.get("/availability", response_model=VehicleAvailOut)
def availability(
    on_date: date = Query(...),
    auth: AuthContext = Depends(require_perms("vehicles.view")),
    db: Session = Depends(get_db),
):
    v = _truck(db, auth.organization_id)
    if not v:
        raise HTTPException(status_code=404, detail="No vehicle")
    return _avail(db, v, on_date)


@router.get("/availability/all", response_model=list[VehicleAvailOut])
def availability_all(
    on_date: date = Query(...),
    auth: AuthContext = Depends(require_perms("vehicles.view")),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Vehicle)
        .filter(Vehicle.organization_id == auth.organization_id, Vehicle.is_active.is_(True))
        .order_by(Vehicle.id)
        .all()
    )
    return [_avail(db, v, on_date) for v in rows]


@router.put("/{vehicle_id}/live", response_model=VehicleOut)
def set_live(
    vehicle_id: int,
    body: VehicleLiveSet,
    auth: AuthContext = Depends(require_perms("vehicles.edit")),
    db: Session = Depends(get_db),
):
    if body.status not in ("idle", "going", "returning"):
        raise HTTPException(status_code=400, detail="Use idle, going or returning")
    v = (
        db.query(Vehicle)
        .filter(Vehicle.id == vehicle_id, Vehicle.organization_id == auth.organization_id)
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    v.live_status = body.status
    db.commit()
    db.refresh(v)
    return v


@router.put("/{vehicle_id}/slot", response_model=VehicleAvailOut)
def set_slot(
    vehicle_id: int,
    body: VehicleSlotSet,
    auth: AuthContext = Depends(require_perms("vehicles.edit")),
    db: Session = Depends(get_db),
):
    if body.slot not in ("morning", "afternoon", "evening"):
        raise HTTPException(status_code=400, detail="Slot must be morning, afternoon or evening")
    if body.status not in ("free", "booked"):
        raise HTTPException(status_code=400, detail="Status must be free or booked")
    # Windows are booked only by assigning an invoiced order on Order desk
    if body.status == "booked":
        raise HTTPException(
            status_code=400,
            detail="Book a truck window from Order desk by assigning an order (date + morning/afternoon/evening + vehicle)",
        )
    v = (
        db.query(Vehicle)
        .filter(Vehicle.id == vehicle_id, Vehicle.organization_id == auth.organization_id)
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    row = (
        db.query(VehicleSlot)
        .filter(
            VehicleSlot.vehicle_id == vehicle_id,
            VehicleSlot.on_date == body.on_date,
            VehicleSlot.slot == body.slot,
        )
        .first()
    )
    if row:
        row.status = body.status
        row.notes = body.notes
    else:
        db.add(
            VehicleSlot(
                vehicle_id=vehicle_id,
                on_date=body.on_date,
                slot=body.slot,
                status=body.status,
                notes=body.notes,
            )
        )
    db.commit()
    return _avail(db, v, body.on_date)
