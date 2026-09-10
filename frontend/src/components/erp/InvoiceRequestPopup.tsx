import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useCompany } from "@/lib/company-context";
import { useMe } from "@/lib/me-context";
import { money } from "@/lib/format";
import { firmLabelByCompanyId } from "@/lib/erp-data";

export type InvoiceRequest = {
  key: string;
  salesOrderId: number;
  companyId: number;
  companyName: string;
  customer: string;
  address: string | null;
  lineCount: number;
  qty: number;
  estimatedTotal: number;
  creditOk: boolean;
  creditLimit: number;
  outstanding: number;
  projected: number;
};

type BillableOrder = {
  sales_order_id: number;
  company_id: number;
  company_name?: string | null;
  customer_name: string;
  address: string | null;
  line_count: number;
  qty: string | number;
  estimated_total: string | number;
  credit_limit: string | number;
  current_outstanding: string | number;
  projected_exposure: string | number;
  credit_ok: boolean;
};

const canInvoiceRole = (role: string) => role === "accountant" || role === "super_admin" || role === "owner";

export function useInvoiceRequests() {
  const { me } = useMe();
  const { firm } = useCompany();
  const [items, setItems] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!me || !canInvoiceRole(me.user.role)) {
      setItems([]);
      return;
    }
    // Owner/admin already have approval popups; invoice queue is for Accounts primarily
    if (me.user.role !== "accountant") {
      setItems([]);
      return;
    }
    setLoading(true);
    const dismissed = new Set(JSON.parse(sessionStorage.getItem("invoiceRequestDismissed") || "[]") as string[]);
    try {
      const orders = await api<BillableOrder[]>("/api/v1/invoices/billable-orders").catch(() => [] as BillableOrder[]);
      const mapped: InvoiceRequest[] = orders.map((o) => ({
        key: `inv-so-${o.sales_order_id}`,
        salesOrderId: o.sales_order_id,
        companyId: o.company_id,
        companyName: o.company_name || firmLabelByCompanyId(o.company_id),
        customer: o.customer_name,
        address: o.address,
        lineCount: o.line_count,
        qty: Number(o.qty) || 0,
        estimatedTotal: Number(o.estimated_total) || 0,
        creditOk: o.credit_ok,
        creditLimit: Number(o.credit_limit) || 0,
        outstanding: Number(o.current_outstanding) || 0,
        projected: Number(o.projected_exposure) || 0,
      }));
      setItems(mapped.filter((i) => !dismissed.has(i.key)));
    } finally {
      setLoading(false);
    }
  }, [me, firm]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const dismiss = (key: string) => {
    const list = JSON.parse(sessionStorage.getItem("invoiceRequestDismissed") || "[]") as string[];
    list.push(key);
    sessionStorage.setItem("invoiceRequestDismissed", JSON.stringify(list));
    setItems((prev) => prev.filter((i) => i.key !== key));
  };

  return {
    items,
    loading,
    refresh,
    dismiss,
    canInvoice: me ? me.user.role === "accountant" : false,
  };
}

export function InvoiceRequestPopup({
  open,
  onClose,
  items,
  onDismiss,
}: {
  open: boolean;
  onClose: () => void;
  items: InvoiceRequest[];
  onDismiss: (key: string) => void;
}) {
  const navigate = useNavigate();
  const current = items[0];

  if (!open || !current) return null;

  function raiseNow() {
    const orderId = current.salesOrderId;
    onDismiss(current.key);
    onClose();
    void navigate({
      to: "/invoices",
      search: { raise: String(orderId) },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-request-title"
        className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] sm:max-w-md sm:rounded-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border sm:hidden" />
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
          Invoice request · {items.length} waiting
        </p>
        <h2 id="invoice-request-title" className="mt-1 text-xl font-semibold tracking-tight">
          {current.customer}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Company <span className="font-medium text-foreground">{current.companyName}</span>
          {" · "}
          Owner approved SO-{current.salesOrderId}. Raise the GST invoice first — then Supervisor or Sales can allot a driver.
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Company</dt>
            <dd className="mt-0.5 font-medium">{current.companyName}</dd>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Order</dt>
            <dd className="mt-0.5 font-medium">SO-{current.salesOrderId}</dd>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Lines / qty</dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {current.lineCount} · {current.qty} kg
            </dd>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">Est. bill</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{money(current.estimatedTotal)}</dd>
          </div>
          <div className="rounded-xl bg-secondary/60 px-3 py-2.5 col-span-2">
            <dt className="text-xs text-muted-foreground">Credit</dt>
            <dd className={`mt-0.5 font-medium ${current.creditOk ? "text-foreground" : "text-destructive"}`}>
              {current.creditOk ? "Within limit" : "Over limit"}
            </dd>
          </div>
        </dl>

        {current.address ? (
          <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{current.address}</p>
        ) : null}
        {!current.creditOk && (
          <p className="mt-3 text-xs text-destructive">
            Projected exposure {money(current.projected)} vs limit {money(current.creditLimit)}. You can still raise with
            override if Owner allows.
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={raiseNow}
            className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
          >
            Raise invoice
          </button>
          <button
            type="button"
            onClick={() => {
              onDismiss(current.key);
              if (items.length <= 1) onClose();
            }}
            className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
