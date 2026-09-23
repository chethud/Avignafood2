import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useCompany } from "@/lib/company-context";
import { PAY_MODES, agingBucket, dueCountdown, payModeLabel, payStatus, payStatusLabel } from "@/lib/accounts";
import { firmLabelByCompanyId, firms } from "@/lib/erp-data";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/receivables")({
  head: () => ({
    meta: [
      { title: "Receivables · Avighna ERP" },
      { name: "description", content: "Payment tracking and outstanding monitoring after credit days start on the invoice." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { overdue?: string; bucket?: string; focus?: string } => ({
    overdue: typeof search.overdue === "string" ? search.overdue : undefined,
    bucket: typeof search.bucket === "string" ? search.bucket : undefined,
    focus: typeof search.focus === "string" ? search.focus : undefined,
  }),
  component: Receivables,
});

type InvoiceRow = {
  id: number;
  company_id: number;
  customer_id: number;
  number: string;
  customer_name: string | null;
  invoice_date: string;
  due_date: string | null;
  status: string;
  total: string | number;
  amount_paid?: string | number;
  outstanding: string | number;
  credit_days: number | null;
  delay_days?: number;
  interest_loss?: string | number;
  penalty_waived?: boolean;
  payment_status?: string;
  subtotal?: string | number;
  tax_amount?: string | number;
};

type PaymentRow = {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  customer_name: string | null;
  amount: string | number;
  method: string;
  reference: string | null;
  paid_at: string;
};

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function Receivables() {
  const { firm } = useCompany();
  const navigate = useNavigate({ from: Route.fullPath });
  const { overdue: overdueParam, bucket, focus } = Route.useSearch();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<InvoiceRow | null>(null);
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const [payKind, setPayKind] = useState<"partial" | "full">("partial");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [companyF, setCompanyF] = useState("all");
  const [form, setForm] = useState({ amount: "", method: "", reference: "", paid_at: "" });

  async function load() {
    try {
      const [inv, pay] = await Promise.all([
        api<InvoiceRow[]>("/api/v1/invoices"),
        api<PaymentRow[]>("/api/v1/payments").catch(() => [] as PaymentRow[]),
      ]);
      setRows(inv);
      setPayments(pay);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load receivables");
    }
  }

  useEffect(() => {
    void load();
  }, [firm]);

  const open = useMemo(
    () => rows.filter((i) => i.status === "open" || i.status === "partial"),
    [rows],
  );

  const filteredOpen = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = open;

    if (overdueParam === "1") {
      list = list.filter((i) => i.due_date && new Date(i.due_date) < new Date());
    }
    if (bucket) {
      const want =
        bucket === "current"
          ? "Current"
          : bucket === "d1_30"
            ? "1–30"
            : bucket === "d31_60"
              ? "31–60"
              : bucket === "d61_90"
                ? "61–90"
                : bucket === "d90"
                  ? "90+"
                  : null;
      if (want) list = list.filter((i) => agingBucket(i.due_date) === want);
    }
    if (focus === "delay") {
      list = list.filter((i) => Number(i.interest_loss || 0) > 0);
    }
    if (statusF === "open") {
      list = list.filter((i) => i.status === "open" && payStatus(i) !== "overdue");
    } else if (statusF === "partial") {
      list = list.filter((i) => i.status === "partial");
    } else if (statusF === "overdue") {
      list = list.filter((i) => payStatus(i) === "overdue");
    }
    if (companyF !== "all") {
      const cid = Number(companyF);
      list = list.filter((i) => i.company_id === cid);
    }
    if (needle) {
      list = list.filter((i) =>
        `${i.number} ${i.customer_name || ""} ${firmLabelByCompanyId(i.company_id)}`
          .toLowerCase()
          .includes(needle),
      );
    }
    return list;
  }, [open, overdueParam, bucket, focus, statusF, companyF, q]);

  const filtersActive =
    Boolean(overdueParam === "1" || bucket || focus) || statusF !== "all" || companyF !== "all" || Boolean(q.trim());

  function clearRegisterFilters() {
    setQ("");
    setStatusF("all");
    setCompanyF("all");
    void navigate({ search: {} });
  }

  function setDueFilter(value: string) {
    void navigate({
      search: (prev) => ({
        ...prev,
        overdue: value === "overdue" ? "1" : undefined,
        focus: value === "delay" ? "delay" : prev.focus === "delay" && value !== "delay" ? undefined : prev.focus,
      }),
    });
  }

  function setBucketFilter(value: string) {
    void navigate({
      search: (prev) => ({
        ...prev,
        bucket: value === "all" ? undefined : value,
      }),
    });
  }

  const dueFilterValue = overdueParam === "1" ? "overdue" : focus === "delay" ? "delay" : "all";
  const bucketFilterValue = bucket || "all";

  const companiesInOpen = useMemo(() => {
    const ids = [...new Set(open.map((i) => i.company_id))];
    return ids
      .map((id) => ({ id, label: firmLabelByCompanyId(id) || firms.find((f) => f.companyId === id)?.short || `Company ${id}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [open]);

  const outstanding = open.reduce((a, i) => a + Number(i.outstanding || 0), 0);
  const overdueRows = open.filter((i) => i.due_date && new Date(i.due_date) < new Date());
  const overdueAmt = overdueRows.reduce((a, i) => a + Number(i.outstanding || 0), 0);
  const dueSoon = open.filter((i) => {
    if (!i.due_date) return false;
    const d = new Date(i.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const week = new Date(today);
    week.setDate(week.getDate() + 7);
    return d >= today && d <= week;
  }).reduce((a, i) => a + Number(i.outstanding || 0), 0);
  const delayCost = open.reduce((a, i) => a + Number(i.interest_loss || 0), 0);

  function startPay(i: InvoiceRow) {
    setError("");
    setPayFor(i);
    setPayKind("partial");
    setForm({
      amount: "",
      method: "",
      reference: "",
      paid_at: new Date().toISOString().slice(0, 10),
    });
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payFor) return;
    const amount = Number(form.amount);
    const due = Number(payFor.outstanding) || 0;
    const reference = form.reference.trim();
    if (!(amount > 0)) {
      setError("Enter a positive amount");
      return;
    }
    if (amount > due + 0.0001) {
      setError(`Amount cannot exceed outstanding ${money(due)}`);
      return;
    }
    if (!form.method) {
      setError("Select payment mode");
      return;
    }
    if (!reference) {
      setError("Reference (UTR / cheque no.) is required");
      return;
    }
    if (!form.paid_at) {
      setError("Paid on date is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/payments", {
        method: "POST",
        companyId: payFor.company_id,
        body: JSON.stringify({
          invoice_id: payFor.id,
          amount,
          method: form.method,
          reference,
          paid_at: form.paid_at,
        }),
      });
      setPayFor(null);
      const [inv, pay] = await Promise.all([
        api<InvoiceRow[]>("/api/v1/invoices"),
        api<PaymentRow[]>("/api/v1/payments").catch(() => [] as PaymentRow[]),
      ]);
      setRows(inv);
      setPayments(pay);
      if (detail) {
        const refreshed = inv.find((x) => x.id === detail.id);
        setDetail(refreshed || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
    } finally {
      setBusy(false);
    }
  }

  const detailReceipts = useMemo(() => {
    if (!detail) return [] as PaymentRow[];
    return payments
      .filter((p) => p.invoice_id === detail.id)
      .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)) || b.id - a.id);
  }, [detail, payments]);

  const detailPaidTotal = detailReceipts.reduce((a, p) => a + Number(p.amount || 0), 0);

  return (
    <>
      <PageHeader
        title="Receivables"
        subtitle="Update pending amounts here — receive full or partial on each open invoice. All receipts appear on Payments."
        action={
          <Link to="/payments" className="rounded-lg border border-border px-3 py-2 text-sm">
            View all payments
          </Link>
        }
      />
      {error && !payFor && !detail && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {focus === "credit" && (
        <p className="mb-3 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
          Credit alerts — review customers with high outstanding vs limit on Collection.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total outstanding" value={money(outstanding)} tone="warn" />
        <Kpi label="Overdue" value={money(overdueAmt)} tone={overdueAmt ? "bad" : "good"} meta={`${overdueRows.length} invoice(s)`} />
        <Kpi label="Due soon" value={money(dueSoon)} meta="Next 7 days" />
        <Kpi label="Cost of delay" value={money(delayCost)} />
      </div>

      <Panel
        title="Open invoice register"
        hint={
          filtersActive
            ? `Showing ${filteredOpen.length} of ${open.length} open`
            : "Tap a row for full details and receipt history · Receive full or partial on each invoice"
        }
        className="mt-6"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2 lg:col-span-2"
            placeholder="Search invoice, customer, company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={statusF}
            onChange={(e) => setStatusF(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="open">Unpaid</option>
            <option value="partial">Partially paid</option>
            <option value="overdue">Overdue</option>
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={bucketFilterValue}
            onChange={(e) => setBucketFilter(e.target.value)}
          >
            <option value="all">All ageing</option>
            <option value="current">Current</option>
            <option value="d1_30">1–30 days</option>
            <option value="d31_60">31–60 days</option>
            <option value="d61_90">61–90 days</option>
            <option value="d90">90+ days</option>
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={dueFilterValue}
            onChange={(e) => setDueFilter(e.target.value)}
          >
            <option value="all">All due</option>
            <option value="overdue">Overdue only</option>
            <option value="delay">Cost of delay</option>
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={companyF}
            onChange={(e) => setCompanyF(e.target.value)}
          >
            <option value="all">All companies</option>
            {companiesInOpen.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          {filtersActive ? (
            <button type="button" className="text-sm text-primary hover:underline" onClick={clearRegisterFilters}>
              Clear filters
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">{open.length} open invoice(s)</span>
          )}
        </div>
        <Table head={["Company", "Customer", "Invoice", "Due", "Countdown", "Outstanding", "Ageing", "Cost of delay", "Status", ""]}>
          {filteredOpen.map((i) => {
            const pay = payStatus(i);
            return (
              <tr
                key={i.id}
                className="cursor-pointer hover:bg-secondary/50"
                onClick={() => {
                  setError("");
                  setDetail(i);
                }}
              >
                <Td className="text-muted-foreground">{firmLabelByCompanyId(i.company_id)}</Td>
                <Td>{i.customer_name || "—"}</Td>
                <Td className="font-medium">{i.number}</Td>
                <Td className="text-muted-foreground">{i.due_date || "—"}</Td>
                <Td>{dueCountdown(i.due_date)}</Td>
                <Td className="tabular-nums">{money(i.outstanding)}</Td>
                <Td>{agingBucket(i.due_date)}</Td>
                <Td className="tabular-nums">{money(i.interest_loss || 0)}</Td>
                <Td>
                  <Badge tone={pay === "overdue" ? "bad" : pay === "partial" ? "warn" : "neutral"}>{payStatusLabel(pay)}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="text-sm text-primary hover:underline" onClick={() => startPay(i)}>
                      Receive
                    </button>
                    {Number(i.interest_loss || 0) > 0 && !i.penalty_waived && (
                      <button
                        type="button"
                        className="text-sm text-primary hover:underline"
                        onClick={() => {
                          const reason = window.prompt("Waiver reason (required, saved to audit)");
                          if (!reason || reason.trim().length < 8) {
                            setError("Waiver needs a reason of at least 8 characters");
                            return;
                          }
                          void api(`/api/v1/accounts/invoices/${i.id}/waive-penalty`, {
                            method: "POST",
                            companyId: i.company_id,
                            body: JSON.stringify({ reason: reason.trim() }),
                          })
                            .then(() => load())
                            .catch((e) => setError(e instanceof Error ? e.message : "Could not waive"));
                        }}
                      >
                        Waive
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
        {!filteredOpen.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            {open.length ? "No invoices match this view." : "No open outstanding. Receivables are closed."}
          </p>
        )}
      </Panel>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setDetail(null)} />
          <div className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{detail.number}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.customer_name || "Customer"} · {firmLabelByCompanyId(detail.company_id)}
                </p>
              </div>
              <Badge
                tone={
                  payStatus(detail) === "overdue"
                    ? "bad"
                    : payStatus(detail) === "partial"
                      ? "warn"
                      : payStatus(detail) === "paid"
                        ? "good"
                        : "neutral"
                }
              >
                {payStatusLabel(payStatus(detail))}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Invoice date</p>
                <p className="font-medium">{detail.invoice_date}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Due date</p>
                <p className="font-medium">{detail.due_date || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Countdown</p>
                <p className="font-medium">{dueCountdown(detail.due_date)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Ageing</p>
                <p className="font-medium">{agingBucket(detail.due_date)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Invoice total</p>
                <p className="font-medium tabular-nums">{money(detail.total)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Paid so far</p>
                <p className="font-medium tabular-nums">{money(detail.amount_paid ?? detailPaidTotal)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Outstanding</p>
                <p className="font-semibold tabular-nums">{money(detail.outstanding)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Cost of delay</p>
                <p className="font-medium tabular-nums">{money(detail.interest_loss || 0)}</p>
              </div>
              {detail.credit_days != null && (
                <div>
                  <p className="text-muted-foreground">Credit days</p>
                  <p className="font-medium">{detail.credit_days}</p>
                </div>
              )}
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold">Receipt history</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Each partial or full receipt with paid date
              </p>
              {detailReceipts.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Paid on</th>
                        <th className="py-2 pr-3 font-medium">Amount</th>
                        <th className="py-2 pr-3 font-medium">Mode</th>
                        <th className="py-2 font-medium">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailReceipts.map((p) => (
                        <tr key={p.id} className="border-b border-border/60">
                          <td className="py-2.5 pr-3 text-muted-foreground">{String(p.paid_at).slice(0, 10)}</td>
                          <td className="py-2.5 pr-3 font-medium tabular-nums">{money(p.amount)}</td>
                          <td className="py-2.5 pr-3">{payModeLabel(p.method)}</td>
                          <td className="py-2.5 text-muted-foreground">{p.reference || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="pt-3 pr-3 text-muted-foreground">Total received</td>
                        <td className="pt-3 pr-3 font-semibold tabular-nums">{money(detailPaidTotal)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No receipts yet on this invoice.</p>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground"
                onClick={() => {
                  startPay(detail);
                }}
              >
                Receive payment
              </button>
              <button type="button" onClick={() => setDetail(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {payFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setPayFor(null)} />
          <form
            onSubmit={(e) => void savePayment(e)}
            className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Receive payment</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {payFor.number} · {payFor.customer_name || "Customer"}
            </p>
            <p className="mt-2 text-sm">
              Outstanding <span className="font-semibold tabular-nums">{money(payFor.outstanding)}</span>
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={
                  payKind === "partial"
                    ? "rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground"
                    : "rounded-xl border border-border px-3 py-2.5 text-sm font-medium"
                }
                onClick={() => {
                  setPayKind("partial");
                  setForm((f) => ({ ...f, amount: "" }));
                }}
              >
                Partial
              </button>
              <button
                type="button"
                className={
                  payKind === "full"
                    ? "rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground"
                    : "rounded-xl border border-border px-3 py-2.5 text-sm font-medium"
                }
                onClick={() => {
                  setPayKind("full");
                  setForm((f) => ({ ...f, amount: String(Number(payFor.outstanding) || "") }));
                }}
              >
                Full settlement
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                {payKind === "partial" ? "Partial amount received *" : "Amount received *"}
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder={
                    payKind === "partial"
                      ? `e.g. ${Math.max(1, Math.round(Number(payFor.outstanding) / 4))}`
                      : String(Number(payFor.outstanding) || "")
                  }
                  className={inputCls}
                  value={form.amount}
                  readOnly={payKind === "full"}
                  onChange={(e) => {
                    setPayKind("partial");
                    setForm((f) => ({ ...f, amount: e.target.value }));
                  }}
                />
              </label>
              {payKind === "partial" && (
                <div className="flex flex-wrap gap-2">
                  {[0.25, 0.5, 0.75].map((frac) => {
                    const v = Math.round(Number(payFor.outstanding) * frac * 100) / 100;
                    if (!(v > 0) || v >= Number(payFor.outstanding)) return null;
                    return (
                      <button
                        key={frac}
                        type="button"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                        onClick={() => setForm((f) => ({ ...f, amount: String(v) }))}
                      >
                        {frac === 0.25 ? "25%" : frac === 0.5 ? "50%" : "75%"} · {money(v)}
                      </button>
                    );
                  })}
                </div>
              )}
              {Number(form.amount) > 0 && Number(form.amount) < Number(payFor.outstanding) && (
                <p className="rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm">
                  Invoice will stay <span className="font-medium">Partially paid</span>. Remaining{" "}
                  <span className="font-semibold tabular-nums">
                    {money(Math.max(0, Number(payFor.outstanding) - Number(form.amount)))}
                  </span>
                </p>
              )}
              <label className="block text-sm text-muted-foreground">
                Mode *
                <select
                  required
                  className={inputCls}
                  value={form.method}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
                >
                  <option value="">Select mode</option>
                  {PAY_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Reference *
                <input
                  required
                  className={inputCls}
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="UTR / cheque no."
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Paid on *
                <input
                  required
                  type="date"
                  className={inputCls}
                  value={form.paid_at}
                  onChange={(e) => setForm((f) => ({ ...f, paid_at: e.target.value }))}
                />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {busy
                  ? "Saving…"
                  : payKind === "partial" || (Number(form.amount) > 0 && Number(form.amount) < Number(payFor.outstanding))
                    ? "Receive partial"
                    : "Receive full"}
              </button>
              <button type="button" onClick={() => setPayFor(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
