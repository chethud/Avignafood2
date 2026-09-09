export const FAIL_REASONS = [
  "Customer unavailable",
  "Address problem",
  "Customer refused",
  "Vehicle issue",
  "Goods damaged",
  "Other",
];

export const SLOTS = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
] as const;

export type SlotKey = (typeof SLOTS)[number]["key"];

export type ReadyOrder = {
  id: number;
  customer_id: number;
  customer_name: string;
  address: string | null;
  phone: string | null;
  qty: string | number;
  value: string | number;
  ops_status: string;
  product_summary?: string;
  company_name?: string | null;
};

export type LogisticsStop = {
  id: number;
  sales_order_id: number;
  customer_id: number;
  customer_name: string;
  address: string | null;
  phone: string | null;
  status: string;
  qty_ordered: string | number;
  qty_delivered: string | number;
  receiver_name: string | null;
  pod_url: string | null;
  signature_url?: string | null;
  fail_reason: string | null;
  remarks: string | null;
  product_summary?: string;
  company_name?: string | null;
  invoice_id?: number | null;
  invoice_number?: string | null;
  return_required?: boolean;
  reattempt_date?: string | null;
};

export type LogisticsRun = {
  id: number;
  number: string;
  on_date: string;
  slot?: string;
  vehicle_id: number | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  agency: string;
  route: string | null;
  status: string;
  total_qty: string | number;
  truck_state?: string;
  stops: LogisticsStop[];
};

export type TruckNow = {
  status: "idle" | "going" | "coming_back" | string;
  vehicle_id: number | null;
  plate: string | null;
  name: string | null;
  driver_name: string | null;
  run_id: number | null;
  run_number: string | null;
  on_date?: string | null;
  slot?: string | null;
};

export type WindowRow = {
  slot: SlotKey;
  label: string;
  status: "free" | "booked";
  mine: boolean;
  run: LogisticsRun | null;
};

export function kg(v: string | number) {
  const n = Number(v || 0);
  if (n >= 1000) return `${(n / 1000).toLocaleString("en-IN")} MT`;
  return `${n.toLocaleString("en-IN")} KG`;
}

export function slotLabel(slot?: string) {
  const s = (slot || "afternoon").toLowerCase();
  return s === "morning" ? "Morning" : s === "evening" ? "Evening" : "Afternoon";
}

export const TRUCK_STATES = [
  { key: "idle" as const, title: "Idle", hint: "At base" },
  { key: "going" as const, title: "Going", hint: "Out with goods" },
  { key: "coming_back" as const, title: "Coming back", hint: "Last drop done" },
];

export type TruckStateKey = (typeof TRUCK_STATES)[number]["key"];

export const WORK_STEPS = [
  { key: "book", n: "1", title: "Assigned" },
  { key: "leave", n: "2", title: "Going" },
  { key: "deliver", n: "3", title: "Drop" },
  { key: "return", n: "4", title: "Base" },
] as const;

export type WorkPhase = (typeof WORK_STEPS)[number]["key"];

export function truckCopy(status: string) {
  if (status === "going") return TRUCK_STATES[1];
  if (status === "coming_back" || status === "returning") return TRUCK_STATES[2];
  return TRUCK_STATES[0];
}

export function truckKey(status?: string | null): TruckStateKey {
  if (status === "going") return "going";
  if (status === "coming_back" || status === "returning") return "coming_back";
  return "idle";
}

const GOING = ["dispatched", "in_transit", "out_for_delivery", "partial"];
const BOOKED = ["planned", "loading", "loaded"];

export function workPhase(run: LogisticsRun | null, status: string): WorkPhase {
  const key = truckKey(status);
  if (key === "going" && run) return "deliver";
  if (key === "coming_back") return "return";
  if (run && BOOKED.includes(run.status)) return "leave";
  return "book";
}

export function activeRun(runs: LogisticsRun[], status: string, runId?: number | null): LogisticsRun | null {
  if (runId) {
    const hit = runs.find((r) => r.id === runId);
    if (hit && !["completed", "cancelled"].includes(hit.status)) return hit;
  }
  const going = runs.find((r) => GOING.includes(r.status));
  const back = runs.find((r) => r.status === "returning");
  const booked = runs.find((r) => BOOKED.includes(r.status));
  const key = truckKey(status);
  if (key === "going") return going || booked || null;
  if (key === "coming_back") return back || going || null;
  return booked || null;
}

export function statusLabel(s: string) {
  return (
    {
      planned: "Assigned",
      loaded: "Loaded",
      dispatched: "Going",
      in_transit: "Going",
      out_for_delivery: "On the way",
      returning: "Coming back",
      completed: "Done",
      delivered: "Delivered",
      partial: "Partial",
      failed: "Failed",
      pending: "Waiting",
    }[s] || s.replaceAll("_", " ")
  );
}

export function stopCta(status: string, phase: WorkPhase) {
  if (status === "delivered") return "View delivery";
  if (status === "partial") return "View partial";
  if (status === "failed") return "View failed";
  if (phase !== "deliver") return "Leaves after Load & go";
  if (status === "out_for_delivery") return "Mark delivery";
  return "Start delivery";
}

export function canDeliver(status: string, phase: WorkPhase) {
  return phase === "deliver" && ["pending", "out_for_delivery"].includes(status);
}

export function outcomeCopy(outcome: "delivered" | "partial" | "failed") {
  if (outcome === "partial") {
    return { title: "Partial delivery", save: "Save partial", hint: "Enter the quantity they actually took." };
  }
  if (outcome === "failed") {
    return { title: "Delivery failed", save: "Save failed", hint: "Choose why it could not be delivered." };
  }
  return { title: "Complete delivery", save: "Save complete", hint: "Get a signature or photo from the receiver." };
}

export const NEXT_STATUS: Record<string, { to: string; label: string }[]> = {
  planned: [{ to: "going", label: "Go" }],
  loaded: [{ to: "going", label: "Go" }],
  dispatched: [],
  in_transit: [],
};
