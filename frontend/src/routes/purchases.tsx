import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { byFirm, inr, mt, purchaseOrders as mockPOs } from "@/lib/erp-data";
import { Badge, Bar, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/purchases")({
  head: () => ({
    meta: [
      { title: "Purchases · Avighna ERP" },
      { name: "description", content: "Purchase bills and orders linked to customers — sales referral or direct." },
      { property: "og:title", content: "Purchases · Avighna ERP" },
    ],
  }),
  component: Purchases,
});

type Customer = { id: number; name: string; phone: string | null };

type PurchaseApi = {
  id: number;
  customer_id: number;
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
  { id: "sales_referral", label: "Sales referral" },
  { id: "direct", label: "Direct" },
  { id: "manufacturer", label: "Manufacturer" },
  { id: "other", label: "Other" },
] as const;

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.id, s.label]));

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function Purchases() {
  const { firm } = useCompany();
  const [rows, setRows] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [sourceF, setSourceF] = useState("all");
  const [form, setForm] = useState({
    customer_id: "",
    customer_name: "",
    customer_phone: "",
    source: "sales_referral",
    manufacturer: "",
    product: "",
    quantity: "",
    value: "",
    eta: "",
    notes: "",
  });

  async function loadCustomers() {
    try {
      const list = await api<Customer[]>("/api/v1/customers");
      setCustomers(list);
      return list;
    } catch {
      setCustomers([]);
      return [] as Customer[];
    }
  }

  async function load() {
    const cust = await loadCustomers();
    const names = Object.fromEntries(cust.map((c) => [c.id, c.name]));
    try {
      const data = await api<PurchaseApi[]>("/api/v1/purchases");
      if (data.length) {
        setRows(
          data.map((p) => ({
            id: `PO-${p.id}`,
            customer: names[p.customer_id] || `Customer #${p.customer_id}`,
            customerId: p.customer_id,
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
      }
    } catch {
      /* mock */
    }
    setRows(
      byFirm(mockPOs, firm).map((p) => ({
        id: p.id,
        customer: "—",
        source: "manufacturer",
        manufacturer: p.manufacturer,
        product: p.product,
        qty: p.qty,
        received: p.received,
        value: p.value,
        eta: p.eta,
        status: p.status,
      })),
    );
  }

  useEffect(() => {
    load();
  }, [firm]);

  function openCreate() {
    setError("");
    setNewCustomer(false);
    setForm({
      customer_id: customers[0] ? String(customers[0].id) : "",
      customer_name: "",
      customer_phone: "",
      source: "sales_referral",
      manufacturer: "",
      product: "",
      quantity: "",
      value: "",
      eta: "",
      notes: "",
    });
    setOpen(true);
  }

  async function ensureCustomerId(): Promise<number> {
    if (!newCustomer) {
      const id = Number(form.customer_id);
      if (!id) throw new Error("Select a customer");
      return id;
    }
    const name = form.customer_name.trim();
    if (!name) throw new Error("Enter the new customer name");
    const created = await api<Customer>("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name,
        phone: form.customer_phone.trim() || null,
      }),
    });
    await loadCustomers();
    return created.id;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const qty = Number(form.quantity);
    if (!(qty > 0) || !form.product.trim()) {
      setError("Product and positive quantity are required");
      setBusy(false);
      return;
    }
    try {
      const customerId = await ensureCustomerId();
      await api("/api/v1/purchases", {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerId,
          source: form.source,
          manufacturer: form.manufacturer.trim() || null,
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
      // offline: keep local row if customer create/purchase API fails after we have a name
      if (newCustomer && form.customer_name.trim()) {
        setRows((r) => [
          {
            id: `PO-L-${Date.now()}`,
            customer: form.customer_name.trim(),
            source: form.source,
            manufacturer: form.manufacturer.trim() || "—",
            product: form.product.trim(),
            qty,
            received: 0,
            value: Number(form.value) || 0,
            eta: form.eta.trim() || "—",
            status: "Confirmed",
          },
          ...r,
        ]);
        setOpen(false);
      } else if (!newCustomer && form.customer_id) {
        const name = customers.find((c) => String(c.id) === form.customer_id)?.name || "Customer";
        setRows((r) => [
          {
            id: `PO-L-${Date.now()}`,
            customer: name,
            source: form.source,
            manufacturer: form.manufacturer.trim() || "—",
            product: form.product.trim(),
            qty,
            received: 0,
            value: Number(form.value) || 0,
            eta: form.eta.trim() || "—",
            status: "Confirmed",
          },
          ...r,
        ]);
        setOpen(false);
      } else {
        setError(err instanceof Error ? err.message : "Could not save purchase");
      }
    } finally {
      setBusy(false);
    }
  }

  const openOrders = useMemo(() => rows.filter((p) => p.received < p.qty), [rows]);
  const incoming = useMemo(() => openOrders.reduce((a, p) => a + (p.qty - p.received), 0), [openOrders]);
  const committed = useMemo(() => rows.reduce((a, p) => a + p.value, 0), [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (statusF !== "all" && p.status.toLowerCase() !== statusF.toLowerCase()) return false;
      if (sourceF !== "all" && p.source !== sourceF) return false;
      if (!needle) return true;
      return `${p.id} ${p.customer} ${p.manufacturer} ${p.product} ${p.source} ${p.status}`.toLowerCase().includes(needle);
    });
  }, [rows, q, statusF, sourceF]);

  const filtersActive = Boolean(q.trim()) || statusF !== "all" || sourceF !== "all";

  function clearFilters() {
    setQ("");
    setStatusF("all");
    setSourceF("all");
  }

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle="Create a bill → auto load on Dispatch if a vehicle is free"
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Open orders" value={String(openOrders.length)} meta="Awaiting full receipt" />
        <Kpi label="Incoming quantity" value={mt(incoming)} />
        <Kpi label="Committed value" value={inr(committed)} />
      </div>

      <Panel
        title="Purchase orders"
        hint={filtersActive ? `Showing ${visible.length} of ${rows.length}` : "Customer-linked bills"}
        className="mt-6"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
            placeholder="Search PO, customer, product"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Received">Received</option>
          </select>
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={sourceF} onChange={(e) => setSourceF(e.target.value)}>
            <option value="all">All sources</option>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {filtersActive && (
          <button type="button" className="mb-3 text-sm text-primary hover:underline" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <Table head={["PO", "Customer", "Source", "Manufacturer", "Product", "Ordered", "Received", "Progress", "Value", "ETA", "Status"]}>
          {visible.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.id}</Td>
              <Td>{p.customer}</Td>
              <Td className="text-muted-foreground">{SOURCE_LABEL[p.source] || p.source}</Td>
              <Td>{p.manufacturer}</Td>
              <Td className="text-muted-foreground">{p.product}</Td>
              <Td className="tabular-nums">{mt(p.qty)}</Td>
              <Td className="tabular-nums">{mt(p.received)}</Td>
              <Td>
                <Bar value={p.qty ? (p.received / p.qty) * 100 : 0} />
              </Td>
              <Td className="tabular-nums">{inr(p.value)}</Td>
              <Td className="text-muted-foreground">{p.eta}</Td>
              <Td>
                <Badge tone={p.status === "Received" ? "good" : p.status === "Confirmed" ? "neutral" : "warn"}>
                  {p.status}
                </Badge>
              </Td>
            </tr>
          ))}
        </Table>
        {!visible.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {rows.length ? "No purchases match this view." : "No purchases yet."}
          </p>
        )}
      </Panel>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setOpen(false)} />
          <form
            onSubmit={save}
            className="relative z-10 w-full max-h-[90dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">New purchase bill</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick or create a customer, then enter the purchase.</p>

            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewCustomer(false)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm font-medium",
                    !newCustomer ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                  )}
                >
                  Existing customer
                </button>
                <button
                  type="button"
                  onClick={() => setNewCustomer(true)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm font-medium",
                    newCustomer ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                  )}
                >
                  New customer
                </button>
              </div>

              {!newCustomer ? (
                <label className="block text-sm text-muted-foreground">
                  Customer
                  <select
                    required={!newCustomer}
                    className={inputCls}
                    value={form.customer_id}
                    onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </option>
                    ))}
                  </select>
                  {!customers.length && (
                    <span className="mt-1 block text-xs text-warning">No customers yet — switch to New customer.</span>
                  )}
                </label>
              ) : (
                <>
                  <label className="block text-sm text-muted-foreground">
                    Customer name
                    <input
                      required
                      className={inputCls}
                      value={form.customer_name}
                      onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                    />
                  </label>
                  <label className="block text-sm text-muted-foreground">
                    Phone
                    <input
                      type="tel"
                      className={inputCls}
                      value={form.customer_phone}
                      onChange={(e) => setForm((f) => ({ ...f, customer_phone: e.target.value }))}
                    />
                  </label>
                </>
              )}

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
                Manufacturer / supplier
                <input
                  className={inputCls}
                  value={form.manufacturer}
                  onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Product
                <input
                  required
                  className={inputCls}
                  value={form.product}
                  onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-muted-foreground">
                  Qty (MT)
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
