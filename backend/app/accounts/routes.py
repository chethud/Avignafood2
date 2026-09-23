"""Accounts financial APIs: aging, credit control, credit/debit notes, payment allocation."""

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import nulls_last
from sqlalchemy.orm import Session

from app.audit.service import write_audit
from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import CreditNote, Customer, Invoice, InvoiceStatus, Payment, SalesOrder, User

router = APIRouter(prefix="/accounts", tags=["accounts"])

INTEREST_ANNUAL = Decimal("18")  # Owner-configurable later; 18% p.a. default


class NoteIn(BaseModel):
    invoice_id: int
    kind: str  # credit | debit
    amount: Decimal
    reason: str
    remarks: str | None = None


class NoteOut(BaseModel):
    id: int
    invoice_id: int
    invoice_number: str | None = None
    customer_id: int
    kind: str
    amount: Decimal
    reason: str
    remarks: str | None = None
    status: str
    created_at: datetime | None = None


class AllocateIn(BaseModel):
    customer_id: int
    amount: Decimal
    method: str = "bank"
    reference: str | None = None
    paid_at: date | None = None
    invoice_ids: list[int] | None = None


class AgingSalesperson(BaseModel):
    salesperson_id: int | None = None
    salesperson_name: str
    current: Decimal
    d1_30: Decimal
    d31_60: Decimal
    d61_90: Decimal
    d90_plus: Decimal
    total: Decimal


class WaiverIn(BaseModel):
    reason: str


class AgingBucket(BaseModel):
    customer_id: int
    customer_name: str
    current: Decimal
    d1_30: Decimal
    d31_60: Decimal
    d61_90: Decimal
    d90_plus: Decimal
    total: Decimal
    credit_limit: Decimal
    credit_days: int


class CreditRow(BaseModel):
    customer_id: int
    customer_name: str
    credit_limit: Decimal
    credit_days: int
    outstanding: Decimal
    overdue: Decimal
    headroom: Decimal
    status: str  # within | warning | exceeded


def _credit(inv: Invoice) -> Decimal:
    return getattr(inv, "credit_applied", None) or Decimal("0")


def _debit(inv: Invoice) -> Decimal:
    return getattr(inv, "debit_applied", None) or Decimal("0")


def outstanding(inv: Invoice) -> Decimal:
    bal = (inv.total or 0) + _debit(inv) - (inv.amount_paid or 0) - _credit(inv)
    return bal if bal > 0 else Decimal("0")


def delay_days(inv: Invoice, on: date | None = None) -> int:
    if not inv.due_date:
        return 0
    day = on or date.today()
    return max(0, (day - inv.due_date).days)


def interest_loss(inv: Invoice, on: date | None = None) -> Decimal:
    if getattr(inv, "penalty_waived", False):
        return Decimal("0")
    d = delay_days(inv, on)
    if d <= 0:
        return Decimal("0")
    return (outstanding(inv) * INTEREST_ANNUAL * Decimal(d) / Decimal("36500")).quantize(Decimal("0.01"))


def _open_invoices(
    db: Session,
    company_id: int | None,
    organization_id: int,
    customer_id: int | None = None,
) -> list[Invoice]:
    q = db.query(Invoice).filter(
        Invoice.organization_id == organization_id,
        Invoice.status.in_((InvoiceStatus.OPEN, InvoiceStatus.PARTIAL)),
    )
    if company_id is not None:
        q = q.filter(Invoice.company_id == company_id)
    if customer_id:
        q = q.filter(Invoice.customer_id == customer_id)
    return q.order_by(nulls_last(Invoice.due_date), Invoice.id).all()


@router.get("/aging", response_model=list[AgingBucket])
def aging_report(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    today = date.today()
    cust_q = db.query(Customer).filter(
        Customer.organization_id == auth.organization_id,
        Customer.is_active.is_(True),
    )
    if company_id is not None:
        cust_q = cust_q.filter(Customer.company_id == company_id)
    customers = {c.id: c for c in cust_q.all()}
    buckets: dict[int, AgingBucket] = {}
    for inv in _open_invoices(db, company_id, auth.organization_id):
        bal = outstanding(inv)
        if bal <= 0:
            continue
        cust = customers.get(inv.customer_id)
        row = buckets.get(inv.customer_id)
        if not row:
            row = AgingBucket(
                customer_id=inv.customer_id,
                customer_name=cust.name if cust else f"Customer {inv.customer_id}",
                current=Decimal("0"),
                d1_30=Decimal("0"),
                d31_60=Decimal("0"),
                d61_90=Decimal("0"),
                d90_plus=Decimal("0"),
                total=Decimal("0"),
                credit_limit=(cust.credit_limit if cust else Decimal("0")) or Decimal("0"),
                credit_days=(cust.credit_days if cust else 30) or 30,
            )
            buckets[inv.customer_id] = row
        days = delay_days(inv, today)
        if days <= 0:
            row.current += bal
        elif days <= 30:
            row.d1_30 += bal
        elif days <= 60:
            row.d31_60 += bal
        elif days <= 90:
            row.d61_90 += bal
        else:
            row.d90_plus += bal
        row.total += bal
    return sorted(buckets.values(), key=lambda r: r.total, reverse=True)


@router.get("/credit", response_model=list[CreditRow])
def credit_control(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    today = date.today()
    out: list[CreditRow] = []
    cust_q = db.query(Customer).filter(
        Customer.organization_id == auth.organization_id,
        Customer.is_active.is_(True),
    )
    if company_id is not None:
        cust_q = cust_q.filter(Customer.company_id == company_id)
    for c in cust_q.order_by(Customer.name):
        due = Decimal("0")
        overdue = Decimal("0")
        for inv in _open_invoices(db, company_id, auth.organization_id, c.id):
            bal = outstanding(inv)
            due += bal
            if delay_days(inv, today) > 0:
                overdue += bal
        limit = c.credit_limit or Decimal("0")
        headroom = limit - due if limit else Decimal("0")
        status = "within"
        if limit > 0:
            if due > limit:
                status = "exceeded"
            elif due >= limit * Decimal("0.8"):
                status = "warning"
        elif overdue > 0:
            status = "warning"
        out.append(
            CreditRow(
                customer_id=c.id,
                customer_name=c.name,
                credit_limit=limit,
                credit_days=c.credit_days or 30,
                outstanding=due,
                overdue=overdue,
                headroom=headroom,
                status=status,
            )
        )
    return out


@router.get("/notes", response_model=list[NoteOut])
def list_notes(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    q = db.query(CreditNote).filter(CreditNote.organization_id == auth.organization_id)
    if company_id is not None:
        q = q.filter(CreditNote.company_id == company_id)
    rows = q.order_by(CreditNote.id.desc()).all()
    inv_q = db.query(Invoice).filter(Invoice.organization_id == auth.organization_id)
    if company_id is not None:
        inv_q = inv_q.filter(Invoice.company_id == company_id)
    invs = {i.id: i for i in inv_q.all()}
    return [
        NoteOut(
            id=r.id,
            invoice_id=r.invoice_id,
            invoice_number=invs[r.invoice_id].number if r.invoice_id in invs else None,
            customer_id=r.customer_id,
            kind=r.kind,
            amount=r.amount,
            reason=r.reason,
            remarks=r.remarks,
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/notes", response_model=NoteOut)
def post_note(
    body: NoteIn,
    auth: AuthContext = Depends(require_perms("invoices.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    if body.kind not in ("credit", "debit"):
        raise HTTPException(status_code=400, detail="Kind must be credit or debit")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    inv = (
        db.query(Invoice)
        .filter(Invoice.id == body.invoice_id, Invoice.company_id == company_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == InvoiceStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Invoice cancelled")
    note = CreditNote(
        organization_id=auth.organization_id,
        company_id=company_id,
        customer_id=inv.customer_id,
        invoice_id=inv.id,
        kind=body.kind,
        amount=body.amount,
        reason=(body.reason or "adjustment").strip() or "adjustment",
        remarks=body.remarks,
        created_by_id=auth.user.id,
    )
    db.add(note)
    if body.kind == "credit":
        inv.credit_applied = _credit(inv) + body.amount
    else:
        inv.debit_applied = _debit(inv) + body.amount
    bal = outstanding(inv)
    if bal <= 0 and inv.status != InvoiceStatus.CANCELLED:
        inv.status = InvoiceStatus.PAID
    elif inv.amount_paid > 0:
        inv.status = InvoiceStatus.PARTIAL
    else:
        inv.status = InvoiceStatus.OPEN
    write_audit(
        db,
        action="create",
        entity_type="credit_note",
        entity_id=None,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"{body.kind} {body.amount} invoice={inv.number}",
    )
    db.commit()
    db.refresh(note)
    return NoteOut(
        id=note.id,
        invoice_id=note.invoice_id,
        invoice_number=inv.number,
        customer_id=note.customer_id,
        kind=note.kind,
        amount=note.amount,
        reason=note.reason,
        remarks=note.remarks,
        status=note.status,
        created_at=note.created_at,
    )


@router.post("/allocate")
def allocate_payment(
    body: AllocateIn,
    auth: AuthContext = Depends(require_perms("payments.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    customer = (
        db.query(Customer)
        .filter(Customer.id == body.customer_id, Customer.company_id == company_id)
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    invoices = _open_invoices(db, company_id, auth.organization_id, customer.id)
    if body.invoice_ids:
        want = set(body.invoice_ids)
        invoices = [i for i in invoices if i.id in want]
    left = body.amount
    paid_at = body.paid_at or date.today()
    applied: list[dict] = []
    for inv in invoices:
        if left <= 0:
            break
        due = outstanding(inv)
        if due <= 0:
            continue
        take = due if due <= left else left
        db.add(
            Payment(
                organization_id=auth.organization_id,
                company_id=company_id,
                invoice_id=inv.id,
                amount=take,
                method=body.method,
                reference=body.reference,
                paid_at=paid_at,
                created_by_id=auth.user.id,
            )
        )
        inv.amount_paid = (inv.amount_paid or Decimal("0")) + take
        if outstanding(inv) <= 0:
            inv.status = InvoiceStatus.PAID
        else:
            inv.status = InvoiceStatus.PARTIAL
        applied.append({"invoice_id": inv.id, "number": inv.number, "amount": float(take)})
        left -= take
    if not applied:
        raise HTTPException(status_code=400, detail="No open invoices to allocate")
    write_audit(
        db,
        action="create",
        entity_type="payment",
        entity_id=None,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"allocate customer={customer.id} amount={body.amount}",
    )
    db.commit()
    return {"allocated": applied, "unallocated": float(left)}


@router.get("/aging/salespeople", response_model=list[AgingSalesperson])
def aging_by_salesperson(
    auth: AuthContext = Depends(require_perms("invoices.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    today = date.today()
    so_q = db.query(SalesOrder).filter(SalesOrder.organization_id == auth.organization_id)
    if company_id is not None:
        so_q = so_q.filter(SalesOrder.company_id == company_id)
    orders = {o.id: o for o in so_q.all()}
    users = {u.id: u for u in db.query(User).all()}
    buckets: dict[int, AgingSalesperson] = {}
    for inv in _open_invoices(db, company_id, auth.organization_id):
        bal = outstanding(inv)
        if bal <= 0:
            continue
        so = orders.get(inv.sales_order_id) if inv.sales_order_id else None
        uid = so.created_by_id if so else 0
        row = buckets.get(uid or 0)
        if not row:
            person = users.get(uid) if uid else None
            row = AgingSalesperson(
                salesperson_id=uid or None,
                salesperson_name=person.full_name if person else "Unassigned",
                current=Decimal("0"),
                d1_30=Decimal("0"),
                d31_60=Decimal("0"),
                d61_90=Decimal("0"),
                d90_plus=Decimal("0"),
                total=Decimal("0"),
            )
            buckets[uid or 0] = row
        days = delay_days(inv, today)
        if days <= 0:
            row.current += bal
        elif days <= 30:
            row.d1_30 += bal
        elif days <= 60:
            row.d31_60 += bal
        elif days <= 90:
            row.d61_90 += bal
        else:
            row.d90_plus += bal
        row.total += bal
    return sorted(buckets.values(), key=lambda r: r.total, reverse=True)


@router.post("/invoices/{invoice_id}/waive-penalty")
def waive_penalty(
    invoice_id: int,
    body: WaiverIn,
    auth: AuthContext = Depends(require_perms("invoices.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    reason = (body.reason or "").strip()
    if len(reason) < 8:
        raise HTTPException(status_code=400, detail="Reason is required for a penalty waiver")
    inv = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.company_id == company_id)
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv.penalty_waived = True
    inv.penalty_waiver_reason = reason
    write_audit(
        db,
        action="update",
        entity_type="invoice",
        entity_id=inv.id,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"penalty waived invoice={inv.number} reason={reason}",
    )
    db.commit()
    return {"ok": True, "invoice_id": inv.id, "penalty_waived": True}
