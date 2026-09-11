import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { API_URL, api, getCompanyId, getToken } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { inr } from "@/lib/erp-data";
import { Badge, Kpi, PageHeader } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "Leads · Avighna ERP" },
      { name: "description", content: "Lead pipeline for the active company." },
      { property: "og:title", content: "Leads · Avighna ERP" },
    ],
  }),
  component: Leads,
});

type LeadRow = {
  id: string;
  rawId: number;
  name: string;
  contact: string;
  phone: string;
  source: string;
  type: string;
  requirement: string;
  value: number;
  stage: string;
  assigned: string;
  gstin: string;
  priority: string;
  nextFollow: string;
  overdue: boolean;
  customerId: number | null;
  notes: string;
  location: string;
};

type ApiLead = {
  id: number;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  source: string | null;
  lead_type: string | null;
  product_requirement: string | null;
  quantity: string | null;
  estimated_value: string | number | null;
  status: string;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  gstin: string | null;
  priority: string | null;
  next_follow_up: string | null;
  overdue_follow_up: boolean;
  customer_id: number | null;
  notes: string | null;
  location: string | null;
};

type Activity = { id: number; kind: string; notes: string | null; created_at: string };

const PIPELINE = ["new", "contacted", "qualified", "visit_required", "quotation", "negotiation", "won", "lost"] as const;

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  visit_required: "Visit",
  quotation: "Quote",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

const emptyForm = {
  business_name: "",
  contact_person: "",
  phone: "",
  source: "WhatsApp",
  lead_type: "wholesale",
  product_requirement: "",
  estimated_value: "",
  gstin: "",
  location: "",
  priority: "medium",
  notes: "",
};

function stageTone(stage: string): "good" | "bad" | "warn" | "neutral" {
  if (stage === "won") return "good";
  if (stage === "lost") return "bad";
  if (stage === "negotiation" || stage === "quotation") return "warn";
  return "neutral";
}

function apiAsRows(rows: ApiLead[]): LeadRow[] {
  return rows.map((l) => ({
    id: `LD-${l.id}`,
    rawId: l.id,
    name: l.business_name,
    contact: l.contact_person || "—",
    phone: l.phone || "—",
    source: l.source || "—",
    type: l.lead_type || "—",
    requirement: [l.product_requirement, l.quantity].filter(Boolean).join(" · ") || "—",
    value: Number(l.estimated_value) || 0,
    stage: l.status,
    assigned: l.assigned_to_name || (l.assigned_to_id ? `#${l.assigned_to_id}` : "Unassigned"),
    gstin: l.gstin || "",
    priority: l.priority || "medium",
    nextFollow: l.next_follow_up ? new Date(l.next_follow_up).toLocaleDateString("en-IN") : "—",
    overdue: !!l.overdue_follow_up,
    customerId: l.customer_id,
    notes: l.notes || "",
    location: l.location || "",
  }));
}

const inputCls =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

function Leads() {
  return <LeadsDesk />;
}

function LeadsDesk() {
  const { me } = useMe();
  const isSales = me?.user.role === "sales";
  const { firm } = useCompany();
  const importRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("all");
  const [source, setSource] = useState("all");
  const [leadType, setLeadType] = useState("all");
  const [assigned, setAssigned] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [followNote, setFollowNote] = useState("");
  const [followDate, setFollowDate] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);

  async function load() {
    try {
      const params = new URLSearchParams();
      if (assigned !== "all") params.set("assigned", assigned);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const qs = params.toString();
      const data = await api<ApiLead[]>(`/api/v1/leads${qs ? `?${qs}` : ""}`);
      setRows(apiAsRows(data));
    } catch {
      setRows([]);
    }
  }

  useEffect(() => {
    void load();
  }, [firm, assigned, dateFrom, dateTo]);

  useEffect(() => {
    if (!selected?.rawId) {
      setActivities([]);
      return;
    }
    api<Activity[]>(`/api/v1/leads/${selected.rawId}/activities`)
      .then(setActivities)
      .catch(() => setActivities([]));
  }, [selected?.rawId]);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source).filter((s) => s && s !== "—"))),
    [rows],
  );

  const filtered = rows.filter((r) => {
    if (stage !== "all" && r.stage !== stage) return false;
    if (source !== "all" && r.source !== source) return false;
    if (leadType !== "all" && r.type !== leadType) return false;
    if (!q.trim()) return true;
    return `${r.id} ${r.name} ${r.contact} ${r.phone} ${r.requirement} ${r.gstin}`.toLowerCase().includes(q.trim().toLowerCase());
  });

  const stageCounts = useMemo(() => {
    const bag = new Map<string, { n: number; value: number }>();
    for (const r of rows) {
      const cur = bag.get(r.stage) ?? { n: 0, value: 0 };
      cur.n += 1;
      cur.value += r.value;
      bag.set(r.stage, cur);
    }
    return PIPELINE.map((key) => {
      const t = bag.get(key) ?? { n: 0, value: 0 };
      return { key, label: STAGE_LABEL[key], ...t };
    });
  }, [rows]);

  const total = rows.length;
  const nAt = (k: string) => stageCounts.find((s) => s.key === k)?.n ?? 0;
  const pipelineValue = rows.filter((r) => r.stage !== "won" && r.stage !== "lost").reduce((s, r) => s + r.value, 0);

  async function createLead(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/leads", {
        method: "POST",
        body: JSON.stringify({
          business_name: form.business_name,
          contact_person: form.contact_person || null,
          phone: form.phone || null,
          source: form.source || null,
          lead_type: form.lead_type || null,
          product_requirement: form.product_requirement || null,
          estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
          gstin: form.gstin || null,
          location: form.location || null,
          priority: form.priority || null,
          notes: form.notes || null,
        }),
      });
      setAdding(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create lead");
    }
  }

  async function patchLead(id: number, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update lead");
    } finally {
      setBusy(false);
    }
  }

  async function convertSelected() {
    if (!selected?.rawId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/leads/${selected.rawId}/convert`, { method: "POST" });
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not convert lead");
    } finally {
      setBusy(false);
    }
  }

  async function saveFollowUp(kind = "follow_up") {
    if (!selected?.rawId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/leads/${selected.rawId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          notes: followNote || (kind === "call" ? "Call logged" : null),
          next_follow_up: followDate ? new Date(followDate).toISOString() : null,
        }),
      });
      setFollowNote("");
      setFollowDate("");
      const acts = await api<Activity[]>(`/api/v1/leads/${selected.rawId}/activities`);
      setActivities(acts);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save activity");
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setError("");
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      const companyId = getCompanyId();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (companyId) headers["X-Company-Id"] = companyId;
      const res = await fetch(`${API_URL}/api/v1/leads/export`, { headers });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leads.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export");
    }
  }

  async function importCsv(file: File) {
    setError("");
    try {
      const csv = await file.text();
      await api("/api/v1/leads/import", { method: "POST", body: JSON.stringify({ csv }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import");
    }
  }

  function contactLine(l: LeadRow) {
    return [l.contact !== "—" ? l.contact : null, l.phone !== "—" ? l.phone : null].filter(Boolean).join(" · ") || "—";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Leads"
        action={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportCsv()} className="rounded-lg border border-border px-3 py-2 text-sm">
              Export CSV
            </button>
            <button type="button" onClick={() => importRef.current?.click()} className="rounded-lg border border-border px-3 py-2 text-sm">
              Import CSV
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importCsv(file);
              }}
            />
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              + Add lead
            </button>
          </div>
        }
      />

      {!isSales && (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Total" value={String(total)} />
        <Kpi label="New" value={String(nAt("new"))} />
        <Kpi label="Qualified" value={String(nAt("qualified"))} />
        <Kpi label="Converted" value={String(nAt("won"))} />
        <Kpi label="Lost" value={String(nAt("lost"))} />
        <Kpi label="Pipeline value" value={pipelineValue ? inr(pipelineValue) : "—"} />
      </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:p-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className={cn(inputCls, "min-w-[12rem] flex-1")}
          />
          <select value={assigned} onChange={(e) => setAssigned(e.target.value)} className={inputCls}>
            <option value="all">All salesperson</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={leadType} onChange={(e) => setLeadType(e.target.value)} className={inputCls}>
            <option value="all">All types</option>
            <option value="wholesale">Wholesale</option>
            <option value="retail">Retail</option>
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls}>
            <option value="all">All stages</option>
            {PIPELINE.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
          {(stage !== "all" || source !== "all" || leadType !== "all" || assigned !== "all" || dateFrom || dateTo || q) && (
            <button
              type="button"
              className="rounded-lg border border-border px-2.5 py-2 text-sm text-muted-foreground hover:bg-secondary"
              onClick={() => {
                setStage("all");
                setSource("all");
                setLeadType("all");
                setAssigned("all");
                setDateFrom("");
                setDateTo("");
                setQ("");
              }}
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {filtered.length}/{total}
          </span>
        </div>

        <div className="grid w-full grid-cols-3 border-b border-border sm:grid-cols-5 lg:grid-cols-9">
          <button
            type="button"
            onClick={() => setStage("all")}
            className={cn(
              "flex flex-col items-center justify-center gap-0 border-b-2 px-1 py-1.5 transition-colors sm:py-2",
              stage === "all"
                ? "border-primary bg-primary-soft/30 text-foreground"
                : "border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            <span className="text-[0.6rem] font-medium uppercase tracking-[0.06em]">All</span>
            <span className="text-sm font-semibold tabular-nums leading-tight sm:text-base">{total}</span>
          </button>
          {stageCounts.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(stage === s.key ? "all" : s.key)}
              className={cn(
                "flex flex-col items-center justify-center gap-0 border-b-2 px-1 py-1.5 transition-colors sm:py-2",
                stage === s.key
                  ? "border-primary bg-primary-soft/30 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )}
            >
              <span className="text-[0.6rem] font-medium uppercase tracking-[0.06em]">{s.label}</span>
              <span className="text-sm font-semibold tabular-nums leading-tight sm:text-base">{s.n}</span>
            </button>
          ))}
        </div>

        {rows.some((r) => r.overdue) && (
          <p className="border-b border-border bg-accent/40 px-3 py-2 text-xs sm:px-4">
            {rows.filter((r) => r.overdue).length} overdue follow-ups
          </p>
        )}

        <ul className="divide-y divide-border sm:hidden">
          {filtered.map((l) => (
            <li key={l.id} className="cursor-pointer px-3 py-3" onClick={() => setSelected(l)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {l.id} · {contactLine(l)}
                  </p>
                </div>
                <Badge tone={stageTone(l.stage)}>{STAGE_LABEL[l.stage] || l.stage}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {l.source} · <span className="tabular-nums text-foreground">{l.value ? inr(l.value) : "—"}</span> · {l.assigned}
                {l.nextFollow !== "—" ? ` · ${l.nextFollow}` : ""}
              </p>
            </li>
          ))}
          {!filtered.length && <li className="px-3 py-10 text-center text-sm text-muted-foreground">No leads match.</li>}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-left text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                {["ID", "Business", "Contact", "Source", "Stage", "Value", "Assigned", "Next follow-up"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium first:pl-4 last:pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/30"
                  onClick={() => setSelected(l)}
                >
                  <td className="px-3 py-2.5 pl-4 font-medium tabular-nums">{l.id}</td>
                  <td className="max-w-[14rem] px-3 py-2.5">
                    <p className="truncate font-medium">{l.name}</p>
                    {l.requirement !== "—" && <p className="truncate text-xs text-muted-foreground">{l.requirement}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{contactLine(l)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{l.source}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={stageTone(l.stage)}>{STAGE_LABEL[l.stage] || l.stage}</Badge>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{l.value ? inr(l.value) : "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{l.assigned}</td>
                  <td className={cn("px-3 py-2.5 pr-4", l.overdue && "text-destructive")}>{l.nextFollow}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="py-10 text-center text-sm text-muted-foreground">No leads match.</p>}
        </div>
      </section>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setAdding(false)} />
          <form
            onSubmit={createLead}
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Add lead</h2>
            <div className="mt-4 space-y-3">
              {(
                [
                  ["business_name", "Name", "text", true],
                  ["contact_person", "Contact person", "text", false],
                  ["phone", "Phone", "tel", false],
                  ["gstin", "GSTIN", "text", false],
                  ["location", "City", "text", false],
                  ["product_requirement", "Product interest", "text", false],
                  ["estimated_value", "Estimated value (₹)", "number", false],
                ] as const
              ).map(([key, label, type, required]) => (
                <label key={key} className="block text-sm text-muted-foreground">
                  {label}
                  <input
                    required={required}
                    type={type}
                    className={cn(inputCls, "mt-1 w-full text-foreground")}
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="block text-sm text-muted-foreground">
                Source
                <select
                  className={cn(inputCls, "mt-1 w-full")}
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                >
                  <option>WhatsApp</option>
                  <option>Call</option>
                  <option>Visit</option>
                  <option>Referral</option>
                  <option>Website</option>
                  <option>Other</option>
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Type
                <select
                  className={cn(inputCls, "mt-1 w-full")}
                  value={form.lead_type}
                  onChange={(e) => setForm((f) => ({ ...f, lead_type: e.target.value }))}
                >
                  <option value="wholesale">Wholesale</option>
                  <option value="retail">Retail</option>
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Priority
                <select
                  className={cn(inputCls, "mt-1 w-full")}
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Notes
                <textarea
                  className={cn(inputCls, "mt-1 w-full text-foreground")}
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="submit" className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground">
                Save
              </button>
              <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setSelected(null)} />
          <div className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl">
            <h2 className="text-lg font-semibold">{selected.name}</h2>
            <p className="text-sm text-muted-foreground">
              {selected.id} · {contactLine(selected)} · {selected.type}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {PIPELINE.filter((s) => s !== "lost").map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!selected.rawId || busy}
                  onClick={() => void patchLead(selected.rawId, { status: s })}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs",
                    selected.stage === s ? "bg-primary text-primary-foreground" : "border border-border",
                  )}
                >
                  {STAGE_LABEL[s]}
                </button>
              ))}
              <button
                type="button"
                disabled={!selected.rawId || busy}
                onClick={() => void patchLead(selected.rawId, { status: "lost", lost_reason: "Lost" })}
                className="rounded-full border border-destructive/40 px-2.5 py-1 text-xs text-destructive"
              >
                Lost
              </button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd>{selected.source}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Priority</dt>
                <dd className="capitalize">{selected.priority}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">GSTIN</dt>
                <dd>{selected.gstin || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">City</dt>
                <dd>{selected.location || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Est. value</dt>
                <dd>{selected.value ? inr(selected.value) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Next follow-up</dt>
                <dd className={selected.overdue ? "text-destructive" : ""}>{selected.nextFollow}</dd>
              </div>
            </dl>
            {selected.notes && <p className="mt-3 text-sm text-muted-foreground">{selected.notes}</p>}
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">Follow-up</p>
              <textarea
                className={cn(inputCls, "w-full")}
                rows={2}
                placeholder="Call notes / next action"
                value={followNote}
                onChange={(e) => setFollowNote(e.target.value)}
              />
              <input type="datetime-local" className={cn(inputCls, "w-full")} value={followDate} onChange={(e) => setFollowDate(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy || !selected.rawId}
                  onClick={() => void saveFollowUp("follow_up")}
                  className="rounded-lg border border-border py-2 text-sm"
                >
                  Save follow-up
                </button>
                <button
                  type="button"
                  disabled={busy || !selected.rawId}
                  onClick={() => void saveFollowUp("call")}
                  className="rounded-lg border border-border py-2 text-sm"
                >
                  Log call
                </button>
              </div>
            </div>
            {activities.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
                {activities.map((a) => (
                  <li key={a.id}>
                    <span className="capitalize text-muted-foreground">{a.kind}</span>
                    {a.notes ? ` · ${a.notes}` : ""}
                    <span className="block text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !selected.rawId || !!selected.customerId}
                onClick={() => void convertSelected()}
                className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {selected.customerId ? "Converted" : "Convert to customer"}
              </button>
              <Link
                to="/sales"
                className="rounded-lg border border-border py-2.5 text-center text-sm"
                onClick={() => setSelected(null)}
              >
                Create quotation
              </Link>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="mt-2 w-full rounded-lg border border-border py-2.5 text-sm">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
