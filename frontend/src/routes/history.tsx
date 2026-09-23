import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, mediaUrl } from "@/lib/api";
import { mapsHref, telHref } from "@/lib/format";
import {
  kg,
  runDateLabel,
  slotLabel,
  statusLabel,
  type LogisticsRun,
  type LogisticsStop,
} from "@/components/erp/logistics-flow";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [{ title: "History · Avighna" }],
  }),
  component: HistoryScreen,
});

type HistoryRow = {
  run: LogisticsRun;
  stop: LogisticsStop;
};

const DONE = new Set(["delivered", "partial", "failed", "completed"]);

export function HistoryScreen() {
  const [runs, setRuns] = useState<LogisticsRun[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<HistoryRow | null>(null);

  useEffect(() => {
    setLoading(true);
    api<LogisticsRun[]>("/api/v1/logistics/runs?history_only=true")
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load history"))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const out: HistoryRow[] = [];
    for (const run of runs) {
      for (const stop of run.stops || []) {
        if (DONE.has(stop.status)) {
          out.push({ run, stop });
        }
      }
    }
    return out.sort((a, b) => {
      const d = String(b.run.on_date || "").localeCompare(String(a.run.on_date || ""));
      if (d) return d;
      return b.stop.id - a.stop.id;
    });
  }, [runs]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tap a delivery to see full details.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <section className="space-y-2">
        {rows.map(({ run, stop }) => (
          <button
            key={`${run.id}-${stop.id}`}
            type="button"
            onClick={() => setOpen({ run, stop })}
            className="w-full rounded-2xl border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-secondary/40"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {stop.company_name || "Avighna"}
              </p>
              <span className="text-xs font-medium">{statusLabel(stop.status)}</span>
            </div>
            <p className="mt-1 font-medium">{stop.customer_name}</p>
            <p className="text-sm">{stop.product_summary || kg(stop.qty_ordered)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {runDateLabel(run.on_date)}
              {run.slot ? ` · ${slotLabel(run.slot)}` : ""}
              {run.number ? ` · ${run.number}` : ""}
              {stop.invoice_number ? ` · ${stop.invoice_number}` : ""}
            </p>
            {stop.qty_delivered != null && Number(stop.qty_delivered) > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Delivered {kg(stop.qty_delivered)}
                {stop.receiver_name ? ` · ${stop.receiver_name}` : ""}
              </p>
            )}
            {stop.fail_reason && <p className="mt-1 text-xs text-destructive">{stop.fail_reason}</p>}
          </button>
        ))}
        {!loading && !rows.length && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No completed drops yet. Finished deliveries will show here.
          </p>
        )}
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => setOpen(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-detail-title"
            className="relative z-10 max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-5"
          >
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              {open.stop.company_name || "Avighna"} · {statusLabel(open.stop.status)}
            </p>
            <h2 id="history-detail-title" className="mt-1 text-xl font-semibold tracking-tight">
              {open.stop.customer_name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {runDateLabel(open.run.on_date)}
              {open.run.slot ? ` · ${slotLabel(open.run.slot)}` : ""}
              {open.run.number ? ` · ${open.run.number}` : ""}
            </p>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">Product</dt>
                <dd className="mt-0.5 font-medium">{open.stop.product_summary || kg(open.stop.qty_ordered)}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Ordered</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{kg(open.stop.qty_ordered)}</dd>
                </div>
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Delivered</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{kg(open.stop.qty_delivered)}</dd>
                </div>
              </div>
              {open.stop.invoice_number && (
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Invoice</dt>
                  <dd className="mt-0.5 font-medium">{open.stop.invoice_number}</dd>
                </div>
              )}
              {open.stop.receiver_name && (
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Receiver</dt>
                  <dd className="mt-0.5 font-medium">{open.stop.receiver_name}</dd>
                </div>
              )}
              {(open.run.vehicle_plate || open.run.driver_name) && (
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Vehicle / driver</dt>
                  <dd className="mt-0.5 font-medium">
                    {[open.run.vehicle_plate, open.run.driver_name].filter(Boolean).join(" · ")}
                  </dd>
                </div>
              )}
            </dl>

            {open.stop.address && (
              <a
                href={mapsHref(open.stop.address)}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block text-sm text-primary"
              >
                {open.stop.address}
              </a>
            )}
            {open.stop.phone && (
              <a href={telHref(open.stop.phone)} className="mt-1 block text-sm font-medium">
                {open.stop.phone}
              </a>
            )}
            {open.stop.fail_reason && (
              <p className="mt-3 text-sm text-destructive">Failed: {open.stop.fail_reason}</p>
            )}
            {open.stop.remarks && (
              <p className="mt-2 text-sm text-muted-foreground">Remarks: {open.stop.remarks}</p>
            )}

            {(open.stop.pod_url || open.stop.signature_url) && (
              <div className="mt-4 space-y-3">
                {open.stop.pod_url && (
                  <div>
                    <p className="text-xs text-muted-foreground">POD photo</p>
                    <img
                      src={mediaUrl(open.stop.pod_url)}
                      alt="Proof of delivery"
                      className="mt-1 max-h-48 w-full rounded-xl border border-border object-contain bg-background"
                    />
                  </div>
                )}
                {open.stop.signature_url && (
                  <div>
                    <p className="text-xs text-muted-foreground">Signature</p>
                    <img
                      src={mediaUrl(open.stop.signature_url)}
                      alt="Receiver signature"
                      className="mt-1 max-h-36 w-full rounded-xl border border-border object-contain bg-background"
                    />
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="mt-5 min-h-11 w-full rounded-xl border border-border text-sm font-medium"
              onClick={() => setOpen(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
