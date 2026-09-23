import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-3 flex flex-wrap items-end justify-between gap-2 sm:mb-4 sm:gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Panel({ title, hint, children, className }: { title?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] sm:rounded-2xl sm:p-5", className)}>
      {title && (
        <div className="mb-3 flex items-baseline justify-between gap-2 sm:mb-4 sm:gap-3">
          <h2 className="text-sm font-medium tracking-wide text-foreground">{title}</h2>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, meta, tone = "default" }: { label: string; value: string; meta?: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const toneClass = {
    default: "text-foreground",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] sm:rounded-2xl sm:p-5">
      <p className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground sm:text-xs">{label}</p>
      <p className={cn("mt-1.5 text-xl font-semibold tabular-nums sm:mt-3 sm:text-2xl", toneClass)}>{value}</p>
      {meta && <p className="mt-0.5 text-[0.7rem] text-muted-foreground sm:mt-1 sm:text-xs">{meta}</p>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  good: "bg-primary-soft text-primary",
  warn: "bg-accent text-accent-foreground",
  bad: "bg-destructive/10 text-destructive",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap py-2 pr-3 text-left text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground sm:pr-4 sm:text-xs">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap py-2.5 pr-3 align-middle sm:py-3 sm:pr-4", className)}>{children}</td>;
}

export function Bar({ value, tone = "primary" }: { value: number; tone?: "primary" | "warning" | "destructive" }) {
  const bg = { primary: "bg-primary", warning: "bg-warning", destructive: "bg-destructive" }[tone];
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", bg)} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
    </div>
  );
}