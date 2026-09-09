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
  f1: { revenue: 18400000, outstanding: 5240000, stockValue: 6100000, stockMt: 12.4, dispatchPending: 4, growth: 8.2 },
  f2: { revenue: 9600000, outstanding: 3120000, stockValue: 4300000, stockMt: 5.1, dispatchPending: 2, growth: 12.6 },
  f3: { revenue: 4200000, outstanding: 980000, stockValue: 1450000, stockMt: 3.2, dispatchPending: 1, growth: -3.4 },
  f4: { revenue: 6100000, outstanding: 1610000, stockValue: 2050000, stockMt: 4.0, dispatchPending: 3, growth: 5.1 },
};

export const consolidatedKpis = () =>
  Object.values(kpisByFirm).reduce(
    (a, k) => ({
      revenue: a.revenue + k.revenue,
      outstanding: a.outstanding + k.outstanding,
      stockValue: a.stockValue + k.stockValue,
      stockMt: a.stockMt + k.stockMt,
      dispatchPending: a.dispatchPending + k.dispatchPending,
      growth: 7.4,
    }),
    { revenue: 0, outstanding: 0, stockValue: 0, stockMt: 0, dispatchPending: 0, growth: 0 },
  );

export const kpisFor = (firm: FirmId) => (firm === "all" ? consolidatedKpis() : kpisByFirm[firm]);

export const monthlyRevenue = [
  { month: "Feb", f1: 12.1, f2: 6.2, f3: 3.1, f4: 4.4 },
  { month: "Mar", f1: 13.4, f2: 6.8, f3: 3.4, f4: 4.1 },
  { month: "Apr", f1: 15.2, f2: 7.4, f3: 3.0, f4: 5.2 },
  { month: "May", f1: 14.8, f2: 8.1, f3: 3.6, f4: 5.5 },
  { month: "Jun", f1: 16.9, f2: 8.9, f3: 4.4, f4: 5.9 },
  { month: "Jul", f1: 18.4, f2: 9.6, f3: 4.2, f4: 6.1 },
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
      secondary: Math.max(1, Math.round(base.dispatchPending / 3) || 1),
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
})[] = [
  { id: "LD-1041", firm: "f1", company: "Anand Bakers Pvt Ltd", contact: "R. Anand", industry: "Bakery", state: "Maharashtra", requirement: "18 MT / month", stage: "Negotiation", source: "WhatsApp bot", type: "Wholesaler" },
  { id: "LD-1040", firm: "f2", company: "Medisyn Formulations", contact: "Dr. Kavita S.", industry: "Pharma", state: "Gujarat", requirement: "6 MT / month", stage: "Meeting", source: "WhatsApp bot", type: "Wholesaler" },
  { id: "LD-1039", firm: "f1", company: "Coastal Dairy Co-op", contact: "Prakash M.", industry: "Dairy", state: "Karnataka", requirement: "24 MT / month", stage: "Follow-up", source: "Referral", type: "Wholesaler" },
  { id: "LD-1038", firm: "f3", company: "NovaBite Foods", contact: "Simran K.", industry: "Specialty foods", state: "Delhi", requirement: "3 MT / month", stage: "New", source: "WhatsApp bot", type: "Wholesaler" },
  { id: "LD-1037", firm: "f4", company: "Shree Traders", contact: "Nitin P.", industry: "Retail", state: "Rajasthan", requirement: "200 kg / month", stage: "Lost", source: "WhatsApp bot", type: "Retailer" },
  { id: "LD-1036", firm: "f1", company: "Gokul Beverages", contact: "Vinay T.", industry: "Beverages", state: "Telangana", requirement: "30 MT / month", stage: "Won", source: "Field visit", type: "Wholesaler" },
];

export const customers: (Firmed & {
  id: string; name: string; industry: string; state: string; creditDays: number;
  creditLimit: number; outstanding: number; revenue: number; lastOrder: string; health: "Good" | "Watch" | "Risk";
})[] = [
  { id: "CU-201", firm: "f1", name: "Gokul Beverages", industry: "Beverages", state: "Telangana", creditDays: 45, creditLimit: 4000000, outstanding: 1820000, revenue: 6400000, lastOrder: "24 Jul", health: "Good" },
  { id: "CU-202", firm: "f1", name: "Anand Bakers Pvt Ltd", industry: "Bakery", state: "Maharashtra", creditDays: 60, creditLimit: 3000000, outstanding: 2640000, revenue: 4900000, lastOrder: "19 Jul", health: "Watch" },
  { id: "CU-203", firm: "f2", name: "Medisyn Formulations", industry: "Pharma", state: "Gujarat", creditDays: 30, creditLimit: 2500000, outstanding: 410000, revenue: 3800000, lastOrder: "26 Jul", health: "Good" },
  { id: "CU-204", firm: "f2", name: "Zenith Lifesciences", industry: "Pharma", state: "Maharashtra", creditDays: 70, creditLimit: 5000000, outstanding: 4310000, revenue: 5200000, lastOrder: "08 Jul", health: "Risk" },
  { id: "CU-205", firm: "f3", name: "NovaBite Foods", industry: "Specialty", state: "Delhi", creditDays: 45, creditLimit: 1200000, outstanding: 380000, revenue: 1450000, lastOrder: "21 Jul", health: "Good" },
  { id: "CU-206", firm: "f4", name: "Sunrise Distributors", industry: "Trading", state: "Rajasthan", creditDays: 30, creditLimit: 1500000, outstanding: 920000, revenue: 2100000, lastOrder: "15 Jul", health: "Watch" },
];

export const approvals: (Firmed & {
  id: string; customer: string; product: string; qty: string; askedPrice: number; floorPrice: number;
  salesperson: string; raised: string; status: "Pending" | "Approved" | "Rejected";
})[] = [
  { id: "AP-88", firm: "f1", customer: "Anand Bakers Pvt Ltd", product: "Glucose Syrup 64 DE", qty: "18 MT", askedPrice: 42500, floorPrice: 43200, salesperson: "Rahul V.", raised: "2 h ago", status: "Pending" },
  { id: "AP-87", firm: "f2", customer: "Medisyn Formulations", product: "Pharma Grade Lactose", qty: "6 MT", askedPrice: 88000, floorPrice: 86500, salesperson: "Neha S.", raised: "5 h ago", status: "Pending" },
  { id: "AP-86", firm: "f1", customer: "Gokul Beverages", product: "Sucrose Fine", qty: "30 MT", askedPrice: 39800, floorPrice: 39500, salesperson: "Rahul V.", raised: "Yesterday", status: "Approved" },
  { id: "AP-85", firm: "f3", customer: "NovaBite Foods", product: "Food Stabilizer FS-2", qty: "2 MT", askedPrice: 121000, floorPrice: 126000, salesperson: "Imran A.", raised: "2 days ago", status: "Rejected" },
];

export const stock: (Firmed & {
  batch: string; product: string; manufacturer: string; warehouse: string; qty: number; reserved: number; age: number;
})[] = [
  { batch: "B-2407-11", firm: "f1", product: "Sucrose Fine", manufacturer: "Aditya Sugars", warehouse: "Bhiwandi", qty: 6.2, reserved: 2.0, age: 14 },
  { batch: "B-2407-08", firm: "f1", product: "Glucose Syrup 64 DE", manufacturer: "Nirman Starch", warehouse: "Bhiwandi", qty: 4.1, reserved: 1.5, age: 21 },
  { batch: "B-2406-22", firm: "f1", product: "Food Stabilizer FS-2", manufacturer: "Vikas Hydrocolloids", warehouse: "Vasai", qty: 2.1, reserved: 0, age: 46 },
  { batch: "B-2407-04", firm: "f2", product: "Pharma Grade Lactose", manufacturer: "Meridian Excipients", warehouse: "Ankleshwar", qty: 3.4, reserved: 1.2, age: 18 },
  { batch: "B-2405-19", firm: "f2", product: "Sorbitol 70%", manufacturer: "Nirman Starch", warehouse: "Ankleshwar", qty: 1.7, reserved: 0, age: 72 },
  { batch: "B-2407-15", firm: "f3", product: "Plant Protein Isolate", manufacturer: "Vikas Hydrocolloids", warehouse: "Vasai", qty: 3.2, reserved: 0.8, age: 9 },
  { batch: "B-2407-02", firm: "f4", product: "Citric Acid Anhydrous", manufacturer: "Aditya Sugars", warehouse: "Jaipur", qty: 4.0, reserved: 1.0, age: 25 },
];

export const purchaseOrders: (Firmed & {
  id: string; manufacturer: string; product: string; qty: number; received: number; eta: string; value: number;
  status: "Confirmed" | "In transit" | "Partially received" | "Received";
})[] = [
  { id: "PO-3312", firm: "f1", manufacturer: "Aditya Sugars", product: "Sucrose Fine", qty: 20, received: 0, eta: "31 Jul", value: 780000, status: "In transit" },
  { id: "PO-3311", firm: "f2", manufacturer: "Meridian Excipients", product: "Pharma Grade Lactose", qty: 8, received: 5, eta: "29 Jul", value: 690000, status: "Partially received" },
  { id: "PO-3310", firm: "f1", manufacturer: "Nirman Starch", product: "Glucose Syrup 64 DE", qty: 12, received: 12, eta: "22 Jul", value: 505000, status: "Received" },
  { id: "PO-3309", firm: "f3", manufacturer: "Vikas Hydrocolloids", product: "Plant Protein Isolate", qty: 5, received: 0, eta: "04 Aug", value: 610000, status: "Confirmed" },
];

export const dispatches: (Firmed & {
  id: string; customer: string; product: string; qty: number; vehicle: string; transporter: string; lr: string;
  eta: string; status: "Pending" | "Allocated" | "Packed" | "Ready" | "Dispatched" | "Delivered";
})[] = [
  { id: "DS-914", firm: "f1", customer: "Gokul Beverages", product: "Sucrose Fine", qty: 10, vehicle: "MH-04 KL 2231", transporter: "Sharma Roadlines", lr: "SR-88213", eta: "30 Jul", status: "Dispatched" },
  { id: "DS-913", firm: "f1", customer: "Anand Bakers Pvt Ltd", product: "Glucose Syrup 64 DE", qty: 6, vehicle: "?", transporter: "VRL Logistics", lr: "?", eta: "31 Jul", status: "Packed" },
  { id: "DS-912", firm: "f2", customer: "Medisyn Formulations", product: "Pharma Grade Lactose", qty: 4, vehicle: "GJ-16 AB 7742", transporter: "Safe Cargo", lr: "SC-3391", eta: "29 Jul", status: "Delivered" },
  { id: "DS-911", firm: "f4", customer: "Sunrise Distributors", product: "Citric Acid Anhydrous", qty: 3, vehicle: "?", transporter: "?", lr: "?", eta: "01 Aug", status: "Allocated" },
  { id: "DS-910", firm: "f3", customer: "NovaBite Foods", product: "Plant Protein Isolate", qty: 1.5, vehicle: "?", transporter: "?", lr: "?", eta: "28 Jul", status: "Pending" },
];

export const invoices: (Firmed & {
  id: string; customer: string; date: string; amount: number; creditDays: number; daysElapsed: number;
  paid: boolean;
})[] = [
  { id: "SFI/25-26/0412", firm: "f1", customer: "Gokul Beverages", date: "02 Jul", amount: 1820000, creditDays: 45, daysElapsed: 27, paid: false },
  { id: "SFI/25-26/0409", firm: "f1", customer: "Anand Bakers Pvt Ltd", date: "18 Jun", amount: 2640000, creditDays: 60, daysElapsed: 41, paid: false },
  { id: "SPA/25-26/0188", firm: "f2", customer: "Zenith Lifesciences", date: "12 May", amount: 4310000, creditDays: 70, daysElapsed: 78, paid: false },
  { id: "SPA/25-26/0201", firm: "f2", customer: "Medisyn Formulations", date: "10 Jul", amount: 410000, creditDays: 30, daysElapsed: 19, paid: false },
  { id: "SSL/25-26/0067", firm: "f3", customer: "NovaBite Foods", date: "21 Jul", amount: 380000, creditDays: 45, daysElapsed: 8, paid: false },
  { id: "STD/25-26/0122", firm: "f4", customer: "Sunrise Distributors", date: "02 Jun", amount: 920000, creditDays: 30, daysElapsed: 57, paid: false },
];

/** Configurable delay-cost formula (admin editable, no code change needed). */
export const defaultFormula = "amount * (annualRate/100) * (overdueDays/365) + flatFee";
export const formulaVars = { annualRate: 14, flatFee: 1500 };

export function delayCost(amount: number, overdueDays: number, annualRate = formulaVars.annualRate, flatFee = formulaVars.flatFee) {
  if (overdueDays <= 0) return 0;
  return amount * (annualRate / 100) * (overdueDays / 365) + flatFee;
}

export const visits: (Firmed & {
  id: string; salesperson: string; customer: string; checkIn: string; duration: string; outcome: string; next: string;
})[] = [
  { id: "V-551", firm: "f1", salesperson: "Rahul V.", customer: "Anand Bakers Pvt Ltd", checkIn: "09:40", duration: "38 min", outcome: "Price revision discussed, awaiting approval", next: "31 Jul" },
  { id: "V-550", firm: "f2", salesperson: "Neha S.", customer: "Medisyn Formulations", checkIn: "11:05", duration: "52 min", outcome: "Sample approved, order expected next week", next: "02 Aug" },
  { id: "V-549", firm: "f1", salesperson: "Rahul V.", customer: "Gokul Beverages", checkIn: "14:20", duration: "25 min", outcome: "Dispatch schedule confirmed", next: "05 Aug" },
  { id: "V-548", firm: "f3", salesperson: "Imran A.", customer: "NovaBite Foods", checkIn: "16:10", duration: "44 min", outcome: "Rate too high, competitor quoted lower", next: "30 Jul" },
];

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
