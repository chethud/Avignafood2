"""Purchase table tweaks on existing DBs (create_all does not ALTER)."""

from sqlalchemy import text
from sqlalchemy.engine import Engine

_done = False


def ensure_purchases_schema(engine: Engine) -> None:
    """Allow manufacturer-only POs (customer link optional)."""
    global _done
    if _done:
        return
    _done = True
    dialect = engine.dialect.name
    with engine.begin() as conn:
        if dialect == "postgresql":
            conn.execute(text("ALTER TABLE purchases ALTER COLUMN customer_id DROP NOT NULL"))
        elif dialect == "sqlite":
            # SQLite cannot DROP NOT NULL; rebuild only if still NOT NULL.
            row = conn.execute(text("PRAGMA table_info(purchases)")).fetchall()
            cols = {r[1]: r for r in row}  # name -> (cid, name, type, notnull, dflt, pk)
            cust = cols.get("customer_id")
            if cust is None or not cust[3]:
                return
            conn.execute(text("PRAGMA foreign_keys=OFF"))
            conn.execute(
                text(
                    """
                    CREATE TABLE purchases__mfr (
                        id INTEGER NOT NULL PRIMARY KEY,
                        organization_id INTEGER NOT NULL,
                        company_id INTEGER NOT NULL,
                        customer_id INTEGER,
                        source VARCHAR(40) NOT NULL DEFAULT 'direct',
                        manufacturer VARCHAR(200),
                        product VARCHAR(200) NOT NULL,
                        quantity NUMERIC(14, 3) NOT NULL,
                        received NUMERIC(14, 3) NOT NULL DEFAULT 0,
                        value NUMERIC(14, 2) NOT NULL DEFAULT 0,
                        eta VARCHAR(40),
                        status VARCHAR(40) NOT NULL DEFAULT 'Confirmed',
                        notes TEXT,
                        created_by_id INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        sales_order_id INTEGER,
                        product_id INTEGER
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO purchases__mfr (
                        id, organization_id, company_id, customer_id, source, manufacturer,
                        product, quantity, received, value, eta, status, notes,
                        created_by_id, created_at, sales_order_id, product_id
                    )
                    SELECT
                        id, organization_id, company_id, customer_id, source, manufacturer,
                        product, quantity, received, value, eta, status, notes,
                        created_by_id, created_at, sales_order_id, product_id
                    FROM purchases
                    """
                )
            )
            conn.execute(text("DROP TABLE purchases"))
            conn.execute(text("ALTER TABLE purchases__mfr RENAME TO purchases"))
            conn.execute(text("PRAGMA foreign_keys=ON"))
