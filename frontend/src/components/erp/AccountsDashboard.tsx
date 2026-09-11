import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { useCompany } from "@/lib/company-context";
import { greeting, money } from "@/lib/format";
import { Badge, PageHeader, Panel } from "@/components/erp/ui-bits";

type AccountsDash = {
  today_collections: string;
  month_collections: string;
  total_receivables: string;
  total_overdue: string;
  due_today: string;
  due_this_week: string;
  unpaid_invoices: number;
  partial_invoices: number;
  overdue_invoices: number;
  credit_exposure: string;
  active_customers: number;
  invoice_count: number;
  pending_payments: number;
  credit_alerts: number;
  today_invoices?: number;
  today_billing?: string;
  due_soon?: string;
  cost_of_delay?: string;
  ready_to_invoice?: number;
};

const rowCls =
  "flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/50";

export function AccountsDashboard() {
  const [data, setData] = useState<AccountsDash | null>(null);
  const [error, setError] = useState("");
  const { me } = useMe();
  const { firm } = useCompany();
  const name = me?.user.full_name?.split(" ")[0] || "Accounts";

  useEffect(() => {
    api<AccountsDash>("/api/v1/dashboard/accounts")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [firm]);

  const kpis = [
    { label: "Today's invoices", value: String(data?.today_invoices ?? "—"), meta: data ? money(data.today_billing || 0) : "", to: "/invoices" as const },
    { label: "Total outstanding", value: data ? money(data.total_receivables) : "—", to: "/receivables" as const },
    { label: "Overdue", value: data ? money(data.total_overdue) : "—", tone: data && Number(data.total_overdue) > 0 ? "bad" : "good", to: "/receivables" as const, search: { overdue: "1" } },
    { label: "Due soon", value: data ? money(data.due_soon || data.due_this_week) : "—", to: "/receivables" as const },
    { label: "Today's collections", value: data ? money(data.today_collections) : "—", to: "/payments" as const },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${name}`}
        subtitle="What is billed, paid, outstanding, due, and overdue. Sales follows up; you book the money."
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            search={"search" in c ? c.search : undefined}
            className="rounded-2xl border border-border bg-card px-4 py-4 hover:bg-secondary/40"
          >
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{c.value}</p>
            {"meta" in c && c.meta ? <p className="mt-0.5 text-xs text-muted-foreground">{c.meta}</p> : null}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <Panel title="Work queue">
          <ul className="space-y-3 text-sm sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
            <li>
              <Link to="/invoices" className={rowCls}>
                <span>Ready to invoice</span>
                <Badge tone={data?.ready_to_invoice ? "warn" : "good"}>{data?.ready_to_invoice ?? 0}</Badge>
              </Link>
            </li>
            <li>
              <Link to="/receivables" className={rowCls}>
                <span>Pending payments</span>
                <Badge tone={data && data.pending_payments > 0 ? "warn" : "good"}>{data?.pending_payments ?? 0}</Badge>
              </Link>
            </li>
            <li>
              <Link to="/receivables" search={{ overdue: "1" }} className={rowCls}>
                <span>Overdue invoices</span>
                <Badge tone={data && data.overdue_invoices > 0 ? "bad" : "good"}>{data?.overdue_invoices ?? 0}</Badge>
              </Link>
            </li>
            <li>
              <Link to="/receivables" search={{ focus: "credit" }} className={rowCls}>
                <span>Credit limit alerts</span>
                <Badge tone={data && data.credit_alerts > 0 ? "bad" : "good"}>{data?.credit_alerts ?? 0}</Badge>
              </Link>
            </li>
            <li>
              <Link to="/receivables" search={{ focus: "delay" }} className={rowCls}>
                <span>Cost of delay</span>
                <span className="tabular-nums font-medium">{data ? money(data.cost_of_delay || 0) : "—"}</span>
              </Link>
            </li>
            <li>
              <Link to="/payments" className={rowCls}>
                <span>Collected this month</span>
                <span className="tabular-nums font-medium">{data ? money(data.month_collections) : "—"}</span>
              </Link>
            </li>
          </ul>
        </Panel>
      </div>

      <Panel title="Accounts flow" className="mt-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Super Admin approves → you enter invoice details & raise bill → Sales/Supervisor allots driver → delivery → payment → receivable closed.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/invoices" className="rounded-xl border border-border px-4 py-3 text-sm hover:bg-secondary">
            Raise invoices →
          </Link>
          <Link to="/receivables" className="rounded-xl border border-border px-4 py-3 text-sm hover:bg-secondary">
            Receive / update payments →
          </Link>
          <Link to="/payments" className="rounded-xl border border-border px-4 py-3 text-sm hover:bg-secondary">
            Payment register →
          </Link>
          <Link to="/collection" className="rounded-xl border border-border px-4 py-3 text-sm hover:bg-secondary">
            Collection follow-up →
          </Link>
        </div>
      </Panel>
    </>
  );
}
