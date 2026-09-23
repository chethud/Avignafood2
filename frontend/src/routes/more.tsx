import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/me-context";
import { PageHeader } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/more")({
  head: () => ({
    meta: [{ title: "More · Avighna" }],
  }),
  component: More,
});

type Vehicle = {
  id: number;
  name: string;
  plate: string;
  kind: string;
  driver_name: string | null;
  live_status: string;
  is_active?: boolean;
};

type ExceptionRow = {
  id: number;
  sales_order_id: number | null;
  kind: string;
  detail: string | null;
  status: string;
};

const EX_NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: "under_review", label: "Review" }],
  under_review: [
    { to: "resolved", label: "Resolve" },
    { to: "closed", label: "Close" },
  ],
  resolved: [{ to: "closed", label: "Close" }],
};

function More() {
  const { me } = useMe();
  if (me?.user.role === "accountant") return <AccountsMore />;
  return <LogisticsMore />;
}

function AccountsMore() {
  const links = [
    { to: "/collection", title: "Collections", hint: "Overdue follow-up, call / WhatsApp, promised date" },
    { to: "/credit", title: "Credit control", hint: "Limit, exposure, credit/debit notes, breach alerts" },
    { to: "/reports", title: "Reports", hint: "Ageing, collections, cost of delay, Excel export" },
    { to: "/clients", title: "Customer statement", hint: "Invoice + payment ledger for a customer" },
  ] as const;
  return (
    <>
      <PageHeader title="More" subtitle="Collection, credit, reports and statements. Penalty policy is Owner-configured; Accounts applies it." />
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="block rounded-2xl border border-border bg-card px-4 py-4 hover:bg-secondary/40">
              <p className="font-medium">{l.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{l.hint}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function LogisticsMore() {
  const [tab, setTab] = useState<"vehicles" | "exceptions">("vehicles");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [issues, setIssues] = useState<ExceptionRow[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [driver, setDriver] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [fleet, rows] = await Promise.all([
        api<Vehicle[]>("/api/v1/vehicles").catch(() => [] as Vehicle[]),
        api<ExceptionRow[]>("/api/v1/logistics/exceptions").catch(() => [] as ExceptionRow[]),
      ]);
      setVehicles(fleet);
      setIssues(rows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addVehicle() {
    setError("");
    if (!name.trim() || !plate.trim()) {
      setError("Enter vehicle name and number");
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/vehicles", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          plate: plate.trim(),
          kind: "truck",
          driver_name: driver.trim() || null,
        }),
      });
      setName("");
      setPlate("");
      setDriver("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add vehicle");
    } finally {
      setBusy(false);
    }
  }

  async function setEx(id: number, status: string) {
    setError("");
    try {
      await api(`/api/v1/logistics/exceptions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">More</h1>
        <p className="mt-1 text-sm text-muted-foreground">Vehicles and delivery exceptions. No stock edits.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTab("vehicles")}
          className={cn(
            "rounded-2xl border px-3 py-3 text-left",
            tab === "vehicles" ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
          )}
        >
          <p className="text-xs text-muted-foreground">Vehicles</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{vehicles.length}</p>
        </button>
        <button
          type="button"
          onClick={() => setTab("exceptions")}
          className={cn(
            "rounded-2xl border px-3 py-3 text-left",
            tab === "exceptions" ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
          )}
        >
          <p className="text-xs text-muted-foreground">Exceptions</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{issues.filter((i) => i.status === "open").length}</p>
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tab === "vehicles" && (
        <ul className="space-y-2">
          <li>
            {adding ? (
              <form
                className="space-y-3 rounded-2xl border border-border bg-card p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addVehicle();
                }}
              >
                <p className="font-medium">Add vehicle</p>
                <label className="block text-sm">
                  Name
                  <input
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Tata 1109"
                  />
                </label>
                <label className="block text-sm">
                  Vehicle number
                  <input
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 uppercase"
                    value={plate}
                    onChange={(e) => setPlate(e.target.value)}
                    placeholder="KA-01-AB-4421"
                  />
                </label>
                <label className="block text-sm">
                  Driver (optional note)
                  <input
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                    value={driver}
                    onChange={(e) => setDriver(e.target.value)}
                    placeholder="Leave blank — assign logistics user on Order desk"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="min-h-11 rounded-xl border border-border text-sm"
                    onClick={() => setAdding(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="min-h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
              >
                Add vehicle
              </button>
            )}
          </li>
          {vehicles.map((v) => (
            <li key={v.id} className="rounded-2xl border border-border bg-card px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-medium">{v.name}</span>
                  <span className="text-sm text-muted-foreground">{v.plate}</span>
                </span>
                <span className="text-xs font-medium">
                  {v.is_active === false ? "Inactive" : v.live_status === "idle" ? "Available" : v.live_status}
                </span>
              </div>
              <p className="mt-1 text-sm">{v.driver_name || "No default driver"}</p>
            </li>
          ))}
          {!vehicles.length && <li className="text-sm text-muted-foreground">No vehicles in the fleet.</li>}
        </ul>
      )}

      {tab === "exceptions" && (
        <ul className="space-y-2">
          {issues.map((i) => (
            <li key={i.id} className="rounded-2xl border border-border bg-card px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-medium">{i.sales_order_id ? `SO-${i.sales_order_id}` : "Issue"}</span>
                  <span className="text-sm text-muted-foreground">{i.kind.replaceAll("_", " ")}</span>
                </span>
                <span className="text-xs font-medium uppercase">{i.status.replaceAll("_", " ")}</span>
              </div>
              {i.detail && <p className="mt-1 text-sm">{i.detail}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {(EX_NEXT[i.status] || []).map((n) => (
                  <button
                    key={n.to}
                    type="button"
                    onClick={() => void setEx(i.id, n.to)}
                    className="rounded-xl border border-border px-3 py-1.5 text-xs"
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
          {!issues.length && <li className="text-sm text-muted-foreground">No delivery issues.</li>}
        </ul>
      )}
    </div>
  );
}
