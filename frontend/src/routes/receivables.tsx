import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useCompany } from "@/lib/company-context";
import { PAY_MODES, agingBucket, dueCountdown, payStatus, payStatusLabel } from "@/lib/accounts";
import { firmLabelByCompanyId } from "@/lib/erp-data";
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
  outstanding: string | number;
  credit_days: number | null;
  delay_days?: number;
  interest_loss?: string | number;
  penalty_waived?: boolean;
};

type AgingRow = {
  customer_id: number;
  customer_name: string;
  current: string | number;
  d1_30: string | number;
  d31_60: string | number;
  d61_90: string | number;
  d90_plus: string | number;
  total: string | number;
};

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function Receivables() {
  const { firm } = useCompany();
  const { overdue: overdueParam, bucket, focus } = Route.useSearch();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [error, setError] = useState("");
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const [alloc, setAlloc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ amount: "", method: "bank", reference: "", paid_at: "" });
  const [allocForm, setAllocForm] = useState({ customer_id: "", amount: "", method: "bank", reference: "", paid_at: "" });

  async function load() {
    try {
      const [inv, age] = await Promise.all([
        api<InvoiceRow[]>("/api/v1/invoices"),
        api<AgingRow[]>("/api/v1/accounts/aging").catch(() => [] as AgingRow[]),
      ]);
      setRows(inv);
      setAging(age);
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
    return list;
  }, [open, overdueParam, bucket, focus]);

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
    setForm({
      amount: String(Number(i.outstanding) || ""),
      method: "neft",
      reference: "",
      paid_at: new Date().toISOString().slice(0, 10),
    });
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payFor) return;
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setError("Enter a positive amount");
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
          reference: form.reference.trim() || null,
          paid_at: form.paid_at || null,
        }),
      });
      setPayFor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
    } finally {
      setBusy(false);
    }
  }

  const customers = useMemo(() => {
    const map = new Map<number, string>();
    for (const i of open) {
      if (i.customer_id) map.set(i.customer_id, i.customer_name || `Customer ${i.customer_id}`);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [open]);

  async function saveAllocate(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(allocForm.amount);
    const sample = open.find((i) => String(i.customer_id) === allocForm.customer_id);
    if (!(amount > 0) || !sample) {
      setError("Choose a customer and enter a positive amount");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/accounts/allocate", {
        method: "POST",
        companyId: sample.company_id,
        body: JSON.stringify({
          customer_id: sample.customer_id,
          amount,
          method: allocForm.method,
          reference: allocForm.reference.trim() || null,
          paid_at: allocForm.paid_at || null,
        }),
      });
      setAlloc(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not allocate payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Receivables"
        subtitle="Open invoice register: due date, days to due, days overdue, ageing and cost of delay."
        action={
          <Link to="/payments" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Record payment
          </Link>
        }
      />
      {error && !payFor && !alloc && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {focus === "credit" && (
        <p className="mb-3 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
          Credit alerts — review ageing totals below and customers with high outstanding vs limit on Collection.
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
          overdueParam === "1" || bucket || focus
            ? `Filtered · ${filteredOpen.length} of ${open.length} open`
            : "Due countdown is automatic from the customer’s credit days"
        }
        className="mt-6"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {(overdueParam === "1" || bucket || focus) && (
            <Link to="/receivables" search={{}} className="text-sm text-primary hover:underline">
              Clear filter
            </Link>
          )}
          <button
            type="button"
            className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              setError("");
              setAllocForm({
                customer_id: customers[0] ? String(customers[0].id) : "",
                amount: "",
                method: "neft",
                reference: "",
                paid_at: new Date().toISOString().slice(0, 10),
              });
              setAlloc(true);
            }}
          >
            Allocate payment
          </button>
        </div>
        <Table head={["Company", "Customer", "Invoice", "Due", "Countdown", "Outstanding", "Ageing", "Cost of delay", "Status", ""]}>
          {filteredOpen.map((i) => {
            const pay = payStatus(i);
            return (
              <tr key={i.id}>
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
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="text-sm text-primary hover:underline" onClick={() => startPay(i)}>
                      Payment
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

      <Panel title="Aging" hint="Current · 1–30 · 31–60 · 61–90 · 90+" className="mt-6">
        <Table head={["Customer", "Current", "1–30", "31–60", "61–90", "90+", "Total"]}>
          {aging.map((r) => (
            <tr key={r.customer_id}>
              <Td className="font-medium">{r.customer_name}</Td>
              <Td className="tabular-nums">{money(r.current)}</Td>
              <Td className="tabular-nums">{money(r.d1_30)}</Td>
              <Td className="tabular-nums">{money(r.d31_60)}</Td>
              <Td className="tabular-nums">{money(r.d61_90)}</Td>
              <Td className="tabular-nums">{money(r.d90_plus)}</Td>
              <Td className="tabular-nums font-medium">{money(r.total)}</Td>
            </tr>
          ))}
        </Table>
        {!aging.length && <p className="mt-3 text-sm text-muted-foreground">No aging buckets yet.</p>}
      </Panel>

      {payFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setPayFor(null)} />
          <form
            onSubmit={(e) => void savePayment(e)}
            className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Record payment</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {payFor.number} · {payFor.customer_name || "Customer"} · due {money(payFor.outstanding)}
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                Amount
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputCls}
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Mode
                <select className={inputCls} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  {PAY_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Reference
                <input className={inputCls} value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no." />
              </label>
              <label className="block text-sm text-muted-foreground">
                Paid on
                <input type="date" className={inputCls} value={form.paid_at} onChange={(e) => setForm((f) => ({ ...f, paid_at: e.target.value }))} />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {busy ? "Saving…" : "Save payment"}
              </button>
              <button type="button" onClick={() => setPayFor(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {alloc && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setAlloc(false)} />
          <form
            onSubmit={(e) => void saveAllocate(e)}
            className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Allocate payment</h2>
            <p className="mt-1 text-sm text-muted-foreground">FIFO across the customer’s open invoices.</p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                Customer
                <select
                  required
                  className={inputCls}
                  value={allocForm.customer_id}
                  onChange={(e) => setAllocForm((f) => ({ ...f, customer_id: e.target.value }))}
                >
                  <option value="">Select</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Amount
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputCls}
                  value={allocForm.amount}
                  onChange={(e) => setAllocForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Mode
                <select className={inputCls} value={allocForm.method} onChange={(e) => setAllocForm((f) => ({ ...f, method: e.target.value }))}>
                  {PAY_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Reference
                <input className={inputCls} value={allocForm.reference} onChange={(e) => setAllocForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no." />
              </label>
              <label className="block text-sm text-muted-foreground">
                Paid on
                <input type="date" className={inputCls} value={allocForm.paid_at} onChange={(e) => setAllocForm((f) => ({ ...f, paid_at: e.target.value }))} />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {busy ? "Saving…" : "Allocate"}
              </button>
              <button type="button" onClick={() => setAlloc(false)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
