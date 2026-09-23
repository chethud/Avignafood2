import { useEffect, useRef, useState } from "react";
import { Camera, Mic, Square, MapPin } from "lucide-react";
import { api, apiUpload, mediaUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

export type CompanyOpt = {
  id: number;
  legal_name: string;
  trade_name: string | null;
  logo_url: string | null;
};

export type GeoFix = { lat: number; lng: number; accuracy_m: number | null };

export type GeoPhoto = { url: string; lat: number | null; lng: number | null };

export function useCompanies() {
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  useEffect(() => {
    api<CompanyOpt[]>("/api/v1/companies")
      .then((rows) => setCompanies(Array.isArray(rows) ? rows : []))
      .catch(() => setCompanies([]));
  }, []);
  return companies;
}

export function readGps(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS not available on this phone"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
        }),
      () => reject(new Error("Allow location so the visit is geo-tagged")),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    );
  });
}

export function CompanyPick({
  companies,
  value,
  onChange,
}: {
  companies: CompanyOpt[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {companies.map((c) => {
        const selected = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={cn(
              "flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-3 text-center",
              selected ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
            )}
          >
            {c.logo_url ? (
              <img src={mediaUrl(c.logo_url) || c.logo_url} alt="" className="h-8 w-8 rounded object-contain" />
            ) : null}
            <span className="text-xs font-medium leading-tight">{c.trade_name || c.legal_name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function GpsPill({ geo, onFix, busy }: { geo: GeoFix | null; onFix: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onFix}
      className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 text-sm font-medium"
    >
      <MapPin className="size-5 text-primary" />
      {busy
        ? "Getting GPS…"
        : geo
          ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`
          : "Tap to pin your location"}
    </button>
  );
}

export function GeoPhotos({
  photos,
  onAdd,
  companyId,
}: {
  photos: GeoPhoto[];
  onAdd: (p: GeoPhoto) => void;
  companyId: number | null;
}) {
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErr("");
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const g = await readGps();
        lat = g.lat;
        lng = g.lng;
      } catch {
        /* photo still uploads; GPS may be denied */
      }
      const { url } = await apiUpload("/api/v1/visits/upload", file, companyId ?? undefined);
      onAdd({ url, lat, lng });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not upload photo");
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-medium text-primary-foreground"
      >
        <Camera className="size-6" />
        Take proof photo
      </button>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.url} className="overflow-hidden rounded-xl border border-border">
              <img src={mediaUrl(p.url)} alt="" className="aspect-square w-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VoiceNote({
  url,
  onChange,
  companyId,
}: {
  url: string | null;
  onChange: (url: string | null) => void;
  companyId: number | null;
}) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      rec?.stream.getTracks().forEach((t) => t.stop());
    };
  }, [rec]);

  async function start() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `note-${Date.now()}.webm`, { type: blob.type });
        try {
          const up = await apiUpload("/api/v1/visits/upload", file, companyId ?? undefined);
          onChange(up.url);
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Could not save voice note");
        }
      };
      recorder.start();
      setRec(recorder);
      setSecs(0);
      timer.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      setErr("Allow the microphone to record instead of typing");
    }
  }

  function stop() {
    if (timer.current) window.clearInterval(timer.current);
    rec?.stop();
    setRec(null);
  }

  return (
    <div className="space-y-2">
      {rec ? (
        <button
          type="button"
          onClick={stop}
          className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-destructive text-base font-medium text-destructive-foreground"
        >
          <Square className="size-5" />
          Stop · {secs}s
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card text-base font-medium"
        >
          <Mic className="size-6 text-primary" />
          {url ? "Re-record voice note" : "Hold the talk — tap to record"}
        </button>
      )}
      {url && !rec && <audio controls className="w-full" src={mediaUrl(url)} />}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

export const fieldInput =
  "min-h-14 w-full rounded-2xl border border-border bg-card px-4 text-base outline-none focus:border-primary";
