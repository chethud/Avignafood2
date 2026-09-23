export type FirmId = "all" | "f1" | "f2" | "f3" | "f4";

export const firms = [
  {
    id: "f1",
    name: "Asian Apex & Co.",
    short: "Asian Apex",
    gst: "29AAAAA0001A1Z1",
    logo: "/logos/asian-apex.jpg",
    companyId: 1,
  },
  {
    id: "f2",
    name: "Avighna Speciality Ingredients Pvt Ltd",
    short: "Avighna",
    gst: "29AAAAA0002A1Z2",
    logo: "/logos/avighna.png",
    companyId: 2,
  },
  {
    id: "f3",
    name: "Ganesh Inc.",
    short: "Ganesh Inc",
    gst: "29AAAAA0003A1Z3",
    logo: "/logos/ganesh-inc.jpg",
    companyId: 3,
  },
  {
    id: "f4",
    name: "Atharva Associates",
    short: "Atharva",
    gst: "29AAAAA0004A1Z4",
    logo: "/logos/atharva-associates.png",
    companyId: 4,
  },
] as const;

export const firmName = (id: FirmId) =>
  id === "all" ? "All companies" : (firms.find((f) => f.id === id)?.name ?? "All companies");

export function firmByCompanyId(companyId: number | null | undefined) {
  if (companyId == null) return null;
  return firms.find((f) => f.companyId === companyId) ?? null;
}

export function firmLabelByCompanyId(companyId: number | null | undefined) {
  return firmByCompanyId(companyId)?.short || firmByCompanyId(companyId)?.name || (companyId != null ? `Company ${companyId}` : "—");
}

export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export const mt = (n: number) => `${n.toFixed(1)} MT`;

type Firmed = { firm: Exclude<FirmId, "all"> };

export const kpisByFirm: Record<string, { revenue: number; outstanding: number; stockValue: number; stockMt: number; dispatchPending: number; growth: number }> = {
  f1: { revenue: 0, outstanding: 0, stockValue: 0, stockMt: 0, dispatchPending: 0, growth: 0 },
  f2: { revenue: 0, outstanding: 0, stockValue: 0, stockMt: 0, dispatchPending: 0, growth: 0 },
  f3: { revenue: 0, outstanding: 0, stockValue: 0, stockMt: 0, dispatchPending: 0, growth: 0 },
  f4: { revenue: 0, outstanding: 0, stockValue: 0, stockMt: 0, dispatchPending: 0, growth: 0 },
};

export const consolidatedKpis = () =>
  Object.values(kpisByFirm).reduce(
    (a, k) => ({
      revenue: a.revenue + k.revenue,
      outstanding: a.outstanding + k.outstanding,
      stockValue: a.stockValue + k.stockValue,
      stockMt: a.stockMt + k.stockMt,
      dispatchPending: a.dispatchPending + k.dispatchPending,
      growth: 0,
    }),
    { revenue: 0, outstanding: 0, stockValue: 0, stockMt: 0, dispatchPending: 0, growth: 0 },
  );

export const kpisFor = (firm: FirmId) => (firm === "all" ? consolidatedKpis() : kpisByFirm[firm]);

export const monthlyRevenue = [
  { month: "Feb", f1: 0, f2: 0, f3: 0, f4: 0 },
  { month: "Mar", f1: 0, f2: 0, f3: 0, f4: 0 },
  { month: "Apr", f1: 0, f2: 0, f3: 0, f4: 0 },
  { month: "May", f1: 0, f2: 0, f3: 0, f4: 0 },
  { month: "Jun", f1: 0, f2: 0, f3: 0, f4: 0 },
  { month: "Jul", f1: 0, f2: 0, f3: 0, f4: 0 },
];

export type DashPeriod = "month" | "fy" | "trend6";

const FIRM_KEYS = ["f1", "f2", "f3", "f4"] as const;

export function monthRowTotal(row: (typeof monthlyRevenue)[0], firm: FirmId) {
  if (firm === "all") return row.f1 + row.f2 + row.f3 + row.f4;
  return row[firm];
}

/** Latest month revenue in INR (series is ? lakh). */
export function revenueThisMonth(firm: FirmId) {
  const last = monthlyRevenue[monthlyRevenue.length - 1];
  return monthRowTotal(last, firm) * 100000;
}

/** Sum of chart months as FY-to-date slice in INR. */
export function revenueFySlice(firm: FirmId) {
  return monthlyRevenue.reduce((s, row) => s + monthRowTotal(row, firm), 0) * 100000;
}

export function revenueSeriesFor(firm: FirmId) {
  return monthlyRevenue.map((m) => ({
    month: m.month,
    value: monthRowTotal(m, firm),
    ...Object.fromEntries(FIRM_KEYS.map((k) => [k, m[k]])),
  }));
}

export const PERIOD_LABEL: Record<DashPeriod, string> = {
  month: "This month",
  fy: "FY year",
  trend6: "Last 6 months",
};

export type KpiGrain = "daily" | "monthly" | "yearly";

export const KPI_GRAIN_LABEL: Record<KpiGrain, string> = {
  daily: "Daily",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** Mock KPI numbers for the strip, keyed by daily / monthly / yearly. */
export function kpisForGrain(firm: FirmId, grain: KpiGrain) {
  const base = kpisFor(firm);
  const month = revenueThisMonth(firm);
  const fy = revenueFySlice(firm);

  if (grain === "daily") {
    return {
      revenue: Math.round(month / 30),
      revenueLabel: "Revenue (today)",
      revenueMeta: "Est. from this month",
      secondary: Math.round(base.dispatchPending / 3),
      secondaryLabel: "Loads today",
      secondaryMeta: "In pipeline",
      tertiary: Math.round(base.outstanding / 30),
      tertiaryLabel: "Collections (est.)",
      tertiaryMeta: "Daily share of outstanding",
      quaternary: Number((base.stockMt / 30).toFixed(2)),
      quaternaryLabel: "Stock moved (MT)",
      quaternaryMeta: "Est. daily throughput",
      quaternaryIsMt: true as const,
    };
  }
  if (grain === "monthly") {
    return {
      revenue: month,
      revenueLabel: "Revenue (month)",
      revenueMeta: "Latest month · Jul",
      secondary: base.dispatchPending,
      secondaryLabel: "Pending dispatch",
      secondaryMeta: "Loads awaiting vehicle",
      tertiary: base.outstanding,
      tertiaryLabel: "Outstanding",
      tertiaryMeta: "Open receivables",
      quaternary: base.stockMt,
      quaternaryLabel: "Inventory",
      quaternaryMeta: `Valued ${inr(base.stockValue)}`,
      quaternaryIsMt: true as const,
    };
  }
  return {
    revenue: fy,
    revenueLabel: "Revenue (FY)",
    revenueMeta: "Feb–Jul slice",
    secondary: Math.round(base.dispatchPending * 8),
    secondaryLabel: "Dispatches (FY)",
    secondaryMeta: "Est. loads YTD",
    tertiary: base.outstanding,
    tertiaryLabel: "Outstanding",
    tertiaryMeta: "Open receivables",
    quaternary: base.stockMt,
    quaternaryLabel: "Inventory",
    quaternaryMeta: `Valued ${inr(base.stockValue)}`,
    quaternaryIsMt: true as const,
  };
}

export const leads: (Firmed & {
  id: string; company: string; contact: string; industry: string; state: string;
  requirement: string; stage: "New" | "Contacted" | "Meeting" | "Follow-up" | "Negotiation" | "Won" | "Lost";
  source: string; type: "Wholesaler" | "Retailer";
})[] = [];

export const customers: (Firmed & {
  id: string; name: string; industry: string; state: string; creditDays: number;
  creditLimit: number; outstanding: number; revenue: number; lastOrder: string; health: "Good" | "Watch" | "Risk";
})[] = [];

export const approvals: (Firmed & {
  id: string; customer: string; product: string; qty: string; askedPrice: number; floorPrice: number;
  salesperson: string; raised: string; status: "Pending" | "Approved" | "Rejected";
})[] = [];

export const stock: (Firmed & {
  batch: string; product: string; manufacturer: string; warehouse: string; qty: number; reserved: number; age: number;
})[] = [];

export const purchaseOrders: (Firmed & {
  id: string; manufacturer: string; product: string; qty: number; received: number; eta: string; value: number;
  status: "Confirmed" | "In transit" | "Partially received" | "Received";
})[] = [];

export const dispatches: (Firmed & {
  id: string; customer: string; product: string; qty: number; vehicle: string; transporter: string; lr: string;
  eta: string; status: "Pending" | "Allocated" | "Packed" | "Ready" | "Dispatched" | "Delivered";
})[] = [];

export const invoices: (Firmed & {
  id: string; customer: string; date: string; amount: number; creditDays: number; daysElapsed: number;
  paid: boolean;
})[] = [];

/** Configurable delay-cost formula (admin editable, no code change needed). */
export const defaultFormula = "amount * (annualRate/100) * (overdueDays/365) + flatFee";
export const formulaVars = { annualRate: 14, flatFee: 1500 };

export function delayCost(amount: number, overdueDays: number, annualRate = formulaVars.annualRate, flatFee = formulaVars.flatFee) {
  if (overdueDays <= 0) return 0;
  return amount * (annualRate / 100) * (overdueDays / 365) + flatFee;
}

export const visits: (Firmed & {
  id: string; salesperson: string; customer: string; checkIn: string; duration: string; outcome: string; next: string;
})[] = [];

export const roles = [
  { role: "Owner", firms: "All firms", scope: "Full access, approvals, consolidated analytics" },
  { role: "Sales Manager", firms: "Firm 1, Firm 2", scope: "CRM, sales, visits, pricing requests" },
  { role: "Salesperson", firms: "Firm 1", scope: "Own leads, visits, quotations ? no inventory edits" },
  { role: "Warehouse Staff", firms: "Firm 1, Firm 3", scope: "Stock inward/outward, dispatch ? no invoices" },
  { role: "Billing Staff", firms: "All firms", scope: "Invoices, e-way bills ? no stock edits" },
  { role: "Accounts", firms: "All firms", scope: "Invoices, receivables, per-client billing (Tally Prime for books)" },
];

export const byFirm = <T extends { firm: string }>(rows: T[], firm: FirmId) =>
  firm === "all" ? rows : rows.filter((r) => r.firm === firm);

/** Dashboard quiet alerts ? shown in the header notification bell. */
export function quietAlerts(firm: FirmId) {
  const lowStock = byFirm(stock, firm).filter((s) => s.qty - s.reserved < 2).length;
  const overdue = byFirm(invoices, firm).filter((i) => i.daysElapsed > i.creditDays).length;
  const loads = byFirm(dispatches, firm).filter((d) => d.status !== "Delivered").length;
  const visitsToday = byFirm(visits, firm).length;
  return [
    { id: "low-stock", label: "Batches running low", count: lowStock, tone: "warn" as const, to: "/inventory" },
    { id: "overdue", label: "Invoices past credit days", count: overdue, tone: "bad" as const, to: "/receivables" },
    { id: "loads", label: "Loads to move", count: loads, tone: "neutral" as const, to: "/dispatch" },
    { id: "visits", label: "Field visits logged today", count: visitsToday, tone: "good" as const, to: "/field" },
  ];
}
