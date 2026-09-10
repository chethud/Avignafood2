import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { firmLabelByCompanyId } from "@/lib/erp-data";
import { Badge, Panel } from "@/components/erp/ui-bits";

export type OutstandingRow = {
  order_id: number;
  company_id: number;
  company_name?: string | null;
  customer_name: string;
  product_id: number;
  product_name: string;
  unit: string;
  ordered_qty: string | number;
  outstanding_qty: string | number;
  on_hand: string | number;
  ops_status: string;
  can_complete: boolean;
};

function kg(v: string | number, unit = "KG") {
  return `${Number(v || 0).toLocaleString("en-IN")} ${unit}`;
}

export function OutstandingDelivery({ canComplete = false }: { canComplete?: boolean }) {
  const { firm } = useCompany();
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    try {
      const data = await api<OutstandingRow[]>("/api/v1/sales-orders/outstanding");
      setRows(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load outstanding delivery");
    }
  }

  useEffect(() => {
    void load();
  }, [firm]);

  async function complete(orderId: number, companyId: number) {
    setBusy(orderId);
    setError("");
    try {
      await api(`/api/v1/sales-orders/${orderId}/fulfill-outstanding`, {
        method: "POST",
        companyId,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete remaining qty");
    } finally {
      setBusy(null);
    }
  }

  const grouped = rows.reduce<Record<number, OutstandingRow[]>>((acc, row) => {
    (acc[row.order_id] ||= []).push(row);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Orders where Sales asked for more than stock. Remaining qty stays here until new stock comes in and the order is completed.
        {firm === "all" ? " Showing all companies." : ""}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!rows.length && !error && (
        <Panel>
          <p className="text-sm text-muted-foreground">No outstanding delivery. Over-stock orders will appear here.</p>
        </Panel>
      )}
      {Object.entries(grouped).map(([id, lines]) => {
        const orderId = Number(id);
        const ready = lines.every((ln) => ln.can_complete);
        const companyLabel = lines[0]?.company_name || firmLabelByCompanyId(lines[0]?.company_id);
        return (
          <Panel
            key={orderId}
            title={`SO-${orderId} · ${lines[0]?.customer_name || ""}`}
            hint={companyLabel || undefined}
          >
            <ul className="space-y-2 text-sm">
              {lines.map((ln) => (
                <li key={`${ln.order_id}-${ln.product_id}`} className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2">
                  <span>
                    <span className="block font-medium">{ln.product_name}</span>
                    <span className="text-xs text-muted-foreground">
                      Ordered {kg(ln.ordered_qty, ln.unit)} · on hand {kg(ln.on_hand, ln.unit)}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums text-warning">{kg(ln.outstanding_qty, ln.unit)}</span>
                    <Badge tone={ln.can_complete ? "good" : "warn"}>{ln.can_complete ? "Stock enough" : "Waiting stock"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            {canComplete && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!ready || busy === orderId}
                  onClick={() => void complete(orderId, lines[0].company_id)}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {busy === orderId ? "Completing…" : "Complete remaining"}
                </button>
                <Link to="/inventory" className="rounded-xl border border-border px-4 py-2.5 text-sm">
                  Inventory
                </Link>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
