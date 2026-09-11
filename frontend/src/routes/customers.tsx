import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { inr } from "@/lib/erp-data";
import { telHref, waHref } from "@/lib/format";
import { Badge, Bar, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers · Avighna ERP" },
      { name: "description", content: "Customer master with credit visibility and health." },
      { property: "og:title", content: "Customers · Avighna ERP" },
    ],
  }),
  component: Customers,
});

type Contact = { id: number; name: string; phone: string | null; email: string | null; designation: string | null; is_primary: boolean };

type CustomerRow = {
  id: number;
  name: string;
  legal_name: string;
  trade_name: string;
  contact_person: string;
  phone: string;
  email: string;
  gstin: string;
  billing_address: string;
  shipping_address: string;
  customer_type: string;
  credit_limit: number;
  credit_days: number;
  is_active: boolean;
  outstanding: number;
  lastOrder: string;
  lastPayment: string;
  health: "GOOD" | "WATCH" | "RISK";
  credit_status: string;
  credit_countdown_days: number | null;
  revenue: number;
  order_count: number;
  reorder: string[];
  contacts: Contact[];
};

type ApiCustomer = {
  id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  credit_limit: string | number;
  credit_days: number;
  is_active: boolean;
  legal_name: string | null;
  trade_name: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  customer_type: string | null;
  outstanding: string | number;
  lifetime_revenue: string | number;
  order_count: number;
  last_order: string | null;
  last_payment: string | null;
  health: string;
  credit_status: string;
  credit_countdown_days: number | null;
  reorder_suggestions: string[];
  contacts: Contact[];
};

type FormState = {
  name: string;
  legal_name: string;
  trade_name: string;
  contact_person: string;
  phone: string;
  email: string;
  gstin: string;
  billing_address: string;
  shipping_address: string;
  customer_type: string;
  credit_limit: string;
  credit_days: string;
  is_active: boolean;
};

const emptyForm = (): FormState => ({
  name: "",
  legal_name: "",
  trade_name: "",
  contact_person: "",
  phone: "",
  email: "",
  gstin: "",
  billing_address: "",
  shipping_address: "",
  customer_type: "wholesale",
  credit_limit: "0",
  credit_days: "30",
  is_active: true,
});

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function fromApi(c: ApiCustomer): CustomerRow {
  const health = c.health === "RISK" ? "RISK" : c.health === "WATCH" ? "WATCH" : "GOOD";
  return {
    id: c.id,
    name: c.name,
    legal_name: c.legal_name || c.name,
    trade_name: c.trade_name || "",
    contact_person: c.contact_person || "",
    phone: c.phone || "",
    email: c.email || "",
    gstin: c.gstin || "",
    billing_address: c.billing_address || c.address || "",
    shipping_address: c.shipping_address || "",
    customer_type: c.customer_type || "",
    credit_limit: Number(c.credit_limit) || 0,
    credit_days: c.credit_days ?? 30,
    is_active: c.is_active,
    outstanding: Number(c.outstanding) || 0,
    lastOrder: c.last_order || "—",
    lastPayment: c.last_payment || "—",
    health,
    credit_status: c.credit_status || "ok",
    credit_countdown_days: c.credit_countdown_days,
    revenue: Number(c.lifetime_revenue) || 0,
    order_count: c.order_count || 0,
    reorder: c.reorder_suggestions || [],
    contacts: c.contacts || [],
  };
}

function healthTone(h: CustomerRow["health"]): "good" | "warn" | "bad" {
  if (h === "GOOD") return "good";
  if (h === "WATCH") return "warn";
  return "bad";
}

function Customers() {
  const { me } = useMe();
  const isSales = me?.user.role === "sales";
  const { firm } = useCompany();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [healthF, setHealthF] = useState("all");

  async function load() {
    try {
      const data = await api<ApiCustomer[]>("/api/v1/customers");
      setRows(data.map(fromApi));
    } catch {
      setRows([]);
    }
  }

  useEffect(() => {
    void load();
  }, [firm]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setModal("add");
  }

  function openEdit(c: CustomerRow) {
    setEditing(c);
    setForm({
      name: c.name,
      legal_name: c.legal_name,
      trade_name: c.trade_name,
      contact_person: c.contact_person,
      phone: c.phone,
      email: c.email,
      gstin: c.gstin,
      billing_address: c.billing_address,
      shipping_address: c.shipping_address,
      customer_type: c.customer_type || "wholesale",
      credit_limit: String(c.credit_limit || 0),
      credit_days: String(c.credit_days || 30),
      is_active: c.is_active,
    });
    setContactName("");
    setContactPhone("");
    setError("");
    setModal("edit");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const legal = form.legal_name.trim() || form.name.trim();
    const body = {
      name: form.name.trim() || legal,
      legal_name: legal || null,
      trade_name: form.trade_name.trim() || null,
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      gstin: form.gstin.trim() || null,
      address: form.billing_address.trim() || null,
      billing_address: form.billing_address.trim() || null,
      shipping_address: form.shipping_address.trim() || null,
      customer_type: form.customer_type || null,
      credit_limit: Number(form.credit_limit) || 0,
      credit_days: Number(form.credit_days) || 30,
      ...(modal === "edit" ? { is_active: form.is_active } : {}),
    };
    try {
      if (modal === "add") {
        await api("/api/v1/customers", { method: "POST", body: JSON.stringify(body) });
      } else if (editing) {
        await api(`/api/v1/customers/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      await load();
      setModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!editing || !contactName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<ApiCustomer>(`/api/v1/customers/${editing.id}/contacts`, {
        method: "POST",
        body: JSON.stringify({ name: contactName.trim(), phone: contactPhone.trim() || null }),
      });
      const row = fromApi(updated);
      setEditing(row);
      setRows((list) => list.map((c) => (c.id === row.id ? row : c)));
      setContactName("");
      setContactPhone("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact");
    } finally {
      setBusy(false);
    }
  }

  const outstanding = rows.reduce((a, c) => a + c.outstanding, 0);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (typeF !== "all" && (c.customer_type || "") !== typeF) return false;
      if (healthF === "inactive") {
        if (c.is_active) return false;
      } else if (healthF !== "all") {
        if (!c.is_active || c.health !== healthF) return false;
      }
      if (!needle) return true;
      return `${c.name} ${c.legal_name} ${c.trade_name} ${c.gstin} ${c.phone} ${c.customer_type}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, typeF, healthF]);

  const filtersActive = Boolean(q.trim()) || typeF !== "all" || healthF !== "all";

  function clearFilters() {
    setQ("");
    setTypeF("all");
    setHealthF("all");
  }

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Credit visibility only — payments are booked in Accounts"
        action={
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            + Add customer
          </button>
        }
      />

      {!isSales && (
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Accounts" value={String(rows.length)} />
        <Kpi label="Outstanding" value={outstanding ? inr(outstanding) : "—"} tone="warn" />
        <Kpi label="On credit hold" value={String(rows.filter((c) => c.credit_status === "hold").length)} />
      </div>
      )}

      {isSales ? (
        <>
          <div className="mt-4 mb-2 grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Search customer, phone, GSTIN"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={typeF} onChange={(e) => setTypeF(e.target.value)}>
              <option value="all">All types</option>
              <option value="wholesale">Wholesale</option>
              <option value="retail">Retail</option>
            </select>
          </div>
          <ul className="space-y-2">
          {visible.map((c) => (
            <li key={c.id} className="rounded-2xl border border-border bg-card px-3 py-3">
              <button type="button" className="w-full text-left" onClick={() => openEdit(c)}>
                <p className="font-medium">{c.trade_name || c.legal_name || c.name}</p>
                <p className="text-xs capitalize text-muted-foreground">{c.customer_type || "—"}</p>
                <p className="mt-1 text-sm tabular-nums">Outstanding {c.outstanding ? inr(c.outstanding) : "—"}</p>
                <p className="text-xs text-muted-foreground">Last order: {c.lastOrder}</p>
              </button>
              {c.phone && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a href={telHref(c.phone)} className="rounded-xl border border-border py-2 text-center text-sm">
                    Call
                  </a>
                  <a href={waHref(c.phone)} target="_blank" rel="noreferrer" className="rounded-xl border border-border py-2 text-center text-sm">
                    WhatsApp
                  </a>
                </div>
              )}
            </li>
          ))}
          {!visible.length && <li className="py-8 text-center text-sm text-muted-foreground">{rows.length ? "No customers match." : "No customers yet."}</li>}
        </ul>
        </>
      ) : (
        <Panel
          title="Customers"
          className="mt-4"
          hint={filtersActive ? `Showing ${visible.length} of ${rows.length}` : undefined}
        >
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
              placeholder="Search customer, phone, GSTIN"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={typeF} onChange={(e) => setTypeF(e.target.value)}>
              <option value="all">All types</option>
              <option value="wholesale">Wholesale</option>
              <option value="retail">Retail</option>
            </select>
            <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={healthF} onChange={(e) => setHealthF(e.target.value)}>
              <option value="all">All health</option>
              <option value="GOOD">Good</option>
              <option value="WATCH">Watch</option>
              <option value="RISK">Risk</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {filtersActive && (
            <button type="button" className="mb-3 text-sm text-primary hover:underline" onClick={clearFilters}>
              Clear filters
            </button>
          )}
          <Table head={["Customer", "Type", "Credit", "Outstanding", "Health"]}>
            {visible.map((c) => {
              const used = c.credit_limit > 0 ? (c.outstanding / c.credit_limit) * 100 : 0;
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-secondary/40" onClick={() => openEdit(c)}>
                  <Td>
                    <p className="font-medium">{c.trade_name || c.legal_name || c.name}</p>
                    <p className="text-xs text-muted-foreground">{[c.gstin || null, c.phone || null].filter(Boolean).join(" · ") || "—"}</p>
                  </Td>
                  <Td className="capitalize text-muted-foreground">{c.customer_type || "—"}</Td>
                  <Td>
                    <p className="tabular-nums">{c.credit_days} days</p>
                    {c.credit_limit > 0 && <Bar value={used} tone={used > 85 ? "destructive" : used > 60 ? "warning" : "primary"} />}
                  </Td>
                  <Td className="tabular-nums">{c.outstanding ? inr(c.outstanding) : "—"}</Td>
                  <Td>
                    <Badge tone={c.is_active ? healthTone(c.health) : "neutral"}>{c.is_active ? c.health : "Inactive"}</Badge>
                  </Td>
                </tr>
              );
            })}
          </Table>
          {!visible.length && <p className="py-8 text-center text-sm text-muted-foreground">{rows.length ? "No customers match." : "No customers yet."}</p>}
        </Panel>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setModal(null)} />
          <form
            onSubmit={save}
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">{modal === "add" ? "Add customer" : "Customer"}</h2>

            {modal === "edit" && editing && (
              <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border p-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Health</dt>
                  <dd>
                    <Badge tone={healthTone(editing.health)}>{editing.health}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Credit status</dt>
                  <dd className="capitalize">{editing.credit_status.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Outstanding</dt>
                  <dd>{editing.outstanding ? inr(editing.outstanding) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Credit countdown</dt>
                  <dd>
                    {editing.credit_countdown_days == null
                      ? "—"
                      : editing.credit_countdown_days >= 0
                        ? `${editing.credit_countdown_days} days to due`
                        : `${Math.abs(editing.credit_countdown_days)} days overdue`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Lifetime revenue</dt>
                  <dd>{editing.revenue ? inr(editing.revenue) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Orders</dt>
                  <dd>{editing.order_count}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Last order</dt>
                  <dd>{editing.lastOrder}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Last payment</dt>
                  <dd>{editing.lastPayment}</dd>
                </div>
                {editing.reorder.length > 0 && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Reorder suggestions</dt>
                    <dd>{editing.reorder.join(", ")}</dd>
                  </div>
                )}
              </dl>
            )}

            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                Legal name
                <input
                  required
                  className={inputCls}
                  value={form.legal_name || form.name}
                  onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value, name: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Trade name
                <input className={inputCls} value={form.trade_name} onChange={(e) => setForm((f) => ({ ...f, trade_name: e.target.value }))} />
              </label>
              <label className="block text-sm text-muted-foreground">
                Phone
                <input type="tel" className={inputCls} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="block text-sm text-muted-foreground">
                Email
                <input type="email" className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label className="block text-sm text-muted-foreground">
                GSTIN
                <input className={inputCls} value={form.gstin} onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))} />
              </label>
              <label className="block text-sm text-muted-foreground">
                Billing address
                <textarea className={inputCls} rows={2} value={form.billing_address} onChange={(e) => setForm((f) => ({ ...f, billing_address: e.target.value }))} />
              </label>
              <label className="block text-sm text-muted-foreground">
                Shipping address
                <textarea className={inputCls} rows={2} value={form.shipping_address} onChange={(e) => setForm((f) => ({ ...f, shipping_address: e.target.value }))} />
              </label>
              <label className="block text-sm text-muted-foreground">
                Customer type
                <select className={inputCls} value={form.customer_type} onChange={(e) => setForm((f) => ({ ...f, customer_type: e.target.value }))}>
                  <option value="wholesale">Wholesale</option>
                  <option value="retail">Retail</option>
                </select>
              </label>
              <label className="block text-sm text-muted-foreground">
                Contact person
                <input className={inputCls} value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm text-muted-foreground">
                  Credit limit (₹)
                  <input type="number" className={inputCls} value={form.credit_limit} onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))} />
                </label>
                <label className="block text-sm text-muted-foreground">
                  Credit days
                  <input type="number" className={inputCls} value={form.credit_days} onChange={(e) => setForm((f) => ({ ...f, credit_days: e.target.value }))} />
                </label>
              </div>
              {modal === "edit" && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="size-4 rounded border-border"
                  />
                  Active account
                </label>
              )}
            </div>

            {modal === "edit" && editing && (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <p className="text-sm font-medium">Contacts</p>
                <ul className="space-y-1 text-sm">
                  {editing.contacts.map((c) => (
                    <li key={c.id}>
                      {c.name}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </li>
                  ))}
                  {!editing.contacts.length && <li className="text-muted-foreground">No extra contacts</li>}
                </ul>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input className={cn(inputCls, "mt-0")} placeholder="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  <input className={cn(inputCls, "mt-0")} placeholder="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                  <button type="button" onClick={() => void addContact()} className="rounded-lg border border-border px-3 text-sm">
                    Add
                  </button>
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="submit"
                disabled={busy}
                className={cn("rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground", busy && "opacity-60")}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setModal(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
