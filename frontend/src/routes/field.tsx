import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  CompanyPick,
  GeoPhotos,
  GpsPill,
  VoiceNote,
  fieldInput,
  readGps,
  useCompanies,
  type GeoFix,
  type GeoPhoto,
} from "@/components/erp/sales-field";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/field")({
  head: () => ({
    meta: [
      { title: "Log visit · Avighna" },
      { name: "description", content: "Existing client order or new client — with optional on-site photos." },
    ],
  }),
  component: Field,
});

type CustomerOpt = { id: number; name: string; contact_person: string | null; phone: string | null };

type CatalogItem = {
  key: string;
  product_id: number | null;
  sku: string;
  name: string;
  unit: string;
  selling: number;
  floor: number;
  available: number;
};

type CartLine = { qty: number; give: number | null };

const DUMMY_STOCK: Omit<CatalogItem, "key" | "product_id" | "floor">[] = [
  { name: "Nutragain Flour", unit: "KG", sku: "NF-500", available: 1250, selling: 50 },
  { name: "Besan", unit: "KG", sku: "BS-50", available: 850, selling: 70 },
  { name: "Suji", unit: "KG", sku: "SJ-50", available: 620, selling: 80 },
  { name: "Rava", unit: "KG", sku: "RV-50", available: 480, selling: 60 },
  { name: "Maida", unit: "KG", sku: "MD-50", available: 210, selling: 45 },
  { name: "Poha", unit: "KG", sku: "PH-50", available: 180, selling: 55 },
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function money(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function Field() {
  const navigate = useNavigate();
  const companies = useCompanies();
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [kind, setKind] = useState<"existing" | "new">("existing");
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [customerId, setCustomerId] = useState<number | "">("");
  const [site, setSite] = useState("");
  const [phone, setPhone] = useState("");
  const [onSite, setOnSite] = useState(false);
  const [geo, setGeo] = useState<GeoFix | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [photos, setPhotos] = useState<GeoPhoto[]>([]);
  const [voice, setVoice] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("follow-up");
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [issue, setIssue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [shortageOpen, setShortageOpen] = useState(false);
  const [overAsk, setOverAsk] = useState<{
    key: string;
    name: string;
    unit: string;
    available: number;
    qty: number;
  } | null>(null);
  const [acceptedOver, setAcceptedOver] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [deliveryMode, setDeliveryMode] = useState<"own_vehicle" | "manufacturer">("own_vehicle");
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planSlot, setPlanSlot] = useState<"morning" | "afternoon" | "evening" | "">("");
  const [planVehicleId, setPlanVehicleId] = useState<number | "">("");
  const [planDriverId, setPlanDriverId] = useState<number | "">("");
  const [fleet, setFleet] = useState<{ vehicle_id: number; name: string; plate: string }[]>([]);
  const [drivers, setDrivers] = useState<{ id: number; full_name: string; phone: string | null }[]>([]);

  useEffect(() => {
    if (!companyId) {
      setCustomers([]);
      setCustomerId("");
      return;
    }
    api<CustomerOpt[]>("/api/v1/customers", { companyId })
      .then((rows) => setCustomers(rows))
      .catch(() => setCustomers([]));
  }, [companyId]);

  useEffect(() => {
    setCart({});
    setQtyDraft({});
    setRateDraft({});
    setAcceptedOver({});
    setOverAsk(null);
    setItemSearch("");
    setDeliveryMode("own_vehicle");
    setPlanSlot("");
    setPlanVehicleId("");
    setPlanDriverId("");
  }, [companyId]);

  useEffect(() => {
    if (!companyId || purpose !== "new_order") {
      setFleet([]);
      setDrivers([]);
      return;
    }
    const onDate = planDate || new Date().toISOString().slice(0, 10);
    api<{ vehicle_id: number; name: string; plate: string }[]>(`/api/v1/vehicles/availability/all?on_date=${onDate}`, {
      companyId,
    })
      .then(setFleet)
      .catch(() =>
        api<{ vehicle_id: number; name: string; plate: string }>(`/api/v1/vehicles/availability?on_date=${onDate}`, {
          companyId,
        })
          .then((one) => setFleet([one]))
          .catch(() => setFleet([])),
      );
    api<{ id: number; full_name: string; phone: string | null }[]>("/api/v1/vehicles/drivers", { companyId })
      .then(setDrivers)
      .catch(() => setDrivers([]));
  }, [companyId, purpose, planDate]);

  useEffect(() => {
    if (purpose !== "new_order" || !companyId) {
      setCatalog([]);
      return;
    }
    let cancelled = false;
    setCatalogBusy(true);
    Promise.all([
      api<{ product_id: number; quantity: string | number }[]>("/api/v1/inventory/stock", { companyId }).catch(() => []),
      api<
        {
          id: number;
          name: string;
          unit: string;
          sku: string;
          base_price?: string | number;
          selling_price?: string | number;
        }[]
      >("/api/v1/products", { companyId }).catch(() => []),
    ]).then(([stock, products]) => {
      if (cancelled) return;
      if (products.length) {
        const qtyMap: Record<number, number> = {};
        for (const s of stock) {
          qtyMap[s.product_id] = (qtyMap[s.product_id] || 0) + (Number(s.quantity) || 0);
        }
        setCatalog(
          products.map((p) => ({
            key: `p:${p.id}`,
            product_id: p.id,
            sku: p.sku,
            name: p.name,
            unit: p.unit || "KG",
            selling: Number(p.selling_price) || Number(p.base_price) || 0,
            floor: Number(p.base_price) || 0,
            available: qtyMap[p.id] || 0,
          })),
        );
      } else {
        setCatalog(
          DUMMY_STOCK.map((r) => ({
            key: `s:${r.sku}`,
            product_id: null,
            sku: r.sku,
            name: r.name,
            unit: r.unit,
            selling: r.selling,
            floor: 0,
            available: r.name === "Maida" || r.name === "Poha" ? r.available : r.available + ((companyId - 1) % 4) * 35,
          })),
        );
      }
    }).finally(() => {
      if (!cancelled) setCatalogBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [purpose, companyId]);

  const pickedLines = useMemo(() => {
    return catalog
      .map((item) => {
        const line = cart[item.key];
        if (!line || line.qty <= 0) return null;
        const rate = line.give != null ? line.give : item.selling;
        const short = Math.max(0, round2(line.qty - item.available));
        return { item, qty: line.qty, rate, amount: round2(rate * line.qty), short };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [catalog, cart]);

  const orderTotal = pickedLines.reduce((sum, row) => sum + row.amount, 0);
  const belowFloor = pickedLines.some((row) => row.item.floor > 0 && row.rate < row.item.floor);
  const shortLines = pickedLines.filter((row) => row.short > 0);

  function requestOrder() {
    const unaccepted = shortLines.filter((row) => acceptedOver[row.item.key] !== row.qty);
    if (purpose === "new_order" && unaccepted.length) {
      setShortageOpen(true);
      return;
    }
    void save("order");
  }

  function askIfOver(
    item: CatalogItem,
    n: number,
  ) {
    if (n > item.available && acceptedOver[item.key] !== n) {
      setOverAsk({
        key: item.key,
        name: item.name,
        unit: item.unit,
        available: item.available,
        qty: n,
      });
    }
  }

  function acceptOver() {
    if (!overAsk) return;
    setAcceptedOver((prev) => ({ ...prev, [overAsk.key]: overAsk.qty }));
    setOverAsk(null);
  }

  function declineOver() {
    if (!overAsk) return;
    setQty(overAsk.key, overAsk.available, true);
    setQtyDraft((d) => {
      const { [overAsk.key]: _, ...rest } = d;
      return rest;
    });
    setAcceptedOver((prev) => {
      const { [overAsk.key]: _, ...rest } = prev;
      return rest;
    });
    setOverAsk(null);
  }

  async function pin() {
    setGeoBusy(true);
    setError("");
    try {
      setGeo(await readGps());
    } catch (e) {
      setError(e instanceof Error ? e.message : "GPS failed");
    } finally {
      setGeoBusy(false);
    }
  }

  function setQty(key: string, qty: number, keepIfZero = false) {
    const next = Math.max(0, Number.isFinite(qty) ? qty : 0);
    setCart((prev) => {
      const current = prev[key] || { qty: 0, give: null };
      if (!keepIfZero && next <= 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: { ...current, qty: next } };
    });
  }

  function setGive(key: string, give: number | null) {
    setCart((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return { ...prev, [key]: { ...current, give } };
    });
  }

  async function save(mode: "visit" | "order") {
    setError("");
    if (!companyId) {
      setError("Pick which firm this is for");
      return;
    }
    if (kind === "existing" && !customerId) {
      setError("Select the existing client");
      return;
    }
    if (kind === "new" && !site.trim()) {
      setError("Enter the new client's business name");
      return;
    }
    if (mode === "order" && purpose === "new_order" && !pickedLines.length) {
      setError("Add at least one item from inventory");
      return;
    }
    if (
      mode === "order" &&
      purpose === "new_order" &&
      deliveryMode === "own_vehicle" &&
      ((planVehicleId && !planDriverId) || (!planVehicleId && planDriverId))
    ) {
      setError("Pick both vehicle and driver, or leave both blank to assign later");
      return;
    }
    const quoteLines = pickedLines
      .filter((row) => row.item.product_id)
      .map((row) => ({
        product_id: row.item.product_id as number,
        quantity: row.qty,
        unit_price: row.rate,
      }));
    if (mode === "order" && purpose === "new_order" && pickedLines.length && !quoteLines.length) {
      setError("Live catalog is not loaded. Open Inventory and try again, or save the visit.");
      return;
    }
    setSaving(true);
    try {
      let fix = geo;
      if (onSite && !fix) {
        try {
          fix = await readGps();
          setGeo(fix);
        } catch {
          /* photos still save */
        }
      }
      const picked = customers.find((c) => c.id === Number(customerId));
      const orderNote = pickedLines.length
        ? pickedLines
            .map((row) => {
              const disc =
                row.item.selling > 0 && row.rate < row.item.selling
                  ? ` · list ${money(row.item.selling)}`
                  : "";
              const short =
                row.short > 0 ? ` · outstanding ${row.short.toLocaleString("en-IN")} ${row.item.unit}` : "";
              return `${row.item.name} × ${row.qty} ${row.item.unit} @ ${money(row.rate)}${disc}${short}`;
            })
            .join("; ")
        : "";
      const visit = await api<{ id: number; customer_id: number | null; lead_id: number | null }>("/api/v1/visits", {
        method: "POST",
        companyId,
        body: JSON.stringify({
          company_id: companyId,
          client_kind: kind,
          customer_id: kind === "existing" ? Number(customerId) : null,
          lead_id: null,
          site_name: kind === "existing" ? picked?.name || "Client" : site.trim(),
          contact_person: kind === "existing" ? picked?.contact_person : null,
          phone: kind === "existing" ? picked?.phone : phone.trim() || null,
          notes: [outcome.trim(), orderNote].filter(Boolean).join(" · ") || null,
          purpose: mode === "order" ? "new_order" : purpose,
          outcome: [outcome.trim(), orderNote].filter(Boolean).join(" · ") || null,
          next_action: nextAction.trim() || null,
          competitor_notes: competitor.trim() || null,
          issue: issue.trim() || null,
          voice_url: voice,
          lat: onSite ? (fix?.lat ?? null) : null,
          lng: onSite ? (fix?.lng ?? null) : null,
          accuracy_m: onSite ? (fix?.accuracy_m ?? null) : null,
          photos: onSite ? photos.map((p) => ({ url: p.url, kind: "photo", lat: p.lat, lng: p.lng })) : [],
        }),
      });
      if (mode === "order") {
        let cid = visit.customer_id || (kind === "existing" ? Number(customerId) : null);
        if (!cid && visit.lead_id) {
          const converted = await api<{ id: number }>(`/api/v1/leads/${visit.lead_id}/convert`, { method: "POST", companyId });
          cid = converted.id;
        }
        if (quoteLines.length && cid) {
          await api("/api/v1/quotations", {
            method: "POST",
            companyId,
            body: JSON.stringify({
              customer_id: cid,
              notes: outcome.trim() || orderNote || null,
              lines: quoteLines,
              delivery_mode: deliveryMode,
              planned_vehicle_id:
                deliveryMode === "own_vehicle" && planVehicleId ? Number(planVehicleId) : null,
              planned_driver_user_id:
                deliveryMode === "own_vehicle" && planDriverId ? Number(planDriverId) : null,
              planned_slot: deliveryMode === "own_vehicle" && planSlot ? planSlot : null,
              planned_on_date: deliveryMode === "own_vehicle" && planVehicleId ? planDate || null : null,
            }),
          });
          navigate({ to: "/sales" });
          return;
        }
        if (cid) sessionStorage.setItem("avighna.quoteCustomer", String(cid));
        navigate({ to: "/sales" });
        return;
      }
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const visibleCustomers = customers.filter((c) => {
    if (!customerSearch.trim()) return true;
    const q = customerSearch.trim().toLowerCase();
    return `${c.name} ${c.phone || ""}`.toLowerCase().includes(q);
  });

  const shownItems = catalog.filter((item) => {
    if (!itemSearch.trim()) return true;
    const q = itemSearch.trim().toLowerCase();
    return `${item.name} ${item.sku}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Log a visit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Existing client can become an order. New client is created on the platform.
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Which firm?</p>
        <CompanyPick companies={companies} value={companyId} onChange={setCompanyId} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setKind("existing")}
          className={cn(
            "min-h-16 rounded-2xl border text-sm font-semibold",
            kind === "existing" ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
          )}
        >
          Existing client
        </button>
        <button
          type="button"
          onClick={() => setKind("new")}
          className={cn(
            "min-h-16 rounded-2xl border text-sm font-semibold",
            kind === "new" ? "border-primary bg-primary/10 ring-2 ring-primary" : "border-border bg-card",
          )}
        >
          New client
        </button>
      </div>

      {kind === "existing" ? (
        <div>
          <label className="block text-sm font-medium">
            Client
            <input
              className={`${fieldInput} mt-1`}
              placeholder={companyId ? "Search customer..." : "Pick a firm first"}
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              disabled={!companyId}
            />
          </label>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {visibleCustomers.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setCustomerId(c.id)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2 text-left text-sm",
                    customerId === c.id ? "border-primary bg-primary/10" : "border-border bg-card",
                  )}
                >
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                </button>
              </li>
            ))}
            {companyId && !visibleCustomers.length && (
              <li className="px-1 text-xs text-muted-foreground">No clients match. Use New client.</li>
            )}
          </ul>
        </div>
      ) : (
        <>
          <label className="block text-sm font-medium">
            Business name
            <input className={`${fieldInput} mt-1`} value={site} onChange={(e) => setSite(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Phone
            <input className={`${fieldInput} mt-1`} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </>
      )}

      <label className="block text-sm font-medium">
        Purpose
        <select className={`${fieldInput} mt-1`} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option value="prospecting">Prospecting</option>
          <option value="new_order">New order</option>
          <option value="follow-up">Follow-up</option>
          <option value="collection">Collection</option>
          <option value="complaint">Complaint</option>
          <option value="delivery_support">Delivery support</option>
        </select>
      </label>

      {purpose === "new_order" && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-3">
          <div>
            <p className="text-sm font-semibold">Order items</p>
            <p className="text-xs text-muted-foreground">Stock for this firm. Qty and the price you are giving the client.</p>
          </div>
          {!companyId ? (
            <p className="text-sm text-muted-foreground">Pick a firm first to load inventory.</p>
          ) : catalogBusy ? (
            <p className="text-sm text-muted-foreground">Loading stock…</p>
          ) : (
            <>
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search items"
                className={fieldInput}
              />
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
                {shownItems.map((item) => {
                  const line = cart[item.key];
                  const qty = line?.qty || 0;
                  const rate = line?.give != null ? line.give : item.selling;
                  const underFloor = item.floor > 0 && qty > 0 && rate < item.floor;
                  return (
                    <li key={item.key} className="rounded-2xl border border-border bg-background p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.available.toLocaleString("en-IN")} {item.unit} available
                          </p>
                          <p className="mt-1 text-sm font-semibold tabular-nums">
                            {item.selling ? `${money(item.selling)} / ${item.unit}` : "Selling —"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setQtyDraft((d) => {
                                const { [item.key]: _, ...rest } = d;
                                return rest;
                              });
                              setQty(item.key, Math.max(0, qty - 1), true);
                            }}
                            className="flex size-11 items-center justify-center rounded-xl border border-border text-lg"
                            aria-label={`Less ${item.name}`}
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="done"
                            placeholder="0"
                            className="h-11 w-20 rounded-xl border border-border bg-card text-center text-sm tabular-nums"
                            value={qtyDraft[item.key] ?? (cart[item.key] ? String(qty) : "")}
                            onFocus={(e) => {
                              const shown = qtyDraft[item.key] ?? (cart[item.key] ? String(qty) : "");
                              e.target.select();
                              setQtyDraft((d) => ({ ...d, [item.key]: shown }));
                            }}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d.]/g, "");
                              setQtyDraft((d) => ({ ...d, [item.key]: raw }));
                              if (raw === "" || raw === ".") {
                                setQty(item.key, 0, true);
                                return;
                              }
                              const n = Number(raw);
                              if (Number.isFinite(n) && n >= 0) setQty(item.key, n, true);
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "" || raw === ".") {
                                setQty(item.key, 0);
                                setQtyDraft((d) => ({ ...d, [item.key]: "" }));
                                return;
                              }
                              const n = Number(raw);
                              setQtyDraft((d) => {
                                const { [item.key]: _, ...rest } = d;
                                return rest;
                              });
                              const qtyVal = Number.isFinite(n) && n >= 0 ? n : 0;
                              setQty(item.key, qtyVal, true);
                              askIfOver(item, qtyVal);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setQtyDraft((d) => {
                                const { [item.key]: _, ...rest } = d;
                                return rest;
                              });
                              const next = qty + 1;
                              setQty(item.key, next, true);
                              askIfOver(item, next);
                            }}
                            className="flex size-11 items-center justify-center rounded-xl border border-border text-lg"
                            aria-label={`More ${item.name}`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      {qty > 0 && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            Price ₹
                            <input
                              className={`${fieldInput} mt-1`}
                              type="text"
                              inputMode="decimal"
                              enterKeyHint="done"
                              value={rateDraft[item.key] ?? String(rate || "")}
                              placeholder={item.selling ? String(item.selling) : "0"}
                              onFocus={(e) => {
                                const shown = rateDraft[item.key] ?? String(rate || "");
                                e.target.select();
                                setRateDraft((d) => ({ ...d, [item.key]: shown }));
                              }}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d.]/g, "");
                                setRateDraft((d) => ({ ...d, [item.key]: raw }));
                                if (raw === "" || raw === ".") {
                                  setGive(item.key, null);
                                  return;
                                }
                                const n = Number(raw);
                                if (Number.isFinite(n) && n >= 0) setGive(item.key, n);
                              }}
                              onBlur={(e) => {
                                const raw = e.target.value.trim();
                                setRateDraft((d) => {
                                  const { [item.key]: _, ...rest } = d;
                                  return rest;
                                });
                                if (raw === "" || raw === ".") {
                                  setGive(item.key, null);
                                  return;
                                }
                                const n = Number(raw);
                                setGive(item.key, Number.isFinite(n) && n >= 0 ? n : null);
                              }}
                            />
                          </label>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Line total</p>
                            <p className="mt-2 text-sm font-semibold tabular-nums">{money(round2(rate * qty))}</p>
                            {item.selling > 0 && rate !== item.selling && (
                              <p className="text-xs text-muted-foreground">List {money(item.selling)}</p>
                            )}
                          </div>
                          {underFloor && (
                            <p className="col-span-2 text-xs font-medium text-warning">Below floor — owner approval</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
                {!shownItems.length && (
                  <li className="py-6 text-center text-sm text-muted-foreground">No items to show.</li>
                )}
              </ul>
              {pickedLines.length > 0 && (
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <p className="text-sm font-semibold tabular-nums">Order total {money(orderTotal)}</p>
                  {belowFloor && <p className="text-xs text-muted-foreground">One or more rates are below floor.</p>}
                </div>
              )}
            </>
          )}

          <div className="space-y-3 border-t border-border pt-3">
            <div>
              <p className="text-sm font-semibold">Delivery</p>
              <p className="text-xs text-muted-foreground">
                Manufacturer = Accounts invoices only. Own vehicle needs truck + driver before Accounts can invoice.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeliveryMode("own_vehicle");
                }}
                className={cn(
                  "min-h-14 rounded-2xl border text-sm font-semibold",
                  deliveryMode === "own_vehicle"
                    ? "border-primary bg-primary/10 ring-2 ring-primary"
                    : "border-border bg-background",
                )}
              >
                Own vehicle
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeliveryMode("manufacturer");
                  setPlanSlot("");
                  setPlanVehicleId("");
                  setPlanDriverId("");
                }}
                className={cn(
                  "min-h-14 rounded-2xl border text-sm font-semibold",
                  deliveryMode === "manufacturer"
                    ? "border-primary bg-primary/10 ring-2 ring-primary"
                    : "border-border bg-background",
                )}
              >
                Manufacturer
              </button>
            </div>
            {deliveryMode === "manufacturer" ? (
              <p className="text-xs text-muted-foreground">
                No fleet or driver. After Owner approves, Accounts raises the invoice — logistics is not involved.
              </p>
            ) : (
              <div className="grid gap-2">
                <p className="text-xs text-muted-foreground">
                  Optional now — if skipped, assign later on Order desk. Invoice waits until vehicle + driver are set.
                </p>
                <label className="text-xs font-medium text-muted-foreground">
                  Date
                  <input
                    type="date"
                    className={`${fieldInput} mt-1`}
                    value={planDate}
                    onChange={(e) => {
                      setPlanDate(e.target.value);
                      setPlanVehicleId("");
                      setPlanDriverId("");
                    }}
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Window
                  <select
                    className={`${fieldInput} mt-1`}
                    value={planSlot}
                    onChange={(e) => {
                      setPlanSlot((e.target.value || "") as typeof planSlot);
                      setPlanVehicleId("");
                      setPlanDriverId("");
                    }}
                  >
                    <option value="">Assign later</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Vehicle
                  <select
                    className={`${fieldInput} mt-1`}
                    value={planVehicleId}
                    disabled={!planSlot}
                    onChange={(e) => {
                      setPlanVehicleId(e.target.value ? Number(e.target.value) : "");
                      setPlanDriverId("");
                    }}
                  >
                    <option value="">{planSlot ? "Choose vehicle (or later)" : "Pick window first"}</option>
                    {planSlot &&
                      fleet.map((v) => (
                        <option key={v.vehicle_id} value={v.vehicle_id}>
                          {v.name} · {v.plate}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Driver
                  <select
                    className={`${fieldInput} mt-1`}
                    value={planDriverId}
                    disabled={!planVehicleId}
                    onChange={(e) => setPlanDriverId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">{planVehicleId ? "Choose driver (or later)" : "Pick vehicle first"}</option>
                    {planVehicleId &&
                      drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}
                          {d.phone ? ` · ${d.phone}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </section>
      )}

      <label className="block text-sm font-medium">
        Requirement / outcome
        <textarea className={`${fieldInput} mt-1`} rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </label>

      <VoiceNote url={voice} onChange={setVoice} companyId={companyId} />

      <label className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-sm">
        <input type="checkbox" checked={onSite} onChange={(e) => setOnSite(e.target.checked)} className="size-5" />
        I&apos;m on site. Add GPS + proof photos
      </label>

      {onSite && (
        <div className="space-y-3 rounded-2xl border border-border bg-secondary/30 p-3">
          <GpsPill geo={geo} onFix={() => void pin()} busy={geoBusy} />
          <GeoPhotos photos={photos} onAdd={(p) => setPhotos((list) => [...list, p])} companyId={companyId} />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save("visit")}
          className="flex min-h-14 items-center justify-center rounded-2xl border border-border text-sm font-semibold disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save visit"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => requestOrder()}
          className="flex min-h-14 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          Create order
        </button>
      </div>

      {overAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={declineOver} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
            <p className="text-lg font-semibold text-destructive">Less stock than asked</p>
            <p className="mt-2 text-sm font-medium">{overAsk.name}</p>
            <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              Only {overAsk.available.toLocaleString("en-IN")} {overAsk.unit} in stock. Remaining{" "}
              {(overAsk.qty - overAsk.available).toLocaleString("en-IN")} {overAsk.unit} will be delivered shortly once
              the stock arrives.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex min-h-12 items-center justify-center rounded-2xl border border-border text-sm font-semibold"
                onClick={declineOver}
              >
                No
              </button>
              <button
                type="button"
                className="flex min-h-12 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
                onClick={acceptOver}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {shortageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close" onClick={() => setShortageOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
            <p className="text-lg font-semibold">We have less quantity</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We will deliver what is in stock now. The remaining quantity will be delivered as soon as new stock arrives.
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {shortLines.map((row) => (
                <li key={row.item.key} className="rounded-xl border border-border bg-background px-3 py-2">
                  <p className="font-medium">{row.item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Asked {row.qty.toLocaleString("en-IN")} {row.item.unit} · have{" "}
                    {row.item.available.toLocaleString("en-IN")} {row.item.unit}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-warning">
                    Outstanding {row.short.toLocaleString("en-IN")} {row.item.unit}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex min-h-12 items-center justify-center rounded-2xl border border-border text-sm font-semibold"
                onClick={() => {
                  setCart((prev) => {
                    const next = { ...prev };
                    for (const row of shortLines) {
                      const cur = next[row.item.key];
                      if (!cur) continue;
                      next[row.item.key] = { ...cur, qty: row.item.available };
                    }
                    return next;
                  });
                  setAcceptedOver({});
                  setShortageOpen(false);
                }}
              >
                No
              </button>
              <button
                type="button"
                disabled={saving}
                className="flex min-h-12 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                onClick={() => {
                  setShortageOpen(false);
                  void save("order");
                }}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
