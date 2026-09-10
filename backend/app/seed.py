"""Seed roles, permissions, org, companies, and super admin."""

import os

from app.core.database import Base, SessionLocal, engine
from app.core.models import (
    Company,
    Organization,
    Permission,
    Role,
    RoleName,
    RolePermission,
    User,
    UserCompany,
    Warehouse,
)
from app.core.security import hash_password
from app.sales.ensure_schema import ensure_sales_schema
from app.logistics.ensure_schema import ensure_logistics_schema
from app.accounts.ensure_schema import ensure_accounts_schema

# Import models so metadata is registered
import app.core.models  # noqa: F401


def _want_demo_transactions() -> bool:
    """Hosted Render stays clean; local / explicit flag gets full sales+accounts+logistics dummy data."""
    flag = (os.getenv("SEED_DEMO_TRANSACTIONS") or "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    if flag in ("0", "false", "no", "off"):
        return False
    on_render = os.getenv("RENDER") == "true" or bool(os.getenv("RENDER_SERVICE_ID"))
    return not on_render


def _seed_demo_transactions(db) -> None:
    """Leads, quotes, visits, invoices, payments, credit notes, SOs, runs, POD, deliveries."""
    # Accounts first so sales collection follow-ups can attach to open invoices
    _sync_demo_accounts(db)
    _sync_demo_accounts_extra(db)
    _sync_demo_sales(db)
    _sync_demo_logistics(db)
    _sync_demo_deliveries(db)

PERMISSIONS = [
    ("dashboard.view", "View dashboard"),
    ("companies.view", "View companies"),
    ("companies.create", "Create companies"),
    ("companies.edit", "Edit companies"),
    ("users.view", "View users"),
    ("users.create", "Create users"),
    ("users.edit", "Edit users"),
    ("customers.view", "View customers"),
    ("customers.create", "Create customers"),
    ("customers.edit", "Edit customers"),
    ("leads.view", "View leads"),
    ("leads.create", "Create leads"),
    ("leads.edit", "Edit leads"),
    ("products.view", "View products"),
    ("products.create", "Create products"),
    ("products.edit", "Edit products"),
    ("inventory.view", "View inventory"),
    ("inventory.edit", "Edit inventory"),
    ("purchases.view", "View purchases"),
    ("purchases.create", "Create purchase bills"),
    ("purchases.edit", "Receive / update purchases"),
    ("purchases.approve", "Approve purchase requirements"),
    ("dispatch.view", "View dispatches"),
    ("dispatch.create", "Create dispatches"),
    ("dispatch.edit", "Update dispatch / status"),
    ("quotations.view", "View quotations"),
    ("quotations.create", "Create quotations"),
    ("quotations.edit", "Edit quotations"),
    ("quotations.approve", "Approve quotations"),
    ("sales.view", "View sales orders"),
    ("sales.create", "Create sales orders"),
    ("sales.edit", "Edit/confirm sales orders"),
    ("invoices.view", "View invoices"),
    ("invoices.create", "Create invoices"),
    ("payments.view", "View payments"),
    ("payments.create", "Create payments"),
    ("audit.view", "View audit logs"),
    ("visits.view", "View field visits"),
    ("visits.create", "Log field visits"),
    ("vehicles.view", "View vehicle availability"),
    ("vehicles.edit", "Set vehicle availability"),
    ("deliveries.view", "View delivery stops"),
    ("deliveries.edit", "Complete deliveries"),
]

# Granular VIEW/CREATE/EDIT/APPROVE — menus hide modules; APIs enforce these codes.
ROLE_PERMS: dict[RoleName, list[str] | str] = {
    RoleName.SUPER_ADMIN: "*",  # everything + Administration
    RoleName.OWNER: "*",
    RoleName.SUPERVISOR: [
        # ops + warehouse + approvals; no Administration (no users.create/edit)
        "dashboard.view",
        "companies.view",
        "users.view",
        "customers.view",
        "customers.create",
        "customers.edit",
        "leads.view",
        "leads.create",
        "leads.edit",
        "products.view",
        "products.create",
        "inventory.view",
        "inventory.edit",
        "purchases.view",
        "purchases.create",
        "purchases.edit",
        "dispatch.view",
        "dispatch.create",
        "dispatch.edit",
        "quotations.view",
        "quotations.create",
        "quotations.edit",
        # quotations.approve: Owner only
        "sales.view",
        "sales.create",
        "sales.edit",
        "invoices.view",
        "payments.view",
        "audit.view",
        "visits.view",
        "visits.create",
        "vehicles.view",
        "vehicles.edit",
        "deliveries.view",
        "deliveries.edit",
    ],
    RoleName.SALES: [
        "dashboard.view",
        "companies.view",
        "customers.view",
        "customers.create",
        "customers.edit",
        "leads.view",
        "leads.create",
        "leads.edit",
        "visits.view",
        "visits.create",
        "vehicles.view",
        "products.view",
        "inventory.view",
        "purchases.view",
        "quotations.view",
        "quotations.create",
        "quotations.edit",
        "sales.view",
        "sales.create",
        "sales.edit",
        "dispatch.view",
        "dispatch.create",
        "invoices.view",
        "payments.view",
    ],
    RoleName.ACCOUNTANT: [
        "dashboard.view",
        "companies.view",
        "customers.view",
        "customers.edit",
        "products.view",
        "sales.view",
        "dispatch.view",
        "invoices.view",
        "invoices.create",
        "payments.view",
        "payments.create",
        "audit.view",
    ],
    RoleName.LOGISTICS: [
        "dashboard.view",
        "companies.view",
        "customers.view",
        "customers.create",
        "products.view",
        "dispatch.view",
        "dispatch.edit",
        "sales.view",
        "invoices.view",
        "vehicles.view",
        "vehicles.edit",
        "deliveries.view",
        "deliveries.edit",
    ],
    # ponytail: WAREHOUSE role removed — Supervisor owns warehouse; enum kept for old DB rows
}


COMPANY_BRANDING = [
    {
        "legal_name": "Asian Apex & Co.",
        "trade_name": "Asian Apex",
        "invoice_prefix": "AA",
        "logo_url": "/logos/asian-apex.jpg",
    },
    {
        "legal_name": "Avighna Speciality Ingredients Pvt Ltd",
        "trade_name": "Avighna",
        "invoice_prefix": "AV",
        "logo_url": "/logos/avighna.png",
    },
    {
        "legal_name": "Ganesh Inc.",
        "trade_name": "Ganesh Inc",
        "invoice_prefix": "GI",
        "logo_url": "/logos/ganesh-inc.jpg",
    },
    {
        "legal_name": "Atharva Associates",
        "trade_name": "Atharva Associates",
        "invoice_prefix": "AT",
        "logo_url": "/logos/atharva-associates.png",
    },
]


def _ensure_column(table: str, column: str, ddl: str) -> None:
    # ponytail: create_all won't add columns to existing tables
    from sqlalchemy import text

    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        exists = conn.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        ).scalar()
        if not exists:
            conn.execute(text(ddl))


def _ensure_logo_column() -> None:
    _ensure_column("users", "photo_url", "ALTER TABLE users ADD COLUMN photo_url VARCHAR(255)")
    _ensure_column("companies", "logo_url", "ALTER TABLE companies ADD COLUMN logo_url VARCHAR(255)")
    _ensure_column("leads", "voice_url", "ALTER TABLE leads ADD COLUMN voice_url VARCHAR(255)")
    _ensure_column("field_visits", "customer_id", "ALTER TABLE field_visits ADD COLUMN customer_id INTEGER")
    _ensure_column("field_visits", "sales_order_id", "ALTER TABLE field_visits ADD COLUMN sales_order_id INTEGER")
    _ensure_column("vehicles", "driver_name", "ALTER TABLE vehicles ADD COLUMN driver_name VARCHAR(120)")
    _ensure_column("vehicles", "live_status", "ALTER TABLE vehicles ADD COLUMN live_status VARCHAR(20) DEFAULT 'idle'")
    _ensure_column("vehicles", "name", "ALTER TABLE vehicles ADD COLUMN name VARCHAR(80) DEFAULT 'Truck'")
    _ensure_column("vehicles", "kind", "ALTER TABLE vehicles ADD COLUMN kind VARCHAR(40) DEFAULT 'truck'")
    _ensure_column("invoices", "dispatch_id", "ALTER TABLE invoices ADD COLUMN dispatch_id INTEGER")
    _ensure_column("sales_orders", "ops_status", "ALTER TABLE sales_orders ADD COLUMN ops_status VARCHAR(40) DEFAULT 'pending_approval'")
    _ensure_column("purchases", "sales_order_id", "ALTER TABLE purchases ADD COLUMN sales_order_id INTEGER")
    _ensure_column("purchases", "product_id", "ALTER TABLE purchases ADD COLUMN product_id INTEGER")
    _ensure_column("dispatches", "sales_order_id", "ALTER TABLE dispatches ADD COLUMN sales_order_id INTEGER")
    _ensure_column("dispatches", "slot_date", "ALTER TABLE dispatches ADD COLUMN slot_date DATE")
    _ensure_column("dispatches", "slot", "ALTER TABLE dispatches ADD COLUMN slot VARCHAR(20)")


def _sync_company_branding(db) -> None:
    companies = db.query(Company).order_by(Company.id).all()
    for company, brand in zip(companies, COMPANY_BRANDING):
        company.legal_name = brand["legal_name"]
        company.trade_name = brand["trade_name"]
        company.invoice_prefix = brand["invoice_prefix"]
        company.logo_url = brand["logo_url"]
    db.commit()
    print(f"Company branding synced for {min(len(companies), len(COMPANY_BRANDING))} companies")


def _sync_role_user(
    db,
    *,
    role_name: RoleName,
    email: str,
    full_name: str,
    password: str,
) -> None:
    from app.core.models import Permission, Role, RolePermission, User, UserCompany, Organization

    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        # ponytail: roles added to enum after first seed
        role = Role(name=role_name, description=role_name.value.replace("_", " ").title())
        db.add(role)
        db.flush()
    perm_map = {p.code: p.id for p in db.query(Permission).all()}
    for code, desc in PERMISSIONS:
        if code not in perm_map:
            p = Permission(code=code, description=desc)
            db.add(p)
            db.flush()
            perm_map[code] = p.id
    wanted = ROLE_PERMS[role_name]
    codes = list(perm_map.keys()) if wanted == "*" else list(dict.fromkeys(wanted))
    db.query(RolePermission).filter(RolePermission.role_id == role.id).delete(synchronize_session=False)
    db.flush()
    for code in codes:
        if code in perm_map:
            db.add(RolePermission(role_id=role.id, permission_id=perm_map[code]))
    db.flush()

    org = db.query(Organization).first()
    companies = db.query(Company).order_by(Company.id).all()
    user = db.query(User).filter(User.email == email).first()
    if not user and org:
        user = User(
            organization_id=org.id,
            role_id=role.id,
            email=email,
            full_name=full_name,
            hashed_password=hash_password(password),
        )
        db.add(user)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=user.id, company_id=c.id))
        print(f"{full_name} user created: {email} / {password}")
    elif user:
        user.role_id = role.id
        user.is_active = True
        user.hashed_password = hash_password(password)
        existing = {uc.company_id for uc in db.query(UserCompany).filter(UserCompany.user_id == user.id).all()}
        for c in companies:
            if c.id not in existing:
                db.add(UserCompany(user_id=user.id, company_id=c.id))
        print(f"{full_name} user refreshed: {email} / {password}")
    db.commit()


FLEET = (
    ("Tata 1109", "KA-01-AB-4421", None),
    ("Tata 407", "KA-05-CD-2287", None),
)


def _sync_vehicles(db) -> None:
    from app.core.models import Organization, Vehicle

    org = db.query(Organization).first()
    if not org:
        return
    for name, plate, driver in FLEET:
        row = (
            db.query(Vehicle)
            .filter(Vehicle.organization_id == org.id, Vehicle.plate == plate)
            .first()
        )
        if not row:
            db.add(
                Vehicle(
                    organization_id=org.id,
                    name=name,
                    plate=plate,
                    kind="truck",
                    driver_name=driver,
                )
            )
        else:
            # Vehicles are fleet assets; logistics people are separate user accounts
            row.driver_name = None
    db.commit()
    count = db.query(Vehicle).filter(Vehicle.organization_id == org.id, Vehicle.is_active.is_(True)).count()
    print(f"Fleet has {count} active vehicles")


def _sync_logistics_drivers(db) -> None:
    """Extra logistics logins Owner can use as assignable drivers (separate from trucks)."""
    for email, name, password in (
        ("ravi@avighnya.local", "Ravi Kumar", "driver123"),
        ("suresh@avighnya.local", "Suresh Naik", "driver123"),
    ):
        _sync_role_user(
            db,
            role_name=RoleName.LOGISTICS,
            email=email,
            full_name=name,
            password=password,
        )


def _sync_demo_deliveries(db) -> None:
    from datetime import date, timedelta

    from app.core.models import Company, Customer, Delivery, Vehicle

    org = db.query(Organization).first()
    if not org:
        return
    company = db.query(Company).order_by(Company.id).first()
    vehicle = db.query(Vehicle).filter(Vehicle.is_active.is_(True)).first()
    customers = (
        db.query(Customer).filter(Customer.company_id == company.id).order_by(Customer.id).limit(4).all()
        if company
        else []
    )
    if not company or len(customers) < 1:
        return
    today = date.today()
    tomorrow = today + timedelta(days=1)
    pending_today = (
        db.query(Delivery)
        .filter(Delivery.slot_date == today, Delivery.status == "pending")
        .count()
    )
    if pending_today >= 3:
        return
    extras = [
        (customers[0], today, "morning", "Glucose Syrup 2 MT"),
        (customers[1] if len(customers) > 1 else customers[0], today, "afternoon", "Sucrose Fine 5 MT"),
        (customers[2] if len(customers) > 2 else customers[0], today, "evening", "Lactose 1 MT"),
        (customers[0], tomorrow, "morning", "Stabilizer 3 MT"),
    ]
    have = {(d.customer_id, d.slot_date.isoformat(), d.slot) for d in db.query(Delivery).all()}
    plan = [row for row in extras if (row[0].id, row[1].isoformat(), row[2]) not in have]
    for cust, when, slot, item in plan:
        if not cust.address:
            cust.address = "Plot 12, Peenya Industrial Area, Bengaluru"
        db.add(
            Delivery(
                organization_id=org.id,
                company_id=company.id,
                customer_id=cust.id,
                vehicle_id=vehicle.id if vehicle else None,
                item_summary=item,
                slot_date=when,
                slot=slot,
                status="pending",
            )
        )
    db.commit()
    print("Demo deliveries created")


DEMO_CUSTOMERS = [
    ("Anand Bakers Pvt Ltd", "Ramesh Anand", "9845011122", "Whitefield, Bangalore", "500000", 30),
    ("Gokul Beverages", "Vinay T.", "9845022233", "Peenya Industrial Area, Bangalore", "400000", 21),
    ("Medisyn Formulations", "Neha S.", "9845033344", "Bidadi, Ramanagara", "300000", 30),
    ("ABC Foods", "Rajesh Kumar", "9845099001", "Peenya Industrial Area, Bangalore", "500000", 30),
    ("XYZ Traders", "Anita Rao", "9845099002", "Hebbal, Mysuru", "250000", 15),
    ("MKM Foods", "Mohan K", "9845099003", "NH 275, Mandya", "200000", 30),
    ("Royal Traders", "Imran Pasha", "9845099004", "Yeshwanthpur, Bangalore", "150000", 7),
    ("Smoke Wholesale Co", "Farhan S", "9999900001", "Plot 12, Peenya Industrial Area, Bengaluru", "600000", 30),
    ("Sweet Mart", "Lakshmi N", "9845088008", "Jayanagar 4th Block, Bangalore", "180000", 21),
    ("City Bakery", "Joseph D", "9845077007", "MG Road, Mysuru", "120000", 15),
]


def _sync_demo_customers(db) -> None:
    from decimal import Decimal

    from app.core.models import Company, Customer

    for company in db.query(Company).order_by(Company.id).all():
        have = {c.name: c for c in db.query(Customer).filter(Customer.company_id == company.id).all()}
        for name, contact, phone, address, limit, days in DEMO_CUSTOMERS:
            row = have.get(name)
            if row:
                if not row.address:
                    row.address = address
                if not row.shipping_address:
                    row.shipping_address = address
                if not row.phone:
                    row.phone = phone
                row.credit_limit = Decimal(limit)
                row.credit_days = days
                continue
            db.add(
                Customer(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    name=name,
                    contact_person=contact,
                    phone=phone,
                    address=address,
                    shipping_address=address,
                    credit_limit=Decimal(limit),
                    credit_days=days,
                    gstin=f"29AAAAA{company.id:04d}{name[:3].upper()}1Z5",
                )
            )
    db.commit()


DEMO_PRODUCTS = [
    {"sku": "NF-500", "name": "Nutragain Flour", "unit": "KG", "base_price": "42", "selling_price": "50", "qty": "1250", "gst": "5"},
    {"sku": "BS-50", "name": "Besan", "unit": "KG", "base_price": "62", "selling_price": "70", "qty": "850", "gst": "5"},
    {"sku": "SJ-50", "name": "Suji", "unit": "KG", "base_price": "68", "selling_price": "80", "qty": "620", "gst": "5"},
    {"sku": "RV-50", "name": "Rava", "unit": "KG", "base_price": "52", "selling_price": "60", "qty": "480", "gst": "5"},
    {"sku": "MD-50", "name": "Maida", "unit": "KG", "base_price": "38", "selling_price": "45", "qty": "210", "gst": "5"},
    {"sku": "PH-50", "name": "Poha", "unit": "KG", "base_price": "44", "selling_price": "55", "qty": "180", "gst": "5"},
]


def _sync_demo_products(db) -> None:
    from decimal import Decimal

    from app.core.models import Product, StockBalance, Warehouse

    companies = db.query(Company).order_by(Company.id).all()
    for offset, company in enumerate(companies):
        wh = (
            db.query(Warehouse)
            .filter(Warehouse.company_id == company.id, Warehouse.is_default.is_(True))
            .first()
        ) or db.query(Warehouse).filter(Warehouse.company_id == company.id).first()
        if not wh:
            wh = Warehouse(
                organization_id=company.organization_id,
                company_id=company.id,
                name="Main Warehouse",
                is_default=True,
            )
            db.add(wh)
            db.flush()
        for item in DEMO_PRODUCTS:
            product = (
                db.query(Product)
                .filter(Product.company_id == company.id, Product.sku == item["sku"])
                .first()
            )
            if not product:
                product = Product(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    sku=item["sku"],
                    name=item["name"],
                    unit=item["unit"],
                    base_price=Decimal(item["base_price"]),
                    selling_price=Decimal(item["selling_price"]),
                    gst_rate=Decimal(item.get("gst", "5")),
                )
                db.add(product)
                db.flush()
            else:
                product.base_price = Decimal(item["base_price"])
                product.selling_price = Decimal(item["selling_price"])
                product.gst_rate = Decimal(item.get("gst", "5"))
            qty = Decimal(item["qty"]) + Decimal(offset * 35)
            if item["name"] in ("Maida", "Poha"):
                qty = Decimal("210") if item["name"] == "Maida" else Decimal("180")
            bal = (
                db.query(StockBalance)
                .filter(StockBalance.warehouse_id == wh.id, StockBalance.product_id == product.id)
                .first()
            )
            if not bal:
                db.add(
                    StockBalance(
                        organization_id=company.organization_id,
                        company_id=company.id,
                        warehouse_id=wh.id,
                        product_id=product.id,
                        quantity=qty,
                    )
                )
            elif bal.quantity == 0:
                bal.quantity = qty
    db.commit()
    print("Demo inventory products synced")


def _product_by_name(db, company_id: int, name: str):
    from app.core.models import Product

    return db.query(Product).filter(Product.company_id == company_id, Product.name == name).first()


def _make_demo_so(db, *, org_id, company_id, warehouse_id, customer_id, user_id, ops_status, lines, status=None):
    from datetime import datetime, timezone
    from decimal import Decimal

    from app.core.models import SalesOrder, SalesOrderLine, SalesOrderStatus

    so_status = status or (
        SalesOrderStatus.INVOICED
        if ops_status in ("ready", "allocated", "dispatched", "pending_verify")
        else SalesOrderStatus.CONFIRMED
    )
    so = SalesOrder(
        organization_id=org_id,
        company_id=company_id,
        customer_id=customer_id,
        warehouse_id=warehouse_id,
        status=so_status,
        ops_status=ops_status,
        notes="logistics-demo",
        created_by_id=user_id,
        confirmed_at=datetime.now(timezone.utc),
    )
    db.add(so)
    db.flush()
    for product, qty, price in lines:
        db.add(
            SalesOrderLine(
                sales_order_id=so.id,
                product_id=product.id,
                quantity=Decimal(str(qty)),
                unit_price=Decimal(str(price)),
                outstanding_qty=Decimal("0"),
            )
        )
    return so


def _invoice_demo_so(db, *, company, so, customer, lines):
    from datetime import date

    from app.core.models import Invoice, InvoiceStatus

    existing = db.query(Invoice).filter(Invoice.sales_order_id == so.id).first()
    if existing:
        return existing
    seq = db.query(Invoice).filter(Invoice.company_id == company.id).count() + 1
    return _add_invoice(
        db,
        company=company,
        customer=customer,
        number=f"{company.invoice_prefix}-SO{so.id:04d}-{seq:02d}",
        inv_date=date.today(),
        due_days=30,
        status=InvoiceStatus.OPEN,
        paid=None,
        lines=lines,
        sales_order_id=so.id,
    )


def _make_demo_stop(db, *, run, so, customer, status, qty, delivered=0, receiver=None, pod=None, fail=None, remarks=None, when=None):
    from decimal import Decimal

    from app.core.models import Dispatch, LogisticsStop

    load = Dispatch(
        organization_id=run.organization_id,
        company_id=run.company_id,
        customer_id=customer.id,
        product="Demo load",
        quantity=Decimal(str(qty)),
        vehicle=None,
        transporter=run.driver_name,
        status="Dispatched" if run.status not in ("planned", "loading", "loaded") else "Ready",
        notes=f"{run.number} · SO-{so.id}",
        created_by_id=run.created_by_id,
        sales_order_id=so.id,
        slot_date=run.on_date,
        slot="morning",
        eta=str(run.on_date),
    )
    db.add(load)
    db.flush()
    stop = LogisticsStop(
        run_id=run.id,
        sales_order_id=so.id,
        customer_id=customer.id,
        dispatch_id=load.id,
        status=status,
        qty_ordered=Decimal(str(qty)),
        qty_delivered=Decimal(str(delivered)),
        receiver_name=receiver,
        pod_url=pod,
        fail_reason=fail,
        remarks=remarks,
        delivered_at=when,
    )
    db.add(stop)
    return stop


def _should_reset_demo(db) -> bool:
    from sqlalchemy import or_

    from app.core.models import LogisticsRun

    return (
        db.query(LogisticsRun)
        .filter(or_(LogisticsRun.number.like("DSP-DEMO-%"), LogisticsRun.number.like("RUN-FILL-%")))
        .first()
        is not None
    )


def _clear_demo_transactions(db) -> None:
    from sqlalchemy import inspect, text

    from app.core.models import StockBalance, Vehicle

    tables = [
        "field_visit_media",
        "collection_follow_ups",
        "credit_notes",
        "payments",
        "invoice_lines",
        "invoices",
        "logistics_exceptions",
        "logistics_stops",
        "logistics_runs",
        "deliveries",
        "vehicle_slots",
        "vehicle_days",
        "quotation_lines",
        "sales_order_lines",
        "purchases",
        "dispatches",
        "sales_orders",
        "quotations",
        "lead_activities",
        "field_visits",
        "leads",
        "stock_movements",
    ]
    have = set(inspect(db.get_bind()).get_table_names())
    existing = [t for t in tables if t in have]
    if existing:
        db.execute(text("TRUNCATE TABLE " + ", ".join(existing) + " RESTART IDENTITY CASCADE"))
    for veh in db.query(Vehicle).all():
        veh.live_status = "idle"
    for bal in db.query(StockBalance).all():
        bal.quantity = 0
    db.commit()
    print("Old dummy data cleared")


def _sync_demo_logistics(db) -> None:
    from datetime import date, datetime, timedelta, timezone
    from decimal import Decimal

    from app.core.models import (
        Company,
        Customer,
        LogisticsRun,
        Purchase,
        User,
        Vehicle,
        VehicleSlot,
        Warehouse,
        SalesOrderStatus,
    )

    today = date.today()
    yesterday = today - timedelta(days=1)
    now = datetime.now(timezone.utc)
    user = db.query(User).filter(User.email == "logistics@avighnya.local").first()
    truck = db.query(Vehicle).filter(Vehicle.is_active.is_(True)).order_by(Vehicle.id).first()
    if truck:
        truck.live_status = "idle"
        for slot in ("morning", "afternoon", "evening"):
            row = (
                db.query(VehicleSlot)
                .filter(VehicleSlot.vehicle_id == truck.id, VehicleSlot.on_date == today, VehicleSlot.slot == slot)
                .first()
            )
            if row:
                row.status = "free"
            else:
                db.add(VehicleSlot(vehicle_id=truck.id, on_date=today, slot=slot, status="free"))

    created = 0
    for company in db.query(Company).order_by(Company.id).all():
        marker = f"RUN-FLOW-{company.id:02d}-YDAY"
        if db.query(LogisticsRun).filter(LogisticsRun.company_id == company.id, LogisticsRun.number == marker).first():
            continue
        wh = (
            db.query(Warehouse)
            .filter(Warehouse.company_id == company.id, Warehouse.is_default.is_(True))
            .first()
        ) or db.query(Warehouse).filter(Warehouse.company_id == company.id).first()
        names = {c.name: c for c in db.query(Customer).filter(Customer.company_id == company.id).all()}
        abc = names.get("ABC Foods")
        xyz = names.get("XYZ Traders")
        smoke = names.get("Smoke Wholesale Co")
        gokul = names.get("Gokul Beverages")
        maida = _product_by_name(db, company.id, "Maida")
        besan = _product_by_name(db, company.id, "Besan")
        suji = _product_by_name(db, company.id, "Suji")
        if not wh or not maida or not besan or not abc or not xyz or not smoke or not gokul:
            continue
        org_id = company.organization_id
        uid = user.id if user else None

        ready_abc = _make_demo_so(
            db,
            org_id=org_id,
            company_id=company.id,
            warehouse_id=wh.id,
            customer_id=abc.id,
            user_id=uid,
            ops_status="ready",
            lines=[(maida, 400, 45), (besan, 150, 70)],
        )
        _invoice_demo_so(db, company=company, so=ready_abc, customer=abc, lines=[(maida, 400, 45), (besan, 150, 70)])
        ready_xyz = _make_demo_so(
            db,
            org_id=org_id,
            company_id=company.id,
            warehouse_id=wh.id,
            customer_id=xyz.id,
            user_id=uid,
            ops_status="ready",
            lines=[(suji or maida, 250, 80)],
        )
        _invoice_demo_so(db, company=company, so=ready_xyz, customer=xyz, lines=[(suji or maida, 250, 80)])
        ready_smoke = _make_demo_so(
            db,
            org_id=org_id,
            company_id=company.id,
            warehouse_id=wh.id,
            customer_id=smoke.id,
            user_id=uid,
            ops_status="ready",
            lines=[(maida, 800, 45)],
        )
        _invoice_demo_so(db, company=company, so=ready_smoke, customer=smoke, lines=[(maida, 800, 45)])

        from app.core.models import SalesOrder

        bill_so = _make_demo_so(
            db,
            org_id=org_id,
            company_id=company.id,
            warehouse_id=wh.id,
            customer_id=abc.id,
            user_id=uid,
            ops_status="awaiting_invoice",
            lines=[(besan, 90, 70)],
            status=SalesOrderStatus.CONFIRMED,
        )
        bill_so.notes = "accounts-demo-awaiting-invoice"

        done_so = _make_demo_so(
            db,
            org_id=org_id,
            company_id=company.id,
            warehouse_id=wh.id,
            customer_id=gokul.id,
            user_id=uid,
            ops_status="dispatched",
            lines=[(besan, 120, 70)],
        )
        _invoice_demo_so(db, company=company, so=done_so, customer=gokul, lines=[(besan, 120, 70)])
        run_done = LogisticsRun(
            organization_id=org_id,
            company_id=company.id,
            number=marker,
            on_date=yesterday,
            slot="morning",
            vehicle_id=truck.id if truck else None,
            driver_name=truck.driver_name if truck else "Ravi Kumar",
            agency="Own Vehicle",
            route="Peenya",
            status="completed",
            dispatched_at=now - timedelta(days=1),
            created_by_id=uid,
        )
        db.add(run_done)
        db.flush()
        _make_demo_stop(
            db,
            run=run_done,
            so=done_so,
            customer=gokul,
            status="delivered",
            qty=120,
            delivered=120,
            receiver="Vinay T.",
            pod="/uploads/pod/demo-pod.jpg",
            when=now - timedelta(days=1),
        )
        if not db.query(Purchase).filter(Purchase.company_id == company.id, Purchase.notes == "demo-purchase").first():
            db.add(
                Purchase(
                    organization_id=org_id,
                    company_id=company.id,
                    customer_id=abc.id,
                    source="manufacturer",
                    manufacturer="Demo Mills",
                    product="Maida",
                    quantity=Decimal("2000"),
                    received=Decimal("2000"),
                    value=Decimal("76000"),
                    status="Received",
                    notes="demo-purchase",
                    product_id=maida.id,
                    created_by_id=uid,
                )
            )
            db.add(
                Purchase(
                    organization_id=org_id,
                    company_id=company.id,
                    customer_id=smoke.id,
                    source="direct",
                    product="Besan",
                    quantity=Decimal("800"),
                    received=Decimal("0"),
                    value=Decimal("49600"),
                    eta=str(today + timedelta(days=3)),
                    status="Confirmed",
                    notes="demo-purchase",
                    product_id=besan.id,
                    created_by_id=uid,
                )
            )
        created += 1

    if truck:
        from app.core.models import SalesOrder

        already = (
            db.query(LogisticsRun)
            .filter(LogisticsRun.on_date == today, LogisticsRun.status.in_(("planned", "loading", "loaded")))
            .first()
        )
        if not already:
            so = (
                db.query(SalesOrder)
                .filter(SalesOrder.ops_status == "ready")
                .order_by(SalesOrder.id)
                .first()
            )
            cust = db.query(Customer).filter(Customer.id == so.customer_id).first() if so else None
            if so and cust:
                so.ops_status = "allocated"
                run = LogisticsRun(
                    organization_id=so.organization_id,
                    company_id=so.company_id,
                    number=f"RUN-FLOW-{so.company_id:02d}-AM",
                    on_date=today,
                    slot="morning",
                    vehicle_id=truck.id,
                    driver_name=truck.driver_name or "Ravi Kumar",
                    agency="Own Vehicle",
                    status="planned",
                    created_by_id=user.id if user else None,
                )
                db.add(run)
                db.flush()
                qty = sum((ln.quantity for ln in so.lines), Decimal("0"))
                _make_demo_stop(db, run=run, so=so, customer=cust, status="pending", qty=qty)
                slot_row = (
                    db.query(VehicleSlot)
                    .filter(VehicleSlot.vehicle_id == truck.id, VehicleSlot.on_date == today, VehicleSlot.slot == "morning")
                    .first()
                )
                if slot_row:
                    slot_row.status = "booked"
                else:
                    db.add(VehicleSlot(vehicle_id=truck.id, on_date=today, slot="morning", status="booked"))

    db.commit()
    print(f"Demo logistics: supervisor assigns windows; READY leftovers; yesterday done ({created} companies)")


def _sync_role_perms(db) -> None:
    perm_map = {p.code: p.id for p in db.query(Permission).all()}
    for code, desc in PERMISSIONS:
        if code not in perm_map:
            row = Permission(code=code, description=desc)
            db.add(row)
            db.flush()
            perm_map[code] = row.id
    for role in db.query(Role).all():
        wanted = ROLE_PERMS.get(role.name)
        if wanted is None:
            continue
        codes = list(perm_map.keys()) if wanted == "*" else list(dict.fromkeys(wanted))
        have = {rp.permission_id for rp in db.query(RolePermission).filter(RolePermission.role_id == role.id)}
        for code in codes:
            pid = perm_map.get(code)
            if pid and pid not in have:
                db.add(RolePermission(role_id=role.id, permission_id=pid))
                have.add(pid)
    db.commit()


def _sync_demo_accounts(db) -> None:
    from datetime import date, timedelta
    from decimal import Decimal

    from app.core.models import (
        Company,
        Customer,
        Invoice,
        InvoiceLine,
        InvoiceStatus,
        Payment,
        Product,
    )

    today = date.today()
    created = 0
    for company in db.query(Company).order_by(Company.id).all():
        if db.query(Invoice).filter(Invoice.company_id == company.id).count() >= 4:
            continue
        customers = {c.name: c for c in db.query(Customer).filter(Customer.company_id == company.id).all()}
        products = {p.name: p for p in db.query(Product).filter(Product.company_id == company.id).all()}
        maida = products.get("Maida")
        besan = products.get("Besan")
        suji = products.get("Suji")
        if not maida or not besan:
            continue
        specs = [
            ("ABC Foods", today - timedelta(days=45), 30, InvoiceStatus.OPEN, Decimal("0"), [(maida, 500, 45), (besan, 300, 70)]),
            ("XYZ Traders", today - timedelta(days=15), 15, InvoiceStatus.PARTIAL, Decimal("8000"), [(suji or maida, 200, 80)]),
            ("MKM Foods", today, 30, InvoiceStatus.OPEN, Decimal("0"), [(besan, 250, 70)]),
            ("Royal Traders", today - timedelta(days=40), 7, InvoiceStatus.OPEN, Decimal("0"), [(maida, 180, 45)]),
            ("Anand Bakers Pvt Ltd", today - timedelta(days=20), 30, InvoiceStatus.PAID, None, [(suji or maida, 90, 80)]),
        ]
        seq = db.query(Invoice).filter(Invoice.company_id == company.id).count()
        for name, inv_date, days, status, paid, lines in specs:
            cust = customers.get(name)
            if not cust:
                continue
            seq += 1
            sub = Decimal("0")
            tax = Decimal("0")
            built = []
            for product, qty, price in lines:
                line_sub = Decimal(qty) * Decimal(price)
                gst = product.gst_rate or Decimal("5")
                line_tax = line_sub * gst / Decimal("100")
                sub += line_sub
                tax += line_tax
                built.append((product, Decimal(qty), Decimal(price), gst, line_sub + line_tax))
            total = sub + tax
            paid_amt = total if status == InvoiceStatus.PAID else (paid or Decimal("0"))
            inv = Invoice(
                organization_id=company.organization_id,
                company_id=company.id,
                customer_id=cust.id,
                number=f"{company.invoice_prefix}-{seq:05d}",
                invoice_date=inv_date,
                due_date=inv_date + timedelta(days=days),
                status=status,
                subtotal=sub,
                tax_amount=tax,
                total=total,
                amount_paid=paid_amt,
            )
            db.add(inv)
            db.flush()
            for product, qty, price, gst, line_total in built:
                db.add(
                    InvoiceLine(
                        invoice_id=inv.id,
                        product_id=product.id,
                        quantity=qty,
                        unit_price=price,
                        gst_rate=gst,
                        line_total=line_total,
                    )
                )
            if paid_amt > 0:
                db.add(
                    Payment(
                        organization_id=company.organization_id,
                        company_id=company.id,
                        invoice_id=inv.id,
                        amount=paid_amt,
                        method="bank",
                        reference="UTR-DEMO",
                        paid_at=inv_date + timedelta(days=3),
                    )
                )
            created += 1
    db.commit()
    print(f"Demo accounts invoices: {created} created" if created else "Demo accounts already present")


def _add_invoice(db, *, company, customer, number, inv_date, due_days, status, paid, lines, method="bank", sent_via=None, sales_order_id=None):
    from datetime import datetime, timedelta, timezone
    from decimal import Decimal

    from app.core.models import Invoice, InvoiceLine, InvoiceStatus, Payment

    existing = db.query(Invoice).filter(Invoice.company_id == company.id, Invoice.number == number).first()
    if existing:
        return existing
    sub = Decimal("0")
    tax = Decimal("0")
    built = []
    for product, qty, price in lines:
        line_sub = Decimal(qty) * Decimal(price)
        gst = product.gst_rate or Decimal("5")
        line_tax = line_sub * gst / Decimal("100")
        sub += line_sub
        tax += line_tax
        built.append((product, Decimal(qty), Decimal(price), gst, line_sub + line_tax))
    total = sub + tax
    paid_amt = total if status == InvoiceStatus.PAID else (paid or Decimal("0"))
    inv = Invoice(
        organization_id=company.organization_id,
        company_id=company.id,
        customer_id=customer.id,
        sales_order_id=sales_order_id,
        number=number,
        invoice_date=inv_date,
        due_date=inv_date + timedelta(days=due_days),
        status=status,
        subtotal=sub,
        tax_amount=tax,
        total=total,
        amount_paid=paid_amt,
        sent_via=sent_via,
        sent_at=datetime.now(timezone.utc) if sent_via else None,
    )
    db.add(inv)
    db.flush()
    for product, qty, price, gst, line_total in built:
        db.add(
            InvoiceLine(
                invoice_id=inv.id,
                product_id=product.id,
                quantity=qty,
                unit_price=price,
                gst_rate=gst,
                line_total=line_total,
            )
        )
    if paid_amt > 0:
        db.add(
            Payment(
                organization_id=company.organization_id,
                company_id=company.id,
                invoice_id=inv.id,
                amount=paid_amt,
                method=method,
                reference=f"DEMO-{method.upper()}",
                paid_at=inv_date + timedelta(days=2),
            )
        )
    return inv


def _sync_demo_sales(db) -> None:
    from datetime import date, datetime, timedelta, timezone
    from decimal import Decimal

    from app.core.models import (
        CollectionFollowUp,
        Company,
        Customer,
        FieldVisit,
        Invoice,
        Lead,
        LeadActivity,
        LeadStatus,
        Quotation,
        QuotationLine,
        QuotationStatus,
        SalesOrder,
        SalesOrderLine,
        SalesOrderStatus,
        User,
        Warehouse,
    )

    sales = db.query(User).filter(User.email == "sales@avighnya.local").first()
    today = date.today()
    now = datetime.now(timezone.utc)
    created = {"leads": 0, "quotes": 0, "visits": 0, "followups": 0}

    lead_specs = [
        ("DEMO New Mill", LeadStatus.NEW, "high", "walk-in", "Maida 2 MT"),
        ("DEMO Contacted Traders", LeadStatus.CONTACTED, "medium", "phone", "Besan 1 MT"),
        ("DEMO Qualified Foods", LeadStatus.QUALIFIED, "high", "referral", "Suji 800 KG"),
        ("DEMO Visit Needed", LeadStatus.VISIT_REQUIRED, "high", "field", "Rava 500 KG"),
        ("DEMO Quote Stage", LeadStatus.QUOTATION, "medium", "whatsapp", "Maida 3 MT"),
        ("DEMO Negotiation", LeadStatus.NEGOTIATION, "high", "repeat", "Besan 2 MT"),
        ("DEMO Won Account", LeadStatus.WON, "low", "field", "Poha 400 KG"),
        ("DEMO Lost Lead", LeadStatus.LOST, "low", "cold", "Suji 1 MT"),
    ]

    quote_specs = [
        ("ABC Foods", QuotationStatus.DRAFT),
        ("XYZ Traders", QuotationStatus.PENDING_APPROVAL),
        ("MKM Foods", QuotationStatus.APPROVED),
        ("Royal Traders", QuotationStatus.REJECTED),
        ("Anand Bakers Pvt Ltd", QuotationStatus.ACCEPTED),
        ("Smoke Wholesale Co", QuotationStatus.CONVERTED),
    ]

    visit_specs = [
        ("ABC Foods", "collection", "Promised payment Friday"),
        ("Smoke Wholesale Co", "prospecting", "Wants afternoon slot"),
        ("Gokul Beverages", "follow-up", "Repeat Maida order"),
        ("MKM Foods", "complaint", "Short delivery last trip"),
    ]

    for company in db.query(Company).order_by(Company.id).all():
        customers = {c.name: c for c in db.query(Customer).filter(Customer.company_id == company.id).all()}
        from app.core.models import Product

        products = {p.name: p for p in db.query(Product).filter(Product.company_id == company.id).all()}
        maida = products.get("Maida")
        besan = products.get("Besan")
        suji = products.get("Suji")
        if not maida or not besan:
            continue
        wh = (
            db.query(Warehouse)
            .filter(Warehouse.company_id == company.id, Warehouse.is_default.is_(True))
            .first()
        )
        uid = sales.id if sales else None

        have_leads = {l.business_name for l in db.query(Lead).filter(Lead.company_id == company.id).all()}
        for name, status, priority, source, req in lead_specs:
            if name in have_leads:
                continue
            lead = Lead(
                organization_id=company.organization_id,
                company_id=company.id,
                business_name=name,
                contact_person="Demo Contact",
                phone="9845000000",
                location="Bangalore",
                source=source,
                product_requirement=req,
                estimated_value=Decimal("85000"),
                status=status,
                assigned_to_id=uid,
                priority=priority,
                notes="demo-lead",
                lost_reason="Price too high" if status == LeadStatus.LOST else None,
                customer_id=customers.get("ABC Foods").id if status == LeadStatus.WON and customers.get("ABC Foods") else None,
            )
            db.add(lead)
            db.flush()
            db.add(LeadActivity(lead_id=lead.id, user_id=uid, kind="note", notes=f"Seeded as {status.value}"))
            created["leads"] += 1

        have_quotes = db.query(Quotation).filter(Quotation.company_id == company.id, Quotation.notes == "demo-quote").count()
        if have_quotes < len(quote_specs):
            for cust_name, qstatus in quote_specs:
                cust = customers.get(cust_name) or customers.get("ABC Foods")
                if not cust:
                    continue
                if db.query(Quotation).filter(
                    Quotation.company_id == company.id,
                    Quotation.customer_id == cust.id,
                    Quotation.status == qstatus,
                    Quotation.notes == "demo-quote",
                ).first():
                    continue
                q = Quotation(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    customer_id=cust.id,
                    status=qstatus,
                    notes="demo-quote",
                    created_by_id=uid,
                )
                db.add(q)
                db.flush()
                db.add(QuotationLine(quotation_id=q.id, product_id=maida.id, quantity=Decimal("500"), unit_price=Decimal("45"), base_price=Decimal("38")))
                db.add(QuotationLine(quotation_id=q.id, product_id=besan.id, quantity=Decimal("200"), unit_price=Decimal("70"), base_price=Decimal("62")))
                created["quotes"] += 1

        have_visits = db.query(FieldVisit).filter(FieldVisit.company_id == company.id, FieldVisit.notes == "demo-visit").count()
        if have_visits < len(visit_specs) and uid:
            for i, (cust_name, purpose, outcome) in enumerate(visit_specs):
                cust = customers.get(cust_name) or customers.get("ABC Foods")
                if not cust:
                    continue
                db.add(
                    FieldVisit(
                        organization_id=company.organization_id,
                        company_id=company.id,
                        user_id=uid,
                        customer_id=cust.id,
                        site_name=cust.name,
                        contact_person=cust.contact_person,
                        phone=cust.phone,
                        notes="demo-visit",
                        purpose=purpose,
                        outcome=outcome,
                        next_action="Call tomorrow",
                        lat=Decimal("12.9716"),
                        lng=Decimal("77.5946"),
                        checked_in_at=now - timedelta(hours=i + 1),
                    )
                )
                created["visits"] += 1

        if wh and not db.query(SalesOrder).filter(SalesOrder.company_id == company.id, SalesOrder.notes == "sales-demo-draft").first():
            draft = SalesOrder(
                organization_id=company.organization_id,
                company_id=company.id,
                customer_id=(customers.get("Sweet Mart") or customers.get("ABC Foods")).id,
                warehouse_id=wh.id,
                status=SalesOrderStatus.DRAFT,
                ops_status="pending_approval",
                notes="sales-demo-draft",
                created_by_id=uid,
            )
            db.add(draft)
            db.flush()
            db.add(SalesOrderLine(sales_order_id=draft.id, product_id=suji.id if suji else maida.id, quantity=Decimal("150"), unit_price=Decimal("80"), outstanding_qty=Decimal("150")))

        open_inv = (
            db.query(Invoice)
            .filter(Invoice.company_id == company.id, Invoice.status.in_(("open", "partial")))
            .first()
        )
        if open_inv and uid and not db.query(CollectionFollowUp).filter(CollectionFollowUp.company_id == company.id, CollectionFollowUp.notes.like("demo-%")).first():
            db.add(
                CollectionFollowUp(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    customer_id=open_inv.customer_id,
                    invoice_id=open_inv.id,
                    user_id=uid,
                    promised_date=today + timedelta(days=2),
                    notes="demo-promise: will pay Friday",
                )
            )
            db.add(
                CollectionFollowUp(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    customer_id=open_inv.customer_id,
                    invoice_id=open_inv.id,
                    user_id=uid,
                    promised_date=today - timedelta(days=1),
                    notes="demo-followup: no answer, retry",
                )
            )
            created["followups"] += 2

    db.commit()
    print(f"Demo sales: {created['leads']} leads, {created['quotes']} quotes, {created['visits']} visits, {created['followups']} follow-ups")


def _sync_demo_accounts_extra(db) -> None:
    from datetime import date, timedelta
    from decimal import Decimal

    from app.core.models import (
        Company,
        CreditNote,
        Customer,
        Invoice,
        InvoiceStatus,
        Product,
        User,
    )

    today = date.today()
    accounts = db.query(User).filter(User.email == "accounts@avighnya.local").first()
    added = 0
    for company in db.query(Company).order_by(Company.id).all():
        customers = {c.name: c for c in db.query(Customer).filter(Customer.company_id == company.id).all()}
        products = {p.name: p for p in db.query(Product).filter(Product.company_id == company.id).all()}
        maida = products.get("Maida")
        besan = products.get("Besan")
        suji = products.get("Suji")
        rava = products.get("Rava")
        if not maida or not besan:
            continue
        abc = customers.get("ABC Foods")
        smoke = customers.get("Smoke Wholesale Co") or abc
        sweet = customers.get("Sweet Mart") or abc
        city = customers.get("City Bakery") or abc
        gokul = customers.get("Gokul Beverages") or abc
        prefix = company.invoice_prefix
        specs = [
            (f"{prefix}-D90", city, today - timedelta(days=120), 30, InvoiceStatus.OPEN, Decimal("0"), [(maida, 400, 45)], "bank", None),
            (f"{prefix}-D60", sweet, today - timedelta(days=50), 15, InvoiceStatus.OPEN, Decimal("0"), [(besan, 180, 70)], "bank", None),
            (f"{prefix}-D30", gokul, today - timedelta(days=20), 7, InvoiceStatus.PARTIAL, Decimal("5000"), [(suji or maida, 100, 80)], "upi", "email"),
            (f"{prefix}-DNOW", smoke, today, 30, InvoiceStatus.OPEN, Decimal("0"), [(maida, 800, 45), (besan, 200, 70)], "bank", "whatsapp"),
            (f"{prefix}-DCASH", abc, today - timedelta(days=8), 30, InvoiceStatus.PAID, None, [(rava or maida, 60, 60)], "cash", None),
            (f"{prefix}-DCHQ", smoke, today - timedelta(days=5), 21, InvoiceStatus.PAID, None, [(besan, 90, 70)], "cheque", None),
            (f"{prefix}-DCAN", sweet, today - timedelta(days=3), 30, InvoiceStatus.CANCELLED, Decimal("0"), [(maida, 50, 45)], "bank", None),
        ]
        invoices = []
        for number, cust, inv_date, days, status, paid, lines, method, sent in specs:
            if not cust:
                continue
            inv = _add_invoice(
                db,
                company=company,
                customer=cust,
                number=number,
                inv_date=inv_date,
                due_days=days,
                status=status,
                paid=paid,
                lines=lines,
                method=method,
                sent_via=sent,
            )
            invoices.append(inv)
            if inv and inv.number == number:
                added += 1

        target = db.query(Invoice).filter(Invoice.company_id == company.id, Invoice.number == f"{prefix}-DNOW").first()
        if target and not db.query(CreditNote).filter(CreditNote.invoice_id == target.id).first():
            db.add(
                CreditNote(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    customer_id=target.customer_id,
                    invoice_id=target.id,
                    kind="credit",
                    amount=Decimal("2500"),
                    reason="Pricing adjustment",
                    remarks="demo credit note",
                    status="posted",
                    created_by_id=accounts.id if accounts else None,
                )
            )
            target.credit_applied = Decimal("2500")
            db.add(
                CreditNote(
                    organization_id=company.organization_id,
                    company_id=company.id,
                    customer_id=target.customer_id,
                    invoice_id=target.id,
                    kind="debit",
                    amount=Decimal("400"),
                    reason="Freight",
                    remarks="demo debit note",
                    status="posted",
                    created_by_id=accounts.id if accounts else None,
                )
            )
            target.debit_applied = Decimal("400")
    db.commit()
    print(f"Demo accounts extras: {added} invoices/notes filled")


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_sales_schema(engine)
    if engine.dialect.name == "postgresql":
        ensure_logistics_schema(engine)
        ensure_accounts_schema(engine)
    _ensure_logo_column()
    db = SessionLocal()
    try:
        if db.query(Organization).first():
            _sync_company_branding(db)
            _sync_role_user(
                db,
                role_name=RoleName.ACCOUNTANT,
                email="accounts@avighnya.local",
                full_name="Accounts",
                password="accounts123",
            )
            _sync_role_user(
                db,
                role_name=RoleName.SUPERVISOR,
                email="supervisor@avighnya.local",
                full_name="Supervisor",
                password="super123",
            )
            _sync_role_user(
                db,
                role_name=RoleName.SALES,
                email="sales@avighnya.local",
                full_name="Sales Person",
                password="sales123",
            )
            _sync_role_user(
                db,
                role_name=RoleName.LOGISTICS,
                email="logistics@avighnya.local",
                full_name="Logistics",
                password="logistics123",
            )
            _sync_role_user(
                db,
                role_name=RoleName.SUPER_ADMIN,
                email="admin@avighnya.local",
                full_name="Super Admin",
                password="admin123",
            )
            _sync_role_user(
                db,
                role_name=RoleName.OWNER,
                email="owner@avighnya.local",
                full_name="Owner",
                password="owner123",
            )
            _sync_role_perms(db)
            _sync_vehicles(db)
            _sync_logistics_drivers(db)
            _sync_demo_customers(db)
            _sync_demo_products(db)
            if engine.dialect.name == "postgresql":
                _clear_demo_transactions(db)
                _sync_demo_products(db)
                if _want_demo_transactions():
                    _seed_demo_transactions(db)
                    print("Seed refreshed (users/master + full dummy transactions)")
                else:
                    print("Seed refreshed (users/master data only; dummy transactions cleared)")
            elif _want_demo_transactions():
                _seed_demo_transactions(db)
                print("Seed refreshed (users/master + full dummy transactions)")
            else:
                print("Seed refreshed (users/master data only)")
            return

        for code, desc in PERMISSIONS:
            db.add(Permission(code=code, description=desc))
        db.flush()
        perm_map = {p.code: p.id for p in db.query(Permission).all()}

        for role_name in RoleName:
            db.add(Role(name=role_name, description=role_name.value.replace("_", " ").title()))
        db.flush()
        role_map = {r.name: r.id for r in db.query(Role).all()}

        for role_name, perms in ROLE_PERMS.items():
            role_id = role_map[role_name]
            codes = list(perm_map.keys()) if perms == "*" else perms
            for code in codes:
                db.add(RolePermission(role_id=role_id, permission_id=perm_map[code]))

        org = Organization(name="Avighna Group")
        db.add(org)
        db.flush()

        companies = []
        for i, brand in enumerate(COMPANY_BRANDING, start=1):
            c = Company(
                organization_id=org.id,
                legal_name=brand["legal_name"],
                trade_name=brand["trade_name"],
                invoice_prefix=brand["invoice_prefix"],
                logo_url=brand["logo_url"],
                gstin=f"29AAAAA000{i}A1Z{i}",
            )
            db.add(c)
            db.flush()
            db.add(
                Warehouse(
                    organization_id=org.id,
                    company_id=c.id,
                    name="Main Warehouse",
                    is_default=True,
                )
            )
            companies.append(c)

        admin = User(
            organization_id=org.id,
            role_id=role_map[RoleName.SUPER_ADMIN],
            email="admin@avighnya.local",
            full_name="Super Admin",
            hashed_password=hash_password("admin123"),
        )
        db.add(admin)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=admin.id, company_id=c.id))

        owner = User(
            organization_id=org.id,
            role_id=role_map[RoleName.OWNER],
            email="owner@avighnya.local",
            full_name="Owner",
            hashed_password=hash_password("owner123"),
        )
        db.add(owner)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=owner.id, company_id=c.id))

        sales = User(
            organization_id=org.id,
            role_id=role_map[RoleName.SALES],
            email="sales@avighnya.local",
            full_name="Sales Person",
            hashed_password=hash_password("sales123"),
        )
        db.add(sales)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=sales.id, company_id=c.id))

        accounts = User(
            organization_id=org.id,
            role_id=role_map[RoleName.ACCOUNTANT],
            email="accounts@avighnya.local",
            full_name="Accounts",
            hashed_password=hash_password("accounts123"),
        )
        db.add(accounts)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=accounts.id, company_id=c.id))

        supervisor = User(
            organization_id=org.id,
            role_id=role_map[RoleName.SUPERVISOR],
            email="supervisor@avighnya.local",
            full_name="Supervisor",
            hashed_password=hash_password("super123"),
        )
        db.add(supervisor)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=supervisor.id, company_id=c.id))

        logistics = User(
            organization_id=org.id,
            role_id=role_map[RoleName.LOGISTICS],
            email="logistics@avighnya.local",
            full_name="Logistics",
            hashed_password=hash_password("logistics123"),
        )
        db.add(logistics)
        db.flush()
        for c in companies:
            db.add(UserCompany(user_id=logistics.id, company_id=c.id))

        db.commit()
        _sync_vehicles(db)
        _sync_logistics_drivers(db)
        _sync_demo_customers(db)
        _sync_demo_products(db)
        if _want_demo_transactions():
            _seed_demo_transactions(db)
            print(
                "Seed complete (with dummy data): admin@avighnya.local / admin123 · "
                "sales@avighnya.local / sales123 · "
                "accounts@avighnya.local / accounts123 · "
                "supervisor@avighnya.local / super123 · "
                "logistics@avighnya.local / logistics123 · "
                "owner@avighnya.local / owner123"
            )
        else:
            print(
                "Seed complete (clean): admin@avighnya.local / admin123 · "
                "sales@avighnya.local / sales123 · "
                "accounts@avighnya.local / accounts123 · "
                "supervisor@avighnya.local / super123 · "
                "logistics@avighnya.local / logistics123 · "
                "owner@avighnya.local / owner123"
            )
    finally:
        db.close()


if __name__ == "__main__":
    seed()
