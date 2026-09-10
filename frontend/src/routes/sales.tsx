import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { approvals, byFirm, inr } from "@/lib/erp-data";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { ApprovalPopup, usePendingApprovals } from "@/components/erp/ApprovalPopup";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sales")({
  head: () => ({
    meta: [
      { title: "Sales & price approvals · Avighna ERP" },
      { name: "description", content: "Negotiated prices go to the owner for approval in the app instead of over phone calls." },
      { property: "og:title", content: "Sales & price approvals · Avighna ERP" },
      { property: "og:description", content: "Approve, reject or counter a negotiated rate in one tap." },
    ],
  }),
  component: Sales,
});

type ApprovalRow = (typeof approvals)[number];

type OrderLine = {
  id?: number;
  product_id: number;
  product_name?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  outstanding_qty?: number;
  on_hand?: number;
  stock_ok?: boolean;
  wholesale_price?: number;
  selling_price?: number;
  below_wholesale?: boolean;
};

type Order = {
  id: number;
  company_id?: number;
  company_name?: string | null;
  customer_id: number;
  customer_name: string | null;
  status: string;
  ops_status: string;
  quotation_id: number | null;
  notes?: string | null;
  lines: OrderLine[];
  stock_warnings: string[];
  created_by_name?: string | null;
  created_at?: string | null;
  confirmed_at?: string | null;
  logistics_status?: string | null;
  vehicle?: string | null;
  eta?: string | null;
};

type ProductOpt = { id: number; name: string; unit: string; base_price: string | number };

function orderStage(o: Order) {
  if (o.status === "cancelled") return "Declined";
  if (o.status === "draft" || o.ops_status === "pending_approval") return "Waiting Super Admin";
  if (o.status === "confirmed" || o.ops_status === "awaiting_invoice") return "Waiting invoice";
  if (o.ops_status === "pending_verify") return "Confirm stock";
  if (o.ops_status === "ready") return "Ready to allot";
  if (o.ops_status === "allocated") return "Driver allotted";
  if (o.ops_status === "dispatched") return o.logistics_status === "delivered" ? "Delivered" : "With driver";
  if (o.status === "invoiced") return "Invoiced";
  return o.status;
}

function fmtWhen(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function lineLabel(ln: OrderLine, products: ProductOpt[]) {
  return ln.product_name || products.find((p) => p.id === ln.product_id)?.name || `Product #${ln.product_id}`;
}

function lineUnit(ln: OrderLine, products: ProductOpt[]) {
  return ln.unit || products.find((p) => p.id === ln.product_id)?.unit || "KG";
}

function orderTotal(o: Order) {
  return o.lines.reduce((sum, ln) => sum + Number(ln.quantity || 0) * Number(ln.unit_price || 0), 0);
}

function isOverdue(o: Order) {
  if (o.lines.some((ln) => Number(ln.outstanding_qty) > 0)) return true;
  if (o.ops_status === "shortage" || o.ops_status === "procuring") return true;
  return false;
}

function Sales() {
  const { me } = useMe();
  if (me?.user.role === "sales") return <SalesWorkspace />;
  return <OwnerApprovals />;
}

function SalesWorkspace() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"normal" | "overdue">("normal");
  const [open, setOpen] = useState<Order | null>(null);

  async function load() {
    const [o, p] = await Promise.all([
      api<Order[]>("/api/v1/sales-orders").catch(() => [] as Order[]),
      api<ProductOpt[]>("/api/v1/products").catch(() => [] as ProductOpt[]),
    ]);
    setOrders(o);
    setProducts(p);
    setOpen((prev) => (prev ? o.find((row) => row.id === prev.id) || null : null));
  }

  useEffect(() => {
    void load();
    sessionStorage.removeItem("avighna.quoteCustomer");
  }, []);

  async function confirmOrder(id: number) {
    setError("");
    try {
      await api(`/api/v1/sales-orders/${id}/confirm`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send order");
    }
  }

  const overdue = orders.filter(isOverdue);
  const normal = orders.filter((o) => !isOverdue(o));
  const shown = tab === "overdue" ? overdue : normal;

  return (
    <>
      <PageHeader title="Orders" subtitle="Tap an order for full details. Create → Super Admin approves → Accounts invoices → allot on Order desk." />
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTab("normal")}
          className={cn(
            "rounded-2xl border px-3 py-3 text-left",
            tab === "normal" ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
          )}
        >
          <p className="text-xs text-muted-foreground">Normal</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{normal.length}</p>
        </button>
        <button
          type="button"
          onClick={() => setTab("overdue")}
          className={cn(
            "rounded-2xl border px-3 py-3 text-left",
            tab === "overdue" ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
          )}
        >
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{overdue.length}</p>
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <ul className="space-y-2">
        {shown.map((o) => (
          <li
            key={o.id}
            role="button"
            tabIndex={0}
            onClick={() => setOpen(o)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpen(o);
              }
            }}
            className="cursor-pointer rounded-2xl border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-secondary/40"
          >
            <div className="flex items-start justify-between gap-2">
              <span>
                <span className="block font-medium">SO-{o.id}</span>
                <span className="text-sm text-muted-foreground">{o.customer_name || `Customer ${o.customer_id}`}</span>
              </span>
              <Badge tone={isOverdue(o) ? "warn" : o.status === "cancelled" ? "bad" : "neutral"}>
                {isOverdue(o) ? "Overdue" : orderStage(o)}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Warehouse: {o.ops_status.replaceAll("_", " ")}</p>
            {o.logistics_status && (
              <p className="mt-1 text-xs text-muted-foreground">
                Dispatch: {o.logistics_status.replaceAll("_", " ")}
                {o.vehicle ? ` · ${o.vehicle}` : ""}
                {o.eta ? ` · expected ${o.eta}` : ""}
              </p>
            )}
            {o.lines.some((ln) => Number(ln.outstanding_qty) > 0) && (
              <p className="mt-2 text-sm font-medium text-warning">
                Outstanding delivery:{" "}
                {o.lines
                  .filter((ln) => Number(ln.outstanding_qty) > 0)
                  .map((ln) => `${Number(ln.outstanding_qty).toLocaleString("en-IN")} ${lineUnit(ln, products)} ${lineLabel(ln, products)}`.trim())
                  .join(" · ")}
              </p>
            )}
            {o.status === "draft" && o.ops_status !== "pending_approval" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void confirmOrder(o.id);
                }}
                className="mt-2 rounded-xl border border-border px-3 py-1.5 text-xs"
              >
                Send to Super Admin
              </button>
            )}
          </li>
        ))}
        {!shown.length && (
          <li className="py-8 text-center text-sm text-muted-foreground">
            {tab === "overdue" ? "No overdue orders." : "No normal orders yet."}
          </li>
        )}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => setOpen(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sales-order-detail-title"
            className="relative z-10 max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-5"
          >
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              SO-{open.id}
              {open.company_name ? ` · ${open.company_name}` : ""}
              {open.quotation_id ? ` · Quote #${open.quotation_id}` : ""}
            </p>
            <h2 id="sales-order-detail-title" className="mt-1 text-xl font-semibold tracking-tight">
              {open.customer_name || `Customer ${open.customer_id}`}
            </h2>
            <div className="mt-2">
              <Badge tone={isOverdue(open) ? "warn" : open.status === "cancelled" ? "bad" : "neutral"}>
                {isOverdue(open) ? "Overdue" : orderStage(open)}
              </Badge>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Order status</dt>
                  <dd className="mt-0.5 font-medium capitalize">{open.status.replaceAll("_", " ")}</dd>
                </div>
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Warehouse</dt>
                  <dd className="mt-0.5 font-medium capitalize">{open.ops_status.replaceAll("_", " ")}</dd>
                </div>
              </div>
              {(open.logistics_status || open.vehicle || open.eta) && (
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Dispatch</dt>
                  <dd className="mt-0.5 font-medium capitalize">
                    {[open.logistics_status?.replaceAll("_", " "), open.vehicle, open.eta ? `expected ${open.eta}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Created</dt>
                  <dd className="mt-0.5 font-medium">{fmtWhen(open.created_at) || "—"}</dd>
                </div>
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Confirmed</dt>
                  <dd className="mt-0.5 font-medium">{fmtWhen(open.confirmed_at) || "—"}</dd>
                </div>
              </div>
              {open.created_by_name && (
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Created by</dt>
                  <dd className="mt-0.5 font-medium">{open.created_by_name}</dd>
                </div>
              )}
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">Order value</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{inr(orderTotal(open))}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Lines</p>
              <ul className="mt-2 space-y-2">
                {open.lines.map((ln, idx) => (
                  <li key={ln.id ?? `${ln.product_id}-${idx}`} className="rounded-xl border border-border px-3 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{lineLabel(ln, products)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {inr(Number(ln.quantity) * Number(ln.unit_price))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {Number(ln.quantity).toLocaleString("en-IN")} {lineUnit(ln, products)} × {inr(ln.unit_price)}
                      {ln.on_hand != null ? ` · stock ${Number(ln.on_hand).toLocaleString("en-IN")}` : ""}
                    </p>
                    {Number(ln.outstanding_qty) > 0 && (
                      <p className="mt-1 text-xs font-medium text-warning">
                        Outstanding {Number(ln.outstanding_qty).toLocaleString("en-IN")} {lineUnit(ln, products)}
                      </p>
                    )}
                    {ln.below_wholesale && (
                      <p className="mt-1 text-xs text-destructive">Below wholesale {inr(ln.wholesale_price || 0)}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {open.stock_warnings?.length > 0 && (
              <div className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                {open.stock_warnings.join(" · ")}
              </div>
            )}
            {open.notes && (
              <p className="mt-3 text-sm text-muted-foreground">Notes: {open.notes}</p>
            )}

            {open.status === "draft" && open.ops_status !== "pending_approval" ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void confirmOrder(open.id)}
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                >
                  Send to Super Admin
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="rounded-xl border border-border px-4 py-3 text-sm"
                >
                  Close
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="mt-5 w-full rounded-xl border border-border py-3 text-sm"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function OwnerApprovals() {
  const { firm } = useCompany();
  const rows = byFirm(approvals, firm);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [popupOpen, setPopupOpen] = useState(false);
  const [selected, setSelected] = useState<ApprovalRow | null>(null);
  const { items, dismiss, canApprove, refresh } = usePendingApprovals();

  const pending = rows.filter((r) => r.status === "Pending" && !decisions[r.id]);

  function statusOf(a: ApprovalRow) {
    return decisions[a.id] ?? a.status;
  }

  function decideSelected(action: "Approved" | "Rejected") {
    if (!selected) return;
    setDecisions((d) => ({ ...d, [selected.id]: action }));
    setSelected(null);
  }

  return (
    <>
      <PageHeader
        title="Sales & price approvals"
        subtitle={
          canApprove
            ? "Sales orders land here for Super Admin approval. After you approve, Accounts raises the invoice — Supervisor does not see the order yet."
            : "Sales orders await Super Admin approval."
        }
        action={
          canApprove && items.length > 0 ? (
            <button
              type="button"
              onClick={() => setPopupOpen(true)}
              className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Review {items.length}
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Kpi label="Awaiting" value={String(items.length || pending.length)} tone={items.length || pending.length ? "warn" : "good"} />
        <Kpi
          label="Approved"
          value={String(rows.filter((r) => r.status === "Approved").length + Object.values(decisions).filter((d) => d === "Approved").length)}
          tone="good"
        />
        <Kpi label="Pipeline value" value={inr(rows.length * 1850000)} meta="Est. from quotes" />
      </div>

      {items.filter((i) => i.kind === "order" || i.kind === "quote").length > 0 && (
        <Panel title="Waiting on Super Admin" hint="Sales created these — approve here, not on Supervisor desk" className="mt-5">
          <ul className="space-y-3">
            {items
              .filter((i) => i.kind === "order" || i.kind === "quote")
              .map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                  <span>
                    <span className="block font-medium">{item.customer}</span>
                    <span className="text-sm text-muted-foreground">
                      {item.kind === "order" ? item.salesperson : "Quote"} · {item.product} · {item.qty}
                    </span>
                  </span>
                  {canApprove ? (
                    <button
                      type="button"
                      onClick={() => setPopupOpen(true)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                    >
                      Review
                    </button>
                  ) : null}
                </li>
              ))}
          </ul>
        </Panel>
      )}

      <div className="mt-5 grid gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-2">
        {rows
          .filter((r) => r.status === "Pending")
          .map((a) => {
            const decided = decisions[a.id];
            return (
              <Panel key={a.id} title={a.customer} hint={`${a.raised} · ${a.salesperson}`}>
                <button type="button" className="w-full text-left" onClick={() => setSelected(a)}>
                  <dl className="grid grid-cols-2 gap-y-2 text-sm sm:gap-y-3">
                    <dt className="text-muted-foreground">Product</dt>
                    <dd className="truncate">{a.product}</dd>
                    <dt className="text-muted-foreground">Qty</dt>
                    <dd className="tabular-nums">{a.qty}</dd>
                    <dt className="text-muted-foreground">Asked</dt>
                    <dd className="tabular-nums font-medium">{inr(a.askedPrice)}</dd>
                    <dt className="text-muted-foreground">Floor</dt>
                    <dd className="tabular-nums">{inr(a.floorPrice)}</dd>
                  </dl>
                </button>
                {decided ? (
                  <p className="mt-3 text-sm sm:mt-4">
                    <Badge tone={decided === "Approved" ? "good" : decided === "Rejected" ? "bad" : "warn"}>{decided}</Badge>
                  </p>
                ) : canApprove ? (
                  <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => setSelected(a)}
                      className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisions((d) => ({ ...d, [a.id]: "Approved" }))}
                      className="rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-secondary"
                    >
                      Quick approve
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground sm:mt-4">
                    <Badge tone="warn">Awaiting owner approval</Badge>
                  </p>
                )}
              </Panel>
            );
          })}
      </div>

      <Panel title="Recent decisions" hint="Tap a row" className="mt-5 sm:mt-6">
        <Table head={["Request", "Customer", "Product", "Qty", "Rate", "Rep", "Status"]}>
          {rows.map((a) => {
            const st = statusOf(a);
            return (
              <tr
                key={a.id}
                className="cursor-pointer hover:bg-secondary/40"
                onClick={() => setSelected(a)}
              >
                <Td className="font-medium">{a.id}</Td>
                <Td>{a.customer}</Td>
                <Td className="text-muted-foreground">{a.product}</Td>
                <Td className="tabular-nums">{a.qty}</Td>
                <Td className="tabular-nums">{inr(a.askedPrice)}</Td>
                <Td className="text-muted-foreground">{a.salesperson}</Td>
                <Td>
                  <Badge tone={st === "Approved" ? "good" : st === "Rejected" ? "bad" : "warn"}>{st}</Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setSelected(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] sm:max-w-md sm:rounded-2xl"
          >
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              {selected.id} · {selected.raised}
            </p>
            <h2 id="decision-title" className="mt-1 text-xl font-semibold tracking-tight">
              {selected.customer}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{selected.salesperson}</p>

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">Product</dt>
                <dd className="mt-0.5 font-medium">{selected.product}</dd>
              </div>
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">Qty</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{selected.qty}</dd>
              </div>
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">Asked</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{inr(selected.askedPrice)}</dd>
              </div>
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">Floor</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{inr(selected.floorPrice)}</dd>
              </div>
            </dl>

            {selected.askedPrice < selected.floorPrice && statusOf(selected) === "Pending" && (
              <p className="mt-3 text-xs text-destructive">
                {inr(selected.floorPrice - selected.askedPrice)} below floor
              </p>
            )}

            <div className="mt-4">
              <Badge tone={statusOf(selected) === "Approved" ? "good" : statusOf(selected) === "Rejected" ? "bad" : "warn"}>
                {statusOf(selected)}
              </Badge>
            </div>

            {canApprove && statusOf(selected) === "Pending" ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => decideSelected("Approved")}
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => decideSelected("Rejected")}
                  className="rounded-xl border border-border px-4 py-3 text-sm text-destructive"
                >
                  Decline
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mt-5 w-full rounded-xl border border-border py-3 text-sm"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      <ApprovalPopup
        open={popupOpen && items.length > 0}
        onClose={() => {
          setPopupOpen(false);
          refresh();
        }}
        items={items}
        onDecided={(key, action) => {
          dismiss(key);
          const mockId = key.startsWith("m-") ? key.slice(2) : null;
          if (mockId && action === "approve") setDecisions((d) => ({ ...d, [mockId]: "Approved" }));
          if (mockId && action === "reject") setDecisions((d) => ({ ...d, [mockId]: "Rejected" }));
        }}
      />
    </>
  );
}
