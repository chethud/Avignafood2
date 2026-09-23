import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useMe } from "@/lib/me-context";
import {
  readTour,
  stopTour,
  tourStepsFor,
  writeTour,
  type TourState,
} from "@/lib/product-tour";
import { cn } from "@/lib/utils";

type Box = { top: number; left: number; width: number; height: number };

function measure(target: string): Box | null {
  const el =
    (document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null) ||
    (target === "page-guide"
      ? (document.querySelector("main") as HTMLElement | null)
      : null);
  if (!el) return null;
  el.scrollIntoView({ block: "nearest", behavior: "smooth", inline: "nearest" });
  const r = el.getBoundingClientRect();
  const pad = 8;
  return {
    top: Math.max(8, r.top - pad),
    left: Math.max(8, r.left - pad),
    width: Math.min(window.innerWidth - 16, r.width + pad * 2),
    height: Math.min(window.innerHeight - 16, Math.min(r.height + pad * 2, window.innerHeight * 0.45)),
  };
}

export function ProductTour() {
  const { me } = useMe();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [state, setState] = useState<TourState | null>(() => readTour());
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const sync = () => setState(readTour());
    window.addEventListener("avighna-tour", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("avighna-tour", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const steps = tourStepsFor(state?.role || me?.user.role);
  const step = state ? steps[state.step] : null;
  const index = state?.step ?? 0;
  const stepKey = state ? `${state.role}:${state.step}:${step?.route || ""}` : "";

  // Navigate when the tour step changes (not on every user navigation race)
  useEffect(() => {
    if (!state || !step) return;
    if (pathname === step.route) return;
    void navigate({ to: step.route });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when step identity changes
  }, [stepKey]);

  useLayoutEffect(() => {
    if (!state || !step) {
      setBox(null);
      return;
    }
    let tries = 0;
    let timer: number | undefined;
    const tick = () => {
      if (pathname !== step.route) {
        timer = window.setTimeout(tick, 120);
        return;
      }
      const next = measure(step.target);
      if (next) {
        setBox(next);
        setMissing(false);
        return;
      }
      tries += 1;
      if (tries < 25) {
        timer = window.setTimeout(tick, 120);
      } else {
        setBox(null);
        setMissing(true);
      }
    };
    tick();
    const onResize = () => {
      const next = measure(step.target);
      if (next) setBox(next);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [state, step, pathname, index]);

  if (!state || !step) return null;

  const tipTop =
    box && box.top + box.height + 16 < window.innerHeight - 200
      ? box.top + box.height + 12
      : Math.max(12, (box?.top || 80) - 180);
  const tipLeft = Math.min(Math.max(12, box?.left || 12), window.innerWidth - 320);

  function go(delta: number) {
    if (!state) return;
    const next = state.step + delta;
    if (next < 0) return;
    if (next >= steps.length) {
      stopTour();
      setState(null);
      return;
    }
    const ns = { ...state, step: next };
    writeTour(ns);
    setState(ns);
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      {/* dim + hole */}
      <svg className="pointer-events-auto absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {box && (
              <rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                rx="16"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15,15,15,0.55)" mask="url(#tour-mask)" />
        {box && (
          <rect
            x={box.left}
            y={box.top}
            width={box.width}
            height={box.height}
            rx="16"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
          />
        )}
      </svg>

      <div
        className="pointer-events-auto absolute w-[min(100%-1.5rem,20rem)] rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
        style={{ top: tipTop, left: tipLeft }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Guide {index + 1} / {steps.length}
            </p>
            <p className="text-base font-semibold">{step.title}</p>
          </div>
          <button
            type="button"
            aria-label="Close guide"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"
            onClick={() => {
              stopTour();
              setState(null);
            }}
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">{step.body}</p>
        {missing && (
          <p className="mt-2 text-xs text-warning">
            This section is not on screen yet — tap Next to continue, or open the matching page from the menu.
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => go(-1)}
            className={cn(
              "min-h-11 flex-1 rounded-xl border border-border text-sm font-semibold disabled:opacity-40",
            )}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="min-h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
          >
            {index >= steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
