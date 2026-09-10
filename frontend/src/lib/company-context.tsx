import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { firms, type FirmId } from "./erp-data";
import { getCompanyId, notifyAuthChanged, onAuthChange } from "./api";
import { applyBrand } from "./brand";

const FIRM_SCOPE_KEY = "firmScope";

/** Roles that open on All companies by default. */
export const ALL_COMPANY_ROLES = new Set([
  "super_admin",
  "owner",
  "accountant",
  "supervisor",
]);

const Ctx = createContext<{ firm: FirmId; setFirm: (f: FirmId) => void }>({
  firm: "all",
  setFirm: () => {},
});

export function getFirmScope(): FirmId {
  if (typeof window === "undefined") return "f1";
  const stored = localStorage.getItem(FIRM_SCOPE_KEY) as FirmId | null;
  if (stored === "all") return "all";
  if (stored && firms.some((f) => f.id === stored)) return stored;
  const cid = getCompanyId();
  if (!cid) return "all";
  const match = firms.find((f) => String(f.companyId) === cid);
  return (match?.id as FirmId) || "all";
}

export function setFirmScope(firm: FirmId, opts?: { silent?: boolean }) {
  localStorage.setItem(FIRM_SCOPE_KEY, firm);
  if (firm !== "all") {
    const companyId = firms.find((x) => x.id === firm)?.companyId;
    if (companyId != null) localStorage.setItem("companyId", String(companyId));
  }
  if (!opts?.silent) notifyAuthChanged();
}

/** Call after login once role is known. Always resets scope for org-wide roles. */
export function applyDefaultFirmForRole(role: string) {
  if (ALL_COMPANY_ROLES.has(role)) {
    setFirmScope("all");
    return "all" as FirmId;
  }
  // Sales / logistics stay on a concrete company
  const cid = getCompanyId();
  const match = firms.find((f) => String(f.companyId) === cid);
  const firm = (match?.id as FirmId) || "f1";
  setFirmScope(firm);
  if (!cid && firms[0]) localStorage.setItem("companyId", String(firms[0].companyId));
  return firm;
}

/** If org-wide role has no firmScope yet (legacy session), default to All. */
export function ensureFirmScopeForRole(role: string) {
  if (typeof window === "undefined") return;
  if (!ALL_COMPANY_ROLES.has(role)) return;
  if (localStorage.getItem(FIRM_SCOPE_KEY)) return;
  setFirmScope("all");
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [firm, setFirmState] = useState<FirmId>("all");

  useEffect(() => {
    const sync = () => {
      const f = getFirmScope();
      setFirmState(f);
      applyBrand(f);
    };
    sync();
    return onAuthChange(sync);
  }, []);

  useEffect(() => {
    applyBrand(firm);
  }, [firm]);

  const setFirm = (f: FirmId) => {
    setFirmScope(f);
    setFirmState(f);
  };

  return <Ctx.Provider value={{ firm, setFirm }}>{children}</Ctx.Provider>;
}

export const useCompany = () => useContext(Ctx);
