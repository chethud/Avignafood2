import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, onAuthChange, type Me } from "@/lib/api";
import { ensureFirmScopeForRole } from "@/lib/company-context";

type MeCtx = { me: Me | null; loading: boolean; refresh: () => Promise<Me | null> };

const Ctx = createContext<MeCtx>({ me: null, loading: true, refresh: async () => null });

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      // Always call /me without company scope so switching firms cannot 403 the session
      const data = await api<Me>("/api/v1/auth/me", { companyId: null });
      ensureFirmScopeForRole(data.user.role);
      setMe(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only wipe the session on real auth failures — never on company-scope errors
      const authFail =
        /401|unauthor|credential|not authenticated|invalid token|could not validate/i.test(msg) ||
        msg === "Unauthorized";
      if (authFail || !getToken()) {
        localStorage.removeItem("token");
        localStorage.removeItem("companyId");
        localStorage.removeItem("firmScope");
        setMe(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onAuthChange(() => {
      void refresh();
    });
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useMe = () => useContext(Ctx);
