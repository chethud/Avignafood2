from decimal import Decimal

from sqlalchemy.orm import Session, joinedload

from app.core.models import (
    Customer,
    Dispatch,
    Product,
    Purchase,
    Quotation,
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    StockBalance,
    Company,
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
    )
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
        slot_date=load.slot_date if load else None,
        slot=load.slot if load else None,
        vehicle=load.vehicle if load else None,
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
