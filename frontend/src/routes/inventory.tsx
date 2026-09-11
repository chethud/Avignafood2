import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { byFirm, firms, inr, kpisFor, mt, stock as mockStock } from "@/lib/erp-data";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/erp/ui-bits";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { CompanyPick, useCompanies, type CompanyOpt } from "@/components/erp/sales-field";

const FOUR_FIRMS: CompanyOpt[] = firms.map((f) => ({
  id: f.companyId,
  legal_name: f.name,
  trade_name: f.short,
  logo_url: f.logo,
}));

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory · Avighna ERP" },
      { name: "description", content: "Batch-level stock in metric tons: manufacturer, warehouse, reserved quantity and ageing." },
      { property: "og:title", content: "Inventory · Avighna ERP" },
      { property: "og:description", content: "Every batch traceable from manufacturer to customer." },
    ],
  }),
  component: Inventory,
});

type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  base_price: string | number;
  selling_price?: string | number;
};

type Warehouse = { id: number; name: string; is_default: boolean };

type StockApi = { id: number; product_id: number; warehouse_id: number; quantity: string | number };

type HistoryItem = {
  id: number;
  kind: string;
  quantity: number;
  balance_after: number;
  batch: string | null;
  manufacturer: string | null;
  notes: string | null;
  created_at: string;
};

type Row = {
  key: string;
  stockId?: number;
  productId?: number;
  batch: string;
  product: string;
  sku?: string;
  unit?: string;
  basePrice?: number;
  manufacturer: string;
  warehouse: string;
  qty: number;
  reserved: number;
  age: number;
};

const inputCls =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const LOW = 250;

const DUMMY_STOCK = [
  { name: "Nutragain Flour", unit: "KG", sku: "NF-500", qty: 1250, selling: 50 },
  { name: "Besan", unit: "KG", sku: "BS-50", qty: 850, selling: 70 },
  { name: "Suji", unit: "KG", sku: "SJ-50", qty: 620, selling: 80 },
  { name: "Rava", unit: "KG", sku: "RV-50", qty: 480, selling: 60 },
  { name: "Maida", unit: "KG", sku: "MD-50", qty: 210, selling: 45 },
  { name: "Poha", unit: "KG", sku: "PH-50", qty: 180, selling: 55 },
];

function SalesStock() {
  const fromApi = useCompanies();
  const companies = FOUR_FIRMS.map((f) => fromApi.find((c) => c.id === f.id) || f);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "fast">("all");
  const [rows, setRows] = useState<{ name: string; unit: string; qty: number; sku: string; selling: number }[]>([]);
  const [open, setOpen] = useState<(typeof rows)[number] | null>(null);

  function pickFirm(id: number) {
    setCompanyId(id);
    setOpen(null);
  }

  useEffect(() => {
    if (!companyId) {
      setRows([]);
      return;
    }
    Promise.all([
      api<{ product_id: number; quantity: string | number }[]>("/api/v1/inventory/stock", { companyId }).catch(() => []),
      api<{ id: number; name: string; unit: string; sku: string; selling_price?: string | number }[]>("/api/v1/products", {
        companyId,
      }).catch(() => []),
    ]).then(([stock, products]) => {
      if (!stock.length) {
        setRows(
          DUMMY_STOCK.map((r) => ({
            ...r,
            qty: r.name === "Maida" || r.name === "Poha" ? r.qty : r.qty + ((companyId - 1) % 4) * 35,
          })),
        );
        return;
      }
      const map = Object.fromEntries(products.map((p) => [p.id, p]));
      setRows(
        stock.map((s) => {
          const p = map[s.product_id];
          return {
            name: p?.name || `Product ${s.product_id}`,
            unit: p?.unit || "KG",
            sku: p?.sku || "",
            qty: Number(s.quantity) || 0,
            selling: Number(p?.selling_price) || 0,
          };
        }),
      );
    });
  }, [companyId]);

  const firmLabel = companies.find((c) => c.id === companyId);
  const shown = rows.filter((r) => {
    if (q.trim() && !`${r.name} ${r.sku}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === "low") return r.qty <= LOW;
    if (filter === "fast") return r.qty > 0;
    return true;
  });

  if (!companyId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pick a firm first. Stock is shown for that company only.</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Which firm?</p>
          <CompanyPick companies={companies} value={companyId} onChange={pickFirm} />
        </div>
      </div>
    );
  }

  function backToFirms() {
    setOpen(null);
    setQ("");
    setFilter("all");
    setCompanyId(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <button
          type="button"
          onClick={backToFirms}
          className="mb-2 flex min-h-10 items-center gap-1 text-sm font-medium text-primary"
        >
          <ChevronLeft className="size-5" />
          Back
        </button>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Available stock · {firmLabel?.trade_name || firmLabel?.legal_name || "Selected firm"}. View only.
        </p>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
      />
      <div className="flex gap-1">
        {(
          [
            ["all", "All items"],
            ["low", "Low stock"],
            ["fast", "Fast moving"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn("rounded-full px-3 py-1.5 text-sm", filter === id ? "bg-primary text-primary-foreground" : "border border-border")}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.map((r) => (
          <li key={r.sku || r.name}>
            <button
              type="button"
              onClick={() => setOpen(r)}
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-3 py-3 text-left"
            >
              <span>
                <span className="block font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.unit}</span>
                <span className="mt-1 block text-sm font-semibold tabular-nums">
                  {r.selling ? `${inr(r.selling)} / ${r.unit}` : "Selling —"}
                </span>
              </span>
              <span className="text-right">
                <span className="block tabular-nums font-semibold">
                  {r.qty.toLocaleString("en-IN")} {r.unit}
                </span>
                <span className={cn("text-xs font-semibold", r.qty <= LOW ? "text-warning" : "text-primary")}>
                  {r.qty <= 0 ? "Out" : r.qty <= LOW ? "Low stock" : "Available"}
                </span>
              </span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="py-8 text-center text-sm text-muted-foreground">No stock to show.</li>}
      </ul>
      {open && (
        <div className="fixed inset-0 z-40">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setOpen(null)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-border bg-card px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-[var(--shadow-soft)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{open.name}</p>
                <p className="text-xs text-muted-foreground">{open.unit}</p>
              </div>
              <button type="button" className="text-sm text-primary" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Selling price</p>
            <p className="text-2xl font-semibold tabular-nums">{open.selling ? inr(open.selling) : "—"}</p>
            {open.selling ? <p className="text-sm text-muted-foreground">per {open.unit}</p> : null}
            <p className="mt-3 text-sm tabular-nums">
              {open.qty.toLocaleString("en-IN")} {open.unit} ·{" "}
              {open.qty <= 0 ? "Out" : open.qty <= LOW ? "Low stock" : "Available"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Inventory() {
  const { me } = useMe();
  if (me?.user.role === "sales") return <SalesStock />;
  return <OpsInventory />;
}

function OpsInventory() {
  const { firm } = useCompany();
  const [rows, setRows] = useState<Row[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [modal, setModal] = useState<"product" | "inbound" | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [moveF, setMoveF] = useState("all");
  const [whF, setWhF] = useState("all");

  const [productForm, setProductForm] = useState({
    sku: "",
    name: "",
    unit: "MT",
    base_price: "0",
    selling_price: "0",
  });
  const [inboundForm, setInboundForm] = useState({
    product_id: "",
    warehouse_id: "",
    quantity: "",
    batch: "",
    manufacturer: "",
    notes: "",
  });

  async function load() {
    try {
      const [stockRows, productRows, whRows] = await Promise.all([
        api<StockApi[]>("/api/v1/inventory/stock"),
        api<Product[]>("/api/v1/products"),
        api<Warehouse[]>("/api/v1/inventory/warehouses"),
      ]);
      setProducts(productRows);
      setWarehouses(whRows);
      if (stockRows.length || productRows.length) {
        const pMap = Object.fromEntries(productRows.map((p) => [p.id, p]));
        const wMap = Object.fromEntries(whRows.map((w) => [w.id, w]));
        setRows(
          stockRows.map((s) => {
            const p = pMap[s.product_id];
            const w = wMap[s.warehouse_id];
            return {
              key: String(s.id),
              stockId: s.id,
              productId: s.product_id,
              batch: `P-${s.product_id}`,
              product: p?.name || `Product #${s.product_id}`,
              sku: p?.sku,
              unit: p?.unit,
              basePrice: p ? Number(p.base_price) || 0 : undefined,
              manufacturer: "—",
              warehouse: w?.name || `WH #${s.warehouse_id}`,
              qty: Number(s.quantity) || 0,
              reserved: 0,
              age: 0,
            };
          }),
        );
        return;
      }
    } catch {
      /* mock */
    }
    setRows(
      byFirm(mockStock, firm).map((s) => ({
        key: s.batch,
        batch: s.batch,
        product: s.product,
        manufacturer: s.manufacturer,
        warehouse: s.warehouse,
        qty: s.qty,
        reserved: s.reserved,
        age: s.age,
      })),
    );
    setProducts([]);
    setWarehouses([]);
  }

  useEffect(() => {
    load();
  }, [firm]);

  async function openDetail(row: Row) {
    setSelected(row);
    setHistory([]);
    if (row.stockId) {
      setHistoryLoading(true);
      try {
        const h = await api<HistoryItem[]>(`/api/v1/inventory/stock/${row.stockId}/history`);
        setHistory(
          h.map((x) => ({
            ...x,
            quantity: Number(x.quantity),
            balance_after: Number(x.balance_after),
          })),
        );
      } catch {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
      return;
    }
    // mock: synthesise one arrival from age
    const arrived = new Date();
    arrived.setDate(arrived.getDate() - (row.age || 0));
    setHistory([
      {
        id: 1,
        kind: "inbound",
        quantity: row.qty,
        balance_after: row.qty,
        batch: row.batch,
        manufacturer: row.manufacturer,
        notes: "Seed / demo receipt",
        created_at: arrived.toISOString(),
      },
    ]);
  }

  function openProduct() {
    setError("");
    setProductForm({ sku: "", name: "", unit: "MT", base_price: "0", selling_price: "0" });
    setModal("product");
  }

  function openInbound(prefillProductId?: number) {
    setError("");
    setInboundForm({
      product_id: prefillProductId
        ? String(prefillProductId)
        : products[0]
          ? String(products[0].id)
          : "",
      warehouse_id: warehouses.find((w) => w.is_default)?.id
        ? String(warehouses.find((w) => w.is_default)!.id)
        : warehouses[0]
          ? String(warehouses[0].id)
          : "",
      quantity: "",
      batch: "",
      manufacturer: "",
      notes: "",
    });
    setModal("inbound");
  }

  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/products", {
        method: "POST",
        body: JSON.stringify({
          sku: productForm.sku.trim(),
          name: productForm.name.trim(),
          unit: productForm.unit.trim() || "MT",
          base_price: Number(productForm.base_price) || 0,
          selling_price: Number(productForm.selling_price) || Number(productForm.base_price) || 0,
        }),
      });
      setModal(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create product");
    } finally {
      setBusy(false);
    }
  }

  async function saveInbound(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const qty = Number(inboundForm.quantity);
    if (!inboundForm.product_id || !(qty > 0)) {
      setError("Pick a product and enter a positive quantity");
      setBusy(false);
      return;
    }
    try {
      await api("/api/v1/inventory/stock/inbound", {
        method: "POST",
        body: JSON.stringify({
          product_id: Number(inboundForm.product_id),
          warehouse_id: inboundForm.warehouse_id ? Number(inboundForm.warehouse_id) : null,
          quantity: qty,
          batch: inboundForm.batch.trim() || null,
          manufacturer: inboundForm.manufacturer.trim() || null,
          notes: inboundForm.notes.trim() || null,
        }),
      });
      setModal(null);
      await load();
      if (selected?.productId === Number(inboundForm.product_id) && selected.stockId) {
        openDetail({ ...selected });
      }
    } catch (err) {
      if (products.length === 0) {
        const productName = inboundForm.product_id || "New stock";
        const next: Row = {
          key: `local-${Date.now()}`,
          batch: inboundForm.batch.trim() || `B-${Date.now().toString().slice(-6)}`,
          product: productName,
          manufacturer: inboundForm.manufacturer.trim() || "—",
          warehouse: "Main",
          qty,
          reserved: 0,
          age: 0,
        };
        setRows((r) => [next, ...r]);
        setModal(null);
      } else {
        setError(err instanceof Error ? err.message : "Could not record inbound");
      }
    } finally {
      setBusy(false);
    }
  }

  const total = useMemo(() => rows.reduce((a, s) => a + s.qty, 0), [rows]);
  const reserved = useMemo(() => rows.reduce((a, s) => a + s.reserved, 0), [rows]);

  const warehousesInStock = useMemo(
    () => [...new Set(rows.map((r) => r.warehouse).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((s) => {
      if (whF !== "all" && s.warehouse !== whF) return false;
      if (moveF === "slow" && !(s.age > 60)) return false;
      if (moveF === "watch" && !(s.age > 40 && s.age <= 60)) return false;
      if (moveF === "fast" && !(s.age > 0 && s.age <= 40)) return false;
      if (moveF === "fresh" && s.age !== 0) return false;
      if (!needle) return true;
      return `${s.batch} ${s.product} ${s.manufacturer} ${s.warehouse} ${s.sku || ""}`.toLowerCase().includes(needle);
    });
  }, [rows, q, moveF, whF]);

  const filtersActive = Boolean(q.trim()) || moveF !== "all" || whF !== "all";

  function clearFilters() {
    setQ("");
    setMoveF("all");
    setWhF("all");
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Tap a line for details & arrival history"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openProduct}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              + Product
            </button>
            <button
              type="button"
              onClick={() => openInbound()}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              + Inbound
            </button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="On hand" value={mt(total)} meta={`${rows.length} live batches`} />
        <Kpi label="Reserved" value={mt(reserved)} meta="Allocated to confirmed orders" />
        <Kpi label="Available" value={mt(total - reserved)} tone="good" />
        <Kpi
          label="Stock value"
          value={new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 0,
          }).format(kpisFor(firm).stockValue)}
        />
      </div>

      <Panel
        title="Batch register"
        hint={filtersActive ? `Showing ${visible.length} of ${rows.length}` : "Tap a row · details + history"}
        className="mt-6"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
            placeholder="Search batch, product, manufacturer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={whF} onChange={(e) => setWhF(e.target.value)}>
            <option value="all">All warehouses</option>
            {warehousesInStock.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <select className="rounded-lg border border-border bg-background px-3 py-2 text-sm" value={moveF} onChange={(e) => setMoveF(e.target.value)}>
            <option value="all">All movement</option>
            <option value="fresh">Fresh</option>
            <option value="fast">Fast moving</option>
            <option value="watch">Watch ageing</option>
            <option value="slow">Slow moving</option>
          </select>
        </div>
        {filtersActive && (
          <button type="button" className="mb-3 text-sm text-primary hover:underline" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <Table head={["Batch", "Product", "Manufacturer", "Warehouse", "On hand", "Reserved", "Available", "Age", "Movement"]}>
          {visible.map((s) => {
            const avail = s.qty - s.reserved;
            return (
              <tr
                key={s.key}
                className="cursor-pointer hover:bg-secondary/40"
                onClick={() => openDetail(s)}
              >
                <Td className="font-medium">{s.batch}</Td>
                <Td>{s.product}</Td>
                <Td className="text-muted-foreground">{s.manufacturer}</Td>
                <Td className="text-muted-foreground">{s.warehouse}</Td>
                <Td className="tabular-nums">{mt(s.qty)}</Td>
                <Td className="tabular-nums">{mt(s.reserved)}</Td>
                <Td className="tabular-nums">{mt(avail)}</Td>
                <Td className="tabular-nums">{s.age ? `${s.age} d` : "—"}</Td>
                <Td>
                  <Badge tone={s.age > 60 ? "bad" : s.age > 40 ? "warn" : "good"}>
                    {s.age > 60 ? "Slow moving" : s.age > 40 ? "Watch ageing" : s.age === 0 ? "Fresh" : "Fast moving"}
                  </Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
        {!visible.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {rows.length ? "No batches match this view." : "No stock yet — add a product, then record inbound."}
          </p>
        )}
      </Panel>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setSelected(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-detail-title"
            className="relative z-10 flex w-full max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card sm:max-w-lg sm:rounded-2xl"
          >
            <div className="border-b border-border p-5">
              <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                {selected.batch}
                {selected.sku ? ` · ${selected.sku}` : ""}
              </p>
              <h2 id="stock-detail-title" className="mt-1 text-xl font-semibold tracking-tight">
                {selected.product}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selected.warehouse}
                {selected.unit ? ` · ${selected.unit}` : ""}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">On hand</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{mt(selected.qty)}</dd>
                </div>
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Available</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{mt(selected.qty - selected.reserved)}</dd>
                </div>
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Reserved</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{mt(selected.reserved)}</dd>
                </div>
                <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
                  <dt className="text-xs text-muted-foreground">Base price</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {selected.basePrice != null
                      ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
                          selected.basePrice,
                        )
                      : "—"}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Arrival history</h3>
                {selected.productId != null && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary"
                    onClick={() => {
                      setSelected(null);
                      openInbound(selected.productId);
                    }}
                  >
                    + Inbound
                  </button>
                )}
              </div>

              {historyLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
              {!historyLoading && !history.length && (
                <p className="mt-3 text-sm text-muted-foreground">No receipts recorded yet for this line.</p>
              )}
              <ul className="mt-3 space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="rounded-xl border border-border px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {h.kind === "inbound" ? "Inbound" : h.kind === "set" ? "Stock set" : h.kind}
                          <span className="ml-2 tabular-nums text-foreground">
                            {h.kind === "inbound" ? "+" : ""}
                            {mt(h.quantity)}
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatWhen(h.created_at)}</p>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">Bal {mt(h.balance_after)}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {[h.batch, h.manufacturer, h.notes].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border p-4">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="w-full rounded-xl border border-border py-2.5 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "product" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setModal(null)} />
          <form
            onSubmit={saveProduct}
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Add product</h2>
            <p className="mt-1 text-sm text-muted-foreground">Creates a catalog item for the active company.</p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-muted-foreground">
                SKU
                <input
                  required
                  className={inputCls}
                  value={productForm.sku}
                  onChange={(e) => setProductForm((f) => ({ ...f, sku: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Name
                <input
                  required
                  className={inputCls}
                  value={productForm.name}
                  onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-muted-foreground">
                  Unit
                  <input
                    className={inputCls}
                    value={productForm.unit}
                    onChange={(e) => setProductForm((f) => ({ ...f, unit: e.target.value }))}
                  />
                </label>
                <label className="block text-sm text-muted-foreground">
                  Wholesale / floor (₹)
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={productForm.base_price}
                    onChange={(e) => setProductForm((f) => ({ ...f, base_price: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm text-muted-foreground">
                Selling price (₹)
                <input
                  type="number"
                  min={0}
                  className={inputCls}
                  value={productForm.selling_price}
                  onChange={(e) => setProductForm((f) => ({ ...f, selling_price: e.target.value }))}
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
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setModal(null)} className="rounded-lg border border-border py-2.5 text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {modal === "inbound" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setModal(null)} />
          <form
            onSubmit={saveInbound}
            className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-md sm:rounded-2xl"
          >
            <h2 className="text-lg font-semibold">Stock inbound</h2>
            <p className="mt-1 text-sm text-muted-foreground">Adds quantity to on-hand for a product.</p>
            <div className="mt-4 space-y-3">
              {products.length > 0 ? (
                <label className="block text-sm text-muted-foreground">
                  Product
                  <select
                    required
                    className={inputCls}
                    value={inboundForm.product_id}
                    onChange={(e) => setInboundForm((f) => ({ ...f, product_id: e.target.value }))}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-sm text-muted-foreground">
                  Product name
                  <input
                    required
                    className={inputCls}
                    value={inboundForm.product_id}
                    onChange={(e) => setInboundForm((f) => ({ ...f, product_id: e.target.value }))}
                    placeholder="e.g. Sucrose Fine"
                  />
                </label>
              )}
              {warehouses.length > 0 && (
                <label className="block text-sm text-muted-foreground">
                  Warehouse
                  <select
                    className={inputCls}
                    value={inboundForm.warehouse_id}
                    onChange={(e) => setInboundForm((f) => ({ ...f, warehouse_id: e.target.value }))}
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.is_default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm text-muted-foreground">
                Quantity (MT)
                <input
                  required
                  type="number"
                  min={0.001}
                  step="any"
                  className={inputCls}
                  value={inboundForm.quantity}
                  onChange={(e) => setInboundForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Batch / lot
                <input
                  className={inputCls}
                  value={inboundForm.batch}
                  onChange={(e) => setInboundForm((f) => ({ ...f, batch: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Manufacturer
                <input
                  className={inputCls}
                  value={inboundForm.manufacturer}
                  onChange={(e) => setInboundForm((f) => ({ ...f, manufacturer: e.target.value }))}
                />
              </label>
              <label className="block text-sm text-muted-foreground">
                Notes
                <input
                  className={inputCls}
                  value={inboundForm.notes}
                  onChange={(e) => setInboundForm((f) => ({ ...f, notes: e.target.value }))}
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
                {busy ? "Saving…" : "Receive"}
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
