import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { inr } from "@/lib/erp-data";
import { telHref, waHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/me-context";

export const Route = createFileRoute("/collection")({
  head: () => ({
    meta: [{ title: "Pending Collection · Avighna" }],
  }),
  component: Collection,
});

type Invoice = {
  id: number;
  customer_id: number;
  customer_name: string | null;
  number: string;
  due_date: string | null;
  outstanding: string | number;
  status: string;
};

type Customer = { id: number; name: string; phone: string | null };

type FollowUp = { id: number; promised_date: string | null; notes: string | null; created_at: string };

type Age = "all" | "0-30" | "31-60" | "61+";

function daysOverdue(due: string | null) {
  if (!due) return 0;
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

function Collection() {
  const { me } = useMe();
  const isAccounts = me?.user.role === "accountant";
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [age, setAge] = useState<Age>("all");
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [picked, setPicked] = useState<Invoice | null>(null);
  const [follows, setFollows] = useState<FollowUp[]>([]);
  const [promised, setPromised] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const [inv, cust] = await Promise.all([
      api<Invoice[]>("/api/v1/invoices").catch(() => [] as Invoice[]),
      api<Customer[]>("/api/v1/customers").catch(() => [] as Customer[]),
    ]);
    setInvoices(inv.filter((i) => Number(i.outstanding) > 0 && i.status !== "cancelled" && i.status !== "paid"));
    setCustomers(cust);
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return invoices.filter((i) => {
      const days = daysOverdue(i.due_date);
      if (age === "0-30" && !(days <= 30)) return false;
      if (age === "31-60" && !(days >= 31 && days <= 60)) return false;
      if (age === "61+" && !(days >= 61)) return false;
      if (statusF === "overdue" && !(days > 0)) return false;
      if (statusF === "current" && days > 0) return false;
      if (statusF === "partial" && i.status !== "partial") return false;
      if (!needle) return true;
      return `${i.customer_name || ""} ${i.number} ${i.outstanding}`.toLowerCase().includes(needle);
    });
  }, [invoices, age, q, statusF]);

  const filtersActive = Boolean(q.trim()) || age !== "all" || statusF !== "all";

  function clearFilters() {
    setQ("");
    setAge("all");
    setStatusF("all");
  }

  const total = rows.reduce((s, i) => s + Number(i.outstanding), 0);
  const overdue = rows.filter((i) => daysOverdue(i.due_date) > 0).reduce((s, i) => s + Number(i.outstanding), 0);

  async function openDetail(inv: Invoice) {
    setPicked(inv);
    setError("");
    setPromised("");
    setRemark("");
    const list = await api<FollowUp[]>(`/api/v1/customers/${inv.customer_id}/collection-follow-ups`).catch(() => [] as FollowUp[]);
    setFollows(list);
  }

  async function saveFollowUp() {
    if (!picked) return;
    setError("");
    try {
      await api(`/api/v1/customers/${picked.customer_id}/collection-follow-ups`, {
        method: "POST",
        body: JSON.stringify({
          invoice_id: picked.id,
          promised_date: promised || null,
          notes: remark || null,
        }),
      });
      setPromised("");
      setRemark("");
      const list = await api<FollowUp[]>(`/api/v1/customers/${picked.customer_id}/collection-follow-ups`);
      setFollows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save follow-up");
    }
  }

  const phone = customers.find((c) => c.id === picked?.customer_id)?.phone || "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{isAccounts ? "Collections" : "Pending Collection"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Outstanding from clients. Accounts books the payment.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-border bg-card px-3 py-3">
          <p className="text-xs text-muted-foreground">Total outstanding</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{inr(total)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-3 py-3">
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-destructive">{inr(overdue)}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm sm:col-span-2"
          placeholder="Search customer or invoice"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={statusF}
          onChange={(e) => setStatusF(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="current">Current</option>
          <option value="overdue">Overdue</option>
          <option value="partial">Partially paid</option>
        </select>
        <select
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          value={age}
          onChange={(e) => setAge(e.target.value as Age)}
        >
          <option value="all">All ageing</option>
          <option value="0-30">0–30 days</option>
          <option value="31-60">31–60 days</option>
          <option value="61+">61+ days</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {(
            [
              ["all", "All"],
              ["0-30", "0-30 days"],
              ["31-60", "31-60 days"],
              ["61+", "61+ days"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAge(id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-sm",
                age === id ? "bg-primary text-primary-foreground" : "border border-border",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {filtersActive && (
          <button type="button" className="text-sm text-primary hover:underline" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {rows.map((i) => {
          const days = daysOverdue(i.due_date);
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => void openDetail(i)}
                className="flex w-full items-start justify-between rounded-2xl border border-border bg-card px-3 py-3 text-left"
              >
                <span>
                  <span className="block font-medium">{i.customer_name || `Customer ${i.customer_id}`}</span>
                  <span className="text-xs text-muted-foreground">{i.number}</span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums font-semibold">{inr(Number(i.outstanding))}</span>
                  <span className={cn("text-xs", days > 30 ? "text-destructive" : days > 0 ? "text-warning" : "text-muted-foreground")}>
                    {days > 0 ? `${days} days overdue` : "Current"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!rows.length && (
          <li className="py-8 text-center text-sm text-muted-foreground">
            {invoices.length ? "No collections match this view." : "No open collections."}
          </li>
        )}
      </ul>

      {picked && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setPicked(null)} />
          <div className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl">
            <h2 className="text-lg font-semibold">{picked.customer_name}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Outstanding</dt>
                <dd className="font-medium tabular-nums">{inr(Number(picked.outstanding))}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Invoice</dt>
                <dd>{picked.number}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Due date</dt>
                <dd>{picked.due_date || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Days overdue</dt>
                <dd>{Math.max(0, daysOverdue(picked.due_date))}</dd>
              </div>
            </dl>
            {phone && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <a href={telHref(phone)} className="rounded-xl border border-border py-2.5 text-center text-sm">
                  Call
                </a>
                <a href={waHref(phone)} target="_blank" rel="noreferrer" className="rounded-xl border border-border py-2.5 text-center text-sm">
                  WhatsApp
                </a>
              </div>
            )}
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Collection follow-up</p>
              <label className="block text-xs text-muted-foreground">
                Customer promised payment
                <input type="date" className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm" value={promised} onChange={(e) => setPromised(e.target.value)} />
              </label>
              <textarea
                className="w-full rounded-xl border border-border px-3 py-2 text-sm"
                rows={2}
                placeholder="Remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
              <button type="button" onClick={() => void saveFollowUp()} className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground">
                Add follow-up
              </button>
            </div>
            {follows.length > 0 && (
              <ul className="mt-3 space-y-2 text-sm">
                {follows.map((f) => (
                  <li key={f.id} className="rounded-xl bg-secondary/50 px-3 py-2">
                    {f.promised_date ? `Promised ${f.promised_date}` : "Follow-up"}
                    {f.notes ? ` · ${f.notes}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <button type="button" onClick={() => setPicked(null)} className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
