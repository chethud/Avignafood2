from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.accounts.routes import interest_loss, outstanding as inv_outstanding
from app.audit.service import write_audit
from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import (
    Company,
    Customer,
    Dispatch,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Product,
    SalesOrder,
    SalesOrderStatus,
)
from app.core.schemas import (
    BillableLoadOut,
    BillableOrderOut,
    ClientAccountOut,
    ClientLedgerOut,
    InvoiceFromOrderIn,
    InvoiceOut,
)

router = APIRouter(prefix="/invoices", tags=["invoices"])

# Invoice once the load is almost leaving (or already gone, if billing lagged)
NEAR_DISPATCH = ("Packed", "Ready", "Dispatched", "Delivered")


def _gst_split(tax: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    half = (tax / 2).quantize(Decimal("0.01"))
    return half, tax - half, Decimal("0")


def _customer_outstanding(db: Session, company_id: int, customer_id: int) -> Decimal:
    rows = (
        db.query(Invoice)
        .filter(
            Invoice.company_id == company_id,
            Invoice.customer_id == customer_id,
            Invoice.status.in_((InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)),
        )
        .all()
    )
    return sum((inv_outstanding(i) for i in rows), Decimal("0"))


def _product_names(db: Session, invoices: list[Invoice]) -> dict[int, str]:
    pids = {ln.product_id for inv in invoices for ln in inv.lines}
    if not pids:
        return {}
    return {p.id: p.name for p in db.query(Product).filter(Product.id.in_(pids)).all()}


def _out(
    inv: Invoice,
    customer: Customer | None = None,
    product_names: dict[int, str] | None = None,
) -> InvoiceOut:
    outstanding = inv_outstanding(inv)
    credit_days = None
    if inv.due_date and inv.invoice_date:
        credit_days = (inv.due_date - inv.invoice_date).days
    elif customer:
        credit_days = customer.credit_days
    cgst, sgst, igst = _gst_split(inv.tax_amount or Decimal("0"))
    delay = 0
    days_to_due = 0
    if inv.due_date:
        delta = (inv.due_date - date.today()).days
        if outstanding > 0 and delta < 0:
            delay = -delta
        elif delta > 0:
            days_to_due = delta
    if inv.status == InvoiceStatus.CANCELLED:
        pay_status = "cancelled"
    elif inv.status == InvoiceStatus.PAID or outstanding <= 0:
        pay_status = "paid"
    elif delay > 0:
        pay_status = "overdue"
    elif inv.status == InvoiceStatus.PARTIAL or (inv.amount_paid or 0) > 0:
        pay_status = "partial"
    else:
        pay_status = "unpaid"
    names = product_names or {}
    return InvoiceOut(
        id=inv.id,
        company_id=inv.company_id,
        customer_id=inv.customer_id,
        customer_name=customer.name if customer else None,
        sales_order_id=inv.sales_order_id,
        dispatch_id=inv.dispatch_id,
        number=inv.number,
        invoice_date=inv.invoice_date,
        due_date=inv.due_date,
        status=inv.status.value,
        subtotal=inv.subtotal,
        tax_amount=inv.tax_amount,
        total=inv.total,
        amount_paid=inv.amount_paid,
        outstanding=outstanding,
        credit_days=credit_days,
        credit_applied=getattr(inv, "credit_applied", None) or 0,
        debit_applied=getattr(inv, "debit_applied", None) or 0,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        delay_days=delay,
        days_to_due=days_to_due,
        payment_status=pay_status,
        interest_loss=interest_loss(inv),
        penalty_waived=bool(getattr(inv, "penalty_waived", False)),
        sent_at=getattr(inv, "sent_at", None),
        sent_via=getattr(inv, "sent_via", None),
        gstin=customer.gstin if customer else None,
        phone=customer.phone if customer else None,
        address=customer.address if customer else None,
        billing_address=(customer.billing_address or customer.address) if customer else None,
        shipping_address=(customer.shipping_address or customer.address) if customer else None,
        lines=[
            {
                "id": ln.id,
                "product_id": ln.product_id,
                "product_name": names.get(ln.product_id) or f"Item {ln.product_id}",
                "quantity": float(ln.quantity),
                "unit_price": float(ln.unit_price),
                "gst_rate": float(ln.gst_rate),
                "line_total": float(ln.line_total),
            }
            for ln in inv.lines
        ],
    )


def _next_number(db: Session, company: Company) -> str:
    count = db.query(Invoice).filter(Invoice.company_id == company.id).count() + 1
    return f"{company.invoice_prefix}-{count:05d}"


def _match_product(db: Session, company_id: int, name: str) -> Product | None:
    q = name.strip()
    if not q:
        return None
    exact = (
        db.query(Product)
        .filter(Product.company_id == company_id, Product.is_active.is_(True), func.lower(Product.name) == q.lower())
        .first()
    )
    if exact:
        return exact
    return (
        db.query(Product)
        .filter(Product.company_id == company_id, Product.is_active.is_(True), Product.name.ilike(f"%{q}%"))
        .first()
    )


def _price_for_dispatch(db: Session, company_id: int, load: Dispatch) -> tuple[Product | None, Decimal]:
    product = _match_product(db, company_id, load.product)
    if product:
        return product, product.base_price or Decimal("0")
    so = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.customer_id == load.customer_id,
            SalesOrder.status.in_([SalesOrderStatus.CONFIRMED, SalesOrderStatus.INVOICED]),
        )
        .order_by(SalesOrder.id.desc())
        .first()
    )
    if so and so.lines:
        ln = so.lines[0]
        p = db.query(Product).filter(Product.id == ln.product_id).first()
        return p, ln.unit_price
    return None, Decimal("0")


@router.get("", response_model=list[InvoiceOut])
def list_invoices(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    rows = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(Invoice.company_id == company_id, Invoice.organization_id == auth.organization_id)
        .order_by(Invoice.id.desc())
        .all()
    )
    customers = {
        c.id: c
        for c in db.query(Customer).filter(Customer.company_id == company_id).all()
    }
    names = _product_names(db, rows)
    return [_out(r, customers.get(r.customer_id), names) for r in rows]


def _invoiced_dispatch_ids(db: Session, company_id: int) -> set[int]:
    return {
        r[0]
        for r in db.query(Invoice.dispatch_id)
        .filter(Invoice.company_id == company_id, Invoice.dispatch_id.isnot(None))
        .all()
        if r[0]
    }


def _notice(
    db: Session,
    company_id: int,
    load: Dispatch,
    customers: dict[int, Customer],
    invoiced_ids: set[int],
) -> BillableLoadOut:
    cust = customers.get(load.customer_id)
    product, unit_price = _price_for_dispatch(db, company_id, load)
    qty = load.quantity or Decimal("0")
    gst = product.gst_rate if product else Decimal("0")
    est = qty * unit_price * (Decimal("1") + gst / Decimal("100"))
    invoiced = load.id in invoiced_ids
    return BillableLoadOut(
        dispatch_id=load.id,
        customer_id=load.customer_id,
        customer_name=cust.name if cust else f"Customer #{load.customer_id}",
        product=load.product,
        quantity=qty,
        unit_price=unit_price,
        estimated_total=est,
        dispatch_status=load.status,
        vehicle=load.vehicle,
        lr=load.lr,
        eta=load.eta,
        notes=load.notes,
        invoiced=invoiced,
        can_invoice=(not invoiced) and load.status in NEAR_DISPATCH,
    )


def _list_notices(db: Session, company_id: int, org_id: int) -> list[BillableLoadOut]:
    invoiced_ids = _invoiced_dispatch_ids(db, company_id)
    loads = (
        db.query(Dispatch)
        .filter(Dispatch.company_id == company_id, Dispatch.organization_id == org_id)
        .order_by(Dispatch.id.desc())
        .all()
    )
    customers = {c.id: c for c in db.query(Customer).filter(Customer.company_id == company_id).all()}
    return [_notice(db, company_id, load, customers, invoiced_ids) for load in loads]


@router.get("/dispatch-inbox", response_model=list[BillableLoadOut])
def dispatch_inbox(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """All dispatch loads Accounts should see — info arrives here before invoicing."""
    company_id = auth.require_company()
    return _list_notices(db, company_id, auth.organization_id)


@router.get("/billable", response_model=list[BillableLoadOut])
def billable_loads(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """Loads near dispatch that do not yet have an invoice — Accounts' work queue."""
    company_id = auth.require_company()
    return [n for n in _list_notices(db, company_id, auth.organization_id) if n.can_invoice]


@router.get("/billable-orders", response_model=list[BillableOrderOut])
def billable_orders(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """Sales orders Super Admin approved that Accounts can invoice. Invoice is raised before dispatch."""
    company_id = auth.require_company()
    invoiced = {
        r[0]
        for r in db.query(Invoice.sales_order_id)
        .filter(Invoice.company_id == company_id, Invoice.sales_order_id.isnot(None))
        .all()
        if r[0]
    }
    rows = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.status == SalesOrderStatus.CONFIRMED,
        )
        .order_by(SalesOrder.id.desc())
        .all()
    )
    out: list[BillableOrderOut] = []
    for so in rows:
        if so.id in invoiced:
            continue
        customer = db.query(Customer).filter(Customer.id == so.customer_id).first()
        qty = sum((ln.quantity for ln in so.lines), Decimal("0"))
        sub = Decimal("0")
        tax = Decimal("0")
        for ln in so.lines:
            product = db.query(Product).filter(Product.id == ln.product_id).first()
            gst = product.gst_rate if product else Decimal("0")
            line_sub = ln.quantity * ln.unit_price
            sub += line_sub
            tax += line_sub * gst / Decimal("100")
        est = sub + tax
        due = _customer_outstanding(db, company_id, so.customer_id)
        limit = (customer.credit_limit if customer else Decimal("0")) or Decimal("0")
        projected = due + est
        out.append(
            BillableOrderOut(
                sales_order_id=so.id,
                customer_id=so.customer_id,
                customer_name=customer.name if customer else f"Customer {so.customer_id}",
                address=(customer.shipping_address or customer.address) if customer else None,
                ops_status=so.ops_status,
                logistics_status=None,
                vehicle=None,
                line_count=len(so.lines),
                qty=qty,
                estimated_total=est,
                credit_limit=limit,
                current_outstanding=due,
                projected_exposure=projected,
                credit_ok=(limit <= 0) or (projected <= limit),
            )
        )
    return out


@router.post("/{invoice_id}/send", response_model=InvoiceOut)
def send_invoice(
    invoice_id: int,
    via: str = Query("whatsapp"),
    auth: AuthContext = Depends(require_perms("invoices.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    if via not in ("whatsapp", "email"):
        raise HTTPException(status_code=400, detail="Use whatsapp or email")
    inv = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(Invoice.id == invoice_id, Invoice.company_id == company_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv.sent_at = datetime.now(timezone.utc)
    inv.sent_via = via
    db.commit()
    customer = db.query(Customer).filter(Customer.id == inv.customer_id).first()
    return _out(inv, customer, _product_names(db, [inv]))


@router.post("/from-dispatch/{dispatch_id}", response_model=InvoiceOut)
def invoice_from_dispatch(
    dispatch_id: int,
    auth: AuthContext = Depends(require_perms("invoices.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    load = (
        db.query(Dispatch)
        .filter(
            Dispatch.id == dispatch_id,
            Dispatch.company_id == company_id,
            Dispatch.organization_id == auth.organization_id,
        )
        .first()
    )
    if not load:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    if load.status not in NEAR_DISPATCH:
        raise HTTPException(
            status_code=400,
            detail="Invoice only when the load is Packed / Ready / Dispatched / Delivered",
        )
    existing = db.query(Invoice).filter(Invoice.dispatch_id == load.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Invoice already exists for this load")

    if load.sales_order_id:
        so = db.query(SalesOrder).filter(SalesOrder.id == load.sales_order_id, SalesOrder.company_id == company_id).first()
        if so:
            existing_so_inv = db.query(Invoice).filter(Invoice.sales_order_id == so.id).first()
            if existing_so_inv:
                raise HTTPException(status_code=400, detail="Invoice already exists for this order")
            if so.status == SalesOrderStatus.CONFIRMED:
                return invoice_from_order(load.sales_order_id, auth, db, override_credit=True)

    company = db.query(Company).filter(Company.id == company_id).first()
    customer = db.query(Customer).filter(Customer.id == load.customer_id).first()
    if not company or not customer:
        raise HTTPException(status_code=400, detail="Company or customer missing")

    product, unit_price = _price_for_dispatch(db, company_id, load)
    if not product:
        raise HTTPException(
            status_code=400,
            detail="No matching product master for this load — cannot invoice",
        )
    if unit_price <= 0:
        raise HTTPException(
            status_code=400,
            detail="No price on file for this product — set base price on the product master first",
        )
    gst_rate = product.gst_rate or Decimal("0")
    qty = load.quantity or Decimal("0")
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Load quantity must be positive")

    inv = Invoice(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=load.customer_id,
        dispatch_id=load.id,
        sales_order_id=load.sales_order_id,
        number=_next_number(db, company),
        invoice_date=date.today(),
        due_date=date.today() + timedelta(days=customer.credit_days or 30),
        status=InvoiceStatus.OPEN,
    )
    db.add(inv)
    db.flush()

    line_sub = qty * unit_price
    line_tax = line_sub * gst_rate / Decimal("100")
    db.add(
        InvoiceLine(
            invoice_id=inv.id,
            product_id=product.id,
            quantity=qty,
            unit_price=unit_price,
            gst_rate=gst_rate,
            line_total=line_sub + line_tax,
        )
    )
    inv.subtotal = line_sub
    inv.tax_amount = line_tax
    inv.total = line_sub + line_tax

    if load.sales_order_id:
        so = (
            db.query(SalesOrder)
            .filter(SalesOrder.id == load.sales_order_id, SalesOrder.company_id == company_id)
            .first()
        )
        if so:
            so.status = SalesOrderStatus.INVOICED
            so.ops_status = "dispatched"

    write_audit(
        db,
        action="create",
        entity_type="invoice",
        entity_id=inv.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"{inv.number} dispatch={load.id}",
    )
    db.commit()
    inv = db.query(Invoice).options(joinedload(Invoice.lines)).filter(Invoice.id == inv.id).first()
    return _out(inv, customer, _product_names(db, [inv]) if inv else None)


@router.get("/clients", response_model=list[ClientAccountOut])
def list_client_accounts(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    customers = (
        db.query(Customer)
        .filter(Customer.company_id == company_id, Customer.organization_id == auth.organization_id)
        .order_by(Customer.name)
        .all()
    )
    invoices = (
        db.query(Invoice)
        .filter(Invoice.company_id == company_id, Invoice.status != InvoiceStatus.CANCELLED)
        .all()
    )
    fulfilled = (
        db.query(Dispatch.customer_id, func.count(Dispatch.id))
        .filter(
            Dispatch.company_id == company_id,
            Dispatch.status.in_(("Dispatched", "Delivered")),
        )
        .group_by(Dispatch.customer_id)
        .all()
    )
    fulfilled_map = {r[0]: int(r[1]) for r in fulfilled}

    inv_by_cust: dict[int, list[Invoice]] = {}
    for inv in invoices:
        inv_by_cust.setdefault(inv.customer_id, []).append(inv)

    out: list[ClientAccountOut] = []
    for c in customers:
        rows = inv_by_cust.get(c.id, [])
        revenue = sum((i.total for i in rows), Decimal("0"))
        outstanding = sum(
            (inv_outstanding(i) for i in rows if i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)),
            Decimal("0"),
        )
        paid = sum((i.amount_paid or Decimal("0") for i in rows), Decimal("0"))
        overdue = sum(
            (
                inv_outstanding(i)
                for i in rows
                if i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)
                and i.due_date
                and i.due_date < date.today()
            ),
            Decimal("0"),
        )
        out.append(
            ClientAccountOut(
                customer_id=c.id,
                name=c.name,
                gstin=c.gstin,
                phone=c.phone,
                credit_days=c.credit_days or 0,
                credit_limit=c.credit_limit or Decimal("0"),
                orders_fulfilled=fulfilled_map.get(c.id, 0),
                invoice_count=len(rows),
                total_revenue=revenue,
                outstanding=outstanding,
                paid=paid,
                overdue=overdue,
            )
        )
    return out


@router.get("/clients/{customer_id}", response_model=ClientLedgerOut)
def client_ledger(
    customer_id: int,
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
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
    invs = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(
            Invoice.customer_id == customer_id,
            Invoice.company_id == company_id,
            Invoice.status != InvoiceStatus.CANCELLED,
        )
        .order_by(Invoice.id.desc())
        .all()
    )
    fulfilled = (
        db.query(func.count(Dispatch.id))
        .filter(
            Dispatch.company_id == company_id,
            Dispatch.customer_id == customer_id,
            Dispatch.status.in_(("Dispatched", "Delivered")),
        )
        .scalar()
    )
    revenue = sum((i.total for i in invs), Decimal("0"))
    outstanding = sum(
        (inv_outstanding(i) for i in invs if i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)),
        Decimal("0"),
    )
    paid = sum((i.amount_paid or Decimal("0") for i in invs), Decimal("0"))
    overdue = sum(
        (
            inv_outstanding(i)
            for i in invs
            if i.status in (InvoiceStatus.OPEN, InvoiceStatus.PARTIAL) and i.due_date and i.due_date < date.today()
        ),
        Decimal("0"),
    )
    names = _product_names(db, invs)
    return ClientLedgerOut(
        customer_id=customer.id,
        name=customer.name,
        gstin=customer.gstin,
        phone=customer.phone,
        address=customer.address,
        credit_days=customer.credit_days or 0,
        credit_limit=customer.credit_limit or Decimal("0"),
        orders_fulfilled=int(fulfilled or 0),
        invoice_count=len(invs),
        total_revenue=revenue,
        outstanding=outstanding,
        paid=paid,
        overdue=overdue,
        invoices=[_out(i, customer, names) for i in invs],
    )


@router.post("/from-order/{order_id}", response_model=InvoiceOut)
def invoice_from_order(
    order_id: int,
    auth: AuthContext = Depends(require_perms("invoices.create")),
    db: Session = Depends(get_db),
    override_credit: bool = Query(False),
    body: InvoiceFromOrderIn | None = None,
):
    """Accounts opens Ready to invoice, enters bill details, then raises the GST invoice."""
    company_id = auth.require_company()
    so = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.id == order_id,
            SalesOrder.company_id == company_id,
            SalesOrder.organization_id == auth.organization_id,
        )
        .first()
    )
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    if so.status != SalesOrderStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="Super Admin must approve the order before invoicing")
    existing = db.query(Invoice).filter(Invoice.sales_order_id == so.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Invoice already exists for this order")

    company = db.query(Company).filter(Company.id == company_id).first()
    customer = db.query(Customer).filter(Customer.id == so.customer_id).first()
    adjustments = {
        ln.product_id: ln for ln in (body.lines or []) if body and body.lines
    } if body else {}

    subtotal = Decimal("0")
    tax_amount = Decimal("0")
    priced: list[tuple] = []
    for ln in so.lines:
        product = db.query(Product).filter(Product.id == ln.product_id).first()
        adj = adjustments.get(ln.product_id)
        qty = adj.quantity if adj and adj.quantity is not None else ln.quantity
        price = adj.unit_price if adj and adj.unit_price is not None else ln.unit_price
        gst_rate = (
            adj.gst_rate
            if adj and adj.gst_rate is not None
            else ((product.gst_rate if product else Decimal("0")) or Decimal("0"))
        )
        if qty <= 0:
            raise HTTPException(status_code=400, detail=f"Quantity must be positive for product {ln.product_id}")
        if price < 0:
            raise HTTPException(status_code=400, detail=f"Unit price cannot be negative for product {ln.product_id}")
        line_sub = qty * price
        line_tax = line_sub * gst_rate / Decimal("100")
        subtotal += line_sub
        tax_amount += line_tax
        priced.append((ln.product_id, qty, price, gst_rate, line_sub, line_tax))

    due = _customer_outstanding(db, company_id, so.customer_id)
    limit = (customer.credit_limit if customer else Decimal("0")) or Decimal("0")
    projected = due + subtotal + tax_amount
    if limit > 0 and projected > limit and not override_credit:
        raise HTTPException(
            status_code=400,
            detail=f"CREDIT LIMIT EXCEEDED: outstanding {due} + invoice {subtotal + tax_amount} = {projected} over limit {limit}",
        )

    inv_date = body.invoice_date if body and body.invoice_date else date.today()
    credit_days = (
        body.credit_days
        if body and body.credit_days is not None
        else (customer.credit_days if customer else 30)
    )
    if credit_days is None:
        credit_days = 30
    due_date = body.due_date if body and body.due_date else inv_date + timedelta(days=int(credit_days))
    number = (body.number or "").strip() if body and body.number else ""
    if number:
        clash = (
            db.query(Invoice)
            .filter(Invoice.company_id == company_id, Invoice.number == number)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail=f"Invoice number {number} already exists")
    else:
        number = _next_number(db, company)

    inv = Invoice(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=so.customer_id,
        sales_order_id=so.id,
        number=number,
        invoice_date=inv_date,
        due_date=due_date,
        status=InvoiceStatus.OPEN,
    )
    db.add(inv)
    db.flush()

    for product_id, qty, price, gst_rate, line_sub, line_tax in priced:
        db.add(
            InvoiceLine(
                invoice_id=inv.id,
                product_id=product_id,
                quantity=qty,
                unit_price=price,
                gst_rate=gst_rate,
                line_total=line_sub + line_tax,
            )
        )

    inv.subtotal = subtotal
    inv.tax_amount = tax_amount
    inv.total = subtotal + tax_amount
    so.status = SalesOrderStatus.INVOICED
    # Stock check for Sales allot — do not queue Supervisor for "pending_verify"
    if (so.ops_status or "") not in ("allocated", "dispatched", "ready", "shortage", "procuring"):
        from app.sales.ops import line_stock

        stock_lines = line_stock(db, so.warehouse_id, so.lines)
        if stock_lines and all(ln.ok for ln in stock_lines):
            so.ops_status = "ready"
            for ln in so.lines:
                ln.outstanding_qty = Decimal("0")
        else:
            so.ops_status = "shortage"
    remarks = (body.remarks or "").strip() if body else ""
    if remarks:
        so.notes = f"{(so.notes or '').strip()}\n[Invoice] {remarks}".strip()
    write_audit(
        db,
        action="create",
        entity_type="invoice",
        entity_id=inv.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"{inv.number}" + (f" · {remarks}" if remarks else ""),
    )
    db.commit()
    inv = db.query(Invoice).options(joinedload(Invoice.lines)).filter(Invoice.id == inv.id).first()
    return _out(inv, customer, _product_names(db, [inv]) if inv else None)


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: int,
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    inv = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(
            Invoice.id == invoice_id,
            Invoice.company_id == company_id,
            Invoice.organization_id == auth.organization_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    customer = db.query(Customer).filter(Customer.id == inv.customer_id).first()
    return _out(inv, customer, _product_names(db, [inv]))
