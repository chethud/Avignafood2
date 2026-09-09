import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, onAuthChange, type Me } from "@/lib/api";

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
      const data = await api<Me>("/api/v1/auth/me");
      setMe(data);
      return data;
    } catch {
      localStorage.removeItem("token");
      localStorage.removeItem("companyId");
      localStorage.removeItem("firmScope");
      setMe(null);
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
