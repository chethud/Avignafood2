import { createFileRoute, Link } from "@tanstack/react-router";
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

function Payments() {
  const { firm } = useCompany();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [modeF, setModeF] = useState("all");
  const [periodF, setPeriodF] = useState("all");
  const [customerF, setCustomerF] = useState("all");

  async function load() {
    try {
      const pay = await api<PaymentRow[]>("/api/v1/payments");
      setRows(pay);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payments");
    }
  }

  useEffect(() => {
    void load();
  }, [firm]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const monthPrefix = todayIso.slice(0, 7);

  const customers = useMemo(() => {
    const names = [...new Set(rows.map((p) => p.customer_name || "").filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    return names;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (modeF !== "all" && p.method !== modeF) return false;
      if (periodF === "today" && String(p.paid_at).slice(0, 10) !== todayIso) return false;
      if (periodF === "month" && !String(p.paid_at).startsWith(monthPrefix)) return false;
      if (customerF !== "all" && (p.customer_name || "") !== customerF) return false;
      if (!needle) return true;
      return `${p.paid_at} ${p.customer_name || ""} ${p.invoice_number || ""} ${p.invoice_id} ${p.method} ${p.reference || ""} ${p.amount}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, modeF, periodF, customerF, todayIso, monthPrefix]);

  const filtersActive = Boolean(q.trim()) || modeF !== "all" || periodF !== "all" || customerF !== "all";

  const collected = rows.reduce((a, p) => a + Number(p.amount || 0), 0);
  const todayAmt = rows.filter((p) => String(p.paid_at).slice(0, 10) === todayIso).reduce((a, p) => a + Number(p.amount || 0), 0);
  const filteredAmt = visible.reduce((a, p) => a + Number(p.amount || 0), 0);

  function clearFilters() {
    setQ("");
    setModeF("all");
    setPeriodF("all");
    setCustomerF("all");
  }

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="All receipts recorded against invoices. To collect or allocate against outstanding, use Receivables."
        action={
          <Link to="/receivables" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
            Open receivables
          </Link>
        }
      />
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Today" value={money(todayAmt)} />
        <Kpi label="All receipts" value={money(collected)} meta={`${rows.length} entries`} />
        <Kpi label="Register" value="View only" meta="Update on Receivables" />
      </div>

      <Panel
        title="Payment register"
        hint={
          filtersActive
            ? `Showing ${visible.length} of ${rows.length} · ${money(filteredAmt)}`
            : "Every received payment · newest first"
        }
        className="mt-6"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2 lg:col-span-2"
            placeholder="Search customer, invoice, reference, amount"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={periodF}
            onChange={(e) => setPeriodF(e.target.value)}
          >
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="month">This month</option>
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={modeF}
            onChange={(e) => setModeF(e.target.value)}
          >
            <option value="all">All modes</option>
            {PAY_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            value={customerF}
            onChange={(e) => setCustomerF(e.target.value)}
          >
            <option value="all">All customers</option>
            {customers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {filtersActive ? (
            <button type="button" className="text-sm text-primary hover:underline" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <span className="text-sm text-muted-foreground">{rows.length} receipt(s)</span>
          )}
        </div>
        <Table head={["Date", "Customer", "Invoice", "Amount", "Mode", "Reference"]}>
          {visible.map((p) => (
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
        {!visible.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            {rows.length ? "No payments match this view." : "No payments recorded yet."}
          </p>
        )}
      </Panel>
    </>
  );
}
