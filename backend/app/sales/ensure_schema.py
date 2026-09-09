"""Add Chethan-owned Sales columns/tables on existing DBs (create_all does not ALTER)."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

_done = False

_LEAD_COLS = {
    "gstin": "VARCHAR(20)",
    "priority": "VARCHAR(20)",
    "next_follow_up": "TIMESTAMP WITH TIME ZONE",
}
_CUSTOMER_COLS = {
    "legal_name": "VARCHAR(200)",
    "trade_name": "VARCHAR(200)",
    "billing_address": "TEXT",
    "shipping_address": "TEXT",
    "customer_type": "VARCHAR(40)",
}
_VISIT_COLS = {
    "purpose": "VARCHAR(40)",
    "outcome": "TEXT",
    "next_action": "TEXT",
    "competitor_notes": "TEXT",
    "issue": "TEXT",
}
_USER_COLS = {
    "phone": "VARCHAR(30)",
}
_PRODUCT_COLS = {
    "selling_price": "NUMERIC(14, 2) DEFAULT 0",
}
_SALES_ORDER_LINE_COLS = {
    "outstanding_qty": "NUMERIC(14, 3) DEFAULT 0",
}


def ensure_sales_schema(engine: Engine) -> None:
    global _done
    if _done:
        return
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        _add_cols(conn, insp, "leads", _LEAD_COLS, tables)
        _add_cols(conn, insp, "customers", _CUSTOMER_COLS, tables)
        _add_cols(conn, insp, "field_visits", _VISIT_COLS, tables)
        _add_cols(conn, insp, "products", _PRODUCT_COLS, tables)
        _add_cols(conn, insp, "users", _USER_COLS, tables)
        _add_cols(conn, insp, "sales_order_lines", _SALES_ORDER_LINE_COLS, tables)
        if "products" in tables:
            conn.execute(
                text(
                    "UPDATE products SET selling_price = base_price "
                    "WHERE COALESCE(selling_price, 0) = 0 AND COALESCE(base_price, 0) <> 0"
                )
            )
        if engine.dialect.name == "postgresql" and "sales_orders" in tables:
            so_cols = {c["name"] for c in insp.get_columns("sales_orders")}
            if "ops_status" in so_cols:
                conn.execute(
                    text(
                        "ALTER TABLE sales_orders ALTER COLUMN ops_status SET DEFAULT 'pending_approval'"
                    )
                )
                conn.execute(
                    text(
                        """
                        UPDATE sales_orders
                        SET ops_status = 'pending_approval'
                        WHERE CAST(status AS TEXT) IN ('draft', 'DRAFT')
                          AND COALESCE(ops_status, '') IN ('', 'pending_verify')
                        """
                    )
                )
        if engine.dialect.name == "postgresql" and "collection_follow_ups" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS collection_follow_ups (
                        id SERIAL PRIMARY KEY,
                        organization_id INTEGER NOT NULL,
                        company_id INTEGER NOT NULL,
                        customer_id INTEGER NOT NULL,
                        invoice_id INTEGER,
                        user_id INTEGER,
                        promised_date DATE,
                        notes TEXT,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                    """
                )
            )
    _done = True


def _add_cols(conn, insp, table: str, cols: dict[str, str], tables: set[str]) -> set[str]:
    added: set[str] = set()
    if table not in tables:
        return added
    existing = {c["name"] for c in insp.get_columns(table)}
    for name, ddl in cols.items():
        if name in existing:
            continue
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {ddl}"))
        added.add(name)
    return added
