from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.audit.service import write_audit
from app.accounts.routes import outstanding as inv_outstanding
from app.core.database import get_db
from app.core.deps import AuthContext, require_perms
from app.core.models import Customer, Invoice, InvoiceStatus, Payment
from app.core.schemas import PaymentCreate, PaymentOut

router = APIRouter(prefix="/payments", tags=["payments"])


def _out(p: Payment, inv: Invoice | None = None, customer: Customer | None = None) -> PaymentOut:
    return PaymentOut(
        id=p.id,
        invoice_id=p.invoice_id,
        invoice_number=inv.number if inv else None,
        customer_name=customer.name if customer else None,
        amount=p.amount,
        method=p.method,
        reference=p.reference,
        paid_at=p.paid_at,
    )


@router.get("", response_model=list[PaymentOut])
def list_payments(
    auth: AuthContext = Depends(require_perms("payments.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.company_or_all()
    pay_q = db.query(Payment).filter(Payment.organization_id == auth.organization_id)
    inv_q = db.query(Invoice).filter(Invoice.organization_id == auth.organization_id)
    cust_q = db.query(Customer).filter(Customer.organization_id == auth.organization_id)
    if company_id is not None:
        pay_q = pay_q.filter(Payment.company_id == company_id)
        inv_q = inv_q.filter(Invoice.company_id == company_id)
        cust_q = cust_q.filter(Customer.company_id == company_id)
    rows = pay_q.order_by(Payment.id.desc()).all()
    invs = {i.id: i for i in inv_q.all()}
    customers = {c.id: c for c in cust_q.all()}
    out: list[PaymentOut] = []
    for p in rows:
        inv = invs.get(p.invoice_id)
        cust = customers.get(inv.customer_id) if inv else None
        out.append(_out(p, inv, cust))
    return out


@router.post("", response_model=PaymentOut)
def create_payment(
    body: PaymentCreate,
    auth: AuthContext = Depends(require_perms("payments.create")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    inv = (
        db.query(Invoice)
        .filter(
            Invoice.id == body.invoice_id,
            Invoice.company_id == company_id,
            Invoice.organization_id == auth.organization_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.status == InvoiceStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Invoice cancelled")
    outstanding = inv_outstanding(inv)
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if body.amount > outstanding:
        raise HTTPException(status_code=400, detail=f"Amount exceeds outstanding {outstanding}")

    payment = Payment(
        organization_id=auth.organization_id,
        company_id=company_id,
        invoice_id=inv.id,
        amount=body.amount,
        method=body.method,
        reference=body.reference,
        paid_at=body.paid_at or date.today(),
        created_by_id=auth.user.id,
    )
    db.add(payment)
    inv.amount_paid = inv.amount_paid + body.amount
    if inv_outstanding(inv) <= 0:
        inv.status = InvoiceStatus.PAID
    else:
        inv.status = InvoiceStatus.PARTIAL

    write_audit(
        db,
        action="create",
        entity_type="payment",
        entity_id=None,
        organization_id=auth.organization_id,
        company_id=company_id,
        user_id=auth.user.id,
        detail=f"invoice={inv.id} amount={body.amount}",
    )
    db.commit()
    db.refresh(payment)
    customer = db.query(Customer).filter(Customer.id == inv.customer_id).first()
    return _out(payment, inv, customer)
