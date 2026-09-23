import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useCompany } from "@/lib/company-context";
import { downloadCsv } from "@/lib/accounts";
import { PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [{ title: "Accounts reports · Avighna ERP" }],
  }),
  component: Reports,
});

type InvoiceRow = {
  id: number;
  number: string;
  customer_name: string | null;
  invoice_date: string;
  due_date: string | null;
  status: string;
  subtotal: string | number;
  tax_amount: string | number;
  cgst?: string | number;
  sgst?: string | number;
  total: string | number;
  outstanding: string | number;
  interest_loss?: string | number;
};

type PaymentRow = {
  id: number;
  paid_at: string;
  invoice_number: string | null;
  customer_name: string | null;
  amount: string | number;
  method: string;
};

function Reports() {
  const { firm } = useCompany();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [tab, setTab] = useState<"invoices" | "payments" | "delay">("invoices");
  const [invQ, setInvQ] = useState("");
  const [invStatus, setInvStatus] = useState("all");
  const [invPeriod, setInvPeriod] = useState("all");

  useEffect(() => {
    api<InvoiceRow[]>("/api/v1/invoices").then(setInvoices).catch(() => setInvoices([]));
    api<PaymentRow[]>("/api/v1/payments").then(setPayments).catch(() => setPayments([]));
  }, [firm]);

  const monthPrefix = new Date().toISOString().slice(0, 7);

  const invoicesVisible = useMemo(() => {
    const needle = invQ.trim().toLowerCase();
    return invoices.filter((i) => {
      if (invStatus !== "all" && i.status !== invStatus) return false;
      if (invPeriod === "month" && !String(i.invoice_date).startsWith(monthPrefix)) return false;
      if (invPeriod === "open" && !(i.status === "open" || i.status === "partial")) return false;
      if (invPeriod === "outstanding" && !(Number(i.outstanding) > 0)) return false;
      if (!needle) return true;
      return `${i.number} ${i.customer_name || ""} ${i.status} ${i.invoice_date}`.toLowerCase().includes(needle);
    });
  }, [invoices, invQ, invStatus, invPeriod, monthPrefix]);

  const invFiltersActive = Boolean(invQ.trim()) || invStatus !== "all" || invPeriod !== "all";

  function clearInvFilters() {
    setInvQ("");
    setInvStatus("all");
    setInvPeriod("all");
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Invoice register, collections and cost of delay. Company-scoped."
        action={
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm"
            onClick={() => {
              if (tab === "invoices") {
                downloadCsv("invoices.csv", [
                  ["Invoice", "Date", "Customer", "Total", "Outstanding", "Status"],
                  ...invoicesVisible.map((i) => [i.number, i.invoice_date, i.customer_name || "", i.total, i.outstanding, i.status]),
                ]);
              } else if (tab === "payments") {
                downloadCsv("payments.csv", [
                  ["Date", "Invoice", "Customer", "Amount", "Mode"],
                  ...payments.map((p) => [p.paid_at, p.invoice_number || "", p.customer_name || "", p.amount, p.method]),
                ]);
              } else {
                downloadCsv("cost-of-delay.csv", [
                  ["Invoice", "Customer", "Due", "Outstanding", "Cost of delay"],
                  ...invoices
                    .filter((i) => Number(i.interest_loss || 0) > 0)
                    .map((i) => [i.number, i.customer_name || "", i.due_date || "", i.outstanding, i.interest_loss || 0]),
                ]);
              }
            }}
          >
            Export Excel
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["invoices", "Invoice register"],
            ["payments", "Collections"],
            ["delay", "Cost of delay"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-xl border px-3 py-2 text-sm ${tab === t ? "border-primary bg-primary/10 font-medium" : "border-border"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "delay" && (
        <Panel title="Cost of delay" hint="18% p.a. default policy. Owner configures formula; Accounts cannot silently clear a penalty.">
          <Table head={["Invoice", "Customer", "Due", "Outstanding", "Cost of delay"]}>
            {invoices
              .filter((i) => Number(i.interest_loss || 0) > 0)
              .map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.number}</Td>
                  <Td>{i.customer_name}</Td>
                  <Td className="text-muted-foreground">{i.due_date || "—"}</Td>
                  <Td className="tabular-nums">{money(i.outstanding)}</Td>
                  <Td className="tabular-nums">{money(i.interest_loss || 0)}</Td>
                </tr>
              ))}
          </Table>
          {!invoices.some((i) => Number(i.interest_loss || 0) > 0) && (
            <p className="mt-3 text-sm text-muted-foreground">No overdue interest this period.</p>
          )}
        </Panel>
      )}

      {tab === "invoices" && (
        <Panel
          title="GST invoice register"
          hint={invFiltersActive ? `Showing ${invoicesVisible.length} of ${invoices.length}` : undefined}
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
              placeholder="Search invoice or customer"
              value={invQ}
              onChange={(e) => setInvQ(e.target.value)}
            />
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={invStatus}
              onChange={(e) => setInvStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={invPeriod}
              onChange={(e) => setInvPeriod(e.target.value)}
            >
              <option value="all">All invoices</option>
              <option value="month">This month</option>
              <option value="outstanding">Has outstanding</option>
              <option value="open">Open / partial</option>
            </select>
          </div>
          <div className="mb-3">
            {invFiltersActive ? (
              <button type="button" className="text-sm text-primary hover:underline" onClick={clearInvFilters}>
                Clear filters
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">{invoices.length} invoice(s)</span>
            )}
          </div>
          <Table head={["Invoice", "Date", "Customer", "Taxable", "CGST", "SGST", "Total", "Outstanding", "Status"]}>
            {invoicesVisible.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.number}</Td>
                <Td className="text-muted-foreground">{i.invoice_date}</Td>
                <Td>{i.customer_name}</Td>
                <Td className="tabular-nums">{money(i.subtotal)}</Td>
                <Td className="tabular-nums">{money(i.cgst || 0)}</Td>
                <Td className="tabular-nums">{money(i.sgst || 0)}</Td>
                <Td className="tabular-nums">{money(i.total)}</Td>
                <Td className="tabular-nums">{money(i.outstanding)}</Td>
                <Td className="capitalize">{i.status}</Td>
              </tr>
            ))}
          </Table>
          {!invoicesVisible.length && (
            <p className="mt-3 text-sm text-muted-foreground">
              {invoices.length ? "No invoices match this view." : "No invoices yet."}
            </p>
          )}
        </Panel>
      )}

      {tab === "payments" && (
        <Panel title="Payment register">
          <Table head={["Date", "Invoice", "Customer", "Amount", "Mode"]}>
            {payments.map((p) => (
              <tr key={p.id}>
                <Td className="text-muted-foreground">{p.paid_at}</Td>
                <Td className="font-medium">{p.invoice_number}</Td>
                <Td>{p.customer_name}</Td>
                <Td className="tabular-nums">{money(p.amount)}</Td>
                <Td className="capitalize">{p.method}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </>
  );
}
