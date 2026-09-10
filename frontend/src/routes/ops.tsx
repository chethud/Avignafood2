import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { firmLabelByCompanyId } from "@/lib/erp-data";
import { useMe } from "@/lib/me-context";
import { Badge, PageHeader, Panel } from "@/components/erp/ui-bits";
import { SLOTS, type SlotKey, type VehicleAvail } from "@/components/erp/VehicleBoard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ops")({
  head: () => ({
    meta: [
      { title: "Order desk · Avighna ERP" },
      {
        name: "description",
        content: "After Accounts invoices, Sales or Supervisor pick vehicle then logistics driver for shipment.",
      },
    ],
  }),
  component: OrderDesk,
});

type DeskLine = {
  product_id: number;
  product_name: string;
  quantity: string | number;
  unit_price: string | number;
  on_hand: string | number;
  ok: boolean;
  outstanding_qty?: string | number;
};

type DeskOrder = {
  id: number;
  company_id: number;
  company_name?: string | null;
  customer_id: number;
  customer_name: string;
  quotation_id: number | null;
  warehouse_id: number;
  status: string;
  ops_status: string;
  notes: string | null;
  confirmed_at: string | null;
  created_at: string | null;
  lines: DeskLine[];
  stock_ok: boolean;
  dispatch_id: number | null;
  purchase_id: number | null;
  purchase_status: string | null;
  slot_date: string | null;
  slot: string | null;
  vehicle: string | null;
};

type DriverOpt = { id: number; full_name: string; phone: string | null; email: string };

type Filter = "all" | "ready" | "pending_verify" | "shortage" | "procuring" | "allocated";

type AllotDraft = { date: string; slot: SlotKey | ""; vehicleId: number | ""; driverUserId: number | "" };

const EMPTY_ALLOT: AllotDraft = { date: "", slot: "", vehicleId: "", driverUserId: "" };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_verify", label: "Confirm stock" },
  { id: "ready", label: "Ready to book" },
  { id: "shortage", label: "Shortage" },
  { id: "procuring", label: "Procuring" },
  { id: "allocated", label: "Booked" },
];

function opsTone(status: string): "neutral" | "good" | "warn" | "bad" {
  if (status === "ready" || status === "allocated" || status === "dispatched") return "good";
  if (status === "shortage") return "bad";
  if (status === "procuring" || status === "pending_verify") return "warn";
  return "neutral";
}

function opsLabel(status: string) {
  return (
    {
      pending_verify: "Confirm stock",
      awaiting_invoice: "Waiting for invoice",
      pending_approval: "Waiting Super Admin",
      shortage: "Shortage",
      procuring: "Procuring",
      ready: "Ready — book truck",
      allocated: "Truck booked",
      dispatched: "Going",
    }[status] || status
  );
}

function kg(v: string | number) {
  return `${Number(v || 0).toLocaleString()} KG`;
}

function OrderDesk() {
  const { me } = useMe();
  const role = me?.user.role || "";
  const canAllot = role === "sales" || role === "supervisor" || role === "owner" || role === "super_admin";
  const [rows, setRows] = useState<DeskOrder[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fleet, setFleet] = useState<VehicleAvail[]>([]);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [drafts, setDrafts] = useState<Record<number, AllotDraft>>({});
  const [maker, setMaker] = useState("");
  const [prNotes, setPrNotes] = useState("");
  const [batch, setBatch] = useState("");
  const [receiveMaker, setReceiveMaker] = useState("");

  function draftFor(so: DeskOrder): AllotDraft {
    return drafts[so.id] || EMPTY_ALLOT;
  }

  function patchDraft(soId: number, patch: Partial<AllotDraft>) {
    setDrafts((prev) => {
      const base = prev[soId] || EMPTY_ALLOT;
      return { ...prev, [soId]: { ...base, ...patch } };
    });
  }

  async function loadDesk() {
    try {
      const data = await api<DeskOrder[]>("/api/v1/sales-orders/desk");
      setRows(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load order desk");
    }
  }

  async function loadFleet(onDate: string) {
    try {
      const all = await api<VehicleAvail[]>(`/api/v1/vehicles/availability/all?on_date=${onDate}`);
      setFleet(all);
    } catch {
      try {
        const one = await api<VehicleAvail>(`/api/v1/vehicles/availability?on_date=${onDate}`);
        setFleet([one]);
      } catch {
        setFleet([]);
      }
    }
  }

  async function loadDrivers() {
    try {
      const rows = await api<DriverOpt[]>("/api/v1/vehicles/drivers");
      setDrivers(rows);
    } catch {
      setDrivers([]);
    }
  }

  useEffect(() => {
    void loadDesk();
    void loadDrivers();
  }, []);

  useEffect(() => {
    if (!canAllot || !rows.length) return;
    const d = rows.find((r) => r.slot_date)?.slot_date || new Date().toISOString().slice(0, 10);
    void loadFleet(d);
  }, [canAllot, rows]);

  const visible = useMemo(() => {
    if (filter === "all") {
      return rows.filter((r) =>
        ["ready", "shortage", "procuring", "allocated", "pending_verify"].includes(r.ops_status),
      );
    }
    if (filter === "allocated") return rows.filter((r) => r.ops_status === "allocated" || r.ops_status === "dispatched");
    return rows.filter((r) => r.ops_status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.ops_status] = (c[r.ops_status] || 0) + 1;
    c.allocated = (c.allocated || 0) + (c.dispatched || 0);
    return c;
  }, [rows]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await loadDesk();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Order desk"
        subtitle="After Accounts invoices: pick date + window, then vehicle, then logistics driver. Owner adds trucks and logistics logins in Administration."
      />
      {!canAllot && (
        <Panel className="mb-4">
          <p className="text-sm text-muted-foreground">
            Driver allotment is for Sales or Supervisor after Accounts raises the invoice. Logistics only drives what you assign.
          </p>
        </Panel>
      )}
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      {canAllot && (
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n =
            f.id === "all"
              ? rows.filter((r) =>
                  ["ready", "shortage", "procuring", "allocated", "pending_verify"].includes(r.ops_status),
                ).length
              : counts[f.id] || 0;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium",
                filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary",
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-80">{n}</span>
            </button>
          );
        })}
      </div>
      )}

      {canAllot && !visible.length && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No orders ready to book. Flow: Sales creates → Owner approves → Accounts raises invoice → then Supervisor or Sales assign date + window + vehicle + driver → Logistics drives.
          </p>
          <Link to="/sales" className="mt-3 inline-block text-sm font-medium text-primary">
            Go to Sales orders →
          </Link>
        </Panel>
      )}

      {canAllot && (
      <div className="space-y-4">
        {visible.map((so) => {
          const draft = draftFor(so);
          const selected = fleet.find((v) => v.vehicle_id === draft.vehicleId);
          const selectedDriver = drivers.find((d) => d.id === draft.driverUserId);
          const slotFree = selected && draft.slot ? selected[draft.slot] === "free" : false;
          const canBook = so.ops_status === "ready";
          const allotComplete = Boolean(draft.date && draft.slot && draft.vehicleId && draft.driverUserId);

          return (
            <Panel
              key={so.id}
              title={`SO-${so.id} · ${so.customer_name}`}
              hint={`${so.company_name || firmLabelByCompanyId(so.company_id)}${so.confirmed_at ? ` · Confirmed ${so.confirmed_at.slice(0, 10)}` : ""}`}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{so.company_name || firmLabelByCompanyId(so.company_id)}</Badge>
                <Badge tone={opsTone(so.ops_status)}>{opsLabel(so.ops_status)}</Badge>
                {so.dispatch_id && (
                  <Badge tone="good">
                    {so.slot_date || ""} {so.slot || ""} {so.vehicle ? `· ${so.vehicle}` : ""}
                  </Badge>
                )}
              </div>

              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Product</th>
                      <th className="pb-2 pr-3 font-medium">Need</th>
                      <th className="pb-2 pr-3 font-medium">On hand</th>
                      <th className="pb-2 font-medium">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {so.lines.map((ln) => (
                      <tr key={ln.product_id}>
                        <td className="py-2 pr-3">{ln.product_name}</td>
                        <td className="py-2 pr-3 tabular-nums">{kg(ln.quantity)}</td>
                        <td className="py-2 pr-3 tabular-nums">{kg(ln.on_hand)}</td>
                        <td className="py-2">
                          <Badge tone={ln.ok ? "good" : "bad"}>{ln.ok ? "OK" : "Short"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {so.ops_status === "pending_verify" && (
                <div className="mt-4">
                  <button
                    type="button"
                    disabled={busy === `v-${so.id}`}
                    onClick={() =>
                      run(`v-${so.id}`, () =>
                        api(`/api/v1/sales-orders/${so.id}/verify-stock`, {
                          method: "POST",
                          companyId: so.company_id,
                        }).then(() => undefined),
                      )
                    }
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {busy === `v-${so.id}` ? "Confirming…" : "Confirm stock → Ready"}
                  </button>
                </div>
              )}

              {so.ops_status === "shortage" && (
                <div className="mt-4 space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
                  <p className="text-sm text-muted-foreground">Stock short — raise purchase or complete remaining after inward. Then you can book a truck.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">
                      Manufacturer
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={maker}
                        onChange={(e) => setMaker(e.target.value)}
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Notes
                      <input
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={prNotes}
                        onChange={(e) => setPrNotes(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={busy === `pr-${so.id}`}
                    onClick={() =>
                      run(`pr-${so.id}`, () =>
                        api(`/api/v1/sales-orders/${so.id}/raise-purchase`, {
                          method: "POST",
                          companyId: so.company_id,
                          body: JSON.stringify({ manufacturer: maker || null, notes: prNotes || null }),
                        }).then(() => undefined),
                      )
                    }
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {busy === `pr-${so.id}` ? "Raising…" : "Raise purchase"}
                  </button>
                </div>
              )}

              {so.ops_status === "procuring" && (
                <div className="mt-4 space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
                  {so.purchase_status === "pending_approval" && (
                    <p className="text-sm text-muted-foreground">Waiting Owner/Admin to approve PR-{so.purchase_id}.</p>
                  )}
                  {(so.purchase_status === "approved" || so.purchase_status === "Approved") && (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-muted-foreground">
                          Batch
                          <input
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            value={batch}
                            onChange={(e) => setBatch(e.target.value)}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Manufacturer
                          <input
                            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                            value={receiveMaker}
                            onChange={(e) => setReceiveMaker(e.target.value)}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        disabled={busy === `rx-${so.id}` || !so.purchase_id}
                        onClick={() =>
                          run(`rx-${so.id}`, () =>
                            api(`/api/v1/purchases/${so.purchase_id}/receive`, {
                              method: "POST",
                              companyId: so.company_id,
                              body: JSON.stringify({
                                batch: batch || null,
                                manufacturer: receiveMaker || null,
                                notes: `GRN SO-${so.id}`,
                              }),
                            }).then(() => undefined),
                          )
                        }
                        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
                      >
                        {busy === `rx-${so.id}` ? "Receiving…" : "Receive + batch inward"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {canBook && so.ops_status === "ready" && (
                <div className="mt-4 space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-medium">Book truck for this order</p>
                  <p className="text-xs text-muted-foreground">
                    1) Date &amp; window · 2) Vehicle · 3) Logistics driver. Drivers are role accounts Owner creates — not tied to the truck.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">
                      Date
                      <input
                        type="date"
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={draft.date}
                        onChange={(e) => {
                          const date = e.target.value;
                          patchDraft(so.id, { date, vehicleId: "", driverUserId: "" });
                          if (date) void loadFleet(date);
                        }}
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Window
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={draft.slot}
                        onChange={(e) =>
                          patchDraft(so.id, {
                            slot: (e.target.value || "") as SlotKey | "",
                            vehicleId: "",
                            driverUserId: "",
                          })
                        }
                      >
                        <option value="">Choose window</option>
                        {SLOTS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      1. Vehicle
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={draft.vehicleId}
                        disabled={!draft.date || !draft.slot}
                        onChange={(e) =>
                          patchDraft(so.id, {
                            vehicleId: e.target.value ? Number(e.target.value) : "",
                            driverUserId: "",
                          })
                        }
                      >
                        <option value="">
                          {!draft.date || !draft.slot
                            ? "Pick date + window first"
                            : fleet.length
                              ? "Choose vehicle"
                              : "No vehicles — Owner adds fleet in Admin"}
                        </option>
                        {draft.date &&
                          draft.slot &&
                          fleet.map((v) => (
                            <option key={v.vehicle_id} value={v.vehicle_id}>
                              {v.name} · {v.plate} · {v[draft.slot]}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      2. Logistics driver
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={draft.driverUserId}
                        disabled={!draft.vehicleId}
                        onChange={(e) =>
                          patchDraft(so.id, { driverUserId: e.target.value ? Number(e.target.value) : "" })
                        }
                      >
                        <option value="">
                          {!draft.vehicleId
                            ? "Select vehicle first"
                            : drivers.length
                              ? "Choose driver"
                              : "No logistics users — Owner creates in Admin"}
                        </option>
                        {draft.vehicleId &&
                          drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.full_name}
                              {d.phone ? ` · ${d.phone}` : ""}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  {selected && draft.slot && draft.date && (
                    <p className="text-xs text-muted-foreground">
                      {selected.name} · {draft.slot} on {draft.date}:{" "}
                      <span className={slotFree ? "text-success" : "text-destructive"}>
                        {slotFree ? "free" : "already has drops"}
                      </span>
                      {selectedDriver ? ` · driver ${selectedDriver.full_name}` : ""}
                      {!slotFree ? " — you can still add this order to the same window." : "."}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy === `a-${so.id}` || !allotComplete}
                    onClick={() =>
                      run(`a-${so.id}`, () =>
                        api(`/api/v1/sales-orders/${so.id}/allocate`, {
                          method: "POST",
                          companyId: so.company_id,
                          body: JSON.stringify({
                            on_date: draft.date,
                            slot: draft.slot,
                            vehicle_id: draft.vehicleId,
                            driver_user_id: draft.driverUserId,
                          }),
                        }).then(() => undefined),
                      )
                    }
                    className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto"
                  >
                    {busy === `a-${so.id}` ? "Booking…" : "Assign vehicle + driver"}
                  </button>
                </div>
              )}

              {so.ops_status === "allocated" && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Booked
                    {so.slot_date ? ` ${so.slot_date}` : ""}
                    {so.slot ? ` · ${so.slot}` : ""}
                    {so.vehicle ? ` · ${so.vehicle}` : ""}. Logistics sees this on Today. Change vehicle/driver only before Going.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">
                      Change vehicle
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={draft.vehicleId}
                        onChange={(e) =>
                          patchDraft(so.id, {
                            vehicleId: e.target.value ? Number(e.target.value) : "",
                            driverUserId: "",
                          })
                        }
                      >
                        <option value="">Choose vehicle</option>
                        {fleet.map((v) => (
                          <option key={v.vehicle_id} value={v.vehicle_id}>
                            {v.name} · {v.plate}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Change driver
                      <select
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        value={draft.driverUserId}
                        disabled={!draft.vehicleId}
                        onChange={(e) =>
                          patchDraft(so.id, { driverUserId: e.target.value ? Number(e.target.value) : "" })
                        }
                      >
                        <option value="">{!draft.vehicleId ? "Select vehicle first" : "Choose driver"}</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={busy === `r-${so.id}` || !draft.vehicleId || !draft.driverUserId}
                    onClick={() =>
                      run(`r-${so.id}`, () =>
                        api(`/api/v1/sales-orders/${so.id}/reassign-vehicle`, {
                          method: "POST",
                          companyId: so.company_id,
                          body: JSON.stringify({
                            vehicle_id: draft.vehicleId,
                            driver_user_id: draft.driverUserId,
                          }),
                        }).then(() => undefined),
                      )
                    }
                    className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:opacity-60"
                  >
                    {busy === `r-${so.id}` ? "Updating…" : "Update vehicle + driver"}
                  </button>
                </div>
              )}
            </Panel>
          );
        })}
      </div>
      )}
    </>
  );
}
