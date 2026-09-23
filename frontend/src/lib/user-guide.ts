/** Role-based page guides — each item opens a real screen. */

export type GuideScreen = {
  /** Short name of the screen */
  label: string;
  /** What this screen is for */
  purpose: string;
  /** What the user should do here */
  how: string;
  /** App route to open */
  to: string;
};

export type RoleGuide = {
  title: string;
  summary: string;
  flow: string[];
  screens: GuideScreen[];
};

const ORDER_FLOW = [
  "Sales creates order",
  "Owner / Super Admin approves",
  "Accounts raises invoice",
  "Supervisor / Sales confirms stock & allots driver",
  "Driver delivers + POD",
  "Accounts collects payment",
];

export const GUIDES: Record<string, RoleGuide> = {
  sales: {
    title: "Sales guide",
    summary: "Every screen you can open. Tap a card to go there, or start the walkthrough to see sections highlighted on screen.",
    flow: ORDER_FLOW,
    screens: [
      {
        label: "Today",
        purpose: "Your home for today’s field work and quick status.",
        how: "Start here each morning. Check visits, vehicle windows, and stock glance.",
        to: "/",
      },
      {
        label: "Visit",
        purpose: "Log field visits and create orders while on site.",
        how: "Add a visit, pick the customer, choose Own vehicle or Manufacturer, then create the order. Plan truck + driver if own vehicle.",
        to: "/field",
      },
      {
        label: "Pending Collection",
        purpose: "Follow up unpaid invoices for your customers.",
        how: "Call / WhatsApp overdue customers and note promises.",
        to: "/collection",
      },
      {
        label: "Leads",
        purpose: "Track new prospects before they become customers.",
        how: "Add leads, update stage, then convert when ready.",
        to: "/leads",
      },
      {
        label: "Customers",
        purpose: "Your B2B customer master (credit, address, GST).",
        how: "Open a customer before quoting or collecting.",
        to: "/customers",
      },
      {
        label: "Quotes & orders",
        purpose: "Quotations and sales orders you raised.",
        how: "Create quote → convert to order. Drafts wait for Owner approval.",
        to: "/sales",
      },
      {
        label: "Allot driver",
        purpose: "Book vehicle + logistics driver after Owner approves and stock is ready.",
        how: "Pick date, window, truck and driver. Driver only sees the trip after this.",
        to: "/ops",
      },
      {
        label: "Inventory",
        purpose: "Check on-hand qty before promising stock.",
        how: "Look up product balances so you don’t oversell.",
        to: "/inventory",
      },
      {
        label: "Profile",
        purpose: "Your name, phone and photo.",
        how: "Keep contact details up to date.",
        to: "/profile",
      },
    ],
  },
  accountant: {
    title: "Accounts guide",
    summary: "Every money screen. Tap a card to open it, or start the walkthrough for on-screen highlights.",
    flow: ORDER_FLOW,
    screens: [
      {
        label: "Dashboard",
        purpose: "Accounts overview — what needs invoicing or collection.",
        how: "Start here, then open Invoices or Receivables from KPIs or the queue.",
        to: "/",
      },
      {
        label: "Invoices",
        purpose: "Raise tax invoices for approved orders and send PDFs.",
        how: "Bill from order after Owner approve. Own vehicle needs truck+driver planned first. Preview / download / WhatsApp PDF.",
        to: "/invoices",
      },
      {
        label: "Receivables",
        purpose: "Who owes what — ageing and outstanding.",
        how: "Filter overdue customers, then record payment or open collection.",
        to: "/receivables",
      },
      {
        label: "Payments received",
        purpose: "Record cash / bank / UPI and allocate to invoices.",
        how: "Enter payment, pick invoices to clear.",
        to: "/payments",
      },
      {
        label: "Customers",
        purpose: "Customer statement and ledger.",
        how: "Open a customer to see invoices + payments together.",
        to: "/clients",
      },
      {
        label: "Collections",
        purpose: "Overdue follow-up with call / WhatsApp and promised dates.",
        how: "From More → Collections — chase late invoices.",
        to: "/collection",
      },
      {
        label: "Credit control",
        purpose: "Credit limit, exposure, notes and breach alerts.",
        how: "Check before large invoices; apply credit/debit notes.",
        to: "/credit",
      },
      {
        label: "Reports",
        purpose: "Ageing, collections and delay reports.",
        how: "Export when Owner asks for numbers.",
        to: "/reports",
      },
      {
        label: "More",
        purpose: "Extra Accounts tools in one place.",
        how: "Open Collections, Credit, Reports and related shortcuts.",
        to: "/more",
      },
    ],
  },
  logistics: {
    title: "Driver guide",
    summary: "Every driver screen. Tap a card to open it, or start the walkthrough on Today.",
    flow: [
      "Wait for assignment (after Owner approve + allot)",
      "Confirm shipment",
      "Confirm load",
      "Go",
      "Drop + photo (required)",
      "Back to base",
    ],
    screens: [
      {
        label: "Today",
        purpose: "Your live trip — shipments assigned to you.",
        how: "Tap Confirm on a card → confirm again in the popup → Load → Go → deliver each drop with a camera photo → return to base.",
        to: "/",
      },
      {
        label: "History",
        purpose: "Past completed trips and drops.",
        how: "Open when you need to check an old delivery.",
        to: "/history",
      },
      {
        label: "Profile",
        purpose: "Your name, phone and photo.",
        how: "Update details so Sales can reach you.",
        to: "/profile",
      },
    ],
  },
  supervisor: {
    title: "Supervisor guide",
    summary: "Every ops screen. Tap a card to open it, or start the walkthrough for highlights.",
    flow: ORDER_FLOW,
    screens: [
      {
        label: "Dashboard",
        purpose: "Ops overview for stock and orders waiting.",
        how: "See what needs verify or purchase. Use Outstanding delivery tab for partials.",
        to: "/",
      },
      {
        label: "Leads",
        purpose: "Support view of sales pipeline.",
        how: "Read-only help for Sales when needed.",
        to: "/leads",
      },
      {
        label: "Customers",
        purpose: "Customer list for ops context.",
        how: "Check address / credit if allotting delivery.",
        to: "/customers",
      },
      {
        label: "Order desk",
        purpose: "Invoiced orders — verify stock, then allot vehicle/driver.",
        how: "Confirm on-hand. If short, raise purchase. When ready, allot truck + logistics driver.",
        to: "/ops",
      },
      {
        label: "Inventory",
        purpose: "Warehouse balances.",
        how: "Check qty before marking an order ready.",
        to: "/inventory",
      },
      {
        label: "Purchases",
        purpose: "Buy stock when an order is short.",
        how: "Raise / receive purchase so outstanding clears.",
        to: "/purchases",
      },
    ],
  },
  owner: {
    title: "Owner guide",
    summary: "Every module you can open. Tap a card to go there, or start the walkthrough for on-screen highlights.",
    flow: ORDER_FLOW,
    screens: [
      {
        label: "Dashboard",
        purpose: "Company performance across firms.",
        how: "Switch company (or All) at the top, then drill into alerts and customize widgets.",
        to: "/",
      },
      {
        label: "Leads",
        purpose: "Pipeline of prospects Sales is working.",
        how: "Review stages; Sales owns day-to-day updates.",
        to: "/leads",
      },
      {
        label: "Customers",
        purpose: "Customer master across firms.",
        how: "Check credit, GST and addresses before approving large orders.",
        to: "/customers",
      },
      {
        label: "Sales & approvals",
        purpose: "Approve or decline draft sales orders.",
        how: "Review total + delivery mode, then Approve. If truck was planned, driver sees it after you approve.",
        to: "/sales",
      },
      {
        label: "Field visits",
        purpose: "Visits Sales logged in the field.",
        how: "Audit check-ins when you need ground truth.",
        to: "/field",
      },
      {
        label: "Order desk",
        purpose: "Ops after invoice — stock and allotment status.",
        how: "Check bottlenecks between Accounts and logistics.",
        to: "/ops",
      },
      {
        label: "Inventory",
        purpose: "On-hand and reserved stock.",
        how: "Watch low stock before promising big orders.",
        to: "/inventory",
      },
      {
        label: "Purchases",
        purpose: "Inbound buys when stock is short.",
        how: "Confirm Supervisor / purchase flow is clearing shortages.",
        to: "/purchases",
      },
      {
        label: "Dispatch",
        purpose: "Loads moving to customers.",
        how: "See transporter / status when Movement widget is not enough.",
        to: "/dispatch",
      },
      {
        label: "Invoices",
        purpose: "Billing raised by Accounts.",
        how: "Audit invoice status and PDFs.",
        to: "/invoices",
      },
      {
        label: "Receivables",
        purpose: "Outstanding and ageing.",
        how: "Watch overdue exposure by company.",
        to: "/receivables",
      },
      {
        label: "Payments received",
        purpose: "Cash coming in against invoices.",
        how: "Confirm allocations match what customers paid.",
        to: "/payments",
      },
      {
        label: "Credit control",
        purpose: "Limits, breaches and notes.",
        how: "Set policy Accounts follows.",
        to: "/credit",
      },
      {
        label: "Accounts reports",
        purpose: "Ageing and collection reports.",
        how: "Export for weekly money review.",
        to: "/reports",
      },
      {
        label: "Analytics",
        purpose: "Trends across sell / stock / money.",
        how: "Use for weekly review.",
        to: "/analytics",
      },
      {
        label: "Administration",
        purpose: "Users, companies and setup.",
        how: "Change carefully — shared with Super Admin / Harshith modules.",
        to: "/admin",
      },
    ],
  },
  super_admin: {
    title: "Super Admin guide",
    summary: "Same full module list as Owner, plus admin. Tap a card or start the walkthrough.",
    flow: ORDER_FLOW,
    screens: [
      {
        label: "Dashboard",
        purpose: "Full ERP overview across companies.",
        how: "Use All companies for consolidated view.",
        to: "/",
      },
      {
        label: "Leads",
        purpose: "Sales pipeline across firms.",
        how: "Spot stuck stages; Sales owns updates.",
        to: "/leads",
      },
      {
        label: "Customers",
        purpose: "Customer master for every firm.",
        how: "Fix master data and credit when needed.",
        to: "/customers",
      },
      {
        label: "Sales & approvals",
        purpose: "Approve draft orders so the chain continues.",
        how: "Approve / decline — same as Owner.",
        to: "/sales",
      },
      {
        label: "Field visits",
        purpose: "Field check-ins from Sales.",
        how: "Audit visits when orders look wrong.",
        to: "/field",
      },
      {
        label: "Order desk",
        purpose: "Stock confirm and driver allot status.",
        how: "Unblock orders stuck after invoice.",
        to: "/ops",
      },
      {
        label: "Inventory",
        purpose: "Stock balances by firm.",
        how: "Check before large approvals.",
        to: "/inventory",
      },
      {
        label: "Purchases",
        purpose: "Inbound stock to clear shortages.",
        how: "Confirm purchase receives are landing.",
        to: "/purchases",
      },
      {
        label: "Dispatch",
        purpose: "Outbound loads and status.",
        how: "Trace a stuck delivery.",
        to: "/dispatch",
      },
      {
        label: "Invoices",
        purpose: "Billing and PDF trail.",
        how: "Check Accounts throughput.",
        to: "/invoices",
      },
      {
        label: "Receivables",
        purpose: "Outstanding and ageing.",
        how: "Watch group exposure.",
        to: "/receivables",
      },
      {
        label: "Payments received",
        purpose: "Cash booked against invoices.",
        how: "Audit allocations when collections look off.",
        to: "/payments",
      },
      {
        label: "Credit control",
        purpose: "Limits, breaches and notes.",
        how: "Override carefully when Sales needs room.",
        to: "/credit",
      },
      {
        label: "Accounts reports",
        purpose: "Money reports for the group.",
        how: "Export for leadership review.",
        to: "/reports",
      },
      {
        label: "Analytics",
        purpose: "Cross-module trends.",
        how: "Use with Dashboard widgets.",
        to: "/analytics",
      },
      {
        label: "Administration",
        purpose: "Users, roles and company setup.",
        how: "Create users and assign roles.",
        to: "/admin",
      },
    ],
  },
};

export function guideForRole(role: string | undefined | null): RoleGuide {
  const key = (role || "").trim().toLowerCase();
  return GUIDES[key] || GUIDES.sales;
}
