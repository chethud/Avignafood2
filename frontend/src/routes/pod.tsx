import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { api, apiUpload, mediaUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { kg, type LogisticsRun, type LogisticsStop } from "@/components/erp/logistics-flow";

export const Route = createFileRoute("/pod")({
  head: () => ({
    meta: [{ title: "POD · Avighna" }],
  }),
  component: Pod,
});

type Row = { run: LogisticsRun; stop: LogisticsStop };

function Pod() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [active, setActive] = useState<Row | null>(null);
  const [receiver, setReceiver] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const runs = await api<LogisticsRun[]>("/api/v1/logistics/runs");
      const pending: Row[] = [];
      const done: Row[] = [];
      for (const run of runs) {
        for (const stop of run.stops) {
          if (!["delivered", "partial"].includes(stop.status)) continue;
          const row = { run, stop };
          if (!stop.pod_url) pending.push(row);
          else done.push(row);
        }
      }
      setRows([...pending, ...done]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load POD");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function takePhoto(file: File) {
    setBusy(true);
    setError("");
    try {
      const up = await apiUpload("/api/v1/deliveries/upload", file);
      setUrl(up.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!active) return;
    const name = receiver.trim();
    if (!url && !name) {
      setError("Enter receiver name (photo optional)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/logistics/stops/${active.stop.id}/pod`, {
        method: "POST",
        body: JSON.stringify({
          pod_url: url || null,
          receiver_name: name || null,
        }),
      });
      setActive(null);
      setUrl("");
      setReceiver("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save POD");
    } finally {
      setBusy(false);
    }
  }

  const pending = rows.filter((r) => !r.stop.pod_url);
  const received = rows.filter((r) => r.stop.pod_url);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">POD</h1>
        <p className="mt-1 text-sm text-muted-foreground">Confirm delivery with receiver name; photo is optional.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Pending POD</h2>
        {pending.map((r) => (
          <article key={r.stop.id} className="rounded-2xl border border-border bg-card px-3 py-3">
            <p className="font-medium">SO-{r.stop.sales_order_id}</p>
            <p className="text-sm text-muted-foreground">{r.stop.customer_name}</p>
            <p className="mt-1 text-sm">
              {kg(r.stop.qty_delivered || r.stop.qty_ordered)} · {r.stop.receiver_name || "No receiver yet"}
            </p>
            <button
              type="button"
              onClick={() => {
                setActive(r);
                setReceiver(r.stop.receiver_name || "");
                setUrl("");
              }}
              className="mt-2 min-h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground"
            >
              Upload POD
            </button>
          </article>
        ))}
        {!pending.length && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No pending POD.
          </p>
        )}
      </section>

      {received.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">POD received</h2>
          {received.map((r) => (
            <article key={r.stop.id} className="rounded-2xl border border-border bg-card px-3 py-3">
              <p className="font-medium">SO-{r.stop.sales_order_id}</p>
              <p className="text-sm text-muted-foreground">{r.stop.customer_name}</p>
              <p className="mt-1 text-sm">{r.stop.receiver_name || "Received"}</p>
            </article>
          ))}
        </section>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
            <p className="text-lg font-semibold">POD · SO-{active.stop.sales_order_id}</p>
            <p className="text-sm text-muted-foreground">{active.stop.customer_name}</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void takePhoto(f);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                "mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-medium",
                url ? "border-primary bg-primary/10" : "border-border",
              )}
            >
              <Camera className="size-5" />
              {url ? "Photo attached" : "Take photo (optional)"}
            </button>
            {url && (
              <img src={mediaUrl(url)} alt="POD" className="mt-2 max-h-40 w-full rounded-xl object-cover" />
            )}
            <label className="mt-3 block text-sm">
              Received by
              <input
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                placeholder="Required if no photo"
              />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="min-h-11 rounded-xl border border-border text-sm"
                onClick={() => setActive(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || (!url && !receiver.trim())}
                onClick={() => void save()}
                className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                Save POD
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
