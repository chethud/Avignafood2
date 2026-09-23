import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { greeting } from "@/lib/format";
import { inr } from "@/lib/erp-data";
import { todayIso, VehicleGlance } from "@/components/erp/VehicleBoard";

type Visit = {
  id: number;
  site_name: string;
  checked_in_at: string;
  purpose: string | null;
};

type StockRow = { id: number; product_id: number; quantity: string | number };
type Product = { id: number; name: string; unit: string; selling_price?: string | number };

const LOW = 250;

function isoDay(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function SalesDashboard() {
  const { me } = useMe();
  const name = me?.user.full_name?.split(" ")[0] || "Sales";
  const [workDate, setWorkDate] = useState(todayIso);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [stock, setStock] = useState<{ name: string; qty: number; unit: string; selling: number }[]>([]);

  useEffect(() => {
    api<Visit[]>("/api/v1/visits")
      .then(setVisits)
      .catch(() => setVisits([]));
  }, []);

  useEffect(() => {
    Promise.all([
      api<StockRow[]>("/api/v1/inventory/stock").catch(() => [] as StockRow[]),
      api<Product[]>("/api/v1/products").catch(() => [] as Product[]),
    ]).then(([rows, products]) => {
      if (!rows.length) {
        setStock(
          [
            { name: "Nutragain Flour", qty: 1250, unit: "KG", selling: 50 },
            { name: "Besan", qty: 850, unit: "KG", selling: 70 },
            { name: "Suji", qty: 620, unit: "KG", selling: 80 },
            { name: "Rava", qty: 480, unit: "KG", selling: 60 },
            { name: "Maida", qty: 210, unit: "KG", selling: 45 },
            { name: "Poha", qty: 180, unit: "KG", selling: 55 },
          ].sort((a, b) => b.qty - a.qty),
        );
        return;
      }
      const names = Object.fromEntries(products.map((p) => [p.id, p]));
      const merged = rows.map((r) => {
        const p = names[r.product_id];
        return { name: p?.name || `Product ${r.product_id}`, qty: Number(r.quantity) || 0, unit: p?.unit || "KG", selling: Number(p?.selling_price) || 0 };
      });
      merged.sort((a, b) => b.qty - a.qty);
      setStock(merged);
    });
  }, []);

  const todayVisits = useMemo(
    () => visits.filter((v) => isoDay(v.checked_in_at) === workDate),
    [visits, workDate],
  );
  const glance = stock.slice(0, 4);

  return (
    <div className="space-y-5" data-tour="sales-home">
      <div>
        <h1 className="text-2xl font-semibold leading-tight">
          {greeting()}, {name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Log the visit. Call the team before you promise stock.</p>
      </div>

      <Link
        to="/field"
        data-tour="sales-log-visit"
        className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground active:scale-[0.99]"
      >
        <ClipboardList className="size-6" />
        Log a visit
      </Link>

      <div data-tour="sales-vehicles">
        <VehicleGlance onDate={workDate} onDateChange={setWorkDate} />
      </div>

      <section data-tour="sales-visits">
        <p className="text-sm font-medium">
          Today · {todayVisits.length} visit{todayVisits.length === 1 ? "" : "s"}
        </p>
        {todayVisits.length ? (
          <ul className="mt-2 space-y-2">
            {todayVisits.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-3">
                <span>
                  <span className="block font-medium">{v.site_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.checked_in_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                  </span>
                </span>
                <span className="text-xs font-medium text-primary">Completed</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-2xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing logged yet today.
          </p>
        )}
      </section>

      <section data-tour="sales-stock">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Inventory at a glance</p>
          <Link to="/inventory" className="text-sm text-primary">
            View all
          </Link>
        </div>
        <ul className="mt-2 space-y-2">
          {glance.map((s) => (
            <li key={s.name} className="flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-3">
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {s.qty.toLocaleString("en-IN")} {s.unit}
                  {s.selling ? ` · ${inr(s.selling)} / ${s.unit}` : ""}
                </span>
              </span>
              <span className={s.qty <= LOW ? "text-xs font-semibold text-warning" : "text-xs font-semibold text-primary"}>
                {s.qty <= 0 ? "Out" : s.qty <= LOW ? "Low stock" : "Available"}
              </span>
            </li>
          ))}
          {!glance.length && <li className="text-sm text-muted-foreground">No stock listed for this firm.</li>}
        </ul>
      </section>
    </div>
  );
}
