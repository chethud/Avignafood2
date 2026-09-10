import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useCompany } from "@/lib/company-context";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Client accounts · Avighna ERP" },
      { name: "description", content: "Per-client billing: fulfilled orders, revenue and outstanding. Books remain in Tally Prime." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { id?: number } => {
    const raw = search.id;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? { id: n } : {};
  },
  component: Clients,
});

type ClientRow = {
  customer_id: number;
  customer_ids?: number[];
  company_id: number;
  company_ids?: number[];
  company_name?: string | null;
  name: string;
  gstin: string | null;
  phone: string | null;
  credit_days: number;
  credit_limit: string | number;
  orders_fulfilled: number;
  invoice_count: number;
  total_revenue: string | number;
  outstanding: string | number;
  paid?: string | number;
  overdue?: string | number;
};

type InvoiceRow = {
  id: number;
  number: string;
  company_id?: number;
  invoice_date: string;
  due_date?: string | null;
  total: string | number;
  outstanding: string | number;
  status: string;
};

type OrderRow = {
  id: number;
  company_id: number;
  company_name?: string | null;
  status: string;
  ops_status: string;
  created_at?: string | null;
  line_count: number;
  qty: number;
  value: number;
  notes?: string | null;
};

type PaymentRow = {
  id: number;
  invoice_id: number;
  invoice_number: string | null;
  amount: string | number;
  method: string;
  paid_at: string;
};

type Ledger = ClientRow & {
  address: string | null;
  invoices: InvoiceRow[];
  orders?: OrderRow[];
};

function Clients() {
  const { firm } = useCompany();
  const navigate = useNavigate();
  const { id: openId } = Route.useSearch();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [pays, setPays] = useState<PaymentRow[]>([]);
  const [error, setError] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    setError("");
    api<ClientRow[]>("/api/v1/invoices/clients")
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load clients"));
  }, [firm]);

  useEffect(() => {
    if (!openId) {
      setLedger(null);
      setPays([]);
      return;
    }
    setLoadingDetail(true);
    setError("");
    Promise.all([
      api<Ledger>(`/api/v1/invoices/clients/${openId}`),
      api<PaymentRow[]>("/api/v1/payments").catch(() => [] as PaymentRow[]),
    ])
      .then(([detail, allPay]) => {
        setLedger(detail);
        const ids = new Set(detail.invoices.map((i) => i.id));
        setPays(allPay.filter((p) => ids.has(p.invoice_id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not open client"))
      .finally(() => setLoadingDetail(false));
  }, [openId, firm]);

  const revenue = rows.reduce((a, r) => a + Number(r.total_revenue || 0), 0);
  const outstanding = rows.reduce((a, r) => a + Number(r.outstanding || 0), 0);
  const fulfilled = rows.reduce((a, r) => a + r.orders_fulfilled, 0);

  if (openId) {
    return (
      <>
        <div className="mb-4">
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => void navigate({ to: "/clients", search: {} })}
          >
            ← All customers
          </button>
        </div>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {loadingDetail && !ledger && <p className="text-sm text-muted-foreground">Loading…</p>}
        {ledger && (
          <>
            <PageHeader
              title={ledger.name}
              subtitle={[ledger.company_name, ledger.gstin, ledger.phone, ledger.address].filter(Boolean).join(" · ") || "Customer account"}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <Kpi label="Orders" value={String(ledger.orders?.length ?? ledger.orders_fulfilled)} />
              <Kpi label="Invoices" value={String(ledger.invoice_count)} />
              <Kpi label="Billed" value={money(ledger.total_revenue)} />
              <Kpi label="Outstanding" value={money(ledger.outstanding)} tone={Number(ledger.outstanding) > 0 ? "warn" : "good"} meta={`${money(ledger.overdue || 0)} overdue`} />
            </div>

            <Panel title="Orders" hint="All sales orders for this customer" className="mt-6">
              <Table head={["Order", "Company", "Status", "Ops", "Lines", "Qty", "Value", "Created"]}>
                {(ledger.orders || []).map((o) => (
                  <tr key={o.id}>
                    <Td className="font-medium">SO-{o.id}</Td>
                    <Td className="text-muted-foreground">{o.company_name || "—"}</Td>
                    <Td className="capitalize">{o.status.replaceAll("_", " ")}</Td>
                    <Td className="capitalize text-muted-foreground">{(o.ops_status || "—").replaceAll("_", " ")}</Td>
                    <Td className="tabular-nums">{o.line_count}</Td>
                    <Td className="tabular-nums">{Number(o.qty).toLocaleString("en-IN")}</Td>
                    <Td className="tabular-nums">{money(o.value)}</Td>
                    <Td className="text-muted-foreground text-xs">{o.created_at?.slice(0, 10) || "—"}</Td>
                  </tr>
                ))}
              </Table>
              {!(ledger.orders || []).length && (
                <p className="mt-3 text-sm text-muted-foreground">No sales orders for this customer.</p>
              )}
            </Panel>

            <Panel title="Invoices" hint="Raised bills" className="mt-6">
              <Table head={["Invoice", "Date", "Due", "Total", "Outstanding", "Status"]}>
                {ledger.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.number}</Td>
                    <Td>{i.invoice_date}</Td>
                    <Td className="text-muted-foreground">{i.due_date || "—"}</Td>
                    <Td className="tabular-nums">{money(i.total)}</Td>
                    <Td className="tabular-nums">{money(i.outstanding)}</Td>
                    <Td>
                      <Badge tone={i.status === "paid" ? "good" : Number(i.outstanding) > 0 ? "warn" : "neutral"}>
                        {i.status}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </Table>
              {!ledger.invoices.length && <p className="mt-3 text-sm text-muted-foreground">No invoices yet.</p>}
            </Panel>

            {pays.length > 0 && (
              <Panel title="Payments" className="mt-6">
                <Table head={["Invoice", "Method", "Date", "Amount"]}>
                  {pays.map((p) => (
                    <tr key={p.id}>
                      <Td>{p.invoice_number || `INV-${p.invoice_id}`}</Td>
                      <Td className="capitalize">{p.method}</Td>
                      <Td className="text-muted-foreground">{String(p.paid_at).slice(0, 10)}</Td>
                      <Td className="tabular-nums">{money(p.amount)}</Td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Customer accounts"
        subtitle="One row per customer. Same buyer across firms is combined when you are on All companies. Tap to see all their orders."
      />
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Clients" value={String(rows.length)} />
        <Kpi label="Orders fulfilled" value={String(fulfilled)} />
        <Kpi label="Revenue billed" value={money(revenue)} meta={`${money(outstanding)} outstanding`} tone="good" />
      </div>

      <Panel title="Customer financials" hint="Tap a row for full order history" className="mt-6">
        <Table head={["Customer", "Firms", "Limit", "Days", "Invoiced", "Paid", "Outstanding", "Overdue"]}>
          {rows.map((c) => (
            <tr
              key={c.customer_id}
              className="cursor-pointer hover:bg-secondary/50"
              onClick={() => void navigate({ to: "/clients", search: { id: c.customer_id } })}
            >
              <Td className="font-medium">{c.name}</Td>
              <Td className="text-muted-foreground text-xs">{c.company_name || "—"}</Td>
              <Td className="tabular-nums">{money(c.credit_limit)}</Td>
              <Td className="tabular-nums">{c.credit_days} d</Td>
              <Td className="tabular-nums">{money(c.total_revenue)}</Td>
              <Td className="tabular-nums">{money(c.paid || 0)}</Td>
              <Td className="tabular-nums">{money(c.outstanding)}</Td>
              <Td className="tabular-nums">{money(c.overdue || 0)}</Td>
            </tr>
          ))}
        </Table>
        {!rows.length && !error && <p className="mt-3 text-sm text-muted-foreground">No customers billed yet.</p>}
      </Panel>
    </>
  );
}
