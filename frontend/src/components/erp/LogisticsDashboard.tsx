import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Truck } from "lucide-react";
import { api, apiUpload, getCompanyId, mediaUrl } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { greeting, mapsHref, money, telHref } from "@/lib/format";
import { firms } from "@/lib/erp-data";
import { cn } from "@/lib/utils";
import { buildInvoicePdfBlob, type InvoicePdfInput } from "@/lib/invoice-pdf";
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
  pick: 0,
  load: 1,
  leave: 2,
  deliver: 3,
  return: 4,
};

type InvoiceView = InvoicePdfInput & {
  id?: number;
  status?: string;
  phone?: string | null;
  cgst?: string | number;
  sgst?: string | number;
  tax_amount?: string | number;
};

export function LogisticsDashboard() {
  const { me } = useMe();
  const name = me?.user.full_name?.split(" ")[0] || "Logistics";
  const [truck, setTruck] = useState<TruckNow | null>(null);
  const [runs, setRuns] = useState<LogisticsRun[]>([]);
  const [pickedRunId, setPickedRunId] = useState<number | null>(null);
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
  const [ret, setRet] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pickConfirm, setPickConfirm] = useState<LogisticsRun | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  async function openCamera() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not available on this device");
      return;
    }
    try {
      // Restart if already open
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setError("Allow camera access to take the delivery photo");
    }
  }

  async function snapPhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Camera is not ready yet");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture photo");
      return;
    }
    ctx.drawImage(video, 0, 0);
    setBusy(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("Could not capture photo");
      const file = new File([blob], `pod-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopCamera();
      const up = await apiUpload("/api/v1/deliveries/upload", file);
      setPhoto(up.url);
      if (step !== "deliver") setStep("deliver");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo");
    } finally {
      setBusy(false);
    }
  }

  const live = truckCopy(truck?.status || "idle");
  const key = truckKey(truck?.status);
  const assignedTrips = useMemo(() => {
    const doneStop = new Set(["delivered", "partial", "failed", "completed"]);
    const open = runs
      .filter((r) => !["completed", "cancelled", "delivered"].includes(r.status))
      .map((r) => ({
        ...r,
        stops: (r.stops || []).filter((s) => !doneStop.has(s.status)),
      }))
      .filter((r) => r.stops.length > 0 || ["loaded", "loading", "dispatched", "in_transit", "returning"].includes(r.status));
    const slotRank = (s?: string) => (s === "morning" ? 0 : s === "afternoon" ? 1 : s === "evening" ? 2 : 3);
    return [...open].sort((a, b) => {
      const d = String(a.on_date || "").localeCompare(String(b.on_date || ""));
      if (d) return d;
      const s = slotRank(a.slot) - slotRank(b.slot);
      if (s) return s;
      return a.id - b.id;
    });
  }, [runs]);

  // Restore picked trip from live run / loaded status after refresh
  useEffect(() => {
    if (pickedRunId) return;
    const liveId = truck?.run_id;
    if (liveId && assignedTrips.some((t) => t.id === liveId)) {
      setPickedRunId(liveId);
      return;
    }
    const advanced = assignedTrips.find((t) =>
      ["loading", "loaded", "dispatched", "in_transit", "out_for_delivery", "returning"].includes(t.status),
    );
    if (advanced) {
      setPickedRunId(advanced.id);
      return;
    }
    // One assigned order → select it so the driver sees it first and can confirm
    if (assignedTrips.length === 1) setPickedRunId(assignedTrips[0].id);
  }, [assignedTrips, truck?.run_id, pickedRunId]);

  const run =
    (pickedRunId ? assignedTrips.find((t) => t.id === pickedRunId) : null) ||
    activeRun(assignedTrips, truck?.status || "idle", truck?.run_id);
  const phase = workPhase(run, truck?.status || "idle", pickedRunId);
  const allStops = useMemo(() => {
    const rows: { run: LogisticsRun; stop: LogisticsStop }[] = [];
    const source = phase === "pick" ? assignedTrips : run ? [run] : [];
    for (const trip of source) {
      for (const stop of trip.stops || []) rows.push({ run: trip, stop });
    }
    return rows;
  }, [assignedTrips, run, phase]);
  const current = useMemo(() => {
    const openStatuses = new Set(["pending", "out_for_delivery"]);
    if (!run) return allStops.find((r) => openStatuses.has(r.stop.status)) || null;
    const fromActive = (run.stops || []).find((s) => openStatuses.has(s.status));
    return fromActive ? { run, stop: fromActive } : null;
  }, [run, allStops]);

  const nextLabel =
    phase === "pick" && !assignedTrips.length
      ? "Waiting for assignment"
      : phase === "pick"
        ? "Tap Confirm on an order"
        : phase === "load"
          ? "Confirm load"
          : phase === "leave"
            ? "Go"
            : phase === "deliver"
              ? current
                ? stopCta(current.stop.status, phase)
                : "Coming back"
              : "Arrived at base";
  const nextHint =
    phase === "pick" && !assignedTrips.length
      ? "Waiting for Owner approval, or for Sales to allot your vehicle and window."
      : phase === "pick"
        ? "Tap Confirm on the order you are taking, then confirm again in the popup."
        : phase === "load"
          ? "Load goods on the truck, then confirm load."
          : phase === "leave"
            ? "Truck loaded. Tap Go when you leave the yard."
            : phase === "deliver"
              ? "Reach each customer and complete the drop."
              : "All drops done. Drive to base and tap Arrived at base.";

  async function setRunStatus(trip: LogisticsRun, status: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/logistics/runs/${trip.id}/status`, {
        method: "POST",
        companyId: trip.company_id ?? undefined,
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update trip");
    } finally {
      setBusy(false);
    }
  }

  async function setLive(status: TruckStateKey) {
    if (status === key) return;
    setBusy(true);
    setError("");
    try {
      setTruck(
        await api<TruckNow>("/api/v1/logistics/truck", {
          method: "POST",
          companyId: run?.company_id ?? undefined,
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

  function askConfirmTrip(trip: LogisticsRun) {
    setPickConfirm(trip);
    setError("");
  }

  async function confirmTrip(trip: LogisticsRun) {
    setPickConfirm(null);
    setPickedRunId(trip.id);
    if (trip.status === "planned") {
      await setRunStatus(trip, "loading");
    }
  }

  async function doNext() {
    if (phase === "pick") return;
    if (phase === "load" && run) return void setRunStatus(run, "loaded");
    if (phase === "leave") return void setLive("going");
    if (phase === "deliver" && current) {
      setOpen(current);
      setOutcome("delivered");
      setStep("detail");
      return;
    }
    if (phase === "deliver") return void setLive("coming_back");
    if (phase === "return") {
      setPickedRunId(null);
      return void setLive("idle");
    }
  }

  async function saveDelivery() {
    if (!open) return;
    if (!photo) {
      setError("Photo is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/logistics/stops/${open.stop.id}/deliver`, {
        method: "POST",
        body: JSON.stringify({
          outcome,
          qty_delivered: outcome === "partial" ? Number(qty) || 0 : null,
          receiver_name: outcome === "failed" ? null : receiver.trim() || null,
          pod_url: photo,
          signature_url: null,
          fail_reason: outcome === "failed" ? reason : null,
          remarks: remarks.trim() || null,
          return_required: outcome === "failed" && ret,
        }),
      });
      setOpen(null);
      setStep("detail");
      setPhoto("");
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

  async function showInvoice(stop: LogisticsStop, companyId?: number | null) {
    setError("");
    setInvoiceBusy(true);
    setStep("invoice");
    setInvoice(null);
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    try {
      let detail: InvoiceView | null = null;
      try {
        detail = await api<InvoiceView>(`/api/v1/logistics/stops/${stop.id}/invoice`, {
          companyId: companyId ?? undefined,
        });
      } catch (e) {
        if (stop.invoice_id) {
          detail = await api<InvoiceView>(`/api/v1/invoices/${stop.invoice_id}`, {
            companyId: companyId ?? undefined,
          });
        } else {
          throw e;
        }
      }
      setInvoice(detail);
      const firmMeta = firms.find((f) => String(f.companyId) === String(companyId ?? getCompanyId()));
      const blob = await buildInvoicePdfBlob(detail, {
        name: stop.company_name || firmMeta?.name,
        gst: firmMeta?.gst,
        logoUrl: firmMeta?.logo ? mediaUrl(firmMeta.logo) : undefined,
      });
      const url = URL.createObjectURL(blob);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e) {
      setInvoice(null);
      setError(e instanceof Error ? e.message : "Invoice not available yet");
    } finally {
      setInvoiceBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold leading-tight">
          {greeting()}, {name}
        </h1>
      </div>

      {/* Progress stepper — always first content under greeting */}
      <div className="rounded-2xl border border-border bg-card px-2 pb-3 pt-3">
        <div className="relative h-10" aria-hidden>
          <div className="absolute left-[10%] right-[10%] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-secondary" />
          <div
            className="absolute left-[10%] top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${(STEP_INDEX[phase] / 4) * 80}%` }}
          />
          <div className="relative grid h-10 grid-cols-5">
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
            className="absolute inset-y-0 left-0 flex w-1/5 items-center justify-center transition-transform duration-700 ease-out"
            style={{ transform: `translate3d(${STEP_INDEX[phase] * 100}%, 0, 0)` }}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Truck className={cn("size-5", phase === "return" && "-scale-x-100")} strokeWidth={2.25} />
            </span>
          </div>
        </div>
        <ol className="mt-1 grid grid-cols-5">
          {WORK_STEPS.map((s) => {
            const on = s.key === phase;
            const done = STEP_INDEX[s.key] < STEP_INDEX[phase];
            return (
              <li
                key={s.key}
                className={cn(
                  "text-center text-[11px] font-semibold",
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {phase === "pick"
            ? assignedTrips.length
              ? assignedTrips.length > 1
                ? "Your shipments"
                : "Your shipment"
              : "No trip yet"
            : run
              ? runTripHeading(run)
              : "Your trip"}
        </h2>
        {(phase === "pick" ? assignedTrips : run ? [run] : []).map((trip) => (
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
              const liveBtn = canDeliver(stop.status, phase);
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
                    <a
                      href={mapsHref(stop.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-sm text-muted-foreground"
                    >
                      {stop.address}
                    </a>
                  )}
                  {stop.phone && (
                    <a href={telHref(stop.phone)} className="mt-1 block text-sm font-medium">
                      {stop.phone}
                    </a>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary"
                      onClick={() => {
                        setOpen({ run: trip, stop });
                        void showInvoice(stop, trip.company_id);
                      }}
                    >
                      {stop.invoice_number || "Invoice"}
                    </button>
                    <span className="flex-1" />
                    {phase === "pick" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => askConfirmTrip(trip)}
                        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        Confirm
                      </button>
                    )}
                    {phase === "deliver" && (
                      <>
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
                          {stopCta(stop.status, phase)}
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
                              void openCamera();
                            }}
                          >
                            <Camera className="size-5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ))}
        {!assignedTrips.length && (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Waiting for Sales or Supervisor to assign an order on Order desk.
          </p>
        )}
      </section>

      <section
        className={cn(
          "rounded-2xl border border-border bg-card px-4 py-4",
          phase === "deliver" && current && "cursor-pointer",
        )}
        onClick={phase === "deliver" && current ? () => void doNext() : undefined}
      >
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Truck · {live.title}</p>
        {(truck?.plate || truck?.driver_name || run?.driver_name) && (
          <p className="mt-1 text-sm text-muted-foreground">
            {truck?.name || "Truck"}
            {truck?.plate ? ` · ${truck.plate}` : run?.vehicle_plate ? ` · ${run.vehicle_plate}` : ""}
            {run?.driver_name || truck?.driver_name ? ` · ${run?.driver_name || truck?.driver_name}` : ""}
            {run?.number ? ` · ${run.number}` : ""}
          </p>
        )}
        {phase === "pick" ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {assignedTrips.length
              ? "Tap Confirm on an order above, then confirm again in the popup."
              : "No shipment yet. Sales or Supervisor assigns vehicle + driver on Order desk."}
          </p>
        ) : phase === "deliver" && current ? (
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
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">{nextHint}</p>
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

      {pickConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5">
            <p className="text-lg font-semibold">Confirm this shipment?</p>
            <p className="mt-1 text-sm text-muted-foreground">{runTripHeading(pickConfirm)}</p>
            <p className="mt-3 text-sm font-medium">
              {(pickConfirm.stops || [])[0]?.customer_name || "Customer"}
            </p>
            <p className="text-sm text-muted-foreground">
              {(pickConfirm.stops || [])[0]?.product_summary ||
                ((pickConfirm.stops || [])[0]?.qty_ordered != null
                  ? kg((pickConfirm.stops || [])[0]!.qty_ordered)
                  : null) ||
                pickConfirm.vehicle_plate ||
                "—"}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                className="min-h-12 rounded-2xl border border-border text-sm font-semibold disabled:opacity-60"
                onClick={() => setPickConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                className="min-h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                onClick={() => void confirmTrip(pickConfirm)}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black">
          <video
            ref={videoRef}
            className="min-h-0 flex-1 w-full object-cover"
            playsInline
            muted
            autoPlay
          />
          <div className="safe-area-pb grid grid-cols-2 gap-3 bg-black/80 p-4">
            <button
              type="button"
              disabled={busy}
              className="min-h-12 rounded-2xl border border-white/30 text-sm font-semibold text-white disabled:opacity-60"
              onClick={stopCamera}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              className="min-h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
              onClick={() => void snapPhoto()}
            >
              {busy ? "Uploading…" : "Capture"}
            </button>
          </div>
        </div>
      )}

      {open && step === "invoice" ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-semibold"
              onClick={() => {
                setError("");
                setStep("detail");
                setPdfUrl((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return null;
                });
              }}
            >
              Back
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{invoice?.number || "Invoice"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {invoice?.customer_name || open.stop.customer_name}
              </p>
            </div>
          </div>
          {invoiceBusy && !pdfUrl ? (
            <p className="p-4 text-sm text-muted-foreground">Loading invoice PDF…</p>
          ) : pdfUrl ? (
            <object
              data={pdfUrl}
              type="application/pdf"
              title={invoice?.number || "Invoice PDF"}
              className="min-h-0 w-full flex-1 bg-white"
            >
              <iframe
                title={invoice?.number || "Invoice PDF"}
                src={pdfUrl}
                className="h-full min-h-[70dvh] w-full border-0 bg-white"
              />
            </object>
          ) : (
            <div className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">
                Invoice is not raised yet for this drop. Ask Accounts to raise it — then you can open it here.
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
        </div>
      ) : open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-border bg-card p-5">
            {step === "deliver" ? (
              <>
                <p className="text-lg font-semibold">{outcomeCopy(outcome).title}</p>
                <p className="text-sm text-muted-foreground">{open.stop.customer_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{outcomeCopy(outcome).hint}</p>
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {(["delivered", "partial", "failed"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => {
                        setOutcome(o);
                        setPhoto("");
                        setError("");
                      }}
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
                        onChange={(e) => {
                          setReason(e.target.value);
                          setPhoto("");
                        }}
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openCamera()}
                      className={cn(
                        "mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm disabled:opacity-60",
                        photo ? "border-primary bg-primary/10" : "border-border",
                      )}
                    >
                      <Camera className="size-4" />
                      {photo
                        ? "Retake photo"
                        : reason === "Goods damaged"
                          ? "Take photo of damaged goods"
                          : reason === "Vehicle issue"
                            ? "Take photo of vehicle problem"
                            : "Take photo (required)"}
                    </button>
                    {photo && (
                      <img src={mediaUrl(photo)} alt="" className="mt-2 max-h-32 w-full rounded-xl object-cover" />
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">Use the camera — gallery upload is not allowed.</p>
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openCamera()}
                      className={cn(
                        "mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm disabled:opacity-60",
                        photo ? "border-primary bg-primary/10" : "border-border",
                      )}
                    >
                      <Camera className="size-4" />
                      {photo ? "Retake photo" : "Take photo (required)"}
                    </button>
                    {photo && <img src={mediaUrl(photo)} alt="" className="mt-2 max-h-32 w-full rounded-xl object-cover" />}
                    <p className="mt-1 text-xs text-muted-foreground">Use the camera — gallery upload is not allowed.</p>
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
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
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
                    onClick={() => void showInvoice(open.stop, open.run.company_id)}
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
      ) : null}
    </div>
  );
}
