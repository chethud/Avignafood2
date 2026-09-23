from decimal import Decimal
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit.service import write_audit
from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import (
    AuditLog,
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    StockBalance,
    StockMovement,
    Warehouse,
)
from app.core.schemas import (
    StockGlimpseOut,
    StockInwardIn,
    StockMovementOut,
    StockOut,
    StockSetIn,
    WarehouseOut,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _default_warehouse(db: Session, company_id: int, org_id: int) -> Warehouse:
    wh = (
        db.query(Warehouse)
        .filter(Warehouse.company_id == company_id, Warehouse.is_default.is_(True))
        .first()
    )
    if wh:
        return wh
    wh = Warehouse(
        organization_id=org_id,
        company_id=company_id,
        name="Main Warehouse",
        is_default=True,
    )
    db.add(wh)
    db.flush()
    return wh


def _record_movement(
    db: Session,
    *,
    auth: AuthContext,
    company_id: int,
    row: StockBalance,
    kind: str,
    quantity: Decimal,
    batch: str | None = None,
    manufacturer: str | None = None,
    notes: str | None = None,
) -> None:
    db.add(
        StockMovement(
            organization_id=auth.organization_id,
            company_id=company_id,
            stock_balance_id=row.id,
            product_id=row.product_id,
            warehouse_id=row.warehouse_id,
            kind=kind,
            quantity=quantity,
            balance_after=row.quantity or Decimal("0"),
            batch=batch,
            manufacturer=manufacturer,
            notes=notes,
            created_by_id=auth.user.id,
        )
    )


@router.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(
    auth: AuthContext = Depends(require_perms("inventory.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    rows = (
        db.query(Warehouse)
        .filter(Warehouse.company_id == company_id, Warehouse.organization_id == auth.organization_id)
        .all()
    )
    return rows


@router.get("/glimpse", response_model=StockGlimpseOut)
def stock_glimpse(
    auth: AuthContext = Depends(require_perms("inventory.view")),
    db: Session = Depends(get_db),
):
    """On hand vs already promised (draft orders). Headroom = what sales can still commit."""
    company_id = auth.require_company()
    on_hand = db.query(func.coalesce(func.sum(StockBalance.quantity), 0)).filter(
        StockBalance.company_id == company_id,
        StockBalance.organization_id == auth.organization_id,
    ).scalar()
    booked = (
        db.query(func.coalesce(func.sum(SalesOrderLine.quantity), 0))
        .join(SalesOrder, SalesOrderLine.sales_order_id == SalesOrder.id)
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.organization_id == auth.organization_id,
            SalesOrder.status == SalesOrderStatus.DRAFT,
        )
        .scalar()
    )
    on_hand_d = Decimal(str(on_hand or 0))
    booked_d = Decimal(str(booked or 0))
    return StockGlimpseOut(on_hand=on_hand_d, booked=booked_d, headroom=on_hand_d - booked_d)


@router.get("/stock", response_model=list[StockOut])
def list_stock(
    auth: AuthContext = Depends(require_perms("inventory.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    return (
        db.query(StockBalance)
        .filter(StockBalance.company_id == company_id, StockBalance.organization_id == auth.organization_id)
        .all()
    )


@router.get("/stock/{stock_id}/history", response_model=list[StockMovementOut])
def stock_history(
    stock_id: int,
    auth: AuthContext = Depends(require_perms("inventory.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    row = (
        db.query(StockBalance)
        .filter(
            StockBalance.id == stock_id,
            StockBalance.company_id == company_id,
            StockBalance.organization_id == auth.organization_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Stock line not found")

    moves = (
        db.query(StockMovement)
        .filter(
            StockMovement.stock_balance_id == stock_id,
            StockMovement.company_id == company_id,
        )
        .order_by(StockMovement.id.desc())
        .limit(100)
        .all()
    )
    if moves:
        return moves

    # ponytail: older inbounds only hit audit_logs — surface those until movements exist
    logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.entity_type == "stock_balance",
            AuditLog.entity_id == stock_id,
            AuditLog.organization_id == auth.organization_id,
            AuditLog.action.in_(("stock_inbound", "set_stock")),
        )
        .order_by(AuditLog.id.desc())
        .limit(100)
        .all()
    )
    out: list[StockMovementOut] = []
    for log in logs:
        detail = log.detail or ""
        kind = "inbound" if log.action == "stock_inbound" else "set"
        qty = Decimal("0")
        m = re.search(r"[+](\d+(?:\.\d+)?)", detail) or re.search(r"qty=(\d+(?:\.\d+)?)", detail)
        if m:
            try:
                qty = Decimal(m.group(1))
            except Exception:
                pass
        out.append(
            StockMovementOut(
                id=log.id,
                stock_balance_id=stock_id,
                product_id=row.product_id,
                warehouse_id=row.warehouse_id,
                kind=kind,
                quantity=qty,
                balance_after=row.quantity or Decimal("0"),
                batch=None,
                manufacturer=None,
                notes=detail or None,
                created_at=log.created_at,
            )
        )
    return out


@router.post("/stock", response_model=StockOut)
def set_stock(
    body: StockSetIn,
    auth: AuthContext = Depends(require_perms("inventory.edit")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    warehouse_id = body.warehouse_id
    if warehouse_id is None:
        warehouse_id = _default_warehouse(db, company_id, auth.organization_id).id
    else:
        wh = (
            db.query(Warehouse)
            .filter(Warehouse.id == warehouse_id, Warehouse.company_id == company_id)
            .first()
        )
        if not wh:
            raise HTTPException(status_code=404, detail="Warehouse not found")

    row = (
        db.query(StockBalance)
        .filter(StockBalance.warehouse_id == warehouse_id, StockBalance.product_id == body.product_id)
        .first()
    )
    prev = row.quantity if row else Decimal("0")
    if row:
        row.quantity = body.quantity
    else:
        row = StockBalance(
            organization_id=auth.organization_id,
            company_id=company_id,
            warehouse_id=warehouse_id,
            product_id=body.product_id,
            quantity=body.quantity,
        )
        db.add(row)
    db.flush()
    delta = body.quantity - (prev or Decimal("0"))
    if delta > 0:
        from app.sales.ops import apply_inbound_to_outstanding

        apply_inbound_to_outstanding(db, company_id=company_id, product_id=body.product_id, qty=delta)
    _record_movement(db, auth=auth, company_id=company_id, row=row, kind="set", quantity=delta)
    write_audit(
        db,
        action="set_stock",
        entity_type="stock_balance",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"product={body.product_id} qty={body.quantity}",
    )
    db.commit()
    db.refresh(row)
    return row


@router.post("/stock/inbound", response_model=StockOut)
def stock_inbound(
    body: StockInwardIn,
    auth: AuthContext = Depends(require_perms("inventory.edit")),
    db: Session = Depends(get_db),
):
    """Add quantity to on-hand (stock inward)."""
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    company_id = auth.require_company()
    warehouse_id = body.warehouse_id
    if warehouse_id is None:
        warehouse_id = _default_warehouse(db, company_id, auth.organization_id).id
    else:
        wh = (
            db.query(Warehouse)
            .filter(Warehouse.id == warehouse_id, Warehouse.company_id == company_id)
            .first()
        )
        if not wh:
            raise HTTPException(status_code=404, detail="Warehouse not found")

    row = (
        db.query(StockBalance)
        .filter(StockBalance.warehouse_id == warehouse_id, StockBalance.product_id == body.product_id)
        .first()
    )
    if row:
        row.quantity = (row.quantity or 0) + body.quantity
    else:
        row = StockBalance(
            organization_id=auth.organization_id,
            company_id=company_id,
            warehouse_id=warehouse_id,
            product_id=body.product_id,
            quantity=body.quantity,
        )
        db.add(row)
    db.flush()
    from app.sales.ops import apply_inbound_to_outstanding

    apply_inbound_to_outstanding(db, company_id=company_id, product_id=body.product_id, qty=body.quantity)
    _record_movement(
        db,
        auth=auth,
        company_id=company_id,
        row=row,
        kind="inbound",
        quantity=body.quantity,
        batch=body.batch,
        manufacturer=body.manufacturer,
        notes=body.notes,
    )
    meta = " · ".join(x for x in [body.batch, body.manufacturer, body.notes] if x)
    write_audit(
        db,
        action="stock_inbound",
        entity_type="stock_balance",
        entity_id=row.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"product={body.product_id} +{body.quantity}" + (f" · {meta}" if meta else ""),
    )
    db.commit()
    db.refresh(row)
    return row
