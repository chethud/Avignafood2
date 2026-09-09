import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  FAIL_REASONS,
  NEXT_STATUS,
  kg,
  statusLabel,
  type LogisticsRun,
  type LogisticsStop,
} from "@/components/erp/logistics-flow";

export const Route = createFileRoute("/deliveries")({
  head: () => ({
    meta: [{ title: "Deliveries · Avighna" }],
  }),
  component: Deliveries,
});

function Deliveries() {
  const [runs, setRuns] = useState<LogisticsRun[]>([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState<{ run: LogisticsRun; stop: LogisticsStop } | null>(null);
  const [outcome, setOutcome] = useState<"delivered" | "partial" | "failed">("delivered");
  const [qty, setQty] = useState("");
  const [receiver, setReceiver] = useState("");
  const [reason, setReason] = useState(FAIL_REASONS[0]);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const rows = await api<LogisticsRun[]>("/api/v1/logistics/runs?open_only=true");
      setRuns(rows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load deliveries");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const live = runs.filter((r) =>
    ["dispatched", "in_transit", "out_for_delivery", "partial"].includes(r.status),
  );

  async function advance(run: LogisticsRun, to: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/logistics/runs/${run.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: to }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update trip");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/logistics/stops/${active.stop.id}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          outcome,
          qty_delivered: outcome === "partial" ? Number(qty) || 0 : null,
          receiver_name: receiver.trim() || null,
          fail_reason: outcome === "failed" ? reason : null,
          remarks: remarks.trim() || null,
        }),
      });
      setActive(null);
      setQty("");
      setReceiver("");
      setRemarks("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save delivery");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Deliveries</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track in-transit orders. Update each stop separately.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {live.map((r) => (
        <section key={r.id} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">{r.number}</h2>
            <span className="text-xs text-muted-foreground">{statusLabel(r.status)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {r.vehicle_plate || "—"} · {r.driver_name || "—"}
          </p>
          {(NEXT_STATUS[r.status] || []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(NEXT_STATUS[r.status] || []).map((n) => (
                <button
                  key={n.to}
                  type="button"
                  disabled={busy}
                  onClick={() => void advance(r, n.to)}
                  className="min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {n.label}
                </button>
              ))}
            </div>
          )}
          {r.stops.map((s) => (
            <article key={s.id} className="rounded-2xl border border-border bg-card px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-medium">SO-{s.sales_order_id}</span>
                  <span className="text-sm text-muted-foreground">{s.customer_name}</span>
                </span>
                <span className="text-xs font-medium">{statusLabel(s.status)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.address || "—"}</p>
              <p className="mt-1 text-sm">{kg(s.qty_ordered)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.phone && (
                  <a href={telHref(s.phone)} className="min-h-11 rounded-xl border border-border px-3 text-sm leading-[2.75rem]">
                    Call customer
                  </a>
                )}
                {["pending", "out_for_delivery"].includes(s.status) && (
                  <button
                    type="button"
                    onClick={() => {
                      setActive({ run: r, stop: s });
                      setOutcome("delivered");
                      setQty("");
                      setReceiver("");
                      setRemarks("");
                    }}
                    className="min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
                  >
                    Update status
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      ))}

      {!live.length && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No trips in transit. Confirm dispatch first.
        </p>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
            <p className="text-lg font-semibold">SO-{active.stop.sales_order_id}</p>
            <p className="text-sm text-muted-foreground">{active.stop.customer_name}</p>
            <div className="mt-3 grid grid-cols-3 gap-1">
              {(["delivered", "partial", "failed"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={cn(
                    "min-h-11 rounded-xl border text-xs font-medium",
                    outcome === o ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border",
                  )}
                >
                  {o === "delivered" ? "Delivered" : o === "partial" ? "Partial" : "Failed"}
                </button>
              ))}
            </div>
            {outcome === "delivered" && (
              <label className="mt-3 block text-sm">
                Received by
                <input
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                  value={receiver}
                  onChange={(e) => setReceiver(e.target.value)}
                />
              </label>
            )}
            {outcome === "partial" && (
              <>
                <label className="mt-3 block text-sm">
                  Qty delivered
                  <input
                    type="number"
                    inputMode="decimal"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder={`Of ${active.stop.qty_ordered}`}
                  />
                </label>
                <label className="mt-3 block text-sm">
                  Received by
                  <input
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                    value={receiver}
                    onChange={(e) => setReceiver(e.target.value)}
                  />
                </label>
              </>
            )}
            {outcome === "failed" && (
              <label className="mt-3 block text-sm">
                Reason
                <select
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {FAIL_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="mt-3 block text-sm">
              Remarks
              <input
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="min-h-11 rounded-xl border border-border text-sm" onClick={() => setActive(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
