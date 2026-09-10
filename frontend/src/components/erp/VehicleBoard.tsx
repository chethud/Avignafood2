import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type LiveStatus = "idle" | "going" | "returning";
export type SlotKey = "morning" | "afternoon" | "evening";
export type SlotState = "free" | "booked";

export type VehicleAvail = {
  vehicle_id: number;
  name: string;
  plate: string;
  kind: string;
  driver_name: string | null;
  live_status: LiveStatus;
  morning: SlotState;
  afternoon: SlotState;
  evening: SlotState;
  morning_for?: string | null;
  afternoon_for?: string | null;
  evening_for?: string | null;
};

export const SLOTS: { key: SlotKey; label: string; forKey: "morning_for" | "afternoon_for" | "evening_for" }[] = [
  { key: "morning", label: "Morning", forKey: "morning_for" },
  { key: "afternoon", label: "Afternoon", forKey: "afternoon_for" },
  { key: "evening", label: "Evening", forKey: "evening_for" },
];

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

export function todayIso() {
  return isoDate(new Date());
}

async function loadFleet(onDate: string): Promise<VehicleAvail[]> {
  try {
    return await api<VehicleAvail[]>(`/api/v1/vehicles/availability/all?on_date=${onDate}`);
  } catch {
    try {
      const one = await api<VehicleAvail>(`/api/v1/vehicles/availability?on_date=${onDate}`);
      return [one];
    } catch {
      return [];
    }
  }
}

export function VehicleGlance({
  onDate,
  onDateChange,
}: {
  onDate?: string;
  onDateChange?: (d: string) => void;
} = {}) {
  const [inner, setInner] = useState(todayIso);
  const date = onDate ?? inner;
  const setDate = (d: string) => {
    setInner(d);
    onDateChange?.(d);
  };
  const [fleet, setFleet] = useState<VehicleAvail[]>([]);

  useEffect(() => {
    void loadFleet(date).then(setFleet);
  }, [date]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Trucks</p>
        <input
          type="date"
          className="rounded-xl border border-border bg-card px-2 py-1.5 text-sm"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {fleet.length ? (
        <ul className="space-y-2">
          {fleet.map((truck) => (
            <li key={truck.vehicle_id} className="rounded-2xl border border-border bg-card px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="block font-medium">{truck.name}</span>
                  <span className="text-xs text-muted-foreground">{truck.plate}</span>
                </span>
                <LivePill status={truck.live_status} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {truck.live_status === "idle" && "Idle. You can promise another drop."}
                {truck.live_status === "going" && "Going. Out with goods. Do not add another now."}
                {truck.live_status === "returning" && "Coming back empty. Free once he reaches base."}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {SLOTS.map((s) => (
                  <SlotChip key={s.key} label={s.label} status={truck[s.key]} detail={truck[s.forKey]} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No vehicle listed yet. New trucks appear here when added to the fleet.</p>
      )}
    </section>
  );
}

export function VehicleEditor({
  date,
  onDateChange,
  onUpdated,
}: {
  date?: string;
  onDateChange?: (d: string) => void;
  onUpdated?: () => void;
} = {}) {
  const [inner, setInner] = useState(date || tomorrowIso);
  const onDate = date ?? inner;
  const setOnDate = (d: string) => {
    setInner(d);
    onDateChange?.(d);
  };
  const [truck, setTruck] = useState<VehicleAvail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<VehicleAvail>(`/api/v1/vehicles/availability?on_date=${onDate}`)
      .then((row) => {
        setTruck(row);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, [onDate]);

  async function setSlot(slot: SlotKey, status: SlotState) {
    if (!truck) return;
    if (status === "booked") {
      setError("Book a truck only from Order desk by assigning an order");
      return;
    }
    try {
      setTruck(
        await api<VehicleAvail>(`/api/v1/vehicles/${truck.vehicle_id}/slot`, {
          method: "PUT",
          body: JSON.stringify({ on_date: onDate, slot, status }),
        }),
      );
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    }
  }

  return (
    <section className="space-y-3">
      <input
        type="date"
        className="min-h-12 w-full rounded-2xl border border-border bg-card px-3 text-sm"
        value={onDate}
        onChange={(e) => setOnDate(e.target.value)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {truck && (
        <div className="grid grid-cols-3 gap-2">
          {SLOTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => void setSlot(s.key, truck[s.key] === "booked" ? "free" : "booked")}
              className={cn(
                "min-h-20 rounded-2xl border px-1 py-2 text-center",
                truck[s.key] === "booked" ? "border-primary bg-primary/10" : "border-border bg-card",
              )}
            >
              <span className="block text-[0.65rem] uppercase tracking-wide text-muted-foreground">{s.label}</span>
              <span className="mt-1 block text-sm font-semibold">{truck[s.key] === "booked" ? "Booked" : "Free"}</span>
              {truck[s.forKey] && (
                <span className="mt-0.5 block truncate px-1 text-[10px] text-muted-foreground">{truck[s.forKey]}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SlotChip({ label, status, detail }: { label: string; status: SlotState; detail?: string | null }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-1 py-2 text-center",
        status === "booked" ? "border-primary/40 bg-primary/5" : "border-border",
      )}
    >
      <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{status === "booked" ? "Booked" : "Free"}</p>
      {detail ? <p className="mt-0.5 line-clamp-2 px-0.5 text-[10px] leading-tight text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function LivePill({ status }: { status: LiveStatus }) {
  const label = status === "idle" ? "Idle" : status === "going" ? "Going" : "Coming back";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold",
        status === "idle" && "bg-primary/15 text-primary",
        status === "going" && "bg-warning/20 text-warning-foreground",
        status === "returning" && "bg-secondary text-foreground",
      )}
    >
      {label}
    </span>
  );
}
