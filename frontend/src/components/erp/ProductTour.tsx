import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

function boxesEqual(a: Box | null, b: Box | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function measure(target: string, scroll: boolean): Box | null {
  const el =
    (document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null) ||
    (target === "page-guide" ? (document.querySelector("main") as HTMLElement | null) : null);
  if (!el) return null;
  if (scroll) el.scrollIntoView({ block: "nearest", behavior: "auto", inline: "nearest" });
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
  const scrolledFor = useRef<string>("");

  useEffect(() => {
    const sync = () => setState(readTour());
    window.addEventListener("avighna-tour", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("avighna-tour", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const roleKey = (state?.role || me?.user.role || "sales").toLowerCase();
  const steps = useMemo(() => tourStepsFor(roleKey), [roleKey]);
  const index = state?.step ?? 0;
  const step = state ? steps[index] : null;
  const stepKey = state && step ? `${state.role}:${index}:${step.route}:${step.target}` : "";

  // Navigate only when the tour step identity changes
  useEffect(() => {
    if (!step) return;
    if (pathname === step.route) return;
    void navigate({ to: step.route });
  }, [stepKey, step, pathname, navigate]);

  useLayoutEffect(() => {
    if (!state || !step) {
      setBox((prev) => (prev === null ? prev : null));
      setMissing(false);
      scrolledFor.current = "";
      return;
    }

    let tries = 0;
    let timer: number | undefined;
    const apply = (next: Box | null, isMissing: boolean) => {
      setBox((prev) => (boxesEqual(prev, next) ? prev : next));
      setMissing(isMissing);
    };

    const tick = () => {
      if (pathname !== step.route) {
        timer = window.setTimeout(tick, 120);
        return;
      }
      const shouldScroll = scrolledFor.current !== stepKey;
      const next = measure(step.target, shouldScroll);
      if (shouldScroll) scrolledFor.current = stepKey;
      if (next) {
        apply(next, false);
        return;
      }
      tries += 1;
      if (tries < 25) {
        timer = window.setTimeout(tick, 120);
      } else {
        apply(null, true);
      }
    };
    tick();

    const onResize = () => {
      if (pathname !== step.route) return;
      const next = measure(step.target, false);
      if (next) apply(next, false);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [state, stepKey, step, pathname]);

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
