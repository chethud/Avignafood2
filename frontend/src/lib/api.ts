export const API_URL = import.meta.env.VITE_API_URL ?? "";

export type Me = {
  user: {
    id: number;
    email: string;
    full_name: string;
    phone?: string | null;
    photo_url?: string | null;
    organization_id: number;
    role: string;
    company_ids: number[];
  };
  permissions: string[];
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("companyId");
}

/** When firm scope is All companies, list APIs omit X-Company-Id (org-wide). */
export function getFirmScopeRaw(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("firmScope");
}

export function isAllCompaniesScope(): boolean {
  return getFirmScopeRaw() === "all";
}

const AUTH_EVENT = "avighna-auth";

function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function onAuthChange(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AUTH_EVENT, handler);
  return () => window.removeEventListener(AUTH_EVENT, handler);
}

export function setAuth(token: string, companyId?: number) {
  localStorage.setItem("token", token);
  if (companyId != null) localStorage.setItem("companyId", String(companyId));
  notifyAuthChanged();
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("companyId");
  localStorage.removeItem("firmScope");
  notifyAuthChanged();
}

/** Resolve logo/media paths from API (/uploads/…) or frontend public (/logos/…). */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (path.startsWith("/uploads/")) return `${API_URL}${path}`;
  return path;
}

type ApiOptions = RequestInit & { companyId?: number | string };

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { companyId: companyOverride, ...init } = options;
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const companyId =
    companyOverride != null
      ? String(companyOverride)
      : isAllCompaniesScope()
        ? null
        : getCompanyId();
  if (companyId) headers.set("X-Company-Id", companyId);
  if (init.body && !(init.body instanceof URLSearchParams) && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiUpload(
  path: string,
  file: File,
  companyId?: number | string,
): Promise<{ url: string }> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const cid =
    companyId != null ? String(companyId) : isAllCompaniesScope() ? null : getCompanyId();
  if (cid) headers.set("X-Company-Id", cid);
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}
