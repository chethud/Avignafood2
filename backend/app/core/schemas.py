from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- Auth ----
class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORMModel):
    id: int
    email: str
    full_name: str
    phone: str | None = None
    photo_url: str | None = None
    organization_id: int
    role: str
    is_active: bool
    company_ids: list[int] = []


class MeProfileUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None


class MeOut(BaseModel):
    user: UserOut
    permissions: list[str]


class PermissionOut(ORMModel):
    id: int
    code: str
    description: str | None = None


class UserPermissionGrant(BaseModel):
    permission_code: str
    forever: bool = True
    expires_on: date | None = None  # ignored when forever=True; end of that day UTC


class UserPermissionOut(BaseModel):
    id: int
    permission_code: str
    description: str | None = None
    forever: bool
    expires_at: datetime | None = None
    created_at: datetime | None = None


# ---- Companies ----
class CompanyCreate(BaseModel):
    legal_name: str
    trade_name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    invoice_prefix: str = "INV"
    logo_url: str | None = None


class CompanyUpdate(BaseModel):
    legal_name: str | None = None
    trade_name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    invoice_prefix: str | None = None
    logo_url: str | None = None
    is_active: bool | None = None


class CompanyOut(ORMModel):
    id: int
    organization_id: int
    legal_name: str
    trade_name: str | None
    gstin: str | None
    pan: str | None
    address: str | None
    phone: str | None
    email: str | None
    invoice_prefix: str
    logo_url: str | None = None
    is_active: bool


# ---- Users ----
class UserCreate(BaseModel):
    email: str
    full_name: str
    password: str = Field(min_length=6)
    role: str
    company_ids: list[int] = []


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    company_ids: list[int] | None = None
    password: str | None = None


# ---- Customers ----
class CustomerCreate(BaseModel):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
    address: str | None = None
    credit_limit: Decimal = Decimal("0")
    credit_days: int = 30
    legal_name: str | None = None
    trade_name: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    customer_type: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
    address: str | None = None
    credit_limit: Decimal | None = None
    credit_days: int | None = None
    is_active: bool | None = None
    legal_name: str | None = None
    trade_name: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    customer_type: str | None = None


class CustomerContactIn(BaseModel):
    name: str
    phone: str | None = None
    email: str | None = None
    designation: str | None = None
    is_primary: bool = False


class CustomerContactOut(ORMModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    designation: str | None
    is_primary: bool


class CustomerOut(ORMModel):
    id: int
    company_id: int
    name: str
    contact_person: str | None
    phone: str | None
    email: str | None
    gstin: str | None
    address: str | None
    credit_limit: Decimal
    credit_days: int
    is_active: bool
    legal_name: str | None = None
    trade_name: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    customer_type: str | None = None
    outstanding: Decimal = Decimal("0")
    lifetime_revenue: Decimal = Decimal("0")
    order_count: int = 0
    last_order: date | None = None
    last_payment: date | None = None
    health: str = "GOOD"
    credit_status: str = "ok"
    credit_countdown_days: int | None = None
    reorder_suggestions: list[str] = []
    contacts: list[CustomerContactOut] = []


class CollectionFollowUpIn(BaseModel):
    invoice_id: int | None = None
    promised_date: date | None = None
    notes: str | None = None


class CollectionFollowUpOut(ORMModel):
    id: int
    customer_id: int
    invoice_id: int | None
    promised_date: date | None
    notes: str | None
    created_at: datetime


# ---- Leads ----
class LeadCreate(BaseModel):
    business_name: str
    company_id: int | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    location: str | None = None
    source: str | None = None
    lead_type: str | None = None
    product_requirement: str | None = None
    quantity: str | None = None
    estimated_value: Decimal | None = None
    assigned_to_id: int | None = None
    notes: str | None = None
    voice_url: str | None = None
    gstin: str | None = None
    priority: str | None = None
    next_follow_up: datetime | None = None


class LeadUpdate(BaseModel):
    business_name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    location: str | None = None
    source: str | None = None
    lead_type: str | None = None
    product_requirement: str | None = None
    quantity: str | None = None
    estimated_value: Decimal | None = None
    status: str | None = None
    assigned_to_id: int | None = None
    notes: str | None = None
    lost_reason: str | None = None
    gstin: str | None = None
    priority: str | None = None
    next_follow_up: datetime | None = None


class LeadActivityIn(BaseModel):
    kind: str = "note"
    notes: str | None = None
    next_action: str | None = None
    next_follow_up: datetime | None = None


class LeadActivityOut(ORMModel):
    id: int
    kind: str
    notes: str | None
    next_action: str | None
    user_id: int | None
    created_at: datetime


class LeadBulkIn(BaseModel):
    ids: list[int]
    status: str | None = None
    assigned_to_id: int | None = None


class LeadOut(ORMModel):
    id: int
    company_id: int
    business_name: str
    contact_person: str | None
    phone: str | None
    email: str | None
    location: str | None
    source: str | None
    lead_type: str | None
    product_requirement: str | None
    quantity: str | None
    estimated_value: Decimal | None
    status: str
    assigned_to_id: int | None
    assigned_to_name: str | None = None
    notes: str | None
    lost_reason: str | None
    customer_id: int | None
    voice_url: str | None = None
    gstin: str | None = None
    priority: str | None = None
    next_follow_up: datetime | None = None
    overdue_follow_up: bool = False
    stuck: bool = False
    created_at: datetime | None = None


# ---- Products ----
class ProductCreate(BaseModel):
    sku: str
    name: str
    unit: str = "KG"
    hsn_code: str | None = None
    gst_rate: Decimal = Decimal("0")
    base_price: Decimal = Decimal("0")
    selling_price: Decimal | None = None


class ProductUpdate(BaseModel):
    name: str | None = None
    unit: str | None = None
    hsn_code: str | None = None
    gst_rate: Decimal | None = None
    base_price: Decimal | None = None
    selling_price: Decimal | None = None
    is_active: bool | None = None


class ProductOut(ORMModel):
    id: int
    company_id: int
    sku: str
    name: str
    unit: str
    hsn_code: str | None
    gst_rate: Decimal
    base_price: Decimal
    selling_price: Decimal = Decimal("0")
    is_active: bool


# ---- Inventory ----
class WarehouseOut(ORMModel):
    id: int
    company_id: int
    name: str
    is_default: bool
    is_active: bool


class StockSetIn(BaseModel):
    product_id: int
    warehouse_id: int | None = None
    quantity: Decimal


class StockInwardIn(BaseModel):
    product_id: int
    warehouse_id: int | None = None
    quantity: Decimal  # amount to add
    batch: str | None = None
    manufacturer: str | None = None
    notes: str | None = None


class StockOut(ORMModel):
    id: int
    product_id: int
    warehouse_id: int
    quantity: Decimal


class StockMovementOut(ORMModel):
    id: int
    stock_balance_id: int
    product_id: int
    warehouse_id: int
    kind: str
    quantity: Decimal
    balance_after: Decimal
    batch: str | None
    manufacturer: str | None
    notes: str | None
    created_at: datetime


# ---- Purchases ----
class PurchaseCreate(BaseModel):
    customer_id: int
    source: str = "direct"
    manufacturer: str | None = None
    product: str
    quantity: Decimal
    received: Decimal = Decimal("0")
    value: Decimal = Decimal("0")
    eta: str | None = None
    status: str = "Confirmed"
    notes: str | None = None
    sales_order_id: int | None = None
    product_id: int | None = None


class PurchaseOut(ORMModel):
    id: int
    company_id: int
    customer_id: int
    source: str
    manufacturer: str | None
    product: str
    quantity: Decimal
    received: Decimal
    value: Decimal
    eta: str | None
    status: str
    notes: str | None
    created_at: datetime
    dispatch_id: int | None = None  # set when a load is auto-created
    sales_order_id: int | None = None
    product_id: int | None = None


class PurchaseReceiveIn(BaseModel):
    batch: str | None = None
    manufacturer: str | None = None
    notes: str | None = None


# ---- Dispatch ----
class DispatchCreate(BaseModel):
    customer_id: int
    product: str
    quantity: Decimal
    vehicle_id: int | None = None
    vehicle: str | None = None
    transporter: str | None = None
    sales_order_id: int | None = None
    slot_date: date | None = None
    slot: str | None = None
    lr: str | None = None
    eta: str | None = None
    status: str = "Pending"
    notes: str | None = None


class DispatchUpdate(BaseModel):
    product: str | None = None
    quantity: Decimal | None = None
    vehicle_id: int | None = None
    vehicle: str | None = None
    transporter: str | None = None
    lr: str | None = None
    eta: str | None = None
    status: str | None = None
    notes: str | None = None


class DispatchOut(ORMModel):
    id: int
    company_id: int
    customer_id: int
    product: str
    quantity: Decimal
    vehicle: str | None
    transporter: str | None
    lr: str | None
    eta: str | None
    status: str
    notes: str | None
    created_at: datetime
    sales_order_id: int | None = None
    slot_date: date | None = None
    slot: str | None = None


# ---- Quotations / Sales ----
class LineIn(BaseModel):
    product_id: int
    quantity: Decimal
    unit_price: Decimal


class QuotationCreate(BaseModel):
    customer_id: int | None = None
    lead_id: int | None = None
    notes: str | None = None
    lines: list[LineIn]


class QuotationOut(ORMModel):
    id: int
    company_id: int
    customer_id: int
    lead_id: int | None
    status: str
    notes: str | None
    lines: list[dict]
    customer_name: str | None = None
    below_floor: bool = False
    needs_approval: bool = False


class SalesOrderCreate(BaseModel):
    customer_id: int
    quotation_id: int | None = None
    warehouse_id: int | None = None
    notes: str | None = None
    lines: list[LineIn]


class SalesOrderOut(ORMModel):
    id: int
    company_id: int
    company_name: str | None = None
    customer_id: int
    quotation_id: int | None
    warehouse_id: int
    status: str
    notes: str | None
    lines: list[dict]
    stock_warnings: list[str] = []
    ops_status: str = "pending_approval"
    customer_name: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    confirmed_at: datetime | None = None
    logistics_status: str | None = None
    vehicle: str | None = None
    eta: str | None = None


class OrderDeskLine(BaseModel):
    product_id: int
    product_name: str
    quantity: Decimal
    unit_price: Decimal
    on_hand: Decimal
    ok: bool
    outstanding_qty: Decimal = Decimal("0")


class OutstandingDeliveryOut(BaseModel):
    order_id: int
    company_id: int
    company_name: str | None = None
    customer_name: str
    product_id: int
    product_name: str
    unit: str = "KG"
    ordered_qty: Decimal
    outstanding_qty: Decimal
    on_hand: Decimal
    ops_status: str
    can_complete: bool


class OrderDeskOut(BaseModel):
    id: int
    company_id: int
    company_name: str | None = None
    customer_id: int
    customer_name: str
    quotation_id: int | None = None
    warehouse_id: int
    status: str
    ops_status: str
    notes: str | None = None
    confirmed_at: datetime | None = None
    created_at: datetime | None = None
    lines: list[OrderDeskLine]
    stock_ok: bool
    dispatch_id: int | None = None
    purchase_id: int | None = None
    purchase_status: str | None = None
    slot_date: date | None = None
    slot: str | None = None
    vehicle: str | None = None


class RaisePurchaseIn(BaseModel):
    manufacturer: str | None = None
    notes: str | None = None
    product_id: int | None = None
    quantity: Decimal | None = None


class AllocateDispatchIn(BaseModel):
    on_date: date
    slot: str  # morning | afternoon | evening
    vehicle_id: int
    driver_user_id: int  # logistics role user — chosen after vehicle


class ReassignVehicleIn(BaseModel):
    """Change truck / driver before logistics starts the run (planned / loading / loaded only)."""

    vehicle_id: int
    driver_user_id: int | None = None


class DriverOut(BaseModel):
    """Logistics person available to assign after picking a vehicle."""

    id: int
    full_name: str
    phone: str | None = None
    email: str


class InvoiceLineAdjustIn(BaseModel):
    product_id: int
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    gst_rate: Decimal | None = None


class InvoiceFromOrderIn(BaseModel):
    """Accounts enters bill details before raising the invoice from an approved SO."""

    invoice_date: date | None = None
    due_date: date | None = None
    credit_days: int | None = None
    number: str | None = None
    remarks: str | None = None
    lines: list[InvoiceLineAdjustIn] | None = None


# ---- Invoices / Payments ----
class InvoiceOut(ORMModel):
    id: int
    company_id: int
    customer_id: int
    customer_name: str | None = None
    sales_order_id: int | None
    dispatch_id: int | None = None
    number: str
    invoice_date: date
    due_date: date | None
    status: str
    subtotal: Decimal
    tax_amount: Decimal
    total: Decimal
    amount_paid: Decimal
    outstanding: Decimal
    credit_days: int | None = None
    credit_applied: Decimal = Decimal("0")
    debit_applied: Decimal = Decimal("0")
    cgst: Decimal = Decimal("0")
    sgst: Decimal = Decimal("0")
    igst: Decimal = Decimal("0")
    delay_days: int = 0
    days_to_due: int = 0
    payment_status: str = "unpaid"
    interest_loss: Decimal = Decimal("0")
    penalty_waived: bool = False
    sent_at: datetime | None = None
    sent_via: str | None = None
    gstin: str | None = None
    phone: str | None = None
    address: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    lines: list[dict] = []


class BillableLoadOut(BaseModel):
    dispatch_id: int
    company_id: int
    company_name: str | None = None
    customer_id: int
    customer_name: str
    product: str
    quantity: Decimal
    unit_price: Decimal
    estimated_total: Decimal
    dispatch_status: str
    vehicle: str | None = None
    lr: str | None = None
    eta: str | None = None
    notes: str | None = None
    sales_order_id: int | None = None
    invoiced: bool = False
    can_invoice: bool = False
    credit_limit: Decimal = Decimal("0")
    current_outstanding: Decimal = Decimal("0")
    projected_exposure: Decimal = Decimal("0")
    credit_ok: bool = True


class BillableOrderOut(BaseModel):
    sales_order_id: int
    company_id: int
    company_name: str | None = None
    customer_id: int
    customer_name: str
    address: str | None = None
    ops_status: str
    logistics_status: str | None = None
    vehicle: str | None = None
    line_count: int
    qty: Decimal
    estimated_total: Decimal
    credit_limit: Decimal = Decimal("0")
    current_outstanding: Decimal = Decimal("0")
    projected_exposure: Decimal = Decimal("0")
    credit_ok: bool = True


class ClientAccountOut(BaseModel):
    customer_id: int
    customer_ids: list[int] = []
    company_id: int
    company_ids: list[int] = []
    company_name: str | None = None
    name: str
    gstin: str | None = None
    phone: str | None = None
    credit_days: int
    credit_limit: Decimal
    orders_fulfilled: int
    invoice_count: int
    total_revenue: Decimal
    outstanding: Decimal
    paid: Decimal = Decimal("0")
    overdue: Decimal = Decimal("0")


class ClientLedgerOut(BaseModel):
    customer_id: int
    customer_ids: list[int] = []
    company_id: int
    company_ids: list[int] = []
    company_name: str | None = None
    name: str
    gstin: str | None = None
    phone: str | None = None
    address: str | None = None
    credit_days: int
    credit_limit: Decimal
    orders_fulfilled: int
    invoice_count: int
    total_revenue: Decimal
    outstanding: Decimal
    paid: Decimal = Decimal("0")
    overdue: Decimal = Decimal("0")
    invoices: list[InvoiceOut] = []
    orders: list[dict] = []


class PaymentCreate(BaseModel):
    invoice_id: int
    amount: Decimal
    method: str = "bank"
    reference: str | None = None
    paid_at: date | None = None


class PaymentOut(ORMModel):
    id: int
    invoice_id: int
    invoice_number: str | None = None
    customer_name: str | None = None
    amount: Decimal
    method: str
    reference: str | None
    paid_at: date


class AccountsDashboardOut(BaseModel):
    today_collections: Decimal
    month_collections: Decimal
    total_receivables: Decimal
    total_overdue: Decimal
    due_today: Decimal
    due_this_week: Decimal
    unpaid_invoices: int
    partial_invoices: int
    overdue_invoices: int
    credit_exposure: Decimal
    active_customers: int
    invoice_count: int = 0
    pending_payments: int = 0
    credit_alerts: int = 0
    today_invoices: int = 0
    today_billing: Decimal = Decimal("0")
    due_soon: Decimal = Decimal("0")
    cost_of_delay: Decimal = Decimal("0")
    aging_current: Decimal = Decimal("0")
    aging_d1_30: Decimal = Decimal("0")
    aging_d31_60: Decimal = Decimal("0")
    aging_d61_90: Decimal = Decimal("0")
    aging_d90_plus: Decimal = Decimal("0")
    ready_to_invoice: int = 0


class SupervisorDashboardOut(BaseModel):
    today_sales: Decimal
    month_sales: Decimal
    active_leads: int
    unassigned_leads: int
    pending_approvals: int
    pending_orders: int
    confirmed_orders: int
    low_stock_items: int
    outstanding: Decimal
    overdue_invoices: int
    team_users: int
    total_stock_qty: Decimal
    inventory_value: Decimal
    available_stock: Decimal
    ready_for_dispatch: int
    warehouses: int


class SalesDashboardOut(BaseModel):
    active_leads: int
    new_leads: int
    pending_quotations: int
    approved_quotations: int
    open_orders: int
    month_sales: Decimal
    month_target: Decimal
    achievement_pct: Decimal
    my_customers: int
    conversion_rate: Decimal
    funnel: dict[str, int] = {}
    today_visits: int = 0
    overdue_follow_ups: int = 0
    pending_quotes: int = 0
    quote_win_rate: Decimal = Decimal("0")
    price_exceptions: int = 0
    visit_coverage: int = 0


class LogisticsDashboardOut(BaseModel):
    pending_dispatches: int
    ready_for_dispatch: int
    today_dispatches: int
    delivered_today: int
    confirmed_orders: int
    planned: int = 0
    in_transit: int = 0
    out_for_delivery: int = 0
    pending_pod: int = 0
    issues: int = 0


class ReadyOrderOut(BaseModel):
    id: int
    customer_id: int
    customer_name: str
    address: str | None = None
    phone: str | None = None
    qty: Decimal
    value: Decimal
    ops_status: str
    notes: str | None = None
    product_summary: str = ""
    company_name: str | None = None


class LogisticsStopOut(BaseModel):
    id: int
    sales_order_id: int
    customer_id: int
    customer_name: str
    address: str | None = None
    phone: str | None = None
    status: str
    qty_ordered: Decimal
    qty_delivered: Decimal
    receiver_name: str | None = None
    pod_url: str | None = None
    signature_url: str | None = None
    fail_reason: str | None = None
    remarks: str | None = None
    product_summary: str = ""
    company_name: str | None = None
    invoice_id: int | None = None
    invoice_number: str | None = None
    return_required: bool = False
    reattempt_date: date | None = None


class LogisticsRunOut(BaseModel):
    id: int
    company_id: int | None = None
    number: str
    on_date: date
    slot: str = "afternoon"
    vehicle_id: int | None = None
    vehicle_plate: str | None = None
    driver_name: str | None = None
    agency: str
    route: str | None = None
    status: str
    notes: str | None = None
    dispatched_at: datetime | None = None
    total_qty: Decimal = Decimal("0")
    truck_state: str = "idle"
    stops: list[LogisticsStopOut] = []


class LogisticsRunCreate(BaseModel):
    order_ids: list[int]
    on_date: date
    slot: str = "afternoon"
    vehicle_id: int | None = None
    driver_name: str | None = None
    agency: str = "Own Vehicle"
    route: str | None = None
    notes: str | None = None


class LogisticsStatusIn(BaseModel):
    status: str


class LogisticsRunPatch(BaseModel):
    vehicle_id: int | None = None
    driver_name: str | None = None
    agency: str | None = None
    route: str | None = None
    notes: str | None = None


class LogisticsDeliverIn(BaseModel):
    outcome: str = "delivered"  # delivered | partial | failed
    qty_delivered: Decimal | None = None
    receiver_name: str | None = None
    pod_url: str | None = None
    signature_url: str | None = None
    fail_reason: str | None = None
    remarks: str | None = None
    return_required: bool = False
    reattempt_date: date | None = None


class LogisticsPodIn(BaseModel):
    pod_url: str | None = None
    signature_url: str | None = None
    receiver_name: str | None = None
    remarks: str | None = None


class LogisticsExceptionPatch(BaseModel):
    status: str


class LogisticsExceptionOut(BaseModel):
    id: int
    sales_order_id: int | None
    kind: str
    detail: str | None
    status: str
    created_at: datetime


class VisitMediaIn(BaseModel):
    url: str
    kind: str = "photo"
    lat: float | None = None
    lng: float | None = None


class VisitCreate(BaseModel):
    company_id: int
    client_kind: str = "new"  # existing | new
    customer_id: int | None = None
    lead_id: int | None = None
    site_name: str
    contact_person: str | None = None
    phone: str | None = None
    notes: str | None = None
    voice_url: str | None = None
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    photos: list[VisitMediaIn] = []
    purpose: str | None = None
    outcome: str | None = None
    next_action: str | None = None
    competitor_notes: str | None = None
    issue: str | None = None


class StockGlimpseOut(BaseModel):
    on_hand: Decimal
    booked: Decimal
    headroom: Decimal
    unit: str = "KG"


class VehicleOut(ORMModel):
    id: int
    name: str
    plate: str
    kind: str
    driver_name: str | None = None
    live_status: str = "idle"
    is_active: bool


class VehicleAvailOut(BaseModel):
    vehicle_id: int
    name: str
    plate: str
    kind: str
    driver_name: str | None = None
    live_status: str
    morning: str
    afternoon: str
    evening: str
    morning_for: str | None = None
    afternoon_for: str | None = None
    evening_for: str | None = None


class VehicleLiveSet(BaseModel):
    status: str  # idle | going | returning


class VehicleSlotSet(BaseModel):
    on_date: date
    slot: str  # morning | afternoon | evening
    status: str  # free | booked
    notes: str | None = None


class DeliveryOut(ORMModel):
    id: int
    company_id: int
    company_name: str
    customer_name: str
    address: str | None
    phone: str | None
    item_summary: str
    slot_date: date
    slot: str
    status: str
    pod_url: str | None = None


class DeliveryComplete(BaseModel):
    pod_url: str | None = None
    lat: float | None = None
    lng: float | None = None


class DeliveryInvoiceOut(BaseModel):
    delivery_id: int
    number: str
    company_name: str
    customer_name: str
    address: str | None
    phone: str | None
    item_summary: str
    slot_date: date
    slot: str


class VehicleCreate(BaseModel):
    name: str
    plate: str
    kind: str = "truck"
    driver_name: str | None = None


class VisitMediaOut(ORMModel):
    id: int
    kind: str
    url: str
    lat: Decimal | None
    lng: Decimal | None


class VisitOut(ORMModel):
    id: int
    company_id: int
    user_id: int
    lead_id: int | None
    customer_id: int | None = None
    sales_order_id: int | None = None
    site_name: str
    contact_person: str | None
    phone: str | None
    notes: str | None
    voice_url: str | None
    lat: Decimal | None
    lng: Decimal | None
    accuracy_m: Decimal | None
    checked_in_at: datetime
    media: list[VisitMediaOut] = []
    purpose: str | None = None
    outcome: str | None = None
    next_action: str | None = None
    competitor_notes: str | None = None
    issue: str | None = None
