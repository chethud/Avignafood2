from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import engine, get_db
from app.core.deps import AuthContext, require_perms
from app.accounts.routes import interest_loss, outstanding as inv_outstanding
from app.core.models import (
    Customer,
    FieldVisit,
    Invoice,
    InvoiceStatus,
    Lead,
    LeadStatus,
    Payment,
    Product,
    Quotation,
    QuotationLine,
    QuotationStatus,
    SalesOrder,
    SalesOrderStatus,
    StockBalance,
    UserCompany,
    Warehouse,
    LogisticsRun,
    LogisticsStop,
    LogisticsException,
)
from app.core.schemas import (
    AccountsDashboardOut,
    LogisticsDashboardOut,
    SalesDashboardOut,
    SupervisorDashboardOut,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/accounts", response_model=AccountsDashboardOut)
def accounts_dashboard(
    auth: AuthContext = Depends(require_perms("dashboard.view")),
    db: Session = Depends(get_db),
):
    """Financial dashboard for Accounts role (billing / receivables focus)."""
    company_id = auth.company_or_all()
    today = date.today()
    month_start = today.replace(day=1)
    week_end = today + timedelta(days=7)

    pay_f = [Payment.organization_id == auth.organization_id]
    inv_f = [Invoice.organization_id == auth.organization_id]
    if company_id is not None:
        pay_f.append(Payment.company_id == company_id)
        inv_f.append(Invoice.company_id == company_id)

    today_collections = (
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(*pay_f, Payment.paid_at == today)
        .scalar()
    )
    month_collections = (
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(*pay_f, Payment.paid_at >= month_start)
        .scalar()
    )

    open_invoices = (
        db.query(Invoice)
        .filter(*inv_f, Invoice.status.in_([InvoiceStatus.OPEN, InvoiceStatus.PARTIAL]))
        .all()
    )

    total_receivables = Decimal("0")
    total_overdue = Decimal("0")
    due_today = Decimal("0")
    due_this_week = Decimal("0")
    unpaid = 0
    partial = 0
    overdue_count = 0

    for inv in open_invoices:
        bal = inv_outstanding(inv)
        if bal <= 0:
            continue
        total_receivables += bal
        if inv.status == InvoiceStatus.OPEN:
            unpaid += 1
        elif inv.status == InvoiceStatus.PARTIAL:
            partial += 1
        due = inv.due_date
        if due is not None:
            if due < today:
                total_overdue += bal
                overdue_count += 1
            elif due == today:
                due_today += bal
            elif due <= week_end:
                due_this_week += bal

    cust_f = [Customer.organization_id == auth.organization_id, Customer.is_active.is_(True)]
    so_f = [SalesOrder.organization_id == auth.organization_id]
    if company_id is not None:
        cust_f.append(Customer.company_id == company_id)
        so_f.append(SalesOrder.company_id == company_id)
        inv_co = [Invoice.company_id == company_id]
    else:
        inv_co = [Invoice.organization_id == auth.organization_id]

    credit_exposure = (
        db.query(func.coalesce(func.sum(Customer.credit_limit), 0))
        .filter(*cust_f)
        .scalar()
    )
    active_customers = (
        db.query(func.count(Customer.id))
        .filter(*cust_f)
        .scalar()
    )

    invoice_count = (
        db.query(func.count(Invoice.id))
        .filter(*inv_f, Invoice.status != InvoiceStatus.CANCELLED)
        .scalar()
        or 0
    )
    today_invoices = (
        db.query(func.count(Invoice.id))
        .filter(
            *inv_f,
            Invoice.invoice_date == today,
            Invoice.status != InvoiceStatus.CANCELLED,
        )
        .scalar()
        or 0
    )
    today_billing = (
        db.query(func.coalesce(func.sum(Invoice.total), 0))
        .filter(
            *inv_f,
            Invoice.invoice_date == today,
            Invoice.status != InvoiceStatus.CANCELLED,
        )
        .scalar()
    )
    invoiced_so = {
        r[0]
        for r in db.query(Invoice.sales_order_id)
        .filter(*inv_co, Invoice.sales_order_id.isnot(None))
        .all()
        if r[0]
    }
    ready_to_invoice = (
        db.query(func.count(SalesOrder.id))
        .filter(*so_f, SalesOrder.status == SalesOrderStatus.CONFIRMED)
        .scalar()
        or 0
    )
    if invoiced_so:
        billed = (
            db.query(func.count(SalesOrder.id))
            .filter(SalesOrder.id.in_(invoiced_so), *so_f)
            .scalar()
            or 0
        )
        ready_to_invoice = max(0, int(ready_to_invoice) - int(billed))

    credit_alerts = 0
    aging_current = aging_d1_30 = aging_d31_60 = aging_d61_90 = aging_d90_plus = Decimal("0")
    cost_delay = Decimal("0")
    by_cust: dict[int, Decimal] = {}
    for inv in open_invoices:
        bal = inv_outstanding(inv)
        by_cust[inv.customer_id] = by_cust.get(inv.customer_id, Decimal("0")) + bal
        days = 0
        if inv.due_date:
            days = max(0, (today - inv.due_date).days)
        if days <= 0:
            aging_current += bal
        elif days <= 30:
            aging_d1_30 += bal
        elif days <= 60:
            aging_d31_60 += bal
        elif days <= 90:
            aging_d61_90 += bal
        else:
            aging_d90_plus += bal
        cost_delay += interest_loss(inv)
    for c in db.query(Customer).filter(*cust_f):
        due = by_cust.get(c.id, Decimal("0"))
        limit = c.credit_limit or Decimal("0")
        if limit > 0 and due > limit:
            credit_alerts += 1

    return AccountsDashboardOut(
        today_collections=Decimal(str(today_collections)),
        month_collections=Decimal(str(month_collections)),
        total_receivables=total_receivables,
        total_overdue=total_overdue,
        due_today=due_today,
        due_this_week=due_this_week,
        unpaid_invoices=unpaid,
        partial_invoices=partial,
        overdue_invoices=overdue_count,
        credit_exposure=Decimal(str(credit_exposure)),
        active_customers=int(active_customers or 0),
        invoice_count=int(invoice_count),
        pending_payments=unpaid + partial,
        credit_alerts=credit_alerts,
        today_invoices=int(today_invoices),
        today_billing=Decimal(str(today_billing or 0)),
        due_soon=due_this_week,
        cost_of_delay=cost_delay,
        aging_current=aging_current,
        aging_d1_30=aging_d1_30,
        aging_d31_60=aging_d31_60,
        aging_d61_90=aging_d61_90,
        aging_d90_plus=aging_d90_plus,
        ready_to_invoice=int(ready_to_invoice),
    )


@router.get("/supervisor", response_model=SupervisorDashboardOut)
def supervisor_dashboard(
    auth: AuthContext = Depends(require_perms("dashboard.view")),
    db: Session = Depends(get_db),
):
    """Supervisor desk: invoiced work only. New sales orders wait on Super Admin, not this dashboard."""
    from app.sales.ensure_schema import ensure_sales_schema

    ensure_sales_schema(engine)
    company_id = auth.company_or_all()
    today = date.today()
    month_start = today.replace(day=1)

    inv_f = [Invoice.organization_id == auth.organization_id]
    lead_f = [Lead.organization_id == auth.organization_id]
    quote_f = [Quotation.organization_id == auth.organization_id]
    so_f = [SalesOrder.organization_id == auth.organization_id]
    stock_f = [StockBalance.organization_id == auth.organization_id]
    wh_f = [Warehouse.organization_id == auth.organization_id, Warehouse.is_active.is_(True)]
    if company_id is not None:
        inv_f.append(Invoice.company_id == company_id)
        lead_f.append(Lead.company_id == company_id)
        quote_f.append(Quotation.company_id == company_id)
        so_f.append(SalesOrder.company_id == company_id)
        stock_f.append(StockBalance.company_id == company_id)
        wh_f.append(Warehouse.company_id == company_id)

    today_sales = (
        db.query(func.coalesce(func.sum(Invoice.total), 0))
        .filter(*inv_f, Invoice.invoice_date == today, Invoice.status != InvoiceStatus.CANCELLED)
        .scalar()
    )
    month_sales = (
        db.query(func.coalesce(func.sum(Invoice.total), 0))
        .filter(*inv_f, Invoice.invoice_date >= month_start, Invoice.status != InvoiceStatus.CANCELLED)
        .scalar()
    )
    active_leads = (
        db.query(func.count(Lead.id))
        .filter(*lead_f, Lead.status.notin_([LeadStatus.WON, LeadStatus.LOST]))
        .scalar()
    )
    unassigned_leads = (
        db.query(func.count(Lead.id))
        .filter(
            *lead_f,
            Lead.assigned_to_id.is_(None),
            Lead.status.notin_([LeadStatus.WON, LeadStatus.LOST]),
        )
        .scalar()
    )
    pending_quotes = (
        db.query(func.count(Quotation.id))
        .filter(*quote_f, Quotation.status == QuotationStatus.PENDING_APPROVAL)
        .scalar()
        or 0
    )
    pending_order_approvals = (
        db.query(func.count(SalesOrder.id))
        .filter(
            *so_f,
            SalesOrder.status == SalesOrderStatus.DRAFT,
            SalesOrder.ops_status == "pending_approval",
        )
        .scalar()
        or 0
    )
    pending_approvals = int(pending_quotes) + int(pending_order_approvals)
    pending_orders = (
        db.query(func.count(SalesOrder.id))
        .filter(
            *so_f,
            SalesOrder.status == SalesOrderStatus.INVOICED,
            SalesOrder.ops_status.in_(["shortage", "procuring", "ready"]),
        )
        .scalar()
    )
    confirmed_orders = (
        db.query(func.count(SalesOrder.id))
        .filter(*so_f, SalesOrder.status == SalesOrderStatus.INVOICED)
        .scalar()
        or 0
    )
    low_stock_items = (
        db.query(func.count(StockBalance.id))
        .filter(*stock_f, StockBalance.quantity < 100)
        .scalar()
    )
    outstanding = (
        db.query(func.coalesce(func.sum(Invoice.total - Invoice.amount_paid), 0))
        .filter(*inv_f, Invoice.status.in_([InvoiceStatus.OPEN, InvoiceStatus.PARTIAL]))
        .scalar()
    )
    overdue_invoices = 0
    for inv in db.query(Invoice).filter(*inv_f, Invoice.status.in_([InvoiceStatus.OPEN, InvoiceStatus.PARTIAL])).all():
        if inv.due_date and inv.due_date < today and (inv.total - inv.amount_paid) > 0:
            overdue_invoices += 1

    if company_id is not None:
        team_users = (
            db.query(func.count(UserCompany.user_id.distinct()))
            .filter(UserCompany.company_id == company_id)
            .scalar()
        )
    else:
        from app.core.models import Company

        org_cos = [
            r[0]
            for r in db.query(Company.id).filter(Company.organization_id == auth.organization_id).all()
        ]
        team_users = (
            db.query(func.count(UserCompany.user_id.distinct()))
            .filter(UserCompany.company_id.in_(org_cos))
            .scalar()
            if org_cos
            else 0
        )

    total_stock = Decimal(
        str(db.query(func.coalesce(func.sum(StockBalance.quantity), 0)).filter(*stock_f).scalar())
    )
    inv_value = Decimal(
        str(
            db.query(func.coalesce(func.sum(StockBalance.quantity * Product.base_price), 0))
            .join(Product, Product.id == StockBalance.product_id)
            .filter(*stock_f)
            .scalar()
        )
    )
    # ponytail: confirm already deducts stock — available = on-hand balance
    warehouses = db.query(func.count(Warehouse.id)).filter(*wh_f).scalar() or 0

    return SupervisorDashboardOut(
        today_sales=Decimal(str(today_sales)),
        month_sales=Decimal(str(month_sales)),
        active_leads=int(active_leads or 0),
        unassigned_leads=int(unassigned_leads or 0),
        pending_approvals=int(pending_approvals or 0),
        pending_orders=int(pending_orders or 0),
        confirmed_orders=int(confirmed_orders),
        low_stock_items=int(low_stock_items or 0),
        outstanding=Decimal(str(outstanding)),
        overdue_invoices=overdue_invoices,
        team_users=int(team_users or 0),
        total_stock_qty=total_stock,
        inventory_value=inv_value,
        available_stock=total_stock,
        ready_for_dispatch=int(confirmed_orders),
        warehouses=int(warehouses),
    )


@router.get("/sales", response_model=SalesDashboardOut)
def sales_dashboard(
    auth: AuthContext = Depends(require_perms("dashboard.view")),
    db: Session = Depends(get_db),
):
    """Personal sales dashboard — own leads, quotes, orders, achievement."""
    from app.sales.ensure_schema import ensure_sales_schema

    ensure_sales_schema(engine)
    company_id = auth.require_company()
    uid = auth.user.id
    today = date.today()
    month_start = today.replace(day=1)
    # ponytail: fixed monthly target until targets module exists
    month_target = Decimal("500000")

    active_leads = (
        db.query(func.count(Lead.id))
        .filter(
            Lead.company_id == company_id,
            Lead.assigned_to_id == uid,
            Lead.status.notin_([LeadStatus.WON, LeadStatus.LOST]),
        )
        .scalar()
    )
    new_leads = (
        db.query(func.count(Lead.id))
        .filter(
            Lead.company_id == company_id,
            Lead.assigned_to_id == uid,
            Lead.status == LeadStatus.NEW,
        )
        .scalar()
    )
    pending_quotations = (
        db.query(func.count(Quotation.id))
        .filter(
            Quotation.company_id == company_id,
            Quotation.created_by_id == uid,
            Quotation.status.in_(
                [QuotationStatus.DRAFT, QuotationStatus.PENDING_APPROVAL, QuotationStatus.APPROVED]
            ),
        )
        .scalar()
    )
    approved_quotations = (
        db.query(func.count(Quotation.id))
        .filter(
            Quotation.company_id == company_id,
            Quotation.created_by_id == uid,
            Quotation.status.in_([QuotationStatus.APPROVED, QuotationStatus.ACCEPTED, QuotationStatus.CONVERTED]),
        )
        .scalar()
    )
    open_orders = (
        db.query(func.count(SalesOrder.id))
        .filter(
            SalesOrder.company_id == company_id,
            SalesOrder.created_by_id == uid,
            SalesOrder.status.in_([SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED, SalesOrderStatus.INVOICED]),
        )
        .scalar()
    )

    # Revenue from invoices linked to sales orders this user created
    month_sales = (
        db.query(func.coalesce(func.sum(Invoice.total), 0))
        .join(SalesOrder, Invoice.sales_order_id == SalesOrder.id)
        .filter(
            Invoice.company_id == company_id,
            Invoice.invoice_date >= month_start,
            Invoice.status != InvoiceStatus.CANCELLED,
            SalesOrder.created_by_id == uid,
        )
        .scalar()
    )

    my_customers = (
        db.query(func.count(func.distinct(SalesOrder.customer_id)))
        .filter(SalesOrder.company_id == company_id, SalesOrder.created_by_id == uid)
        .scalar()
    )

    won = (
        db.query(func.count(Lead.id))
        .filter(Lead.company_id == company_id, Lead.assigned_to_id == uid, Lead.status == LeadStatus.WON)
        .scalar()
        or 0
    )
    closed = (
        db.query(func.count(Lead.id))
        .filter(
            Lead.company_id == company_id,
            Lead.assigned_to_id == uid,
            Lead.status.in_([LeadStatus.WON, LeadStatus.LOST]),
        )
        .scalar()
        or 0
    )
    conversion = Decimal("0")
    if closed > 0:
        conversion = (Decimal(won) * Decimal("100") / Decimal(closed)).quantize(Decimal("0.1"))

    month_sales_d = Decimal(str(month_sales))
    achievement = Decimal("0")
    if month_target > 0:
        achievement = (month_sales_d * Decimal("100") / month_target).quantize(Decimal("0.1"))

    funnel: dict[str, int] = {}
    for st in LeadStatus:
        funnel[st.value] = int(
            db.query(func.count(Lead.id))
            .filter(Lead.company_id == company_id, Lead.assigned_to_id == uid, Lead.status == st)
            .scalar()
            or 0
        )

    today_visits = (
        db.query(func.count(FieldVisit.id))
        .filter(
            FieldVisit.company_id == company_id,
            FieldVisit.user_id == uid,
            func.date(FieldVisit.checked_in_at) == today,
        )
        .scalar()
        or 0
    )
    now = datetime.now(timezone.utc)
    overdue_follow = (
        db.query(func.count(Lead.id))
        .filter(
            Lead.company_id == company_id,
            Lead.assigned_to_id == uid,
            Lead.status.notin_([LeadStatus.WON, LeadStatus.LOST]),
            Lead.next_follow_up.isnot(None),
            Lead.next_follow_up < now,
        )
        .scalar()
        or 0
    )
    won_quotes = (
        db.query(func.count(Quotation.id))
        .filter(
            Quotation.company_id == company_id,
            Quotation.created_by_id == uid,
            Quotation.status.in_([QuotationStatus.ACCEPTED, QuotationStatus.CONVERTED]),
        )
        .scalar()
        or 0
    )
    lost_quotes = (
        db.query(func.count(Quotation.id))
        .filter(
            Quotation.company_id == company_id,
            Quotation.created_by_id == uid,
            Quotation.status == QuotationStatus.REJECTED,
        )
        .scalar()
        or 0
    )
    quote_closed = won_quotes + lost_quotes
    quote_win = Decimal("0")
    if quote_closed:
        quote_win = (Decimal(won_quotes) * Decimal("100") / Decimal(quote_closed)).quantize(Decimal("0.1"))
    price_exceptions = (
        db.query(func.count(func.distinct(QuotationLine.quotation_id)))
        .join(Quotation, QuotationLine.quotation_id == Quotation.id)
        .filter(
            Quotation.company_id == company_id,
            Quotation.created_by_id == uid,
            QuotationLine.unit_price < QuotationLine.base_price,
        )
        .scalar()
        or 0
    )
    visit_coverage = (
        db.query(func.count(func.distinct(FieldVisit.customer_id)))
        .filter(
            FieldVisit.company_id == company_id,
            FieldVisit.user_id == uid,
            FieldVisit.checked_in_at >= datetime.combine(month_start, datetime.min.time()).replace(tzinfo=timezone.utc),
            FieldVisit.customer_id.isnot(None),
        )
        .scalar()
        or 0
    )

    return SalesDashboardOut(
        active_leads=int(active_leads or 0),
        new_leads=int(new_leads or 0),
        pending_quotations=int(pending_quotations or 0),
        approved_quotations=int(approved_quotations or 0),
        open_orders=int(open_orders or 0),
        month_sales=month_sales_d,
        month_target=month_target,
        achievement_pct=achievement,
        my_customers=int(my_customers or 0),
        conversion_rate=conversion,
        funnel=funnel,
        today_visits=int(today_visits),
        overdue_follow_ups=int(overdue_follow),
        pending_quotes=int(pending_quotations or 0),
        quote_win_rate=quote_win,
        price_exceptions=int(price_exceptions),
        visit_coverage=int(visit_coverage),
    )


@router.get("/logistics", response_model=LogisticsDashboardOut)
def logistics_dashboard(
    auth: AuthContext = Depends(require_perms("dashboard.view")),
    db: Session = Depends(get_db),
):
    company_id = auth.require_company()
    today = date.today()
    ready = (
        db.query(func.count(SalesOrder.id))
        .filter(SalesOrder.company_id == company_id, SalesOrder.ops_status == "ready")
        .scalar()
        or 0
    )
    planned = (
        db.query(func.count(LogisticsRun.id))
        .filter(LogisticsRun.company_id == company_id, LogisticsRun.status.in_(("planned", "loading", "loaded")))
        .scalar()
        or 0
    )
    in_transit = (
        db.query(func.count(LogisticsRun.id))
        .filter(LogisticsRun.company_id == company_id, LogisticsRun.status == "in_transit")
        .scalar()
        or 0
    )
    ofd = (
        db.query(func.count(LogisticsRun.id))
        .filter(LogisticsRun.company_id == company_id, LogisticsRun.status == "out_for_delivery")
        .scalar()
        or 0
    )
    today_disp = (
        db.query(func.count(LogisticsRun.id))
        .filter(LogisticsRun.company_id == company_id, LogisticsRun.on_date == today)
        .scalar()
        or 0
    )
    delivered_today = (
        db.query(func.count(LogisticsStop.id))
        .join(LogisticsRun, LogisticsRun.id == LogisticsStop.run_id)
        .filter(
            LogisticsRun.company_id == company_id,
            LogisticsStop.status == "delivered",
            func.date(LogisticsStop.delivered_at) == today,
        )
        .scalar()
        or 0
    )
    pending_pod = (
        db.query(func.count(LogisticsStop.id))
        .join(LogisticsRun, LogisticsRun.id == LogisticsStop.run_id)
        .filter(
            LogisticsRun.company_id == company_id,
            LogisticsStop.status.in_(("delivered", "partial")),
            or_(LogisticsStop.pod_url.is_(None), LogisticsStop.pod_url == ""),
        )
        .scalar()
        or 0
    )
    issues = (
        db.query(func.count(LogisticsException.id))
        .filter(LogisticsException.company_id == company_id, LogisticsException.status == "open")
        .scalar()
        or 0
    )
    confirmed = (
        db.query(func.count(SalesOrder.id))
        .filter(SalesOrder.company_id == company_id, SalesOrder.status == SalesOrderStatus.INVOICED)
        .scalar()
        or 0
    )
    return LogisticsDashboardOut(
        pending_dispatches=int(planned),
        ready_for_dispatch=int(ready),
        today_dispatches=int(today_disp),
        delivered_today=int(delivered_today),
        confirmed_orders=int(confirmed),
        planned=int(planned),
        in_transit=int(in_transit),
        out_for_delivery=int(ofd),
        pending_pod=int(pending_pod),
        issues=int(issues),
    )
