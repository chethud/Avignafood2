import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { firmLabelByCompanyId, inr } from "@/lib/erp-data";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ApprovalLine = {
  product_name: string;
  unit?: string;
  quantity: number;
  on_hand: number;
  extra_qty: number;
  stock_ok: boolean;
  selling_price: number;
  wholesale_price: number;
  requested_price: number;
  below_wholesale: boolean;
};

export type PendingItem = {
  key: string;
  source: "api" | "mock";
  kind?: "quote" | "purchase" | "order";
  quoteId?: number;
  purchaseId?: number;
  orderId?: number;
  companyId?: number;
  companyName?: string;
  customer: string;
  product: string;
  qty: string;
  asked: number;
  floor: number;
  salesperson: string;
  lines?: ApprovalLine[];
  notes?: string | null;
};

type OrderLine = {
  product_id: number;
  product_name?: string;
  unit?: string;
  quantity: number;
  on_hand?: number;
  extra_qty?: number;
  stock_ok?: boolean;
  unit_price: number;
  requested_price?: number;
  wholesale_price?: number;
  selling_price?: number;
  below_wholesale?: boolean;
};

type Order = {
  id: number;
  company_id: number;
  company_name?: string | null;
  customer_id: number;
  customer_name: string | null;
  status: string;
  ops_status: string;
  notes?: string | null;
  created_by_name?: string | null;
  lines: OrderLine[];
};

type Customer = { id: number; name: string };

/** Only Owner / Super Admin may approve — not Supervisor or other roles. */
const canApproveRole = (role: string) => role === "super_admin" || role === "owner";

function mapOrderLines(lines: OrderLine[]): ApprovalLine[] {
  return lines.map((ln) => {
    const qty = Number(ln.quantity) || 0;
    const onHand = Number(ln.on_hand ?? 0);
    const wholesale = Number(ln.wholesale_price ?? 0);
    const selling = Number(ln.selling_price ?? wholesale);
    const requested = Number(ln.requested_price ?? ln.unit_price ?? 0);
    const extra = Number(ln.extra_qty ?? Math.max(0, qty - onHand));
    return {
      product_name: ln.product_name || `Product #${ln.product_id}`,
      unit: ln.unit || "KG",
      quantity: qty,
      on_hand: onHand,
      extra_qty: extra,
      stock_ok: ln.stock_ok ?? onHand >= qty,
      selling_price: selling,
      wholesale_price: wholesale,
      requested_price: requested,
      below_wholesale: ln.below_wholesale ?? requested < wholesale,
    };
  });
}

export function usePendingApprovals() {
  const { me } = useMe();
  const { firm } = useCompany();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me || !canApproveRole(me.user.role)) {
      setItems([]);
      return;
    }
    setLoading(true);
    const dismissed = new Set(JSON.parse(sessionStorage.getItem("approvalDismissed") || "[]") as string[]);
    try {
      const [orders, customers] = await Promise.all([
        api<Order[]>("/api/v1/sales-orders").catch(() => [] as Order[]),
        api<Customer[]>("/api/v1/customers").catch(() => [] as Customer[]),
      ]);
      const names = Object.fromEntries(customers.map((c) => [c.id, c.name]));
      const orderItems: PendingItem[] = orders
        .filter((o) => o.status === "draft" && (o.ops_status === "pending_approval" || !o.ops_status))
        .map((o) => {
          const lines = mapOrderLines(o.lines || []);
          const first = lines[0];
          return {
            key: `o-${o.id}`,
            source: "api" as const,
            kind: "order" as const,
            orderId: o.id,
            companyId: o.company_id,
            companyName: o.company_name || firmLabelByCompanyId(o.company_id),
            customer: o.customer_name || names[o.customer_id] || `Customer #${o.customer_id}`,
            product: first?.product_name || (lines.length > 1 ? `${lines.length} products` : "Sales order"),
            qty: first ? `${first.quantity} ${first.unit}` : "—",
            asked: first?.requested_price ?? 0,
            floor: first?.wholesale_price ?? 0,
            salesperson: o.created_by_name || "Sales",
            lines,
            notes: o.notes,
          };
        });

      // Order requests only — price (below floor) is reviewed inside each order, not as a separate queue
      setItems(orderItems.filter((i) => !dismissed.has(i.key)));
    } finally {
      setLoading(false);
    }
  }, [me, firm]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const dismiss = (key: string) => {
    const list = JSON.parse(sessionStorage.getItem("approvalDismissed") || "[]") as string[];
    list.push(key);
    sessionStorage.setItem("approvalDismissed", JSON.stringify(list));
    setItems((prev) => prev.filter((i) => i.key !== key));
  };

  return { items, loading, refresh, dismiss, canApprove: me ? canApproveRole(me.user.role) : false };
}

function OrderApprovalBody({ item }: { item: PendingItem }) {
  const lines = item.lines || [];
  return (
    <div className="mt-4 space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">Company</dt>
          <dd className="mt-0.5 font-medium">{item.companyName || firmLabelByCompanyId(item.companyId)}</dd>
        </div>
        <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">From salesperson</dt>
          <dd className="mt-0.5 font-medium">{item.salesperson}</dd>
        </div>
        <div className="rounded-xl bg-secondary/60 px-3 py-2.5 col-span-2">
          <dt className="text-xs text-muted-foreground">Customer (for whom)</dt>
          <dd className="mt-0.5 font-medium">{item.customer}</dd>
        </div>
      </dl>

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No line items on this order.</p>
      ) : (
        <ul className="space-y-3">
          {lines.map((ln, idx) => (
            <li key={`${ln.product_name}-${idx}`} className="rounded-xl border border-border bg-background/80 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-snug">{ln.product_name}</p>
                {!ln.stock_ok && (
                  <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-[0.65rem] font-medium text-destructive">
                    Extra qty
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Ordered</p>
                  <p className="mt-0.5 font-medium tabular-nums">
                    {ln.quantity} {ln.unit}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">In stock</p>
                  <p className={cn("mt-0.5 font-medium tabular-nums", !ln.stock_ok && "text-destructive")}>
                    {ln.on_hand} {ln.unit}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Extra</p>
                  <p className={cn("mt-0.5 font-medium tabular-nums", ln.extra_qty > 0 && "text-destructive")}>
                    {ln.extra_qty > 0 ? `+${ln.extra_qty}` : "0"} {ln.unit}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border/70 pt-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Selling</p>
                  <p className="mt-0.5 font-medium tabular-nums">{money(ln.selling_price)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Wholesale</p>
                  <p className="mt-0.5 font-medium tabular-nums">{money(ln.wholesale_price)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Requested</p>
                  <p
                    className={cn(
                      "mt-0.5 font-medium tabular-nums",
                      ln.below_wholesale ? "text-warning" : "text-foreground",
                    )}
                  >
                    {money(ln.requested_price)}
                  </p>
                </div>
              </div>
              {ln.below_wholesale && (
                <p className="mt-2 text-[0.7rem] text-destructive">
                  Requested {inr(ln.wholesale_price - ln.requested_price)} below wholesale
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {item.notes ? <p className="text-xs text-muted-foreground">Notes: {item.notes}</p> : null}
      <p className="text-xs text-muted-foreground">
        Approve so Accounts can raise the invoice first. After invoicing, Supervisor or Sales allot the driver.
      </p>
    </div>
  );
}

export function ApprovalPopup({
  open,
  onClose,
  items,
  onDecided,
}: {
  open: boolean;
  onClose: () => void;
  items: PendingItem[];
  onDecided: (key: string, action: "approve" | "reject" | "later") => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const current = items[0];

  if (!open || !current) return null;

  async function decide(action: "approve" | "reject") {
    setBusy(current.key);
    setError("");
    const opts = { method: "POST" as const, companyId: current.companyId };
    try {
      if (current.source === "api" && current.orderId) {
        await api(`/api/v1/sales-orders/${current.orderId}/${action}`, opts);
      }
      onDecided(current.key, action);
      if (items.length <= 1) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const belowFloor = (current.lines || []).some((ln) => ln.below_wholesale);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" />
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
          Sales order request · {items.length} waiting
        </p>
        <h2 id="approval-title" className="mt-1 text-xl font-semibold tracking-tight">
          Order for {current.customer}
        </h2>
        {belowFloor && (
          <p className="mt-1 text-sm text-warning">Includes below-floor price — review rates on the lines below</p>
        )}

        <OrderApprovalBody item={current} />

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void decide("approve")}
            className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy === current.key ? "…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void decide("reject")}
            className="rounded-xl border border-border px-4 py-3 text-sm text-destructive disabled:opacity-60"
          >
            Decline
          </button>
        </div>
        <button
          type="button"
          className="mt-3 w-full py-2 text-sm text-muted-foreground"
          onClick={() => {
            onDecided(current.key, "later");
            if (items.length <= 1) onClose();
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
