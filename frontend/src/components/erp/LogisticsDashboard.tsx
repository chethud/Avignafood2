import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Truck } from "lucide-react";
import { api, apiUpload, getCompanyId, mediaUrl } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { greeting, mapsHref, money, telHref } from "@/lib/format";
import { firms } from "@/lib/erp-data";
import { cn } from "@/lib/utils";
import {
  FAIL_REASONS,
  WORK_STEPS,
  activeRun,
  canDeliver,
  kg,
  outcomeCopy,
  runDateLabel,
  runTripHeading,
  slotLabel,
  statusLabel,
  stopCta,
  truckCopy,
  truckKey,
  workPhase,
  type LogisticsRun,
  type LogisticsStop,
  type TruckNow,
  type TruckStateKey,
  type WorkPhase,
} from "@/components/erp/logistics-flow";

const STEP_INDEX: Record<WorkPhase, number> = {
  book: 0,
  leave: 1,
  deliver: 2,
  return: 3,
};

type InvoicePeek = {
  number: string;
  total: string | number;
  status: string;
  customer_name?: string | null;
};

function SignaturePad({ onChange }: { onChange: (file: File | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function up() {
    drawing.current = false;
    const c = canvasRef.current;
    if (!c) return;
    c.toBlob((blob) => {
      if (!blob) return onChange(null);
      onChange(new File([blob], "signature.png", { type: "image/png" }));
    });
  }

  function clear() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={640}
        height={220}
        className="h-28 w-full touch-none rounded-xl border border-border bg-background"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <button type="button" className="mt-1 text-xs text-muted-foreground" onClick={clear}>
        Clear
      </button>
    </div>
  );
}

export function LogisticsDashboard() {
  const { me } = useMe();
  const name = me?.user.full_name?.split(" ")[0] || "Logistics";
  const [truck, setTruck] = useState<TruckNow | null>(null);
  const [runs, setRuns] = useState<LogisticsRun[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ run: LogisticsRun; stop: LogisticsStop } | null>(null);
  const [step, setStep] = useState<"detail" | "deliver" | "invoice">("detail");
  const [outcome, setOutcome] = useState<"delivered" | "partial" | "failed">("delivered");
  const [qty, setQty] = useState("");
  const [receiver, setReceiver] = useState("");
  const [reason, setReason] = useState(FAIL_REASONS[0]);
  const [remarks, setRemarks] = useState("");
  const [photo, setPhoto] = useState("");
  const [sigFile, setSigFile] = useState<File | null>(null);
  const [ret, setRet] = useState(false);
  const [invoice, setInvoice] = useState<InvoicePeek | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const cardCamRef = useRef<HTMLInputElement>(null);
  const firm = firms.find((f) => String(f.companyId) === getCompanyId());

  async function load() {
    try {
      const [t, trips] = await Promise.all([
        api<TruckNow>("/api/v1/logistics/truck"),
        // Org-wide open assignments (not only today's date / current company)
        api<LogisticsRun[]>("/api/v1/logistics/runs?open_only=true"),
      ]);
      setTruck(t);
      setRuns(trips);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load today");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const live = truckCopy(truck?.status || "idle");
  const key = truckKey(truck?.status);
  const run = activeRun(runs, truck?.status || "idle", truck?.run_id);
  const phase = workPhase(run, truck?.status || "idle");
  /** Every open assigned trip (all companies / windows), not only the active truck run. */
  const assignedTrips = useMemo(() => {
    const doneStop = new Set(["delivered", "partial", "failed", "completed"]);
    const open = runs
      .filter((r) => !["completed", "cancelled", "delivered"].includes(r.status))
      .map((r) => ({
        ...r,
        stops: (r.stops || []).filter((s) => !doneStop.has(s.status)),
      }))
      .filter((r) => r.stops.length > 0);
    const slotRank = (s?: string) => (s === "morning" ? 0 : s === "afternoon" ? 1 : s === "evening" ? 2 : 3);
    return [...open].sort((a, b) => {
      const d = String(a.on_date || "").localeCompare(String(b.on_date || ""));
      if (d) return d;
      const s = slotRank(a.slot) - slotRank(b.slot);
      if (s) return s;
      return a.id - b.id;
    });
  }, [runs]);
  const allStops = useMemo(() => {
    const rows: { run: LogisticsRun; stop: LogisticsStop }[] = [];
    for (const trip of assignedTrips) {
      for (const stop of trip.stops || []) rows.push({ run: trip, stop });
    }
    return rows;
  }, [assignedTrips]);
  const current = useMemo(() => {
    const openStatuses = new Set(["pending", "out_for_delivery"]);
    const fromActive = run
      ? (run.stops || []).find((s) => openStatuses.has(s.status))
      : null;
    if (fromActive && run) return { run, stop: fromActive };
    return allStops.find((r) => openStatuses.has(r.stop.status)) || null;
  }, [run, allStops]);
  const nextLabel =
    phase === "book" && !assignedTrips.length
      ? "Waiting for assignment"
      : phase === "book" && assignedTrips.length
        ? "Open assigned trip"
        : phase === "leave"
          ? "Load & go"
          : phase === "deliver"
            ? current
              ? stopCta(current.stop.status, phase)
              : "Coming back"
            : "Arrived at base";
  const nextHint =
    phase === "book" && !assignedTrips.length
      ? "Sales or Supervisor allots date, window and vehicle on Order desk. Then it appears here."
      : phase === "book" && assignedTrips.length
        ? `${assignedTrips.length} trip(s) assigned. Tap Load & go on the trip you are driving.`
        : phase === "leave"
          ? `${slotLabel(run?.slot)} · ${runDateLabel(run?.on_date)} assigned. Tap Load & go when the truck is loaded.`
          : phase === "deliver"
            ? "Deliver each customer in order. Last drop flips the truck to Coming back."
            : "Drive to base. Tap Arrived at base so Sales sees Idle.";

  async function setLive(status: TruckStateKey) {
    if (status === key) return;
    setBusy(true);
    setError("");
    try {
      setTruck(
        await api<TruckNow>("/api/v1/logistics/truck", {
          method: "POST",
          body: JSON.stringify({ status }),
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update truck");
    } finally {
      setBusy(false);
    }
  }

  async function doNext() {
    if (phase === "book" && !assignedTrips.length) return;
    if (phase === "book" && assignedTrips.length) return void setLive("going");
    if (phase === "leave") return void setLive("going");
    if (phase === "deliver" && current) {
      setOpen(current);
      setOutcome("delivered");
      setStep("detail");
      return;
    }
    if (phase === "deliver") return void setLive("coming_back");
    return void setLive("idle");
  }

  async function takePhoto(file: File) {
    setBusy(true);
    try {
      const up = await apiUpload("/api/v1/deliveries/upload", file);
      setPhoto(up.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo");
    } finally {
      setBusy(false);
    }
  }

  async function saveDelivery() {
    if (!open) return;
    setBusy(true);
    setError("");
    try {
      let signatureUrl: string | null = null;
      if (sigFile) {
        const up = await apiUpload("/api/v1/deliveries/upload", sigFile);
        signatureUrl = up.url;
      }
      await api(`/api/v1/logistics/stops/${open.stop.id}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          outcome,
          qty_delivered: outcome === "partial" ? Number(qty) || 0 : null,
          receiver_name: receiver.trim() || null,
          pod_url: photo || null,
          signature_url: signatureUrl,
          fail_reason: outcome === "failed" ? reason : null,
          remarks: remarks.trim() || null,
          return_required: outcome === "failed" && ret,
        }),
      });
      setOpen(null);
      setStep("detail");
      setPhoto("");
      setSigFile(null);
      setRemarks("");
      setReceiver("");
      setRet(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save delivery");
    } finally {
      setBusy(false);
    }
  }

  async function showInvoice(stop: LogisticsStop) {
    if (!stop.invoice_id) {
      setInvoice(null);
      setStep("invoice");
      return;
    }
    try {
      setInvoice(await api<InvoicePeek>(`/api/v1/invoices/${stop.invoice_id}`));
    } catch {
      setInvoice({ number: stop.invoice_number || "—", total: 0, status: "pending" });
    }
    setStep("invoice");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold leading-tight">
          {greeting()}, {name}
        </h1>
      </div>

      <div className="rounded-2xl border border-border bg-card px-2 pb-3 pt-3">
        <div className="relative h-10" aria-hidden>
          <div className="absolute left-[12.5%] right-[12.5%] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary" />
          <div
            className="absolute left-[12.5%] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${(STEP_INDEX[phase] / 3) * 75}%` }}
          />
          <div className="relative grid h-10 grid-cols-4">
            {WORK_STEPS.map((s, i) => (
              <span key={s.key} className="flex items-center justify-center">
                <span
                  className={cn(
                    "size-2.5 rounded-full ring-4 ring-card",
                    i < STEP_INDEX[phase] ? "bg-primary" : "bg-border",
                    i === STEP_INDEX[phase] && "opacity-0",
                  )}
                />
              </span>
            ))}
          </div>
          <div
            className="absolute inset-y-0 left-0 flex w-1/4 items-center justify-center transition-transform duration-700 ease-out"
            style={{ transform: `translate3d(${STEP_INDEX[phase] * 100}%, 0, 0)` }}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Truck className={cn("size-5", phase === "return" && "-scale-x-100")} strokeWidth={2.25} />
            </span>
          </div>
        </div>
        <ol className="mt-1 grid grid-cols-4">
          {WORK_STEPS.map((s) => {
            const on = s.key === phase;
            const done =
              (s.key === "book" && phase !== "book") ||
              (s.key === "leave" && (phase === "deliver" || phase === "return")) ||
              (s.key === "deliver" && phase === "return");
            return (
              <li
                key={s.key}
                className={cn(
                  "text-center text-xs font-semibold",
                  (on || done) && "text-foreground",
                  !on && !done && "text-muted-foreground",
                )}
              >
                {s.title}
              </li>
            );
          })}
        </ol>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <section
        className={cn(
          "rounded-2xl border border-border bg-card px-4 py-4",
          phase === "deliver" && current && "cursor-pointer",
        )}
        onClick={phase === "deliver" && current ? () => void doNext() : undefined}
      >
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Truck · {live.title}</p>
        {(truck?.plate || truck?.driver_name) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {truck?.name} · {truck?.plate}
            {truck?.driver_name ? ` · ${truck.driver_name}` : ""}
            {run?.number ? ` · ${run.number}` : ""}
          </p>
        )}
        {phase === "deliver" && current ? (
          <>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {current.stop.company_name || firm?.short || "Avighna"}
            </p>
            <p className="mt-1 text-lg font-semibold">{current.stop.customer_name}</p>
            <p className="text-sm">{current.stop.product_summary || kg(current.stop.qty_ordered)}</p>
            <p className="mt-1 text-sm font-medium">{statusLabel(current.stop.status)}</p>
            {current.stop.address && (
              <p className="mt-1 text-sm text-muted-foreground">{current.stop.address}</p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void doNext()}
              className="mt-3 min-h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {nextLabel}
            </button>
          </>
        ) : phase === "book" && !assignedTrips.length ? (
          <p className="mt-3 rounded-2xl border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            No assignment yet. Sales or Supervisor opens Order desk, picks date + window + vehicle, then Assign.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">{nextHint}</p>
            {assignedTrips.length > 1 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {assignedTrips.length} assigned trips below — all companies / windows.
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void doNext()}
              className="mt-3 min-h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {nextLabel}
            </button>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {!assignedTrips.length
            ? "No trip yet"
            : assignedTrips.length === 1
              ? `${slotLabel(assignedTrips[0].slot)} · ${runDateLabel(assignedTrips[0].on_date)}`
              : `All assigned trips (${allStops.length} drops)`}
        </h2>
        <input
          ref={cardCamRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f || !open) return;
            setStep("deliver");
            setOutcome("delivered");
            void takePhoto(f);
          }}
        />
        {assignedTrips.map((trip) => (
          <div key={trip.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                {runTripHeading(trip)}
              </p>
              <p className="text-xs text-muted-foreground">
                {[trip.vehicle_plate, trip.driver_name, statusLabel(trip.status)].filter(Boolean).join(" · ")}
              </p>
            </div>
            {(trip.stops || []).map((stop) => {
              const isCurrent = current?.stop.id === stop.id;
              const tripPhase = workPhase(trip, truck?.status || "idle");
              const liveBtn = canDeliver(stop.status, tripPhase === "book" ? phase : tripPhase);
              return (
                <article
                  key={stop.id}
                  className={cn(
                    "rounded-2xl border bg-card px-3 py-3",
                    isCurrent ? "border-primary" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {stop.company_name || firm?.short || "Avighna"}
                    </p>
                    <span className="text-xs font-medium">{statusLabel(stop.status)}</span>
                  </div>
                  <p className="mt-1 font-medium">{stop.customer_name}</p>
                  <p className="text-sm">{stop.product_summary || kg(stop.qty_ordered)}</p>
                  {stop.address && (
                    <a href={mapsHref(stop.address)} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-muted-foreground">
                      {stop.address}
                    </a>
                  )}
                  {stop.phone && (
                    <a href={telHref(stop.phone)} className="mt-1 block text-sm font-medium">
                      {stop.phone}
                    </a>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary"
                      onClick={() => {
                        setOpen({ run: trip, stop });
                        void showInvoice(stop);
                      }}
                    >
                      {stop.invoice_number || "Invoice"}
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      className={cn(
                        "min-h-11 rounded-xl px-3 text-sm font-semibold",
                        liveBtn ? "bg-primary text-primary-foreground" : "border border-border",
                      )}
                      onClick={() => {
                        setOpen({ run: trip, stop });
                        setOutcome("delivered");
                        setStep(liveBtn ? "deliver" : "detail");
                      }}
                    >
                      {stopCta(stop.status, tripPhase === "book" ? phase : tripPhase)}
                    </button>
                    {liveBtn && (
                      <button
                        type="button"
                        aria-label="Capture photo"
                        className="flex size-11 items-center justify-center rounded-xl border border-border"
                        onClick={() => {
                          setOpen({ run: trip, stop });
                          setStep("deliver");
                          setOutcome("delivered");
                          setTimeout(() => cardCamRef.current?.click(), 0);
                        }}
                      >
                        <Camera className="size-5" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ))}
        {!allStops.length && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Waiting for Sales or Supervisor to assign an order on Order desk.
          </p>
        )}
      </section>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-5">
            {step === "invoice" ? (
              <>
                <p className="text-lg font-semibold">{invoice?.number || "Invoice"}</p>
                <p className="text-sm text-muted-foreground">{open.stop.customer_name}</p>
                {invoice ? (
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between"><dt>Amount</dt><dd className="tabular-nums">{money(invoice.total)}</dd></div>
                    <div className="flex justify-between"><dt>Status</dt><dd className="capitalize">{invoice.status}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">Invoice is not on this drop yet. Accounts raises it before Sales or Supervisor allots you.</p>
                )}
                <button type="button" className="mt-4 min-h-11 w-full rounded-xl border border-border text-sm" onClick={() => setStep("detail")}>
                  Back
                </button>
              </>
            ) : step === "deliver" ? (
              <>
                <p className="text-lg font-semibold">{outcomeCopy(outcome).title}</p>
                <p className="text-sm text-muted-foreground">{open.stop.customer_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{outcomeCopy(outcome).hint}</p>
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {(["delivered", "partial", "failed"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOutcome(o)}
                      className={cn(
                        "min-h-11 rounded-xl border text-xs font-medium",
                        outcome === o ? "border-primary bg-primary/10" : "border-border",
                      )}
                    >
                      {o === "delivered" ? "Complete" : o === "partial" ? "Partial" : "Failed"}
                    </button>
                  ))}
                </div>
                {outcome === "partial" && (
                  <label className="mt-3 block text-sm">
                    Qty delivered
                    <input
                      type="number"
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder={`Of ${open.stop.qty_ordered}`}
                    />
                  </label>
                )}
                {outcome === "failed" && (
                  <>
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
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} />
                      Return goods to warehouse
                    </label>
                  </>
                )}
                {outcome !== "failed" && (
                  <>
                    <label className="mt-3 block text-sm">
                      Received by
                      <input
                        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                        value={receiver}
                        onChange={(e) => setReceiver(e.target.value)}
                      />
                    </label>
                    <p className="mt-3 text-sm">Signature</p>
                    <SignaturePad onChange={setSigFile} />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      ref={camRef}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void takePhoto(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => camRef.current?.click()}
                      className={cn(
                        "mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm",
                        photo ? "border-primary bg-primary/10" : "border-border",
                      )}
                    >
                      <Camera className="size-4" />
                      {photo ? "Photo attached" : "Take photo"}
                    </button>
                    {photo && <img src={mediaUrl(photo)} alt="" className="mt-2 max-h-32 w-full rounded-xl object-cover" />}
                  </>
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
                  <button type="button" className="min-h-11 rounded-xl border border-border text-sm" onClick={() => setStep("detail")}>
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveDelivery()}
                    className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {outcomeCopy(outcome).save}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {open.stop.company_name || firm?.short}
                </p>
                <p className="text-lg font-semibold">{open.stop.customer_name}</p>
                <p className="text-sm">{open.stop.product_summary || kg(open.stop.qty_ordered)}</p>
                <p className="mt-1 text-sm font-medium">{statusLabel(open.stop.status)}</p>
                {open.stop.status === "delivered" && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {open.stop.receiver_name ? `Received by ${open.stop.receiver_name}` : "Fully delivered"}
                    {open.stop.qty_delivered ? ` · ${kg(open.stop.qty_delivered)}` : ""}
                  </p>
                )}
                {open.stop.status === "partial" && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {kg(open.stop.qty_delivered)} of {kg(open.stop.qty_ordered)}
                    {open.stop.remarks ? ` · ${open.stop.remarks}` : ""}
                  </p>
                )}
                {open.stop.status === "failed" && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {open.stop.fail_reason || "Failed"}
                    {open.stop.remarks ? ` · ${open.stop.remarks}` : ""}
                  </p>
                )}
                {open.stop.address && (
                  <a href={mapsHref(open.stop.address)} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-primary">
                    {open.stop.address}
                  </a>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {open.stop.phone && (
                    <a href={telHref(open.stop.phone)} className="min-h-11 rounded-xl border border-border text-center text-sm leading-[2.75rem]">
                      Call
                    </a>
                  )}
                  {open.stop.address && (
                    <a
                      href={mapsHref(open.stop.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-11 rounded-xl border border-border text-center text-sm leading-[2.75rem]"
                    >
                      Navigate
                    </a>
                  )}
                  <button
                    type="button"
                    className="min-h-11 rounded-xl border border-border text-sm"
                    onClick={() => void showInvoice(open.stop)}
                  >
                    Invoice
                  </button>
                  {canDeliver(open.stop.status, phase) && (
                    <button
                      type="button"
                      className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
                      onClick={() => {
                        setOutcome("delivered");
                        setStep("deliver");
                      }}
                    >
                      {stopCta(open.stop.status, phase)}
                    </button>
                  )}
                </div>
                <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-border text-sm" onClick={() => setOpen(null)}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
