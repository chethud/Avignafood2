/** Interactive product tour — highlights real UI containers, then walks every page. */

import { guideForRole } from "@/lib/user-guide";

export type TourStep = {
  /** Matches data-tour="…" on a container */
  target: string;
  /** Route that must be open for the target to exist */
  route: string;
  title: string;
  body: string;
};

const TOUR_KEY = "avighna.tour";

export type TourState = { role: string; step: number };

export function readTour(): TourState | null {
  try {
    const raw = sessionStorage.getItem(TOUR_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TourState;
  } catch {
    return null;
  }
}

export function writeTour(state: TourState | null) {
  try {
    if (!state) sessionStorage.removeItem(TOUR_KEY);
    else sessionStorage.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("avighna-tour"));
}

export function startTour(role: string) {
  writeTour({ role: (role || "sales").toLowerCase(), step: 0 });
}

export function stopTour() {
  writeTour(null);
}

/** Home-screen container highlights (before page-by-page steps). */
export const HOME_TOURS: Record<string, TourStep[]> = {
  sales: [
    {
      target: "sales-home",
      route: "/",
      title: "Today (home)",
      body: "Your daily home. See visits logged today and stock at a glance before you promise qty to a customer.",
    },
    {
      target: "sales-log-visit",
      route: "/",
      title: "Log a visit",
      body: "Tap this to open Visit. That is where you check in on site and create the sales order (Own vehicle or Manufacturer).",
    },
    {
      target: "sales-vehicles",
      route: "/",
      title: "Vehicle windows",
      body: "See which truck slots are free today. Useful before you plan a driver on the order.",
    },
    {
      target: "sales-visits",
      route: "/",
      title: "Today’s visits",
      body: "Visits you already logged. Empty until you complete a field check-in.",
    },
    {
      target: "sales-stock",
      route: "/",
      title: "Inventory glance",
      body: "Quick stock check. Open Inventory for the full list before overselling.",
    },
    {
      target: "shell-nav-sales",
      route: "/",
      title: "Bottom tabs",
      body: "Visit · Inventory · Allot · Orders — jump between field work and booking a driver after Owner approves.",
    },
  ],
  accountant: [
    {
      target: "accounts-kpis",
      route: "/",
      title: "Money KPIs",
      body: "Today’s billing, total outstanding, overdue, due soon, and today’s collections. Tap a card to open that list.",
    },
    {
      target: "accounts-queue",
      route: "/",
      title: "Work queue",
      body: "Ready to invoice, pending payments, overdue, and credit alerts — your daily Accounts checklist.",
    },
    {
      target: "shell-nav",
      route: "/",
      title: "Sidebar menu",
      body: "Invoices, Receivables, Payments, Customers, Guide, More. Use these for the full money cycle.",
    },
    {
      target: "shell-company",
      route: "/",
      title: "Company switcher",
      body: "Accounts opens on All companies by default. Switch firm when you need one company’s books only.",
    },
    {
      target: "shell-bell",
      route: "/",
      title: "Notifications",
      body: "Invoice requests and alerts land here so you know what to raise next.",
    },
  ],
  logistics: [
    {
      target: "logistics-steps",
      route: "/",
      title: "Trip steps",
      body: "Select → Load → Go → Drop → Base. This bar shows where you are in the trip.",
    },
    {
      target: "logistics-shipments",
      route: "/",
      title: "Your shipments",
      body: "Orders allotted to you (only after Owner approve). Tap Confirm on a card, then confirm again in the popup.",
    },
    {
      target: "logistics-truck",
      route: "/",
      title: "Truck status",
      body: "After you confirm a shipment, use this block for Load / Go / return to base.",
    },
    {
      target: "shell-nav-logistics",
      route: "/",
      title: "Today & History",
      body: "Today is live work. History is past trips. Guide (?) is always in the header.",
    },
  ],
  supervisor: [
    {
      target: "supervisor-kpis",
      route: "/",
      title: "Ops KPIs",
      body: "Orders waiting for stock / allot, ready for dispatch, and low-stock warnings.",
    },
    {
      target: "supervisor-tabs",
      route: "/",
      title: "Overview / Outstanding",
      body: "Switch to Outstanding delivery when partial loads still need to go out.",
    },
    {
      target: "shell-nav",
      route: "/",
      title: "Order desk",
      body: "Use Order desk in the menu to verify stock and allot vehicle + driver after Accounts invoices.",
    },
    {
      target: "shell-company",
      route: "/",
      title: "Company",
      body: "Pick the firm you are running warehouse / allot for.",
    },
  ],
  owner: [
    {
      target: "shell-company",
      route: "/",
      title: "Company switcher",
      body: "Switch one firm or All companies. Numbers and approvals follow this choice.",
    },
    {
      target: "shell-bell",
      route: "/",
      title: "Notifications bell",
      body: "Pending order approvals and invoice requests appear here. Open Sales & approvals from the alert.",
    },
    {
      target: "shell-nav",
      route: "/",
      title: "Sidebar",
      body: "Sell, Operate, Money, Guide, Admin. This is how you move through the full order → cash cycle.",
    },
    {
      target: "owner-kpis",
      route: "/",
      title: "KPI strip",
      body: "Revenue and key metrics for the selected company / period. Customize layout if you want different widgets.",
    },
    {
      target: "owner-approvals",
      route: "/",
      title: "Needs your approval",
      body: "Draft sales orders waiting on you. Approve here or under Sales & approvals — then Accounts can invoice and drivers can get trips.",
    },
    {
      target: "owner-movement",
      route: "/",
      title: "Movement",
      body: "Dispatch pipeline by day — what is pending, loaded, or delivered.",
    },
  ],
  super_admin: [
    {
      target: "shell-company",
      route: "/",
      title: "Company switcher",
      body: "Use All companies for a group view, or one firm when you are fixing that company’s ops.",
    },
    {
      target: "shell-bell",
      route: "/",
      title: "Notifications",
      body: "Approvals waiting on Super Admin / Owner land here first.",
    },
    {
      target: "shell-nav",
      route: "/",
      title: "Full menu",
      body: "You see every module. Approve under Sales, bill under Invoices, allot under Order desk, users under Administration.",
    },
    {
      target: "owner-kpis",
      route: "/",
      title: "KPI strip",
      body: "Group performance cards. Change daily / monthly / yearly grain above the strip when available.",
    },
    {
      target: "owner-approvals",
      route: "/",
      title: "Approvals container",
      body: "This box lists draft orders. Open an item or go to Sales & approvals to Approve / Decline.",
    },
    {
      target: "owner-movement",
      route: "/",
      title: "Movement container",
      body: "Logistics pipeline for the selected day — not your driver phone; that is the Logistics login.",
    },
  ],
};

/** @deprecated use HOME_TOURS */
export const TOURS = HOME_TOURS;

export function tourStepsFor(role: string | null | undefined): TourStep[] {
  const key = (role || "").toLowerCase();
  const home = HOME_TOURS[key] || HOME_TOURS.sales;
  const guide = guideForRole(key);
  const pageSteps: TourStep[] = guide.screens
    .filter((s) => s.to !== "/")
    .map((s) => ({
      target: "page-guide",
      route: s.to,
      title: s.label,
      body: `${s.purpose} ${s.how}`,
    }));
  return [...home, ...pageSteps];
}
