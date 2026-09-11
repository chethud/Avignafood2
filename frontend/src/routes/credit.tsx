import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/credit")({
  head: () => ({
    meta: [{ title: "Credit control · Avighna ERP" }],
  }),
  component: CreditControl,
});

type CreditRow = {
  customer_id: number;
  customer_name: string;
  credit_limit: string | number;
  credit_days: number;
  outstanding: string | number;
  overdue: string | number;
  headroom: string | number;
  status: string;
};

type InvoiceRow = {
  id: number;
  number: string;
  customer_name: string | null;
  outstanding: string | number;
  status: string;
};

type NoteRow = {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  kind: string;
  amount: string | number;
  reason: string;
  status: string;
};

const REASONS = {
  credit: ["Returned goods", "Pricing adjustment", "Approved discount", "Billing correction"],
  debit: ["Freight", "Interest", "Shortage claim reversed", "Billing correction"],
};

function CreditControl() {
  const [rows, setRows] = useState<CreditRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ invoice_id: "", kind: "credit" as "credit" | "debit", amount: "", reason: REASONS.credit[0] });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [balanceF, setBalanceF] = useState("all");

  async function load() {
    try {
      const [c, inv, n] = await Promise.all([
        api<CreditRow[]>("/api/v1/accounts/credit"),
        api<InvoiceRow[]>("/api/v1/invoices"),
        api<NoteRow[]>("/api/v1/accounts/notes"),
      ]);
      setRows(c);
      setInvoices(inv.filter((i) => i.status === "open" || i.status === "partial"));
      setNotes(n);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load credit control");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function postNote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/accounts/notes", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: Number(form.invoice_id),
          kind: form.kind,
          amount: Number(form.amount),
          reason: form.reason,
        }),
      });
      setForm((f) => ({ ...f, amount: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post note");
    } finally {
      setBusy(false);
    }
  }

  const alerts = rows.filter((r) => r.status !== "within");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusF !== "all" && r.status !== statusF) return false;
      if (balanceF === "outstanding" && !(Number(r.outstanding) > 0)) return false;
      if (balanceF === "overdue" && !(Number(r.overdue) > 0)) return false;
      if (balanceF === "headroom" && !(Number(r.headroom) > 0)) return false;
      if (!needle) return true;
      return `${r.customer_name} ${r.status}`.toLowerCase().includes(needle);
    });
  }, [rows, q, statusF, balanceF]);

  const filtersActive = Boolean(q.trim()) || statusF !== "all" || balanceF !== "all";

  function clearFilters() {
    setQ("");
    setStatusF("all");
    setBalanceF("all");
  }

  return (
    <>
      <PageHeader
        title="Credit control"
        subtitle="Limits, days and credit/debit notes. Accounts adjusts receivables — warehouse handles stock."
      />
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Customers" value={String(rows.length)} />
        <Kpi label="Limit alerts" value={String(alerts.length)} tone={alerts.length ? "bad" : "good"} />
        <Kpi label="Notes posted" value={String(notes.length)} />
      </div>

      <Panel
        title="Credit position"
        hint={filtersActive ? `Showing ${visible.length} of ${rows.length}` : "Projected exposure vs limit"}
        className="mt-6"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
            placeholder="Search customer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={statusF}
            onChange={(e) => setStatusF(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="within">Within limit</option>
            <option value="warning">Watch</option>
            <option value="exceeded">Exceeded</option>
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={balanceF}
            onChange={(e) => setBalanceF(e.target.value)}
          >
            <option value="all">All balances</option>
            <option value="outstanding">Has outstanding</option>
            <option value="overdue">Has overdue</option>
            <option value="headroom">Has headroom</option>
          </select>
        </div>
        <div className="mb-3">
          {filtersActive ? (
            <button type="button" className="text-sm text-primary hover:underline" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">{rows.length} customer(s)</span>
          )}
        </div>
        <Table head={["Customer", "Limit", "Days", "Outstanding", "Overdue", "Headroom", "Status"]}>
          {visible.map((r) => (
            <tr key={r.customer_id}>
              <Td className="font-medium">{r.customer_name}</Td>
              <Td className="tabular-nums">{money(r.credit_limit)}</Td>
              <Td className="tabular-nums">{r.credit_days} d</Td>
              <Td className="tabular-nums">{money(r.outstanding)}</Td>
              <Td className="tabular-nums">{money(r.overdue)}</Td>
              <Td className="tabular-nums">{money(r.headroom)}</Td>
              <Td>
                <Badge tone={r.status === "exceeded" ? "bad" : r.status === "warning" ? "warn" : "good"}>
                  {r.status === "exceeded" ? "Exceeded" : r.status === "warning" ? "Watch" : "Within limit"}
                </Badge>
              </Td>
            </tr>
          ))}
        </Table>
        {!visible.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            {rows.length ? "No customers match this view." : "No credit positions yet."}
          </p>
        )}
      </Panel>

      <Panel title="Credit / debit note" hint="Posted notes adjust outstanding. They do not change warehouse stock." className="mt-6">
        <form onSubmit={(e) => void postNote(e)} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm text-muted-foreground">
            Invoice
            <select
              required
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={form.invoice_id}
              onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}
            >
              <option value="">Select</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {i.customer_name} · {money(i.outstanding)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            Type
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  kind: e.target.value as "credit" | "debit",
                  reason: REASONS[e.target.value as "credit" | "debit"][0],
                }))
              }
            >
              <option value="credit">Credit note</option>
              <option value="debit">Debit note</option>
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            Reason
            <select
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            >
              {REASONS[form.kind].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-muted-foreground">
            Amount
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className={cn("mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60")}
          >
            {busy ? "Posting…" : "Post note"}
          </button>
        </form>
        <Table head={["Type", "Invoice", "Amount", "Reason", "Status"]}>
          {notes.map((n) => (
            <tr key={n.id}>
              <Td className="capitalize">{n.kind}</Td>
              <Td className="font-medium">{n.invoice_number || n.invoice_id}</Td>
              <Td className="tabular-nums">{money(n.amount)}</Td>
              <Td>{n.reason}</Td>
              <Td>
                <Badge tone="good">{n.status}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
        {!notes.length && <p className="mt-3 text-sm text-muted-foreground">No credit or debit notes yet.</p>}
      </Panel>
    </>
  );
}
