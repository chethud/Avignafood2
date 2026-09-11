import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { money, waHref } from "@/lib/format";
import { firms, firmLabelByCompanyId } from "@/lib/erp-data";
import { useCompany } from "@/lib/company-context";
import { dueCountdown, payStatus, payStatusLabel } from "@/lib/accounts";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { buildInvoicePdfBlob, downloadPdfBlob } from "@/lib/invoice-pdf";

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
  vehicle?: string | null;
  driver_name?: string | null;
  delivery_mode?: string;
  line_count: number;
  qty: string | number;
  estimated_total: string | number;
  credit_limit: string | number;
  current_outstanding: string | number;
  projected_exposure: string | number;
  credit_ok: boolean;
  can_invoice?: boolean;
  invoice_block_reason?: string | null;
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
  const [printIntent, setPrintIntent] = useState<"preview" | "download" | "whatsapp" | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [month, setMonth] = useState("all");
  const [readyQ, setReadyQ] = useState("");
  const [readyCredit, setReadyCredit] = useState("all");
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

  const readyVisible = useMemo(() => {
    const needle = readyQ.trim().toLowerCase();
    return orders.filter((o) => {
      if (readyCredit === "ok" && !o.credit_ok) return false;
      if (readyCredit === "exceeded" && o.credit_ok) return false;
      if (!needle) return true;
      return `${o.customer_name} ${o.company_name || ""} SO-${o.sales_order_id} ${o.ops_status} ${o.logistics_status || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [orders, readyQ, readyCredit]);

  const readyFiltersActive = Boolean(readyQ.trim()) || readyCredit !== "all";

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
        notes?: string | null;
        delivery_mode?: string | null;
        vehicle?: string | null;
        driver_name?: string | null;
        planned_slot?: string | null;
        planned_on_date?: string | null;
      };
      type Prod = { id: number; name: string; gst_rate?: string | number };
      type Cust = { id: number; credit_days?: number | null };
      const [sos, products, nextNo, customers] = await Promise.all([
        api<So[]>("/api/v1/sales-orders", { companyId: o.company_id }),
        api<Prod[]>("/api/v1/products", { companyId: o.company_id }).catch(() => [] as Prod[]),
        api<{ number: string }>("/api/v1/invoices/next-number", { companyId: o.company_id }).catch(() => ({
          number: "",
        })),
        api<Cust[]>("/api/v1/customers", { companyId: o.company_id }).catch(() => [] as Cust[]),
      ]);
      const so = sos.find((x) => x.id === o.sales_order_id);
      const names = Object.fromEntries(products.map((p) => [p.id, p]));
      const cust = customers.find((c) => c.id === o.customer_id);
      const today = new Date().toISOString().slice(0, 10);
      const creditDays = cust?.credit_days && cust.credit_days > 0 ? cust.credit_days : 30;
      const due = new Date();
      due.setDate(due.getDate() + creditDays);
      const deliveryMode = o.delivery_mode || so?.delivery_mode || null;
      const vehicle = o.vehicle || so?.vehicle || null;
      const driverName = o.driver_name || so?.driver_name || null;
      const enriched: BillableOrder = {
        ...o,
        delivery_mode: deliveryMode || o.delivery_mode,
        vehicle,
        driver_name: driverName,
      };
      setPickOrder(enriched);
      setDraft({
        invoice_date: today,
        due_date: due.toISOString().slice(0, 10),
        credit_days: String(creditDays),
        number: nextNo.number || "",
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

  async function loadInvoiceDetail(row: InvoiceRow) {
    try {
      return await api<InvoiceRow>(`/api/v1/invoices/${row.id}`, {
        companyId: row.company_id,
      });
    } catch {
      return row;
    }
  }

  function closePdfViewer() {
    setPrintInv(null);
    setPrintIntent(null);
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function makePdf(detail: InvoiceRow) {
    const firmMeta =
      firms.find((f) => f.companyId === detail.company_id) ||
      firms.find((f) => f.id === firm) ||
      company;
    let name = firmMeta?.name;
    let gst = firmMeta?.gst ?? null;
    let logoUrl: string | null = firmMeta && "logo" in firmMeta ? firmMeta.logo : null;
    try {
      type Co = {
        id: number;
        legal_name?: string;
        trade_name?: string | null;
        gstin?: string | null;
        logo_url?: string | null;
      };
      const rows = await api<Co[]>("/api/v1/companies", { companyId: detail.company_id });
      const co = rows.find((c) => c.id === detail.company_id) || rows[0];
      if (co) {
        name = co.trade_name || co.legal_name || name;
        gst = co.gstin || gst;
        if (co.logo_url) logoUrl = mediaUrl(co.logo_url) || co.logo_url;
      }
    } catch {
      /* use firm seed logo */
    }
    return buildInvoicePdfBlob(detail, { name, gst, logoUrl });
  }

  async function previewInvoice(row: InvoiceRow) {
    setError("");
    setPdfBusy(true);
    try {
      const detail = await loadInvoiceDetail(row);
      const blob = await makePdf(detail);
      const url = URL.createObjectURL(blob);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setPrintIntent("preview");
      setPrintInv(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadInvoicePdf(row: InvoiceRow) {
    setError("");
    setPdfBusy(true);
    try {
      const detail = await loadInvoiceDetail(row);
      const blob = await makePdf(detail);
      downloadPdfBlob(blob, `${detail.number || "invoice"}.pdf`);
      const url = URL.createObjectURL(blob);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setPrintIntent("download");
      setPrintInv(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  function invoiceWhatsAppText(row: InvoiceRow) {
    return [
      `Tax Invoice ${row.number}`,
      `Date: ${row.invoice_date}`,
      `Amount: ${money(row.total)}`,
      row.due_date ? `Due: ${row.due_date}` : null,
      row.sales_order_id ? `SO-${row.sales_order_id}` : null,
      "",
      "Invoice PDF has been downloaded — please attach that file in this chat.",
    ]
      .filter((x) => x != null)
      .join("\n");
  }

  async function shareInvoiceWhatsApp(row: InvoiceRow) {
    setError("");
    if (!row.phone) {
      setError("No customer phone on this invoice — add phone on the customer to share on WhatsApp.");
      return;
    }
    setPdfBusy(true);
    try {
      const detail = await loadInvoiceDetail(row);
      const blob = await makePdf(detail);
      downloadPdfBlob(blob, `${detail.number || "invoice"}.pdf`);
      const url = URL.createObjectURL(blob);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setPrintIntent("whatsapp");
      setPrintInv(detail);
      void sendInvoice(row, "whatsapp");
      window.open(
        `${waHref(row.phone)}?text=${encodeURIComponent(invoiceWhatsAppText(detail))}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare WhatsApp share");
    } finally {
      setPdfBusy(false);
    }
  }
  const invoiced = rows.reduce((a, i) => a + Number(i.total || 0), 0);
  const open = rows.filter((i) => i.status === "open" || i.status === "partial").length;

  if (pickOrder && draft) {
    return (
      <>
        <PageHeader
          title="Raise invoice"
          subtitle={`SO-${pickOrder.sales_order_id} · ${pickOrder.customer_name}`}
        />
        <button
          type="button"
          className="mb-4 text-sm text-primary hover:underline"
          onClick={() => {
            setPickOrder(null);
            setDraft(null);
          }}
        >
          ← Back to invoices
        </button>

        <div className="mx-auto w-full max-w-3xl space-y-5 pb-8">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">Company</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {pickOrder.company_name || firmLabelByCompanyId(pickOrder.company_id)}
            </h2>
          </div>

          <dl className="grid gap-2 sm:grid-cols-2 text-sm">
            <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Customer</dt>
              <dd className="mt-0.5 font-semibold leading-snug">{pickOrder.customer_name}</dd>
            </div>
            <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Order</dt>
              <dd className="mt-0.5 font-medium">SO-{pickOrder.sales_order_id}</dd>
            </div>
            <div className="rounded-xl bg-secondary/60 px-3 py-2.5 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Delivery</dt>
              <dd className="mt-0.5 font-medium leading-snug">
                {pickOrder.delivery_mode === "manufacturer"
                  ? "Manufacturer — no fleet"
                  : [pickOrder.vehicle, pickOrder.driver_name].filter(Boolean).join(" · ") || "Own vehicle"}
              </dd>
            </div>
            {pickOrder.address ? (
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Address</dt>
                <dd className="mt-0.5 text-sm leading-snug">{pickOrder.address}</dd>
              </div>
            ) : null}
            <div className="rounded-xl border border-primary/25 bg-primary/10 px-3 py-3 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Invoice number (auto)</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">
                {draft.number || "Will assign on raise"}
              </dd>
            </div>
            <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Est. total</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{money(draftEst || pickOrder.estimated_total)}</dd>
            </div>
            <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">Credit</dt>
              <dd className="mt-0.5">
                <Badge tone={pickOrder.credit_ok ? "good" : "bad"}>
                  {pickOrder.credit_ok ? "Within limit" : "Limit exceeded"}
                </Badge>
              </dd>
            </div>
          </dl>

          <div className="grid gap-3 sm:grid-cols-3">
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
                onChange={(e) => {
                  const days = e.target.value;
                  const next = { ...draft, credit_days: days };
                  const n = Number(days);
                  if (Number.isFinite(n) && n >= 0 && draft.invoice_date) {
                    const d = new Date(draft.invoice_date);
                    d.setDate(d.getDate() + n);
                    next.due_date = d.toISOString().slice(0, 10);
                  }
                  setDraft(next);
                }}
              />
            </label>
          </div>

          <label className="block text-xs text-muted-foreground">
            Remarks / notes
            <textarea
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              rows={2}
              value={draft.remarks}
              onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
              placeholder="Any Accounts notes for this bill"
            />
          </label>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">Lines</p>
              <p className="text-xs text-muted-foreground">Qty and rate from the order — edit GST only</p>
            </div>
            {draft.lines.map((ln, idx) => {
              const qty = Number(ln.quantity) || 0;
              const price = Number(ln.unit_price) || 0;
              const gst = Number(ln.gst_rate) || 0;
              const lineSub = qty * price;
              const lineTotal = lineSub + (lineSub * gst) / 100;
              return (
                <div key={ln.product_id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{ln.product_name}</p>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{money(lineTotal)}</p>
                  </div>
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
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary/10 px-4 py-3">
            <span className="font-medium text-muted-foreground">Total incl. GST</span>
            <span className="text-xl font-semibold tabular-nums">{money(draftEst)}</span>
          </div>
          {!pickOrder.credit_ok && (
            <p className="text-xs text-destructive">
              Projected {money(pickOrder.projected_exposure)} vs limit {money(pickOrder.credit_limit)}.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background/95 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:py-0 sm:backdrop-blur-none">
            <button
              type="button"
              disabled={busy}
              onClick={() => void generateFromOrder(!pickOrder.credit_ok)}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Creating…" : pickOrder.credit_ok ? "Raise invoice" : "Raise anyway"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPickOrder(null);
                setDraft(null);
              }}
              className="rounded-xl border border-border px-5 py-3 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="After Owner approves a sales order, it lands here first. Raise the invoice — then Supervisor or Sales allot the driver for Logistics."
      />
      {error && !printInv && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Ready to invoice" value={String(orders.length)} tone={orders.length ? "warn" : "good"} meta="Owner-approved · your queue" />
        <Kpi label="Invoiced" value={money(invoiced)} meta={`${rows.length} documents`} />
        <Kpi label="Awaiting payment" value={String(open)} tone="warn" />
      </div>

      <Panel
        title="Ready to invoice"
        hint={
          readyFiltersActive
            ? `Showing ${readyVisible.length} of ${orders.length}`
            : "Owner approved · manufacturer ready anytime · own vehicle only after truck + driver assigned"
        }
        className="mt-6"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2 lg:col-span-2"
            placeholder="Search order, customer, company"
            value={readyQ}
            onChange={(e) => setReadyQ(e.target.value)}
          />
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={readyCredit}
            onChange={(e) => setReadyCredit(e.target.value)}
          >
            <option value="all">All credit</option>
            <option value="ok">Within limit</option>
            <option value="exceeded">Limit exceeded</option>
          </select>
        </div>
        {readyFiltersActive && (
          <button
            type="button"
            className="mb-3 text-sm text-primary hover:underline"
            onClick={() => {
              setReadyQ("");
              setReadyCredit("all");
            }}
          >
            Clear filters
          </button>
        )}
        <Table head={["Company", "Order", "Customer", "Delivery", "Est. total", "Credit", ""]}>
          {readyVisible.map((o) => (
            <tr key={o.sales_order_id}>
              <Td className="text-muted-foreground">{o.company_name || firmLabelByCompanyId(o.company_id)}</Td>
              <Td className="font-medium">SO-{o.sales_order_id}</Td>
              <Td>{o.customer_name}</Td>
              <Td className="text-sm">
                {o.delivery_mode === "manufacturer" ? (
                  <span className="text-muted-foreground">Manufacturer</span>
                ) : (
                  <span>
                    {o.vehicle || "Own vehicle"}
                    {o.driver_name ? ` · ${o.driver_name}` : ""}
                  </span>
                )}
              </Td>
              <Td className="tabular-nums">{money(o.estimated_total)}</Td>
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
        {!readyVisible.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            {orders.length
              ? "No orders match this view."
              : "Nothing ready to bill. Manufacturer orders appear after Owner approve. Own-vehicle orders need vehicle + driver first (Sales / Order desk)."}
          </p>
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
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => void previewInvoice(i)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => void downloadInvoicePdf(i)}
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => void shareInvoiceWhatsApp(i)}
                  >
                    WhatsApp
                  </button>
                </div>
              </Td>
            </tr>
            );
          })}
        </Table>
        {!visible.length && <p className="mt-3 text-sm text-muted-foreground">No invoices match these filters.</p>}
      </Panel>

      {printInv && pdfUrl && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={closePdfViewer} />
          <div className="relative z-10 flex h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-[var(--shadow-soft)] sm:rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                  {printIntent === "download"
                    ? "Download PDF"
                    : printIntent === "whatsapp"
                      ? "WhatsApp · PDF ready"
                      : "PDF preview"}
                </p>
                <p className="text-sm font-semibold">
                  {printInv.number} · {printInv.customer_name || "Invoice"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pdfBusy}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  onClick={() => {
                    if (!printInv) return;
                    void makePdf(printInv).then((blob) =>
                      downloadPdfBlob(blob, `${printInv.number || "invoice"}.pdf`),
                    );
                  }}
                >
                  Download PDF
                </button>
                {printInv.phone ? (
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                    onClick={() => {
                      void makePdf(printInv).then((blob) => {
                        downloadPdfBlob(blob, `${printInv.number || "invoice"}.pdf`);
                        void sendInvoice(printInv, "whatsapp");
                        window.open(
                          `${waHref(printInv.phone!)}?text=${encodeURIComponent(invoiceWhatsAppText(printInv))}`,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      });
                    }}
                  >
                    WhatsApp
                  </button>
                ) : null}
                <button type="button" onClick={closePdfViewer} className="rounded-lg border border-border px-3 py-2 text-sm">
                  Close
                </button>
              </div>
            </div>
            {printIntent === "whatsapp" && (
              <p className="border-b border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
                PDF downloaded. Attach <span className="font-medium text-foreground">{printInv.number}.pdf</span> in the
                WhatsApp chat that opened.
              </p>
            )}
            <iframe title={`Invoice ${printInv.number}`} src={pdfUrl} className="min-h-0 w-full flex-1 bg-secondary/30" />
          </div>
        </div>
      )}
    </>
  );
}
