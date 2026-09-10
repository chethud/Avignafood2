import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { money, waHref } from "@/lib/format";
import { firms, firmLabelByCompanyId } from "@/lib/erp-data";
import { useCompany } from "@/lib/company-context";
import { dueCountdown, payStatus, payStatusLabel } from "@/lib/accounts";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices · Avighna ERP" },
      { name: "description", content: "Generate GST invoices from loads that are almost ready to dispatch. Books stay in Tally Prime." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { raise?: string } => ({
    raise: typeof search.raise === "string" ? search.raise : undefined,
  }),
  component: Invoices,
});

type BillableOrder = {
  sales_order_id: number;
  company_id: number;
  company_name?: string | null;
  customer_id: number;
  customer_name: string;
  address: string | null;
  ops_status: string;
  logistics_status: string | null;
  line_count: number;
  qty: string | number;
  estimated_total: string | number;
  credit_limit: string | number;
  current_outstanding: string | number;
  projected_exposure: string | number;
  credit_ok: boolean;
};

type InvoiceRow = {
  id: number;
  company_id?: number;
  number: string;
  customer_name: string | null;
  invoice_date: string;
  due_date: string | null;
  status: string;
  total: string | number;
  amount_paid: string | number;
  outstanding: string | number;
  credit_days: number | null;
  subtotal?: string | number;
  tax_amount?: string | number;
  cgst?: string | number;
  sgst?: string | number;
  delay_days?: number;
  interest_loss?: string | number;
  phone?: string | null;
  gstin?: string | null;
  sent_via?: string | null;
  sent_at?: string | null;
  address?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  sales_order_id?: number | null;
  dispatch_id?: number | null;
  payment_status?: string;
  lines?: {
    product_name?: string;
    quantity: number;
    unit_price: number;
    gst_rate: number;
    line_total: number;
  }[];
};

type OrderLineDraft = {
  product_id: number;
  product_name: string;
  quantity: string;
  unit_price: string;
  gst_rate: string;
};

type InvoiceDraft = {
  invoice_date: string;
  due_date: string;
  credit_days: string;
  number: string;
  remarks: string;
  lines: OrderLineDraft[];
};

function Invoices() {
  const { firm } = useCompany();
  const navigate = useNavigate();
  const { raise } = Route.useSearch();
  const company = firms.find((f) => f.id === firm);
  const [orders, setOrders] = useState<BillableOrder[]>([]);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [pickOrder, setPickOrder] = useState<BillableOrder | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [printInv, setPrintInv] = useState<InvoiceRow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [month, setMonth] = useState("all");
  const raisedFromPopup = useRef<string | null>(null);

  async function load() {
    try {
      const [issued, soReady] = await Promise.all([
        api<InvoiceRow[]>("/api/v1/invoices"),
        api<BillableOrder[]>("/api/v1/invoices/billable-orders").catch(() => [] as BillableOrder[]),
      ]);
      setRows(issued);
      setOrders(soReady);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load invoices");
    }
  }

  useEffect(() => {
    void load();
  }, [firm]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((i) => {
      const pay = payStatus(i);
      if (status !== "all" && pay !== status && i.status !== status) return false;
      if (overdueOnly && pay !== "overdue") return false;
      if (month !== "all" && !String(i.invoice_date).startsWith(month)) return false;
      if (!needle) return true;
      return `${i.number} ${i.customer_name || ""}`.toLowerCase().includes(needle);
    });
  }, [rows, q, status, overdueOnly, month]);

  const draftEst = useMemo(() => {
    if (!draft) return 0;
    return draft.lines.reduce((sum, ln) => {
      const qty = Number(ln.quantity) || 0;
      const price = Number(ln.unit_price) || 0;
      const gst = Number(ln.gst_rate) || 0;
      const sub = qty * price;
      return sum + sub + (sub * gst) / 100;
    }, 0);
  }, [draft]);

  async function openInvoiceForm(o: BillableOrder) {
    setError("");
    setBusy(true);
    try {
      type So = {
        id: number;
        lines: { product_id: number; quantity: number; unit_price: number }[];
      };
      type Prod = { id: number; name: string; gst_rate?: string | number };
      const [sos, products] = await Promise.all([
        api<So[]>("/api/v1/sales-orders", { companyId: o.company_id }),
        api<Prod[]>("/api/v1/products", { companyId: o.company_id }).catch(() => [] as Prod[]),
      ]);
      const so = sos.find((x) => x.id === o.sales_order_id);
      const names = Object.fromEntries(products.map((p) => [p.id, p]));
      const today = new Date().toISOString().slice(0, 10);
      const creditDays = 30;
      const due = new Date();
      due.setDate(due.getDate() + creditDays);
      setPickOrder(o);
      setDraft({
        invoice_date: today,
        due_date: due.toISOString().slice(0, 10),
        credit_days: String(creditDays),
        number: "",
        remarks: "",
        lines: (so?.lines || []).map((ln) => {
          const p = names[ln.product_id];
          return {
            product_id: ln.product_id,
            product_name: p?.name || `Product #${ln.product_id}`,
            quantity: String(ln.quantity),
            unit_price: String(ln.unit_price),
            gst_rate: String(p?.gst_rate ?? 5),
          };
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open invoice form");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!raise || !orders.length || busy || pickOrder) return;
    if (raisedFromPopup.current === raise) return;
    const o = orders.find((x) => String(x.sales_order_id) === raise);
    if (!o) return;
    raisedFromPopup.current = raise;
    void openInvoiceForm(o).then(() => {
      void navigate({ to: "/invoices", search: {}, replace: true });
    });
  }, [raise, orders, busy, pickOrder, navigate]);

  async function generateFromOrder(override = false) {
    if (!pickOrder || !draft) return;
    if (!draft.invoice_date || !draft.due_date) {
      setError("Enter invoice date and due date");
      return;
    }
    if (!draft.lines.length) {
      setError("Add at least one invoice line");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/invoices/from-order/${pickOrder.sales_order_id}?override_credit=${override}`, {
        method: "POST",
        companyId: pickOrder.company_id,
        body: JSON.stringify({
          invoice_date: draft.invoice_date,
          due_date: draft.due_date,
          credit_days: draft.credit_days ? Number(draft.credit_days) : null,
          number: draft.number.trim() || null,
          remarks: draft.remarks.trim() || null,
          lines: draft.lines.map((ln) => ({
            product_id: ln.product_id,
            quantity: ln.quantity,
            unit_price: ln.unit_price,
            gst_rate: ln.gst_rate,
          })),
        }),
      });
      setPickOrder(null);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate invoice");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvoice(row: InvoiceRow, via: "whatsapp" | "email") {
    try {
      await api(`/api/v1/invoices/${row.id}/send?via=${via}`, {
        method: "POST",
        companyId: row.company_id,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark sent");
    }
  }

  async function openPrint(row: InvoiceRow) {
    try {
      setPrintInv(
        await api<InvoiceRow>(`/api/v1/invoices/${row.id}`, {
          companyId: row.company_id,
        }),
      );
    } catch {
      setPrintInv(row);
    }
  }
  const invoiced = rows.reduce((a, i) => a + Number(i.total || 0), 0);
  const open = rows.filter((i) => i.status === "open" || i.status === "partial").length;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="After Owner approves a sales order, it lands here first. Raise the invoice — then Supervisor or Sales allot the driver for Logistics."
      />
      {error && !pickOrder && !printInv && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Ready to invoice" value={String(orders.length)} tone={orders.length ? "warn" : "good"} meta="Owner-approved · your queue" />
        <Kpi label="Invoiced" value={money(invoiced)} meta={`${rows.length} documents`} />
        <Kpi label="Awaiting payment" value={String(open)} tone="warn" />
      </div>

      <Panel title="Ready to invoice" hint="Owner approved — raise GST invoice first. Driver allotment happens after this on Order desk." className="mt-6">
        <Table head={["Company", "Order", "Customer", "Lines", "Est. total", "Stage", "Credit", ""]}>
          {orders.map((o) => (
            <tr key={o.sales_order_id}>
              <Td className="text-muted-foreground">{o.company_name || firmLabelByCompanyId(o.company_id)}</Td>
              <Td className="font-medium">SO-{o.sales_order_id}</Td>
              <Td>{o.customer_name}</Td>
              <Td className="tabular-nums">{o.line_count}</Td>
              <Td className="tabular-nums">{money(o.estimated_total)}</Td>
              <Td className="capitalize">{(o.logistics_status || o.ops_status).replaceAll("_", " ")}</Td>
              <Td>
                <Badge tone={o.credit_ok ? "good" : "bad"}>{o.credit_ok ? "Within limit" : "Limit exceeded"}</Badge>
              </Td>
              <Td>
                <button type="button" className="text-sm text-primary hover:underline" onClick={() => void openInvoiceForm(o)}>
                  Enter details
                </button>
              </Td>
            </tr>
          ))}
        </Table>
        {!orders.length && (
          <p className="mt-3 text-sm text-muted-foreground">No approved orders waiting to bill. Super Admin must approve a sales order first.</p>
        )}
      </Panel>

      <Panel title="Issued invoices" hint="Invoice ↔ sales order ↔ dispatch. Filters stay on this company." className="mt-6">
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            placeholder="Search invoice or customer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partially paid</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">All dates</option>
            <option value={new Date().toISOString().slice(0, 7)}>This month</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>
        <Table head={["Invoice", "Customer", "SO / Dispatch", "Date", "Due", "Total", "Outstanding", "Status", ""]}>
          {visible.map((i) => {
            const pay = payStatus(i);
            return (
            <tr key={i.id}>
              <Td className="font-medium">{i.number}</Td>
              <Td>{i.customer_name || "—"}</Td>
              <Td className="text-muted-foreground text-xs">
                {i.sales_order_id ? `SO-${i.sales_order_id}` : "—"}
                {i.dispatch_id ? ` · D-${i.dispatch_id}` : ""}
              </Td>
              <Td className="text-muted-foreground">{i.invoice_date}</Td>
              <Td className="text-muted-foreground">{dueCountdown(i.due_date)}</Td>
              <Td className="tabular-nums">{money(i.total)}</Td>
              <Td className="tabular-nums">{money(i.outstanding)}</Td>
              <Td>
                <Badge tone={pay === "paid" ? "good" : pay === "overdue" ? "bad" : pay === "partial" ? "warn" : "neutral"}>
                  {payStatusLabel(pay)}
                  {i.sent_via ? " · sent" : ""}
                </Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="text-sm text-primary hover:underline" onClick={() => void openPrint(i)}>
                    PDF
                  </button>
                  {i.phone ? (
                    <a
                      href={`${waHref(i.phone)}?text=${encodeURIComponent(`Invoice ${i.number} dated ${i.invoice_date}. Amount ${money(i.total)}. Due ${i.due_date || ""}.`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                      onClick={() => void sendInvoice(i, "whatsapp")}
                    >
                      WhatsApp
                    </a>
                  ) : (
                    <button type="button" className="text-sm text-primary hover:underline" onClick={() => void sendInvoice(i, "whatsapp")}>
                      Send
                    </button>
                  )}
                  <button type="button" className="text-sm text-primary hover:underline" onClick={() => void sendInvoice(i, "email")}>
                    Email
                  </button>
                  {Number(i.outstanding) > 0 && i.status !== "cancelled" && (
                    <Link to="/payments" className="text-sm text-primary hover:underline">
                      Payment
                    </Link>
                  )}
                </div>
              </Td>
            </tr>
            );
          })}
        </Table>
        {!visible.length && <p className="mt-3 text-sm text-muted-foreground">No invoices match these filters.</p>}
      </Panel>

      {pickOrder && draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close"
            onClick={() => {
              setPickOrder(null);
              setDraft(null);
            }}
          />
          <div className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl">
            <h2 className="text-lg font-semibold">Enter invoice details</h2>
            <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">
              {pickOrder.company_name || firmLabelByCompanyId(pickOrder.company_id)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              SO-{pickOrder.sales_order_id} · {pickOrder.customer_name} — fill dates, lines and remarks, then raise.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">
                Invoice date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={draft.invoice_date}
                  onChange={(e) => setDraft({ ...draft, invoice_date: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Due date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Credit days
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={draft.credit_days}
                  onChange={(e) => setDraft({ ...draft, credit_days: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Invoice number (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  placeholder="Auto if blank"
                  value={draft.number}
                  onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                />
              </label>
            </div>
            <label className="mt-3 block text-xs text-muted-foreground">
              Remarks / notes
              <textarea
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                rows={2}
                value={draft.remarks}
                onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
                placeholder="Any Accounts notes for this bill"
              />
            </label>
            <div className="mt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">Lines</p>
                <p className="text-xs text-muted-foreground">Qty and rate from the order — edit GST only</p>
              </div>
              {draft.lines.map((ln, idx) => (
                <div key={ln.product_id} className="rounded-xl border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{ln.product_name}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="block text-xs text-muted-foreground">
                      <span className="mb-1 block">Qty</span>
                      <p className="min-h-11 rounded-lg border border-transparent bg-secondary/60 px-2 py-2 text-sm font-medium tabular-nums text-foreground">
                        {ln.quantity}
                      </p>
                    </div>
                    <div className="block text-xs text-muted-foreground">
                      <span className="mb-1 block">Rate</span>
                      <p className="min-h-11 rounded-lg border border-transparent bg-secondary/60 px-2 py-2 text-sm font-medium tabular-nums text-foreground">
                        {ln.unit_price}
                      </p>
                    </div>
                    <label className="block text-xs text-muted-foreground">
                      <span className="mb-1 block">GST %</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        className="min-h-11 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm font-medium text-foreground outline-none ring-offset-background focus:border-primary focus:ring-2 focus:ring-primary/30"
                        value={ln.gst_rate}
                        onChange={(e) => {
                          const next = e.target.value.replace(/[^\d.]/g, "");
                          const lines = draft.lines.map((row, i) =>
                            i === idx ? { ...row, gst_rate: next } : row,
                          );
                          setDraft({ ...draft, lines });
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Est. total incl. GST</dt>
                <dd className="tabular-nums font-medium">{money(draftEst)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Credit</dt>
                <dd>
                  <Badge tone={pickOrder.credit_ok ? "good" : "bad"}>
                    {pickOrder.credit_ok ? "Within limit" : "Limit exceeded"}
                  </Badge>
                </dd>
              </div>
            </dl>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void generateFromOrder(!pickOrder.credit_ok)}
                className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Creating…" : pickOrder.credit_ok ? "Raise invoice" : "Raise anyway"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickOrder(null);
                  setDraft(null);
                }}
                className="rounded-lg border border-border py-2.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {printInv && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 print:static print:inset-auto print:p-0">
          <button type="button" className="absolute inset-0 bg-foreground/40 print:hidden" aria-label="Close" onClick={() => setPrintInv(null)} />
          <div id="invoice-print" className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:p-8">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{company?.name || "Avighna Foods"}</p>
            <h2 className="text-lg font-semibold">Tax Invoice {printInv.number}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              GSTIN {company?.gst || "—"} · Invoice {printInv.invoice_date} · Due {printInv.due_date || "—"}
              {printInv.sales_order_id ? ` · SO-${printInv.sales_order_id}` : ""}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Bill to</dt>
                <dd className="font-medium">{printInv.customer_name}</dd>
                <dd>{printInv.gstin || ""}</dd>
                <dd className="text-muted-foreground">{printInv.billing_address || printInv.address || ""}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ship to</dt>
                <dd>{printInv.shipping_address || printInv.address || "—"}</dd>
                <dd className="text-muted-foreground">{printInv.credit_days ?? 30} day credit</dd>
              </div>
            </dl>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1">Product</th>
                  <th className="py-1 text-right">Qty</th>
                  <th className="py-1 text-right">Rate</th>
                  <th className="py-1 text-right">GST</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(printInv.lines || []).map((ln, idx) => (
                  <tr key={idx} className="border-b border-border/60">
                    <td className="py-1">{ln.product_name || "Item"}</td>
                    <td className="py-1 text-right tabular-nums">{ln.quantity}</td>
                    <td className="py-1 text-right tabular-nums">{money(ln.unit_price)}</td>
                    <td className="py-1 text-right tabular-nums">{ln.gst_rate}%</td>
                    <td className="py-1 text-right tabular-nums">{money(ln.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 ml-auto w-56 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Taxable</dt><dd className="tabular-nums">{money(printInv.subtotal || 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">CGST</dt><dd className="tabular-nums">{money(printInv.cgst || 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">SGST</dt><dd className="tabular-nums">{money(printInv.sgst || 0)}</dd></div>
              <div className="flex justify-between font-medium"><dt>Grand total</dt><dd className="tabular-nums">{money(printInv.total)}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">Pay by bank transfer / UPI / cheque. Outstanding {money(printInv.outstanding)}.</p>
            <div className="mt-5 grid grid-cols-2 gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground">
                Print / PDF
              </button>
              <button type="button" onClick={() => setPrintInv(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
