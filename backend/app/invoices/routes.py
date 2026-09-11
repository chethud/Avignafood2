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
from app.sales.ops import can_raise_invoice, delivery_labels, normalize_delivery_mode

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
    company_id = auth.company_or_all()
    q = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(Invoice.organization_id == auth.organization_id)
    )
    if company_id is not None:
        q = q.filter(Invoice.company_id == company_id)
    rows = q.order_by(Invoice.id.desc()).all()
    cust_q = db.query(Customer).filter(Customer.organization_id == auth.organization_id)
    if company_id is not None:
        cust_q = cust_q.filter(Customer.company_id == company_id)
    customers = {c.id: c for c in cust_q.all()}
    names = _product_names(db, rows)
    return [_out(r, customers.get(r.customer_id), names) for r in rows]


def _invoiced_dispatch_ids(db: Session, company_id: int | None, org_id: int) -> set[int]:
    q = db.query(Invoice.dispatch_id).filter(
        Invoice.organization_id == org_id,
        Invoice.dispatch_id.isnot(None),
    )
    if company_id is not None:
        q = q.filter(Invoice.company_id == company_id)
    return {r[0] for r in q.all() if r[0]}


def _notice(
    db: Session,
    company_id: int,
    load: Dispatch,
    customers: dict[int, Customer],
    invoiced_ids: set[int],
    company_name: str | None = None,
) -> BillableLoadOut:
    cust = customers.get(load.customer_id)
    product, unit_price = _price_for_dispatch(db, company_id, load)
    qty = load.quantity or Decimal("0")
    gst = product.gst_rate if product else Decimal("0")
    est = qty * unit_price * (Decimal("1") + gst / Decimal("100"))
    invoiced = load.id in invoiced_ids
    return BillableLoadOut(
        dispatch_id=load.id,
        company_id=company_id,
        company_name=company_name,
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


def _list_notices(db: Session, company_id: int | None, org_id: int) -> list[BillableLoadOut]:
    invoiced_ids = _invoiced_dispatch_ids(db, company_id, org_id)
    q = db.query(Dispatch).filter(Dispatch.organization_id == org_id)
    if company_id is not None:
        q = q.filter(Dispatch.company_id == company_id)
    loads = q.order_by(Dispatch.id.desc()).all()
    cust_q = db.query(Customer).filter(Customer.organization_id == org_id)
    if company_id is not None:
        cust_q = cust_q.filter(Customer.company_id == company_id)
    customers = {c.id: c for c in cust_q.all()}
    companies = {
        c.id: (c.trade_name or c.legal_name)
        for c in db.query(Company).filter(Company.organization_id == org_id).all()
    }
    return [
        _notice(db, load.company_id, load, customers, invoiced_ids, companies.get(load.company_id))
        for load in loads
    ]


@router.get("/dispatch-inbox", response_model=list[BillableLoadOut])
def dispatch_inbox(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """All dispatch loads Accounts should see — info arrives here before invoicing."""
    company_id = auth.company_or_all()
    return _list_notices(db, company_id, auth.organization_id)


@router.get("/billable", response_model=list[BillableLoadOut])
def billable_loads(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """Loads near dispatch that do not yet have an invoice — Accounts' work queue."""
    company_id = auth.company_or_all()
    return [n for n in _list_notices(db, company_id, auth.organization_id) if n.can_invoice]


@router.get("/billable-orders", response_model=list[BillableOrderOut])
def billable_orders(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """Approved sales orders Accounts can invoice.

    Manufacturer delivery → invoice anytime after Owner approve.
    Own vehicle → vehicle + driver must be assigned first (invoice needs vehicle details).
    """
    company_id = auth.company_or_all()
    inv_q = db.query(Invoice.sales_order_id).filter(
        Invoice.organization_id == auth.organization_id,
        Invoice.sales_order_id.isnot(None),
    )
    so_q = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.organization_id == auth.organization_id,
            SalesOrder.status == SalesOrderStatus.CONFIRMED,
        )
    )
    if company_id is not None:
        inv_q = inv_q.filter(Invoice.company_id == company_id)
        so_q = so_q.filter(SalesOrder.company_id == company_id)
    invoiced = {r[0] for r in inv_q.all() if r[0]}
    rows = so_q.order_by(SalesOrder.id.desc()).all()
    companies = {
        c.id: (c.trade_name or c.legal_name)
        for c in db.query(Company).filter(Company.organization_id == auth.organization_id).all()
    }
    out: list[BillableOrderOut] = []
    for so in rows:
        if so.id in invoiced:
            continue
        ok, block = can_raise_invoice(so)
        if not ok:
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
        due = _customer_outstanding(db, so.company_id, so.customer_id)
        limit = (customer.credit_limit if customer else Decimal("0")) or Decimal("0")
        projected = due + est
        vehicle, driver = delivery_labels(db, so)
        out.append(
            BillableOrderOut(
                sales_order_id=so.id,
                company_id=so.company_id,
                company_name=companies.get(so.company_id),
                customer_id=so.customer_id,
                customer_name=customer.name if customer else f"Customer {so.customer_id}",
                address=(customer.shipping_address or customer.address) if customer else None,
                ops_status=so.ops_status,
                logistics_status=None,
                vehicle=vehicle,
                driver_name=driver,
                delivery_mode=normalize_delivery_mode(getattr(so, "delivery_mode", None)) or "own_vehicle",
                line_count=len(so.lines),
                qty=qty,
                estimated_total=est,
                credit_limit=limit,
                current_outstanding=due,
                projected_exposure=projected,
                credit_ok=(limit <= 0) or (projected <= limit),
                can_invoice=True,
                invoice_block_reason=block,
            )
        )
    return out


@router.get("/next-number")
def next_invoice_number(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """Preview the next auto invoice number for the active company."""
    company_id = auth.require_company()
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"number": _next_number(db, company)}


@router.post("/{invoice_id}/send", response_model=InvoiceOut)
def send_invoice(
    invoice_id: int,
    via: str = Query("whatsapp"),
    auth: AuthContext = Depends(require_perms("invoices.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    if via not in ("whatsapp", "email"):
        raise HTTPException(status_code=400, detail="Use whatsapp or email")
    q = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(Invoice.id == invoice_id, Invoice.organization_id == auth.organization_id)
    )
    if company_id is not None:
        q = q.filter(Invoice.company_id == company_id)
    inv = q.first()
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
    scope = auth.company_or_all()
    load_q = db.query(Dispatch).filter(
        Dispatch.id == dispatch_id,
        Dispatch.organization_id == auth.organization_id,
    )
    if scope is not None:
        load_q = load_q.filter(Dispatch.company_id == scope)
    load = load_q.first()
    if not load:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    company_id = load.company_id
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


def _client_key(c: Customer) -> str:
    gst = (c.gstin or "").strip().upper()
    if gst:
        return f"gst:{gst}"
    return f"name:{(c.name or '').strip().lower()}"


@router.get("/clients", response_model=list[ClientAccountOut])
def list_client_accounts(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """One row per customer (same name/GST across firms is merged when scope is All)."""
    company_id = auth.company_or_all()
    cust_q = db.query(Customer).filter(Customer.organization_id == auth.organization_id)
    inv_q = db.query(Invoice).filter(
        Invoice.organization_id == auth.organization_id,
        Invoice.status != InvoiceStatus.CANCELLED,
    )
    disp_q = db.query(Dispatch.customer_id, func.count(Dispatch.id)).filter(
        Dispatch.organization_id == auth.organization_id,
        Dispatch.status.in_(("Dispatched", "Delivered")),
    )
    if company_id is not None:
        cust_q = cust_q.filter(Customer.company_id == company_id)
        inv_q = inv_q.filter(Invoice.company_id == company_id)
        disp_q = disp_q.filter(Dispatch.company_id == company_id)
    customers = cust_q.order_by(Customer.name).all()
    invoices = inv_q.all()
    fulfilled = disp_q.group_by(Dispatch.customer_id).all()
    fulfilled_map = {r[0]: int(r[1]) for r in fulfilled}
    companies = {
        c.id: (c.trade_name or c.legal_name)
        for c in db.query(Company).filter(Company.organization_id == auth.organization_id).all()
    }

    inv_by_cust: dict[int, list[Invoice]] = {}
    for inv in invoices:
        inv_by_cust.setdefault(inv.customer_id, []).append(inv)

    groups: dict[str, list[Customer]] = {}
    for c in customers:
        groups.setdefault(_client_key(c), []).append(c)

    out: list[ClientAccountOut] = []
    for members in groups.values():
        members = sorted(members, key=lambda x: x.id)
        primary = members[0]
        ids = [m.id for m in members]
        company_ids = sorted({m.company_id for m in members})
        rows: list[Invoice] = []
        for mid in ids:
            rows.extend(inv_by_cust.get(mid, []))
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
        fulfilled_n = sum(fulfilled_map.get(mid, 0) for mid in ids)
        firm_names = [companies.get(cid) or f"Company {cid}" for cid in company_ids]
        out.append(
            ClientAccountOut(
                customer_id=primary.id,
                customer_ids=ids,
                company_id=primary.company_id,
                company_ids=company_ids,
                company_name=", ".join(firm_names),
                name=primary.name,
                gstin=next((m.gstin for m in members if m.gstin), None),
                phone=next((m.phone for m in members if m.phone), None),
                credit_days=max((m.credit_days or 0) for m in members),
                credit_limit=max((m.credit_limit or Decimal("0")) for m in members),
                orders_fulfilled=fulfilled_n,
                invoice_count=len(rows),
                total_revenue=revenue,
                outstanding=outstanding,
                paid=paid,
                overdue=overdue,
            )
        )
    out.sort(key=lambda r: r.name.lower())
    return out


@router.get("/clients/{customer_id}", response_model=ClientLedgerOut)
def client_ledger(
    customer_id: int,
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    """Full customer ledger. Under All companies, merges same-name / same-GST firm records."""
    scope = auth.company_or_all()
    cust_q = db.query(Customer).filter(
        Customer.id == customer_id,
        Customer.organization_id == auth.organization_id,
    )
    if scope is not None:
        cust_q = cust_q.filter(Customer.company_id == scope)
    customer = cust_q.first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    siblings_q = db.query(Customer).filter(Customer.organization_id == auth.organization_id)
    if scope is not None:
        siblings_q = siblings_q.filter(Customer.company_id == scope)
        members = [customer]
    else:
        key = _client_key(customer)
        members = [c for c in siblings_q.all() if _client_key(c) == key] or [customer]
    members = sorted(members, key=lambda x: x.id)
    ids = [m.id for m in members]
    company_ids = sorted({m.company_id for m in members})
    companies = {
        c.id: (c.trade_name or c.legal_name)
        for c in db.query(Company).filter(Company.id.in_(company_ids or [0])).all()
    }

    invs = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(
            Invoice.customer_id.in_(ids),
            Invoice.organization_id == auth.organization_id,
            Invoice.status != InvoiceStatus.CANCELLED,
        )
        .order_by(Invoice.id.desc())
        .all()
    )
    fulfilled = (
        db.query(func.count(Dispatch.id))
        .filter(
            Dispatch.customer_id.in_(ids),
            Dispatch.status.in_(("Dispatched", "Delivered")),
        )
        .scalar()
    )
    orders = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.customer_id.in_(ids),
            SalesOrder.organization_id == auth.organization_id,
            SalesOrder.status != SalesOrderStatus.CANCELLED,
        )
        .order_by(SalesOrder.id.desc())
        .all()
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
    cust_by_id = {m.id: m for m in members}
    order_rows = []
    for so in orders:
        c = cust_by_id.get(so.customer_id)
        order_rows.append(
            {
                "id": so.id,
                "company_id": so.company_id,
                "company_name": companies.get(so.company_id),
                "status": so.status.value if hasattr(so.status, "value") else str(so.status),
                "ops_status": so.ops_status or "",
                "created_at": so.created_at.isoformat() if so.created_at else None,
                "confirmed_at": so.confirmed_at.isoformat() if so.confirmed_at else None,
                "line_count": len(so.lines or []),
                "qty": float(sum((ln.quantity for ln in (so.lines or [])), Decimal("0"))),
                "value": float(
                    sum((ln.quantity * ln.unit_price for ln in (so.lines or [])), Decimal("0"))
                ),
                "notes": so.notes,
            }
        )
    return ClientLedgerOut(
        customer_id=customer.id,
        customer_ids=ids,
        company_id=customer.company_id,
        company_ids=company_ids,
        company_name=", ".join(companies.get(cid) or f"Company {cid}" for cid in company_ids),
        name=customer.name,
        gstin=next((m.gstin for m in members if m.gstin), None),
        phone=next((m.phone for m in members if m.phone), None),
        address=next((m.address for m in members if m.address), None),
        credit_days=max((m.credit_days or 0) for m in members),
        credit_limit=max((m.credit_limit or Decimal("0")) for m in members),
        orders_fulfilled=int(fulfilled or 0),
        invoice_count=len(invs),
        total_revenue=revenue,
        outstanding=outstanding,
        paid=paid,
        overdue=overdue,
        invoices=[_out(i, cust_by_id.get(i.customer_id) or customer, names) for i in invs],
        orders=order_rows,
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
    so_q = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(
            SalesOrder.id == order_id,
            SalesOrder.organization_id == auth.organization_id,
        )
    )
    if auth.company_id is not None:
        so_q = so_q.filter(SalesOrder.company_id == auth.company_id)
    so = so_q.first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    company_id = so.company_id
    if so.status != SalesOrderStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="Super Admin must approve the order before invoicing")
    ok, block = can_raise_invoice(so)
    if not ok:
        raise HTTPException(status_code=400, detail=block or "Assign vehicle and driver before raising the invoice")
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
    mode = normalize_delivery_mode(getattr(so, "delivery_mode", None))
    vehicle, driver = delivery_labels(db, so)
    if mode == "manufacturer":
        # Manufacturer delivers — Accounts only raises invoice; no fleet allotment.
        so.ops_status = "manufacturer"
    elif (so.ops_status or "") not in ("allocated", "dispatched"):
        from app.sales.ops import line_stock

        stock_lines = line_stock(db, so.warehouse_id, so.lines)
        if stock_lines and all(ln.ok for ln in stock_lines):
            so.ops_status = "ready"
            for ln in so.lines:
                ln.outstanding_qty = Decimal("0")
            # Auto-book logistics run when Sales already planned vehicle + slot at order time.
            if (
                getattr(so, "planned_vehicle_id", None)
                and getattr(so, "planned_driver_user_id", None)
                and getattr(so, "planned_on_date", None)
                and getattr(so, "planned_slot", None)
            ):
                from app.core.models import RoleName, User, Vehicle
                from app.logistics.routes import assign_order_to_window

                veh = (
                    db.query(Vehicle)
                    .filter(
                        Vehicle.id == so.planned_vehicle_id,
                        Vehicle.organization_id == auth.organization_id,
                        Vehicle.is_active.is_(True),
                    )
                    .first()
                )
                driver_user = (
                    db.query(User)
                    .options(joinedload(User.role))
                    .filter(
                        User.id == so.planned_driver_user_id,
                        User.organization_id == auth.organization_id,
                        User.is_active.is_(True),
                    )
                    .first()
                )
                if veh and driver_user and driver_user.role.name == RoleName.LOGISTICS:
                    try:
                        assign_order_to_window(
                            db,
                            org_id=auth.organization_id,
                            company_id=company_id,
                            so=so,
                            on_date=so.planned_on_date,
                            slot=so.planned_slot,
                            veh=veh,
                            user_id=auth.user.id,
                            driver_name=driver_user.full_name,
                        )
                    except HTTPException:
                        # Keep planned fields; Order desk can allot manually.
                        pass
        else:
            so.ops_status = "pending_verify"
    remarks = (body.remarks or "").strip() if body else ""
    delivery_note = ""
    if mode == "manufacturer":
        delivery_note = "Delivery: Manufacturer"
    elif vehicle or driver:
        delivery_note = " · ".join(
            x for x in [f"Vehicle: {vehicle}" if vehicle else "", f"Driver: {driver}" if driver else ""] if x
        )
    bits = [x for x in [remarks, delivery_note] if x]
    if bits:
        so.notes = f"{(so.notes or '').strip()}\n[Invoice] {' · '.join(bits)}".strip()
    write_audit(
        db,
        action="create",
        entity_type="invoice",
        entity_id=inv.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"{inv.number}" + (f" · {' · '.join(bits)}" if bits else ""),
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
    company_id = auth.company_or_all()
    q = (
        db.query(Invoice)
        .options(joinedload(Invoice.lines))
        .filter(
            Invoice.id == invoice_id,
            Invoice.organization_id == auth.organization_id,
        )
    )
    if company_id is not None:
        q = q.filter(Invoice.company_id == company_id)
    inv = q.first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    customer = db.query(Customer).filter(Customer.id == inv.customer_id).first()
    return _out(inv, customer, _product_names(db, [inv]))
