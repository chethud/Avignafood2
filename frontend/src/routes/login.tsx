import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleHelp, Eye, EyeOff } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { API_URL, setAuth, api } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { firms } from "@/lib/erp-data";
import { applyDefaultFirmForRole } from "@/lib/company-context";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const DEMO_LOGINS = [
  { role: "Sales", email: "sales@avighnya.local", password: "sales123" },
  { role: "Accounts", email: "accounts@avighnya.local", password: "accounts123" },
  { role: "Logistics", email: "logistics@avighnya.local", password: "logistics123" },
  { role: "Supervisor", email: "supervisor@avighnya.local", password: "super123" },
  { role: "Owner", email: "owner@avighnya.local", password: "owner123" },
] as const;

function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [askGuide, setAskGuide] = useState(false);

  // Wake Render API while the login page is open (free tier sleeps)
  useEffect(() => {
    if (!API_URL) return;
    const ping = () => {
      void fetch(`${API_URL}/health`, { method: "GET", mode: "cors", cache: "no-store" }).catch(() => undefined);
    };
    ping();
    const id = window.setInterval(ping, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body = new URLSearchParams();
      body.set("username", email);
      body.set("password", password);
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new Error("Invalid credentials");
      const data = await res.json();
      // Token only first — firm scope is set from role (All companies for owner/accounts/supervisor)
      setAuth(data.access_token);
      const session = await refresh();
      if (!session) throw new Error("Could not load your account");
      const firm = applyDefaultFirmForRole(session.user.role);
      try {
        const companies = await api<{ id: number }[]>("/api/v1/companies");
        // Fallback company id for write actions when UI is on All companies
        if (companies[0] && firm === "all") {
          localStorage.setItem("companyId", String(companies[0].id));
        } else if (companies[0] && firm !== "all") {
          const match = firms.find((f) => f.id === firm);
          localStorage.setItem("companyId", String(match?.companyId ?? companies[0].id));
        }
      } catch {
        if (firms[0] && !localStorage.getItem("companyId")) {
          localStorage.setItem("companyId", String(firms[0].companyId));
        }
      }
      setAskGuide(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function openGuide() {
    navigate({ to: "/guide" });
  }

  function skipGuide() {
    navigate({ to: "/" });
  }

  function fillDemo(row: (typeof DEMO_LOGINS)[number]) {
    setEmail(row.email);
    setPassword(row.password);
    setError("");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex flex-wrap items-center justify-center gap-3">
          {firms.filter((f) => f.logo).map((f) => (
            <img key={f.id} src={f.logo!} alt={f.short} className="h-12 w-auto max-w-[100px] object-contain rounded-md border border-border bg-background px-2 py-1" />
          ))}
        </div>
        <div className="mb-1 text-center font-[Fraunces,Georgia,serif] text-3xl tracking-tight">Avighna Group</div>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Sign in — Accounts, Owner & Supervisor open on all companies
        </p>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <label className="mb-3 block text-sm text-muted-foreground">
          Email
          <input
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            name="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="mb-4 block text-sm text-muted-foreground">
          Password
          <span className="relative mt-1 block">
            <input
              className="w-full rounded-xl border border-border bg-background px-3 py-2 pr-10 font-sans text-sm outline-none focus:border-primary"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </span>
        </label>

        <div className="mb-5 rounded-xl border border-border bg-secondary/30 px-3 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Login credentials</p>
          <ul className="space-y-1.5">
            {DEMO_LOGINS.map((row) => (
              <li key={row.email}>
                <button
                  type="button"
                  onClick={() => fillDemo(row)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-background"
                >
                  <span className="font-medium">{row.role}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {row.email} · {row.password}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Tap a role to fill email & password.</p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {askGuide && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <CircleHelp className="size-6" />
            </div>
            <p className="text-lg font-semibold">Need a quick guide?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              See every page for your role, or start a walkthrough that highlights sections on screen.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={skipGuide}
                className="min-h-12 rounded-2xl border border-border text-sm font-semibold"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={openGuide}
                className="min-h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
              >
                Open guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
