import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, mediaUrl } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { Badge, PageHeader } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Administration · Avighna ERP" },
      { name: "description", content: "Configure companies, users, roles and audit — not day-to-day ops." },
      { property: "og:title", content: "Administration · Avighna ERP" },
    ],
  }),
  component: Admin,
});

type Tab = "companies" | "users" | "fleet" | "roles" | "audit";

type FleetVehicle = {
  id: number;
  name: string;
  plate: string;
  kind: string;
  driver_name: string | null;
  live_status: string;
};

type Company = {
  id: number;
  legal_name: string;
  trade_name: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  invoice_prefix: string | null;
  logo_url: string | null;
  is_active: boolean;
};

type CompanyForm = {
  legal_name: string;
  trade_name: string;
  gstin: string;
  pan: string;
  address: string;
  phone: string;
  email: string;
  invoice_prefix: string;
  logo_url: string;
  is_active: boolean;
};

function companyToForm(c: Company): CompanyForm {
  return {
    legal_name: c.legal_name || "",
    trade_name: c.trade_name || "",
    gstin: c.gstin || "",
    pan: c.pan || "",
    address: c.address || "",
    phone: c.phone || "",
    email: c.email || "",
    invoice_prefix: c.invoice_prefix || "",
    logo_url: c.logo_url || "",
    is_active: c.is_active !== false,
  };
}

type User = {
  id: number;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  company_ids: number[];
};

type PermCatalog = { id: number; code: string; description: string | null };
type UserGrant = {
  id: number;
  permission_code: string;
  description: string | null;
  forever: boolean;
  expires_at: string | null;
  created_at: string | null;
};

type Audit = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  detail: string | null;
  user_id: number | null;
  created_at: string | null;
};

const ROLE_CATALOG = [
  { id: "owner", label: "Owner", scope: "Full business · config & approvals" },
  { id: "supervisor", label: "Supervisor", scope: "Sales ops + warehouse · no payments" },
  { id: "sales", label: "Sales", scope: "Own leads, quotes, orders · view stock" },
  { id: "accountant", label: "Accounts", scope: "Invoices, receivables, per-client billing" },
  { id: "logistics", label: "Logistics", scope: "Driver phone login · assigned after vehicle on Order desk" },
];

const ASSIGNABLE = ["supervisor", "sales", "accountant", "logistics", "owner"] as const;

function Admin() {
  const { me, loading } = useMe();
  const role = me?.user.role || "";
  const isAdmin = role === "owner" || role === "super_admin";
  const [tab, setTab] = useState<Tab>("companies");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [fleetForm, setFleetForm] = useState({ name: "", plate: "" });
  const [addingFleet, setAddingFleet] = useState(false);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyForm | null>(null);
  const [savingCompany, setSavingCompany] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userGrants, setUserGrants] = useState<UserGrant[]>([]);
  const [permCatalog, setPermCatalog] = useState<PermCatalog[]>([]);
  const [grantForm, setGrantForm] = useState({ codes: [] as string[], forever: true, expires_on: "" });
  const [permSearch, setPermSearch] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "sales",
    company_ids: [] as number[],
  });

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setError("");
    try {
      const [c, u, v] = await Promise.all([
        api<Company[]>("/api/v1/companies"),
        api<User[]>("/api/v1/users"),
        api<FleetVehicle[]>("/api/v1/vehicles").catch(() => [] as FleetVehicle[]),
      ]);
      setCompanies(c);
      setUsers(u);
      setFleet(v);
      if (tab === "audit") {
        const a = await api<Audit[]>("/api/v1/audit?limit=50").catch(() => [] as Audit[]);
        setAudit(a);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [isAdmin, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const companyName = useMemo(() => {
    const m = Object.fromEntries(companies.map((c) => [c.id, c.trade_name || c.legal_name]));
    return (ids: number[]) =>
      ids.length ? ids.map((id) => m[id] || `#${id}`).join(", ") : "—";
  }, [companies]);

  const filteredUsers = users
    .filter((u) => u.role !== "super_admin")
    .filter((u) => {
      if (!q.trim()) return true;
      const hay = `${u.full_name} ${u.email} ${u.role}`.toLowerCase();
      return hay.includes(q.trim().toLowerCase());
    });

  const managedUsers = users.filter((u) => u.role !== "super_admin");
  const activeUsers = managedUsers.filter((u) => u.is_active).length;
  const activeCompanies = companies.filter((c) => c.is_active !== false).length;

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/v1/users", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          role: form.role,
          company_ids: form.company_ids.length ? form.company_ids : companies.map((c) => c.id).slice(0, 1),
        }),
      });
      setAddingUser(false);
      setForm({ full_name: "", email: "", password: "", role: "sales", company_ids: [] });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    }
  }

  async function toggleUser(u: User) {
    try {
      await api(`/api/v1/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function openUser(u: User) {
    setEditingUser(u);
    setError("");
    try {
      const [grants, catalog] = await Promise.all([
        api<UserGrant[]>(`/api/v1/users/${u.id}/permissions`),
        permCatalog.length
          ? Promise.resolve(permCatalog)
          : api<PermCatalog[]>("/api/v1/users/permissions/catalog"),
      ]);
      setUserGrants(grants);
      if (!permCatalog.length) setPermCatalog(catalog);
      setGrantForm({ codes: [], forever: true, expires_on: "" });
      setPermSearch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load permissions");
    }
  }

  function closeUser() {
    setEditingUser(null);
    setUserGrants([]);
  }

  async function attachPermission(e: FormEvent) {
    e.preventDefault();
    if (!editingUser || !grantForm.codes.length) return;
    setGrantBusy(true);
    setError("");
    try {
      for (const permission_code of grantForm.codes) {
        await api(`/api/v1/users/${editingUser.id}/permissions`, {
          method: "POST",
          body: JSON.stringify({
            permission_code,
            forever: grantForm.forever,
            expires_on: grantForm.forever ? null : grantForm.expires_on || null,
          }),
        });
      }
      const grants = await api<UserGrant[]>(`/api/v1/users/${editingUser.id}/permissions`);
      setUserGrants(grants);
      setGrantForm((f) => ({ ...f, codes: [] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach permission");
    } finally {
      setGrantBusy(false);
    }
  }

  async function detachPermission(grantId: number) {
    if (!editingUser) return;
    setGrantBusy(true);
    setError("");
    try {
      await api(`/api/v1/users/${editingUser.id}/permissions/${grantId}`, { method: "DELETE" });
      setUserGrants((g) => g.filter((x) => x.id !== grantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not detach permission");
    } finally {
      setGrantBusy(false);
    }
  }

  function openCompany(c: Company) {
    setEditingCompany(c);
    setCompanyForm(companyToForm(c));
    setError("");
  }

  function closeCompany() {
    setEditingCompany(null);
    setCompanyForm(null);
  }

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    if (!editingCompany || !companyForm) return;
    setSavingCompany(true);
    setError("");
    try {
      await api(`/api/v1/companies/${editingCompany.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          legal_name: companyForm.legal_name.trim(),
          trade_name: companyForm.trade_name.trim() || null,
          gstin: companyForm.gstin.trim() || null,
          pan: companyForm.pan.trim() || null,
          address: companyForm.address.trim() || null,
          phone: companyForm.phone.trim() || null,
          email: companyForm.email.trim() || null,
          invoice_prefix: companyForm.invoice_prefix.trim() || "INV",
          logo_url: companyForm.logo_url.trim() || null,
          is_active: companyForm.is_active,
        }),
      });
      closeCompany();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save company");
    } finally {
      setSavingCompany(false);
    }
  }

  async function onLogoFile(file: File | null) {
    if (!file || !editingCompany) return;
    setUploadingLogo(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const updated = await api<Company>(`/api/v1/companies/${editingCompany.id}/logo`, {
        method: "POST",
        body: fd,
      });
      setEditingCompany(updated);
      setCompanyForm(companyToForm(updated));
      setCompanies((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setUploadingLogo(false);
    }
  }

  if (loading) return null;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-xl font-semibold">Administration</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Only Owner / Super Admin can configure companies, users and system settings.
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "companies", label: "Companies" },
    { id: "users", label: "Users" },
    { id: "fleet", label: "Fleet" },
    { id: "roles", label: "Roles" },
    { id: "audit", label: "Audit" },
  ];

  async function addFleetVehicle() {
    setError("");
    setAddingFleet(true);
    try {
      await api("/api/v1/vehicles", {
        method: "POST",
        body: JSON.stringify({
          name: fleetForm.name.trim(),
          plate: fleetForm.plate.trim(),
          kind: "truck",
          driver_name: null,
        }),
      });
      setFleetForm({ name: "", plate: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add vehicle");
    } finally {
      setAddingFleet(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-3 sm:space-y-4">
      <PageHeader
        title="Administration"
        subtitle="Owner adds companies, role-based users (incl. logistics drivers), and fleet trucks. Sales/Supervisor allot vehicle then driver on Order desk."
        action={
          tab === "users" ? (
            <button
              type="button"
              onClick={() => setAddingUser(true)}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              + Add user
            </button>
          ) : undefined
        }
      />

      {/* Overview strip */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
          {[
            { label: "Companies", value: String(activeCompanies || companies.length) },
            { label: "Active users", value: String(activeUsers) },
            { label: "Fleet trucks", value: String(fleet.length) },
            { label: "Audit entries", value: tab === "audit" ? String(audit.length) : "—" },
          ].map((s) => (
            <div key={s.label} className="px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="text-[0.65rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{s.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {tab === "companies" && (
        <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5 sm:px-4">
            <h2 className="text-sm font-medium">Companies / firms</h2>
            <span className="text-xs text-muted-foreground">{companies.length} total</span>
          </div>
          <ul className="divide-y divide-border">
            {companies.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openCompany(c)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/60 sm:px-4"
                >
                  {c.logo_url ? (
                    <img src={mediaUrl(c.logo_url)} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-border object-contain bg-background" />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                      {(c.trade_name || c.legal_name).slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.legal_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.trade_name || "—"}
                      {c.gstin ? ` · GST ${c.gstin}` : ""}
                      {c.invoice_prefix ? ` · Inv ${c.invoice_prefix}-…` : ""}
                    </p>
                  </div>
                  <Badge tone={c.is_active !== false ? "good" : "bad"}>
                    {c.is_active !== false ? "Active" : "Inactive"}
                  </Badge>
                </button>
              </li>
            ))}
            {!companies.length && (
              <li className="px-3 py-10 text-center text-sm text-muted-foreground">No companies loaded.</li>
            )}
          </ul>
        </section>
      )}

      {tab === "users" && (
        <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:px-4">
            <h2 className="text-sm font-medium sm:mr-auto">Users</h2>
            <p className="text-xs text-muted-foreground sm:mr-2">Create logistics role for drivers used on Order desk</p>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search users…"
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary sm:max-w-[14rem]"
            />
          </div>

          <ul className="divide-y divide-border sm:hidden">
            {filteredUsers.map((u) => (
              <li key={u.id} className="px-3 py-3">
                <button type="button" className="w-full text-left" onClick={() => openUser(u)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{u.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <Badge tone={u.is_active ? "good" : "bad"}>{u.is_active ? "Active" : "Off"}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge>{u.role.replaceAll("_", " ")}</Badge>
                    <span className="truncate">{companyName(u.company_ids)}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="mt-2 text-xs underline text-muted-foreground"
                  onClick={() => toggleUser(u)}
                >
                  {u.is_active ? "Deactivate" : "Activate"}
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-[24%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                  {["Name", "Email", "Role", "Companies", "Status", ""].map((h) => (
                    <th key={h || "a"} className="px-3 py-2 font-medium first:pl-4 last:pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((u) => (
                  <tr
                    key={u.id}
                    className="cursor-pointer hover:bg-secondary/30"
                    onClick={() => openUser(u)}
                  >
                    <td className="truncate px-3 py-2.5 pl-4 font-medium">{u.full_name}</td>
                    <td className="truncate px-3 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="px-3 py-2.5 capitalize">{u.role.replaceAll("_", " ")}</td>
                    <td className="truncate px-3 py-2.5 text-muted-foreground">{companyName(u.company_ids)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={u.is_active ? "good" : "bad"}>{u.is_active ? "Active" : "Off"}</Badge>
                    </td>
                    <td className="px-3 py-2.5 pr-4 text-right">
                      <button
                        type="button"
                        className="text-xs underline text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleUser(u);
                        }}
                      >
                        {u.is_active ? "Off" : "On"}
                      </button>
                    </td>
            </tr>
          ))}
              </tbody>
            </table>
          </div>
          {!filteredUsers.length && (
            <p className="py-10 text-center text-sm text-muted-foreground">No users match.</p>
          )}
        </section>
      )}

      {tab === "fleet" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-soft)] sm:p-4">
            <h2 className="text-sm font-medium">Add vehicle</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Trucks only — do not bind a driver here. Sales/Supervisor pick a logistics user after the vehicle on Order desk.
            </p>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                void addFleetVehicle();
              }}
            >
              <input
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Name · Tata 1109"
                value={fleetForm.name}
                onChange={(e) => setFleetForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
              <input
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm uppercase"
                placeholder="Plate · KA-01-AB-4421"
                value={fleetForm.plate}
                onChange={(e) => setFleetForm((f) => ({ ...f, plate: e.target.value }))}
                required
              />
              <button
                type="submit"
                disabled={addingFleet}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {addingFleet ? "Saving…" : "Add truck"}
              </button>
            </form>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
            {fleet.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
                <span>
                  <span className="block font-medium">{v.name}</span>
                  <span className="text-xs text-muted-foreground">{v.plate}</span>
                </span>
                <Badge tone="neutral">{v.live_status || "idle"}</Badge>
              </li>
            ))}
            {!fleet.length && (
              <li className="px-3 py-10 text-center text-sm text-muted-foreground">No trucks yet.</li>
            )}
          </ul>
        </section>
      )}

      {tab === "roles" && (
        <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="border-b border-border px-3 py-2.5 sm:px-4">
            <h2 className="text-sm font-medium">Roles</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Permissions are enforced by the API — this is the catalogue.</p>
          </div>
          <ul className="divide-y divide-border">
            {ROLE_CATALOG.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-3 py-3 sm:px-4">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-xs font-semibold capitalize text-primary">
                  {r.label.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{r.label}</p>
                  <p className="text-sm text-muted-foreground">{r.scope}</p>
                </div>
                <code className="ml-auto shrink-0 text-[0.7rem] text-muted-foreground">{r.id}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "audit" && (
        <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5 sm:px-4">
            <h2 className="text-sm font-medium">Audit log</h2>
            <button type="button" className="text-xs underline text-muted-foreground" onClick={load}>
              Refresh
            </button>
          </div>
          <ul className="divide-y divide-border max-h-[28rem] overflow-y-auto">
            {audit.map((a) => (
              <li key={a.id} className="px-3 py-2.5 sm:px-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Badge>{a.action}</Badge>
                  <span className="text-sm font-medium">
                    {a.entity_type}
                    {a.entity_id != null ? ` #${a.entity_id}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.created_at ? new Date(a.created_at).toLocaleString("en-IN") : ""}
                  </span>
                </div>
                {a.detail && <p className="mt-1 truncate text-xs text-muted-foreground">{a.detail}</p>}
              </li>
            ))}
            {!audit.length && (
              <li className="px-3 py-10 text-center text-sm text-muted-foreground">No audit entries yet.</li>
            )}
          </ul>
        </section>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={closeUser} />
          <div className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl">
            <h2 className="text-lg font-semibold">{editingUser.full_name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {editingUser.email} · {editingUser.role.replaceAll("_", " ")}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Attach extra permissions on top of their role — forever or until a date. Detach anytime.
            </p>

            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {userGrants.map((g) => (
                <li key={g.id} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.permission_code}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.forever
                        ? "Forever"
                        : g.expires_at
                          ? `Until ${new Date(g.expires_at).toLocaleDateString("en-IN")}`
                          : "Temporary"}
                      {g.description ? ` · ${g.description}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={grantBusy}
                    onClick={() => detachPermission(g.id)}
                    className="shrink-0 text-xs underline text-muted-foreground disabled:opacity-50"
                  >
                    Detach
                  </button>
                </li>
              ))}
              {!userGrants.length && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">No extra permissions yet.</li>
              )}
            </ul>

            <form onSubmit={attachPermission} className="mt-4 space-y-3 rounded-xl border border-border p-3">
              <p className="text-sm font-medium">Attach permission</p>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  placeholder="Search permissions…"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setPermSearch("")}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary"
                >
                  {permSearch ? "Clear" : "Search"}
                </button>
              </div>
              <fieldset className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-background p-2">
                <legend className="sr-only">Permissions</legend>
                {permCatalog
                  .filter((p) => !userGrants.some((g) => g.permission_code === p.code))
                  .filter((p) => {
                    const q = permSearch.trim().toLowerCase();
                    if (!q) return true;
                    return `${p.code} ${p.description || ""}`.toLowerCase().includes(q);
                  })
                  .map((p) => {
                    const checked = grantForm.codes.includes(p.code);
                    return (
                      <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary/60">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() =>
                            setGrantForm((f) => ({
                              ...f,
                              codes: checked ? f.codes.filter((c) => c !== p.code) : [...f.codes, p.code],
                            }))
                          }
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{p.code}</span>
                          {p.description ? (
                            <span className="block text-xs text-muted-foreground">{p.description}</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                {!permCatalog
                  .filter((p) => !userGrants.some((g) => g.permission_code === p.code))
                  .filter((p) => {
                    const q = permSearch.trim().toLowerCase();
                    if (!q) return true;
                    return `${p.code} ${p.description || ""}`.toLowerCase().includes(q);
                  }).length && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {permSearch.trim() ? "No permissions match." : "All permissions already attached."}
                  </p>
                )}
              </fieldset>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={grantForm.forever}
                    onChange={() => setGrantForm((f) => ({ ...f, forever: true }))}
                  />
                  Forever
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={!grantForm.forever}
                    onChange={() => setGrantForm((f) => ({ ...f, forever: false }))}
                  />
                  Until date
                </label>
              </div>
              {!grantForm.forever && (
                <label className="block text-sm text-muted-foreground">
                  Expires on
                  <input
                    required
                    type="date"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={grantForm.expires_on}
                    onChange={(e) => setGrantForm((f) => ({ ...f, expires_on: e.target.value }))}
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={grantBusy || !grantForm.codes.length}
                className="w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {grantBusy
                  ? "Saving…"
                  : grantForm.codes.length
                    ? `Attach (${grantForm.codes.length})`
                    : "Attach"}
              </button>
            </form>

            <button
              type="button"
              onClick={closeUser}
              className="mt-4 w-full rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-secondary"
            >
              Close
            </button>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </div>
        </div>
      )}

      {editingCompany && companyForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={closeCompany} />
          <form
            onSubmit={saveCompany}
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex items-start gap-3">
              {companyForm.logo_url ? (
                <img src={mediaUrl(companyForm.logo_url)} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-border object-contain bg-background" />
              ) : (
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
                  {(companyForm.trade_name || companyForm.legal_name || "?").slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Edit company</h2>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{editingCompany.legal_name}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-secondary/40 p-3 sm:col-span-2">
              <p className="text-sm font-medium">Logo</p>
              <p className="mt-0.5 text-xs text-muted-foreground">PNG, JPG, WEBP or GIF · max 2MB</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
                  {uploadingLogo ? "Uploading…" : companyForm.logo_url ? "Change logo" : "Add logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={uploadingLogo}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      void onLogoFile(f);
                    }}
                  />
                </label>
                {companyForm.logo_url ? (
                  <button
                    type="button"
                    onClick={() => setCompanyForm((f) => (f ? { ...f, logo_url: "" } : f))}
                    className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-background"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["legal_name", "Legal name", true],
                  ["trade_name", "Trade name", false],
                  ["gstin", "GSTIN", false],
                  ["pan", "PAN", false],
                  ["phone", "Phone", false],
                  ["email", "Email", false],
                  ["invoice_prefix", "Invoice prefix", false],
                ] as const
              ).map(([key, label, required]) => (
                <label key={key} className="block text-sm text-muted-foreground">
                  {label}
                  <input
                    required={required}
                    type={key === "email" ? "email" : "text"}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                    value={companyForm[key]}
                    onChange={(e) => setCompanyForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
                  />
                </label>
              ))}
              <label className="block text-sm text-muted-foreground sm:col-span-2">
                Address
                <textarea
                  rows={3}
                  className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm((f) => (f ? { ...f, address: e.target.value } : f))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={companyForm.is_active}
                  onChange={(e) => setCompanyForm((f) => (f ? { ...f, is_active: e.target.checked } : f))}
                />
                Active
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeCompany}
                className="flex-1 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCompany || uploadingLogo}
                className="flex-1 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {savingCompany ? "Saving…" : "Save"}
              </button>
            </div>
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </form>
        </div>
      )}

      {addingUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setAddingUser(false)} />
          <form
            onSubmit={createUser}
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Add user</h2>
            <p className="mt-1 text-sm text-muted-foreground">Assign a role and at least one company.</p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                Full name
                <input
                  required
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Email
                <input
                  required
                  type="email"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Temporary password
                <input
                  required
                  type="password"
                  minLength={6}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Role
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                >
                  {ASSIGNABLE.map((r) => (
                    <option key={r} value={r}>
                      {r.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-sm text-muted-foreground">Companies</legend>
                <div className="mt-2 space-y-1.5">
                  {companies.map((c) => {
                    const checked = form.company_ids.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setForm((f) => ({
                              ...f,
                              company_ids: checked
                                ? f.company_ids.filter((id) => id !== c.id)
                                : [...f.company_ids, c.id],
                            }))
                          }
                        />
                        {c.trade_name || c.legal_name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="submit" className="rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground">
                Create
              </button>
              <button type="button" onClick={() => setAddingUser(false)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
