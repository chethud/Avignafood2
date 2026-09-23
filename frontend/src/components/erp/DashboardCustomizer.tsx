import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, Handshake, LayoutGrid, Truck, TrendingUp, GripVertical, Settings, SlidersHorizontal, X,
  Wallet, Boxes, PieChart, Percent, LineChart, Share2, Columns3,
} from "lucide-react";
import { useCompany } from "@/lib/company-context";
import { firms, firmName, KPI_GRAIN_LABEL, type FirmId, type KpiGrain } from "@/lib/erp-data";
import { cn } from "@/lib/utils";

export type DashWidgetId =
  | "kpis"
  | "revenue"
  | "approvals"
  | "byCompany"
  | "dispatch"
  | "receivables"
  | "stockLevels"
  | "dispatchMix"
  | "growth"
  | "revenueLine"
  | "firmShare"
  | "monthlyCompare";

export type DashSize = 1 | 2 | 3;

export type DashItem = { id: DashWidgetId; size: DashSize };

export type DashWidgetMeta = {
  id: DashWidgetId;
  label: string;
  hint: string;
  icon: LucideIcon;
  defaultSize: DashSize;
};

export const DASH_WIDGETS: DashWidgetMeta[] = [
  { id: "kpis", label: "KPI strip", hint: "Month + FY revenue and ops", icon: LayoutGrid, defaultSize: 3 },
  { id: "revenue", label: "Revenue area", hint: "Area chart · period aware", icon: TrendingUp, defaultSize: 2 },
  { id: "revenueLine", label: "Revenue line", hint: "Line chart trend", icon: LineChart, defaultSize: 2 },
  { id: "monthlyCompare", label: "Monthly compare", hint: "Grouped bars by firm", icon: Columns3, defaultSize: 3 },
  { id: "firmShare", label: "Firm share", hint: "Pie · FY mix", icon: Share2, defaultSize: 1 },
  { id: "approvals", label: "Approvals", hint: "Price requests waiting", icon: Handshake, defaultSize: 1 },
  { id: "byCompany", label: "By company", hint: "Revenue vs outstanding", icon: BarChart3, defaultSize: 3 },
  { id: "receivables", label: "Receivables", hint: "Outstanding by firm", icon: Wallet, defaultSize: 2 },
  { id: "stockLevels", label: "Stock levels", hint: "Inventory MT", icon: Boxes, defaultSize: 2 },
  { id: "dispatchMix", label: "Dispatch mix", hint: "Status pie", icon: PieChart, defaultSize: 1 },
  { id: "growth", label: "Growth", hint: "MoM growth bars", icon: Percent, defaultSize: 2 },
  { id: "dispatch", label: "Movement by day", hint: "Yesterday / today / next day", icon: Truck, defaultSize: 3 },
];

const DEFAULT_LAYOUT: DashItem[] = [
  { id: "kpis", size: 3 },
  { id: "revenue", size: 2 },
  { id: "approvals", size: 1 },
  { id: "byCompany", size: 3 },
  { id: "dispatch", size: 3 },
];

const STORAGE_KEY = "avighna.dashboard.layout.v2";
const LEGACY_KEY = "avighna.dashboard.layout";

export const SIZE_CLASS: Record<DashSize, string> = {
  1: "col-span-12 sm:col-span-6 lg:col-span-4",
  2: "col-span-12 sm:col-span-6 lg:col-span-6",
  3: "col-span-12",
};

function meta(id: DashWidgetId) {
  return DASH_WIDGETS.find((w) => w.id === id);
}

function normalize(raw: unknown): DashItem[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_LAYOUT;
  // legacy: string[]
  if (typeof raw[0] === "string") {
    return (raw as string[])
      .map((id) => {
        const m = meta(id as DashWidgetId);
        return m ? { id: m.id, size: m.defaultSize } : null;
      })
      .filter(Boolean) as DashItem[];
  }
  const out: DashItem[] = [];
  for (const row of raw as { id?: string; size?: number }[]) {
    const m = meta(row.id as DashWidgetId);
    if (!m) continue;
    const size = ([1, 2, 3].includes(row.size as number) ? row.size : m.defaultSize) as DashSize;
    if (!out.some((x) => x.id === m.id)) out.push({ id: m.id, size });
  }
  return out.length ? out : DEFAULT_LAYOUT;
}

function loadLayout(): DashItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    return normalize(JSON.parse(raw));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashItem[]>(DEFAULT_LAYOUT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLayout(loadLayout());
    setReady(true);
  }, []);

  const save = useCallback((next: DashItem[]) => {
    setLayout(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const toggle = useCallback(
    (id: DashWidgetId) => {
      if (layout.some((x) => x.id === id)) save(layout.filter((x) => x.id !== id));
      else {
        const m = meta(id)!;
        save([...layout, { id, size: m.defaultSize }]);
      }
    },
    [layout, save],
  );

  const remove = useCallback(
    (id: DashWidgetId) => save(layout.filter((x) => x.id !== id)),
    [layout, save],
  );

  const setSize = useCallback(
    (id: DashWidgetId, size: DashSize) => {
      save(layout.map((x) => (x.id === id ? { ...x, size } : x)));
    },
    [layout, save],
  );

  const move = useCallback(
    (fromId: DashWidgetId, toId: DashWidgetId) => {
      if (fromId === toId) return;
      const from = layout.find((x) => x.id === fromId);
      if (!from) return;
      const next = layout.filter((x) => x.id !== fromId);
      const at = next.findIndex((x) => x.id === toId);
      if (at < 0) next.push(from);
      else next.splice(at, 0, from);
      save(next);
    },
    [layout, save],
  );

  const reset = useCallback(() => save(DEFAULT_LAYOUT), [save]);

  return { layout, ready, toggle, remove, setSize, move, reset };
}

export function DashboardCustomizer({
  layout,
  onToggle,
  onRemove,
  onSetSize,
  onMove,
  onReset,
  open,
  onOpenChange,
  kpiGrain,
  onKpiGrainChange,
}: {
  layout: DashItem[];
  onToggle: (id: DashWidgetId) => void;
  onRemove: (id: DashWidgetId) => void;
  onSetSize: (id: DashWidgetId, size: DashSize) => void;
  onMove: (from: DashWidgetId, to: DashWidgetId) => void;
  onReset: () => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kpiGrain: KpiGrain;
  onKpiGrainChange: (g: KpiGrain) => void;
}) {
  const { firm, setFirm } = useCompany();
  const [dragging, setDragging] = useState<DashWidgetId | null>(null);
  const [kpiSettingsOpen, setKpiSettingsOpen] = useState(false);
  const selected = new Set(layout.map((x) => x.id));

  function onDragStart(id: DashWidgetId, e: DragEvent) {
    setDragging(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDropOn(target: DashWidgetId, e: DragEvent) {
    e.preventDefault();
    const from = (e.dataTransfer.getData("text/plain") || dragging) as DashWidgetId;
    if (from) onMove(from, target);
    setDragging(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary",
          open && "border-primary text-primary",
        )}
        aria-expanded={open}
      >
        <SlidersHorizontal className="size-4" />
        Customize
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-foreground/20"
            aria-label="Close customizer"
            onClick={() => onOpenChange(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-[min(100%,22rem)] flex-col border-l border-border bg-card shadow-[var(--shadow-soft)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Modify dashboard</p>
                <p className="text-xs text-muted-foreground">Select · resize · drag · remove</p>
              </div>
              <button type="button" className="rounded-lg p-1.5 hover:bg-secondary" onClick={() => onOpenChange(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">Available</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {DASH_WIDGETS.map((w) => {
                  const on = selected.has(w.id);
                  const Icon = w.icon;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => onToggle(w.id)}
                      className={cn(
                        "flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors",
                        on ? "border-primary bg-primary-soft/40" : "border-border hover:bg-secondary/60",
                      )}
                    >
                      <Icon className={cn("size-5", on ? "text-primary" : "text-muted-foreground")} />
                      <span className="text-xs font-medium leading-tight">{w.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="mt-5 text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">On dashboard</p>
              <ul className="mt-2 space-y-2">
                {layout.map((item) => {
                  const w = meta(item.id)!;
                  const Icon = w.icon;
                  return (
                    <li
                      key={item.id}
                      draggable
                      onDragStart={(e) => onDragStart(item.id, e)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropOn(item.id, e)}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        "rounded-xl border border-border bg-background p-2.5 active:cursor-grabbing",
                        dragging === item.id && "opacity-50",
                      )}
                    >
                      <div className="flex cursor-grab items-center gap-2">
                        <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                        <Icon className="size-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate text-sm">{w.label}</span>
                        {item.id === "kpis" && (
                          <button
                            type="button"
                            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            aria-label="KPI settings"
                            onClick={(e) => {
                              e.stopPropagation();
                              setKpiSettingsOpen(true);
                            }}
                          >
                            <Settings className="size-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Remove ${w.label}`}
                          onClick={() => onRemove(item.id)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-1 pl-6">
                        <span className="mr-1 text-[0.65rem] text-muted-foreground">Size</span>
                        {([1, 2, 3] as DashSize[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onSetSize(item.id, s)}
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[0.7rem] font-medium",
                              item.size === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {s === 1 ? "S" : s === 2 ? "M" : "L"}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
                {!layout.length && (
                  <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Select icons above to add widgets
                  </li>
                )}
              </ul>
            </div>

            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={onReset}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
              >
                Reset layout
              </button>
            </div>
          </aside>

          {kpiSettingsOpen && (
            <KpiSettingsPopup
              firm={firm}
              grain={kpiGrain}
              onFirm={setFirm}
              onGrain={onKpiGrainChange}
              onClose={() => setKpiSettingsOpen(false)}
            />
          )}
        </>
      )}
    </>
  );
}

function KpiSettingsPopup({
  firm,
  grain,
  onFirm,
  onGrain,
  onClose,
}: {
  firm: FirmId;
  grain: KpiGrain;
  onFirm: (f: FirmId) => void;
  onGrain: (g: KpiGrain) => void;
  onClose: () => void;
}) {
  const firmOpts: { id: FirmId; label: string }[] = [
    { id: "all", label: "All companies" },
    ...firms.map((f) => ({ id: f.id as FirmId, label: f.short })),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-settings-title"
        className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] sm:max-w-sm sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">KPI strip</p>
            <h2 id="kpi-settings-title" className="mt-1 text-lg font-semibold tracking-tight">
              Settings
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {firmName(firm)} · {KPI_GRAIN_LABEL[grain]}
            </p>
          </div>
          <button type="button" className="rounded-lg p-1.5 hover:bg-secondary" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>

        <p className="mt-5 text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">Company</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {firmOpts.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onFirm(o.id)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                firm === o.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">Period</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(["daily", "monthly", "yearly"] as KpiGrain[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGrain(g)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                grain === g ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {KPI_GRAIN_LABEL[g]}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Optional chrome when customizing: remove + size on the widget itself. */
const TOUR_BY_WIDGET: Partial<Record<DashWidgetId, string>> = {
  kpis: "owner-kpis",
  approvals: "owner-approvals",
  dispatch: "owner-movement",
};

export function WidgetChrome({
  id,
  size,
  editing,
  onRemove,
  onSetSize,
  children,
}: {
  id: DashWidgetId;
  size: DashSize;
  editing: boolean;
  onRemove: (id: DashWidgetId) => void;
  onSetSize: (id: DashWidgetId, size: DashSize) => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", SIZE_CLASS[size])} data-tour={TOUR_BY_WIDGET[id]}>
      {editing && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-0.5 shadow-sm backdrop-blur">
          {([1, 2, 3] as DashSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSetSize(id, s)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold",
                size === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {s === 1 ? "S" : s === 2 ? "M" : "L"}
            </button>
          ))}
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label="Remove widget"
            onClick={() => onRemove(id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
