import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart as RePie, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import {
  PERIOD_LABEL, KPI_GRAIN_LABEL, byFirm, dispatches, firms, firmName, inr, kpisByFirm,
  kpisForGrain, monthlyRevenue, mt, revenueSeriesFor, stock,
  type DashPeriod, type FirmId, type KpiGrain,
} from "@/lib/erp-data";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { AccountsDashboard } from "@/components/erp/AccountsDashboard";
import { SupervisorDashboard } from "@/components/erp/SupervisorDashboard";
import { SalesDashboard } from "@/components/erp/SalesDashboard";
import { LogisticsDashboard } from "@/components/erp/LogisticsDashboard";
import { OutstandingDelivery } from "@/components/erp/OutstandingDelivery";
import { usePendingApprovals } from "@/components/erp/ApprovalPopup";
import { cn } from "@/lib/utils";
import {
  DashboardCustomizer,
  useDashboardLayout,
  WidgetChrome,
  type DashWidgetId,
} from "@/components/erp/DashboardCustomizer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · Avighna ERP" },
      { name: "description", content: "Consolidated view of revenue, receivables, stock and dispatch across firms." },
      { property: "og:title", content: "Dashboard · Avighna ERP" },
      { property: "og:description", content: "Revenue, receivables, stock and dispatch at a glance." },
    ],
  }),
  component: Dashboard,
});

const PIE_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-primary)", "var(--color-warning)"];

function movementDayOffset(status: string): number {
  if (status === "Delivered" || status === "Dispatched") return -1;
  if (status === "Pending" || status === "Allocated") return 1;
  return 0;
}

function formatMovementDay(offset: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const label =
    offset === 0 ? "Today" : offset === -1 ? "Yesterday" : offset === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short" });
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return { label, date };
}

function MovementDayPanel({ firm }: { firm: FirmId }) {
  const [dayOffset, setDayOffset] = useState(0);
  const { label, date } = formatMovementDay(dayOffset);
  const rows = useMemo(
    () => byFirm(dispatches, firm).filter((d) => movementDayOffset(d.status) === dayOffset),
    [firm, dayOffset],
  );

  return (
    <Panel title="Movement" hint="Dispatch pipeline">
      <div className="mb-3 flex flex-wrap items-center justify-start gap-2">
        <button
          type="button"
          onClick={() => setDayOffset((o) => o - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-secondary sm:text-sm"
        >
          <ChevronLeft className="size-4" />
          {dayOffset === 0 ? "Yesterday" : "Previous"}
        </button>
        <div className="text-left">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <button
          type="button"
          onClick={() => setDayOffset((o) => o + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-secondary sm:text-sm"
        >
          {dayOffset === 0 ? "Tomorrow" : "Next day"}
          <ChevronRight className="size-4" />
        </button>
      </div>
      {dayOffset !== 0 && (
        <button
          type="button"
          onClick={() => setDayOffset(0)}
          className="mb-3 text-xs text-primary underline-offset-2 hover:underline"
        >
          Jump to today
        </button>
      )}
      <div className="overflow-x-auto">
        <Table head={["Load", "Customer", "Product", "Qty", "Transporter", "ETA", "Status"]}>
          {rows.map((d) => (
            <tr key={d.id}>
              <Td className="font-medium">{d.id}</Td>
              <Td>{d.customer}</Td>
              <Td className="text-muted-foreground">{d.product}</Td>
              <Td className="tabular-nums">{mt(d.qty)}</Td>
              <Td className="text-muted-foreground">{d.transporter}</Td>
              <Td>{d.eta}</Td>
              <Td>
                <Badge tone={d.status === "Delivered" ? "good" : d.status === "Pending" ? "warn" : "neutral"}>{d.status}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
        {!rows.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">No loads for {label.toLowerCase()}.</p>
        )}
      </div>
    </Panel>
  );
}

function Dashboard() {
  const { me, loading } = useMe();
  if (loading) return null;
  if (me?.user.role === "accountant") return <AccountsDashboard />;
  if (me?.user.role === "supervisor") return <SupervisorDashboard />;
  if (me?.user.role === "sales") return <SalesDashboard />;
  if (me?.user.role === "logistics") return <LogisticsDashboard />;
  return <OwnerDashboard />;
}

function KpiStrip({ firm, grain }: { firm: FirmId; grain: KpiGrain }) {
  const k = kpisForGrain(firm, grain);

  return (
    <Panel title="KPI strip" hint={`${firmName(firm)} · ${KPI_GRAIN_LABEL[grain]}`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        <Kpi label={k.revenueLabel} value={inr(k.revenue)} meta={k.revenueMeta} tone="good" />
        <Kpi label={k.secondaryLabel} value={String(k.secondary)} meta={k.secondaryMeta} />
        <Kpi label={k.tertiaryLabel} value={inr(k.tertiary)} meta={k.tertiaryMeta} tone="warn" />
        <Kpi
          label={k.quaternaryLabel}
          value={k.quaternaryIsMt ? mt(k.quaternary) : inr(k.quaternary)}
          meta={k.quaternaryMeta}
        />
      </div>
    </Panel>
  );
}

function OwnerDashboard() {
  const { firm } = useCompany();
  const { items: liveApprovals } = usePendingApprovals();
  const { layout, ready, toggle, remove, setSize, move, reset } = useDashboardLayout();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "outstanding">("overview");
  const [kpiGrain, setKpiGrain] = useState<KpiGrain>(() => {
    try {
      const g = localStorage.getItem("avighna.dashboard.kpiGrain") as KpiGrain | null;
      return g === "daily" || g === "monthly" || g === "yearly" ? g : "monthly";
    } catch {
      return "monthly";
    }
  });
  // ponytail: period UI removed; charts keep last saved grain from localStorage
  const [period] = useState<DashPeriod>(() => {
    try {
      const p = localStorage.getItem("avighna.dashboard.period") as DashPeriod | null;
      return p === "month" || p === "fy" || p === "trend6" ? p : "trend6";
    } catch {
      return "trend6";
    }
  });

  function changeKpiGrain(g: KpiGrain) {
    setKpiGrain(g);
    localStorage.setItem("avighna.dashboard.kpiGrain", g);
  }

  const pendingApprovals = liveApprovals.map((a) => ({
    id: a.key,
    customer: a.customer,
    product: a.product,
    qty: a.qty,
    askedPrice: a.asked,
    floorPrice: a.floor,
  }));

  const series = revenueSeriesFor(firm);
  const trendData =
    period === "month" ? series.slice(-1) : period === "fy" ? series : series;

  const allFirmSeries = firms.map((f) => ({
    name: f.short,
    revenue: kpisByFirm[f.id].revenue / 100000,
    outstanding: kpisByFirm[f.id].outstanding / 100000,
    stockMt: kpisByFirm[f.id].stockMt,
    growth: kpisByFirm[f.id].growth,
    month: monthlyRevenue[monthlyRevenue.length - 1][f.id],
  }));
  const firmSeries = firm === "all" ? allFirmSeries : allFirmSeries.filter((f) => f.name === firms.find((x) => x.id === firm)?.short);

  const shareData = firms.map((f) => ({
    name: f.short,
    value: Math.round(kpisByFirm[f.id].revenue / 100000),
  }));

  const dispatchStatus = (() => {
    const rows = byFirm(dispatches, firm);
    const map = new Map<string, number>();
    for (const d of rows) map.set(d.status, (map.get(d.status) || 0) + 1);
    return [...map.entries()].map(([name, value]) => ({ name, value }));
  })();

  const stockSeries = byFirm(stock, firm)
    .slice(0, 8)
    .map((s) => ({ name: s.product.slice(0, 14), free: Math.max(0, s.qty - s.reserved), reserved: s.reserved }));

  const chartH = "h-48 sm:h-56 lg:h-64";
  const tip = { borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)" };
  const periodHint =
    period === "month" ? "This month (Jul)" : period === "fy" ? "FY slice (Feb–Jul)" : "Last 6 months";

  const widgets: Record<DashWidgetId, ReactNode> = {
    kpis: <KpiStrip firm={firm} grain={kpiGrain} />,
    revenue: (
      <Panel title="Revenue area" hint={`₹ lakh · ${periodHint}`}>
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ left: -18, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Area type="monotone" dataKey="value" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#rev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    revenueLine: (
      <Panel title="Revenue line" hint={`₹ lakh · ${periodHint}`}>
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    monthlyCompare: (
      <Panel title="Monthly compare" hint="₹ lakh by firm">
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Legend />
              {(firm === "all" ? (["f1", "f2", "f3", "f4"] as const) : [firm]).map((fid, i) => (
                <Bar
                  key={fid}
                  dataKey={fid}
                  name={firms.find((f) => f.id === fid)?.short || fid}
                  fill={PIE_COLORS[i % PIE_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    firmShare: (
      <Panel title="Firm share" hint="FY revenue mix">
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <RePie>
              <Pie data={shareData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2}>
                {shareData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tip} />
              <Legend />
            </RePie>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    approvals: (
      <Panel title="Needs your approval" hint={`${pendingApprovals.length} waiting`}>
        <ul className="max-h-64 space-y-3 overflow-y-auto sm:max-h-none">
          {pendingApprovals.map((a) => (
            <li key={a.id} className="rounded-xl border border-border p-3">
              <p className="text-sm font-medium">{a.customer}</p>
              <p className="text-xs text-muted-foreground">{a.product} · {a.qty}</p>
              <p className="mt-2 text-sm tabular-nums">
                {inr(a.askedPrice)}/MT{" "}
                <span className={a.askedPrice < a.floorPrice ? "text-destructive" : "text-success"}>
                  ({a.askedPrice < a.floorPrice ? "below" : "above"} floor)
                </span>
              </p>
            </li>
          ))}
          {!pendingApprovals.length && <p className="text-sm text-muted-foreground">Nothing pending. Enjoy the calm.</p>}
        </ul>
        <Link to="/sales" className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Open approvals →
        </Link>
      </Panel>
    ),
    byCompany: (
      <Panel title="By company" hint="₹ lakh · all firms">
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={allFirmSeries} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="outstanding" name="Outstanding" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    receivables: (
      <Panel title="Receivables" hint="Outstanding ₹ lakh · all firms">
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={allFirmSeries} layout="vertical" margin={{ left: 8, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--color-border)" />
              <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis type="category" dataKey="name" width={88} tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Bar dataKey="outstanding" name="Outstanding" fill="var(--color-chart-2)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    stockLevels: (
      <Panel title="Stock levels" hint="Free vs reserved MT">
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stockSeries.length ? stockSeries : firmSeries.map((f) => ({ name: f.name, free: f.stockMt, reserved: 0 }))} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} stroke="var(--color-muted-foreground)" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Bar dataKey="free" stackId="a" fill="var(--color-chart-1)" />
              <Bar dataKey="reserved" stackId="a" fill="var(--color-warning)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    dispatchMix: (
      <Panel title="Dispatch mix" hint="By status">
        <div className={chartH}>
          {dispatchStatus.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <RePie>
                <Pie data={dispatchStatus} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3}>
                  {dispatchStatus.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tip} />
              </RePie>
            </ResponsiveContainer>
          ) : (
            <p className="grid h-full place-items-center text-sm text-muted-foreground">No dispatches</p>
          )}
        </div>
      </Panel>
    ),
    growth: (
      <Panel title="Growth" hint="% vs last month">
        <div className={chartH}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={firmSeries} margin={{ left: -18, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
              <Tooltip contentStyle={tip} />
              <Bar dataKey="growth" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    ),
    dispatch: <MovementDayPanel firm={firm} />,
  };

  return (
    <>
      <PageHeader
        title="Good morning, Owner"
        subtitle={`${firmName(firm)} · ${PERIOD_LABEL[period]}. Customize widgets anytime.`}
        action={
          tab === "overview" ? (
          <DashboardCustomizer
            layout={layout}
            onToggle={toggle}
            onRemove={remove}
            onSetSize={setSize}
            onMove={move}
            onReset={reset}
            open={customizeOpen}
            onOpenChange={setCustomizeOpen}
            kpiGrain={kpiGrain}
            onKpiGrainChange={changeKpiGrain}
          />
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={cn("rounded-lg px-3 py-2 text-sm", tab === "overview" ? "bg-primary text-primary-foreground" : "border border-border")}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setTab("outstanding")}
          className={cn("rounded-lg px-3 py-2 text-sm", tab === "outstanding" ? "bg-primary text-primary-foreground" : "border border-border")}
        >
          Outstanding delivery
        </button>
      </div>

      {tab === "outstanding" ? (
        <OutstandingDelivery canComplete />
      ) : (
        <>
      {ready && (
        <div className="grid grid-cols-12 gap-3 sm:gap-4 lg:gap-5">
          {layout.map((item) => (
            <WidgetChrome
              key={item.id}
              id={item.id}
              size={item.size}
              editing={customizeOpen}
              onRemove={remove}
              onSetSize={setSize}
            >
              {widgets[item.id]}
            </WidgetChrome>
          ))}
        </div>
      )}

      {!layout.length && ready && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No widgets selected — open Customize to add some.
        </p>
      )}
        </>
      )}
    </>
  );
}
