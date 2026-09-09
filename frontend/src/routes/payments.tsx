import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useCompany } from "@/lib/company-context";
import { PAY_MODES, payModeLabel } from "@/lib/accounts";
import { Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [{ title: "Payments · Avighna ERP" }],
  }),
  component: Payments,
});

type InvoiceRow = {
  id: number;
  company_id: number;
  customer_id: number;
  number: string;
  customer_name: string | null;
  outstanding: string | number;
  status: string;
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
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

function Payments() {
  const { firm } = useCompany();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"invoice" | "allocate" | null>(null);
  const [form, setForm] = useState({
    invoice_id: "",
    customer_id: "",
    amount: "",
    method: "neft",
    reference: "",
    paid_at: new Date().toISOString().slice(0, 10),
  });

  const open = useMemo(
    () => invoices.filter((i) => i.status === "open" || i.status === "partial"),
    [invoices],
  );
  const customers = useMemo(() => {
    const map = new Map<number, string>();
    for (const i of open) map.set(i.customer_id, i.customer_name || `Customer ${i.customer_id}`);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [open]);

  async function load() {
    try {
      const [inv, pay] = await Promise.all([
        api<InvoiceRow[]>("/api/v1/invoices"),
        api<PaymentRow[]>("/api/v1/payments"),
      ]);
      setInvoices(inv);
      setRows(pay);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payments");
    }
  }

  useEffect(() => {
    void load();
  }, [firm]);

  const collected = rows.reduce((a, p) => a + Number(p.amount || 0), 0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayAmt = rows.filter((p) => p.paid_at === todayIso).reduce((a, p) => a + Number(p.amount || 0), 0);

  async function saveInvoicePay(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    const inv = open.find((i) => String(i.id) === form.invoice_id);
    if (!(amount > 0) || !inv) {
      setError("Choose an invoice and enter a positive amount");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/payments", {
        method: "POST",
        companyId: inv.company_id,
        body: JSON.stringify({
          invoice_id: inv.id,
          amount,
          method: form.method,
          reference: form.reference.trim() || null,
          paid_at: form.paid_at || null,
        }),
      });
      setMode(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment");
    } finally {
      setBusy(false);
    }
  }

  async function saveAllocate(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    const sample = open.find((i) => String(i.customer_id) === form.customer_id);
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
          method: form.method,
          reference: form.reference.trim() || null,
          paid_at: form.paid_at || null,
        }),
      });
      setMode(null);
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
        title="Payments"
        subtitle="Record receipts (NEFT, UPI, cheque, cash, adjustment) and allocate them to invoices. The original invoice amount is never overwritten."
        action={
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              onClick={() => {
                setError("");
                setForm((f) => ({
                  ...f,
                  invoice_id: open[0] ? String(open[0].id) : "",
                  amount: open[0] ? String(open[0].outstanding) : "",
                  method: "neft",
                  reference: "",
                  paid_at: todayIso,
                }));
                setMode("invoice");
              }}
            >
              Record payment
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => {
                setError("");
                setForm((f) => ({
                  ...f,
                  customer_id: customers[0] ? String(customers[0].id) : "",
                  amount: "",
                  method: "neft",
                  reference: "",
                  paid_at: todayIso,
                }));
                setMode("allocate");
              }}
            >
              Allocate
            </button>
          </div>
        }
      />
      {error && !mode && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Today" value={money(todayAmt)} />
        <Kpi label="All receipts" value={money(collected)} meta={`${rows.length} entries`} />
        <Kpi label="Open invoices" value={String(open.length)} tone={open.length ? "warn" : "good"} />
      </div>

      <Panel title="Payment register" hint="Invoice ↔ payment linkage" className="mt-6">
        <Table head={["Date", "Customer", "Invoice", "Amount", "Mode", "Reference"]}>
          {rows.map((p) => (
            <tr key={p.id}>
              <Td className="text-muted-foreground">{p.paid_at}</Td>
              <Td>{p.customer_name || "—"}</Td>
              <Td className="font-medium">{p.invoice_number || `#${p.invoice_id}`}</Td>
              <Td className="tabular-nums">{money(p.amount)}</Td>
              <Td>{payModeLabel(p.method)}</Td>
              <Td className="text-muted-foreground">{p.reference || "—"}</Td>
            </tr>
          ))}
        </Table>
        {!rows.length && <p className="mt-3 text-sm text-muted-foreground">No payments recorded yet.</p>}
      </Panel>

      {mode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setMode(null)} />
          <form
            onSubmit={(e) => void (mode === "allocate" ? saveAllocate(e) : saveInvoicePay(e))}
            className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">{mode === "allocate" ? "Allocate payment" : "Record payment"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "allocate" ? "FIFO across the customer’s open invoices." : "Apply to one invoice. Partial receipts stay partially paid."}
            </p>
            <div className="mt-4 space-y-3">
              {mode === "allocate" ? (
                <label className="block text-sm text-muted-foreground">
                  Customer
                  <select
                    required
                    className={inputCls}
                    value={form.customer_id}
                    onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-sm text-muted-foreground">
                  Invoice
                  <select
                    required
                    className={inputCls}
                    value={form.invoice_id}
                    onChange={(e) => {
                      const inv = open.find((i) => String(i.id) === e.target.value);
                      setForm((f) => ({
                        ...f,
                        invoice_id: e.target.value,
                        amount: inv ? String(inv.outstanding) : f.amount,
                      }));
                    }}
                  >
                    <option value="">Select</option>
                    {open.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.number} · {i.customer_name} · {money(i.outstanding)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Reference
                <input
                  className={inputCls}
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="NEFT123456 / UTR / cheque no."
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Date
                <input type="date" className={inputCls} value={form.paid_at} onChange={(e) => setForm((f) => ({ ...f, paid_at: e.target.value }))} />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setMode(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
