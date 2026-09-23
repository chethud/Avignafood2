import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { inr, mt } from "@/lib/erp-data";
import { Badge, Bar, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/purchases")({
  head: () => ({
    meta: [
      { title: "Purchases · Avighna ERP" },
      { name: "description", content: "Purchase orders from manufacturers — stock inward for the warehouse." },
      { property: "og:title", content: "Purchases · Avighna ERP" },
    ],
  }),
  component: Purchases,
});

type Customer = { id: number; name: string; phone: string | null };

type PurchaseApi = {
  id: number;
  customer_id: number | null;
  source: string;
  manufacturer: string | null;
  product: string;
  quantity: string | number;
  received: string | number;
  value: string | number;
  eta: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

type Row = {
  id: string;
  rawId?: number;
  customer: string;
  customerId?: number;
  source: string;
  manufacturer: string;
  product: string;
  qty: number;
  received: number;
  value: number;
  eta: string;
  status: string;
};

const SOURCES = [
  { id: "manufacturer", label: "Manufacturer" },
  { id: "direct", label: "Direct" },
  { id: "sales_referral", label: "Sales referral" },
  { id: "other", label: "Other" },
] as const;

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.id, s.label]));

const PO_STATUSES = ["Confirmed", "In transit", "Partially received", "Received"] as const;

const STATUS_ROLES = new Set(["supervisor", "owner", "super_admin"]);

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function statusTone(status: string): "good" | "neutral" | "warn" {
  if (status === "Received" || status === "received") return "good";
  if (status === "Confirmed" || status === "approved") return "neutral";
  return "warn";
}

function Purchases() {
  const { me } = useMe();
  const { firm } = useCompany();
  const role = me?.user.role;
  const canUpdateStatus =
    !role || STATUS_ROLES.has(role) || !!me?.permissions.includes("purchases.edit");
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    source: "manufacturer",
    manufacturer: "",
    product: "",
    quantity: "",
    value: "",
    eta: "",
    notes: "",
  });

  async function loadCustomers() {
    try {
      return await api<Customer[]>("/api/v1/customers");
    } catch {
      return [] as Customer[];
    }
  }

  async function load() {
    const cust = await loadCustomers();
    const names = Object.fromEntries(cust.map((c) => [c.id, c.name]));
    try {
      const data = await api<PurchaseApi[]>("/api/v1/purchases");
      setRows(
        data.map((p) => ({
          id: `PO-${p.id}`,
          rawId: p.id,
          customer: p.customer_id ? names[p.customer_id] || `Customer #${p.customer_id}` : "—",
          customerId: p.customer_id || undefined,
          source: p.source,
          manufacturer: p.manufacturer || "—",
          product: p.product,
          qty: Number(p.quantity) || 0,
          received: Number(p.received) || 0,
          value: Number(p.value) || 0,
          eta: p.eta || "—",
          status: p.status,
        })),
      );
      return;
    } catch {
      /* offline demo rows */
    }
    setRows([]);
  }

  useEffect(() => {
    load();
  }, [firm]);

  function openCreate() {
    setError("");
    setForm({
      source: "manufacturer",
      manufacturer: "",
      product: "",
      quantity: "",
      value: "",
      eta: "",
      notes: "",
    });
    setOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const qty = Number(form.quantity);
    const manufacturer = form.manufacturer.trim();
    if (!manufacturer) {
      setError("Manufacturer is required");
      setBusy(false);
      return;
    }
    if (!(qty > 0) || !form.product.trim()) {
      setError("Product and positive quantity are required");
      setBusy(false);
      return;
    }
    try {
      await api("/api/v1/purchases", {
        method: "POST",
        body: JSON.stringify({
          customer_id: null,
          source: form.source,
          manufacturer,
          product: form.product.trim(),
          quantity: qty,
          received: 0,
          value: Number(form.value) || 0,
          eta: form.eta.trim() || null,
          status: "Confirmed",
          notes: form.notes.trim() || null,
        }),
      });
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save purchase");
    } finally {
      setBusy(false);
    }
  }

  function applyLocalStatus(row: Row, status: string) {
    setRows((list) =>
      list.map((r) =>
        r.id === row.id
          ? {
              ...r,
              status,
              received: status === "Received" ? r.qty : r.received,
            }
          : r,
      ),
    );
  }

  async function updateStatus(row: Row, status: string) {
    if (row.status === status) return;
    setError("");
    if (!row.rawId) {
      applyLocalStatus(row, status);
      return;
    }
    setStatusBusyId(row.id);
    try {
      const updated = await api<PurchaseApi>(`/api/v1/purchases/${row.rawId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setRows((list) =>
        list.map((r) =>
          r.rawId === row.rawId
            ? {
                ...r,
                status: updated.status,
                received: Number(updated.received) || 0,
              }
            : r,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
    } finally {
      setStatusBusyId(null);
    }
  }

  const openOrders = useMemo(() => rows.filter((p) => p.received < p.qty), [rows]);
  const incoming = useMemo(() => openOrders.reduce((a, p) => a + (p.qty - p.received), 0), [openOrders]);
  const committed = useMemo(() => rows.reduce((a, p) => a + p.value, 0), [rows]);

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle="Buy from manufacturer → track inbound → receive into warehouse"
        action={
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            + New purchase
          </button>
        }
      />

      {error && !open && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Open orders" value={String(openOrders.length)} meta="Awaiting full receipt" />
        <Kpi label="Incoming quantity" value={mt(incoming)} />
        <Kpi label="Committed value" value={inr(committed)} />
      </div>

      <Panel title="Purchase orders" hint="Manufacturer stock buys" className="mt-6">
        <Table head={["PO", "Manufacturer", "Source", "Product", "Ordered", "Received", "Progress", "Value", "ETA", "Status"]}>
          {rows.map((p) => {
            const locked = p.status === "pending_approval" || p.status === "rejected";
            const selectValue = PO_STATUSES.includes(p.status as (typeof PO_STATUSES)[number])
              ? p.status
              : p.status === "received"
                ? "Received"
                : p.status === "approved"
                  ? "Confirmed"
                  : p.status;
            return (
              <tr key={p.id}>
                <Td className="font-medium">{p.id}</Td>
                <Td>{p.manufacturer}</Td>
                <Td className="text-muted-foreground">{SOURCE_LABEL[p.source] || p.source}</Td>
                <Td className="text-muted-foreground">{p.product}</Td>
                <Td className="tabular-nums">{mt(p.qty)}</Td>
                <Td className="tabular-nums">{mt(p.received)}</Td>
                <Td>
                  <Bar value={p.qty ? (p.received / p.qty) * 100 : 0} />
                </Td>
                <Td className="tabular-nums">{inr(p.value)}</Td>
                <Td className="text-muted-foreground">{p.eta}</Td>
                <Td>
                  {canUpdateStatus && !locked ? (
                    <select
                      className="min-w-[8.5rem] rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground"
                      value={selectValue}
                      disabled={statusBusyId === p.id}
                      onChange={(e) => void updateStatus(p, e.target.value)}
                      aria-label={`Status for ${p.id}`}
                    >
                      {!PO_STATUSES.includes(selectValue as (typeof PO_STATUSES)[number]) && (
                        <option value={selectValue}>{selectValue.replaceAll("_", " ")}</option>
                      )}
                      {PO_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={statusTone(p.status)}>{p.status.replaceAll("_", " ")}</Badge>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        {!rows.length && <p className="py-8 text-center text-sm text-muted-foreground">No purchases yet.</p>}
      </Panel>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setOpen(false)} />
          <form
            onSubmit={save}
            className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">New purchase bill</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter the manufacturer and what you are buying.</p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                Manufacturer <span className="text-destructive">*</span>
                <input
                  required
                  className={inputCls}
                  placeholder="e.g. Aditya Sugars"
                  value={form.manufacturer}
                  onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
                />
              </label>

              <label className="block text-sm text-muted-foreground">
                Source
                <select
                  className={inputCls}
                  value={form.source}
                  onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                >
                  {SOURCES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-muted-foreground">
                Product <span className="text-destructive">*</span>
                <input
                  required
                  className={inputCls}
                  value={form.product}
                  onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-muted-foreground">
                  Qty (MT) <span className="text-destructive">*</span>
                  <input
                    required
                    type="number"
                    min={0.001}
                    step="any"
                    className={inputCls}
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </label>
                <label className="block text-sm text-muted-foreground">
                  Value (₹)
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={form.value}
                    onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm text-muted-foreground">
                ETA
                <input
                  className={inputCls}
                  placeholder="e.g. 31 Jul"
                  value={form.eta}
                  onChange={(e) => setForm((f) => ({ ...f, eta: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Notes
                <input
                  className={inputCls}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="submit"
                disabled={busy}
                className={cn("rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground", busy && "opacity-60")}
              >
                {busy ? "Saving…" : "Create bill"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
