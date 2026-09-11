import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Sparkles, Users, Handshake, MapPin, Boxes, Truck, ShoppingCart,
  ReceiptText, Wallet, BarChart3, Settings, Menu, X, Check, ChevronDown, Bell, ClipboardList,
  ChevronLeft, Scale, Banknote, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/lib/company-context";
import { firms, firmName, quietAlerts, type FirmId } from "@/lib/erp-data";
import { getToken, mediaUrl } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { applyBrand } from "@/lib/brand";
import { nameInitials } from "@/lib/format";
import { InvoiceRequestPopup, useInvoiceRequests } from "@/components/erp/InvoiceRequestPopup";
import { usePendingApprovals } from "@/components/erp/ApprovalPopup";
import { Badge } from "@/components/erp/ui-bits";

function ProfileAvatar({
  name,
  photoUrl,
  className,
  textClassName,
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
  textClassName?: string;
}) {
  if (photoUrl) {
    return (
      <span className={cn("relative overflow-hidden rounded-full bg-primary", className)}>
        <img src={mediaUrl(photoUrl)} alt="" className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span className={cn("flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground", className, textClassName)}>
      {nameInitials(name) || "U"}
    </span>
  );
}

function SidebarBrand({
  logo,
  name,
}: {
  logo?: string | null;
  name: string;
}) {
  return (
    <div className="flex h-14 w-full items-center justify-center overflow-hidden rounded-xl border border-sidebar-border bg-card p-1.5">
      <img src={logo!} alt={name} className="h-full w-full object-contain object-center" />
    </div>
  );
}

type NavItem = { to: string; label: string; icon: LucideIcon };
type NavSection = { group: string; items: NavItem[] };

/** Owner / Super Admin — everything */
const ownerNav: NavSection[] = [
  { group: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Sell",
    items: [
      { to: "/leads", label: "Leads", icon: Sparkles },
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/sales", label: "Sales & approvals", icon: Handshake },
      { to: "/field", label: "Field visits", icon: MapPin },
    ],
  },
  {
    group: "Operate",
    items: [
      { to: "/ops", label: "Order desk", icon: ClipboardList },
      { to: "/inventory", label: "Inventory", icon: Boxes },
      { to: "/purchases", label: "Purchases", icon: ShoppingCart },
      { to: "/dispatch", label: "Dispatch", icon: Truck },
    ],
  },
  {
    group: "Money",
    items: [
      { to: "/invoices", label: "Invoices", icon: ReceiptText },
      { to: "/receivables", label: "Receivables", icon: Wallet },
      { to: "/payments", label: "Payments received", icon: Banknote },
      { to: "/credit", label: "Credit control", icon: Scale },
      { to: "/reports", label: "Accounts reports", icon: BarChart3 },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  { group: "Setup", items: [{ to: "/admin", label: "Administration", icon: Settings }] },
];

/**
 * Sidebar visibility = modules only.
 * View/create/edit/approve still enforced by API permissions.
 */
const navByRole: Record<string, NavSection[]> = {
  owner: ownerNav,
  super_admin: ownerNav,
  supervisor: [
    { group: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "Sell",
      items: [
        { to: "/leads", label: "Leads", icon: Sparkles },
        { to: "/customers", label: "Customers", icon: Users },
      ],
    },
    {
      group: "Operate",
      items: [
        { to: "/ops", label: "Order desk", icon: ClipboardList },
        { to: "/inventory", label: "Inventory", icon: Boxes },
        { to: "/purchases", label: "Purchases", icon: ShoppingCart },
      ],
    },
  ],
  sales: [
    { group: "Field", items: [{ to: "/", label: "Today", icon: LayoutDashboard }] },
    {
      group: "Sell",
      items: [
        { to: "/field", label: "Visit", icon: MapPin },
        { to: "/collection", label: "Pending Collection", icon: Wallet },
        { to: "/leads", label: "Leads", icon: Sparkles },
        { to: "/customers", label: "Customers", icon: Users },
        { to: "/sales", label: "Quotes & orders", icon: Handshake },
        { to: "/ops", label: "Allot driver", icon: ClipboardList },
        { to: "/inventory", label: "Inventory", icon: Boxes },
        { to: "/profile", label: "Profile", icon: Users },
      ],
    },
  ],
  accountant: [
    { group: "Accounts", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] },
    {
      group: "Money",
      items: [
        { to: "/invoices", label: "Invoices", icon: ReceiptText },
        { to: "/receivables", label: "Receivables", icon: Wallet },
        { to: "/payments", label: "Payments received", icon: Banknote },
        { to: "/clients", label: "Customers", icon: Users },
        { to: "/more", label: "More", icon: Menu },
      ],
    },
  ],
  logistics: [
    {
      group: "Drive",
      items: [
        { to: "/", label: "Today", icon: LayoutDashboard },
        { to: "/history", label: "History", icon: History },
        { to: "/profile", label: "Profile", icon: Users },
      ],
    },
  ],
};

function flattenNav(sections: NavSection[]): NavItem[] {
  return sections.flatMap((s) => s.items);
}

const SALES_TABS: NavItem[] = [
  { to: "/", label: "Today", icon: LayoutDashboard },
  { to: "/field", label: "Visit", icon: MapPin },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/ops", label: "Allot", icon: Truck },
  { to: "/sales", label: "Orders", icon: ClipboardList },
];

const LOGISTICS_TABS: NavItem[] = [
  { to: "/", label: "Today", icon: LayoutDashboard },
  { to: "/history", label: "History", icon: History },
];

function SalesPhoneShell({
  meName,
  pathname,
  children,
}: {
  meName: string;
  pathname: string;
  children: ReactNode;
}) {
  const { me } = useMe();
  useEffect(() => {
    applyBrand("f1");
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{meName}</p>
          <p className="text-xs text-muted-foreground">On-site · phone</p>
        </div>
        <Link
          to="/profile"
          aria-label="Profile"
          className={cn(
            "block size-11 shrink-0 overflow-hidden rounded-full",
            pathname === "/profile" && "ring-2 ring-primary/40",
          )}
        >
          <ProfileAvatar
            name={meName}
            photoUrl={me?.user.photo_url}
            className="size-11 text-sm"
          />
        </Link>
      </header>
      <main className="mx-auto max-w-md px-4 py-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {SALES_TABS.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-[11px] leading-tight",
                active ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function LogisticsPhoneShell({
  meName,
  pathname,
  children,
}: {
  meName: string;
  pathname: string;
  children: ReactNode;
}) {
  const { me } = useMe();
  useEffect(() => {
    applyBrand("f1");
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        {pathname !== "/" && (
          <Link
            to="/"
            aria-label="Back"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border"
          >
            <ChevronLeft className="size-5" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{meName}</p>
          <p className="text-xs text-muted-foreground">Driver · phone</p>
        </div>
        <Link
          to="/profile"
          aria-label="Profile"
          className={cn(
            "block size-11 shrink-0 overflow-hidden rounded-full",
            pathname === "/profile" && "ring-2 ring-primary/40",
          )}
        >
          <ProfileAvatar
            name={meName}
            photoUrl={me?.user.photo_url}
            className="size-11 text-sm"
          />
        </Link>
      </header>
      <main className="mx-auto max-w-md px-4 py-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {LOGISTICS_TABS.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-[11px] leading-tight",
                active ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const ACCOUNTANT_MORE = ["/collection", "/credit", "/reports", "/payments"];

function pathAllowed(pathname: string, sections: NavSection[]): boolean {
  const paths = new Set(flattenNav(sections).map((i) => i.to));
  if (paths.has(pathname)) return true;
  if (pathname === "/profile") return true;
  if (ACCOUNTANT_MORE.includes(pathname) && paths.has("/more")) return true;
  return false;
}

function CompanySwitcher({ compact, hideThumb }: { compact?: boolean; hideThumb?: boolean }) {
  const { firm, setFirm } = useCompany();
  const [open, setOpen] = useState(false);
  const options: { id: FirmId; label: string; note: string; logo?: string | null }[] = [
    { id: "all", label: "All companies", note: "Consolidated", logo: null },
    ...firms.map((f) => ({
      id: f.id as FirmId,
      label: f.name,
      note: f.short,
      logo: f.logo,
    })),
  ];
  const active = options.find((o) => o.id === firm);
  const showThumb = !hideThumb && Boolean(active?.logo);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-xl border border-sidebar-border bg-card text-left transition-colors hover:bg-secondary",
          compact ? "px-2 py-1.5" : "px-3 py-2",
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {showThumb ? (
            <img src={active!.logo!} alt="" className={cn("shrink-0 rounded-md object-contain bg-background border border-border", compact ? "h-7 w-7" : "h-8 w-8")} />
          ) : null}
          <span className="min-w-0">
            {!compact && (
              <span className="block text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">Company</span>
            )}
            <span className={cn("block truncate font-medium leading-snug", compact ? "max-w-[9rem] text-xs" : "text-sm")}>
              {compact ? active?.note || firmName(firm) : firmName(firm)}
            </span>
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label="Close" />
          <ul className="absolute z-20 mt-2 max-h-[60vh] w-full min-w-[14rem] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-[var(--shadow-soft)] right-0">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => {
                    setFirm(o.id);
                    setOpen(false);
                    window.location.reload();
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {o.logo ? (
                      <img src={o.logo} alt="" className="h-7 w-7 rounded object-contain bg-background border border-border" />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded bg-secondary text-[10px] text-muted-foreground">All</span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate">{o.label}</span>
                      <span className="block text-xs text-muted-foreground">{o.note}</span>
                    </span>
                  </span>
                  {firm === o.id && <Check className="size-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { me, loading } = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { firm } = useCompany();
  const activeFirm = firms.find((f) => f.id === firm);
  const { items, canApprove } = usePendingApprovals();
  const { items: invoiceRequests, dismiss: dismissInvoice, canInvoice } = useInvoiceRequests();
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) navigate({ to: "/login" });
    else if (!loading && !me) navigate({ to: "/login" });
  }, [navigate, loading, me]);

  // Auto-open when Accounts has orders waiting to invoice
  useEffect(() => {
    if (canInvoice && invoiceRequests.length > 0) setInvoiceOpen(true);
  }, [canInvoice, invoiceRequests.length]);

  const role = me?.user.role || "";
  const roleLabel = role.replaceAll("_", " ") || (loading ? "…" : "Signed in");
  // Unknown / loading → dashboard only (never fall through to owner/admin nav)
  const activeNav =
    navByRole[role] ??
    [{ group: "Overview", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }] }];
  const flat = flattenNav(activeNav);
  const bottomTabs = flat.slice(0, 4);
  const alerts = quietAlerts(firm).filter((a) => pathAllowed(a.to, activeNav));
  const alertBadge =
    (canApprove ? items.length : 0) +
    (canInvoice ? invoiceRequests.length : 0) +
    alerts.filter((a) => a.count > 0 && a.tone !== "good").length;

  // Hide ≠ security, but don't let roles deep-link into modules they shouldn't see
  useEffect(() => {
    if (loading || !me) return;
    if (pathname === "/login") return;
    if (!pathAllowed(pathname, activeNav)) navigate({ to: "/" });
  }, [loading, me, pathname, activeNav, navigate]);

  if (loading) {
    return <div className="min-h-dvh bg-background" />;
  }

  if (role === "logistics") {
    return (
      <LogisticsPhoneShell meName={me?.user.full_name || "Logistics"} pathname={pathname}>
        {children}
      </LogisticsPhoneShell>
    );
  }

  if (role === "sales") {
    return (
      <SalesPhoneShell
        meName={me?.user.full_name || "Sales Person"}
        pathname={pathname}
      >
        {children}
      </SalesPhoneShell>
    );
  }

  const hasBrandLogo = Boolean(activeFirm?.logo);

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex shrink-0 flex-col gap-3 px-3 pt-4 pb-3 sm:px-4 sm:pt-5">
        {hasBrandLogo ? (
          <SidebarBrand logo={activeFirm!.logo} name={activeFirm!.short} />
        ) : firm === "all" ? (
          <div className="flex items-center gap-2 rounded-xl border border-sidebar-border bg-card px-3 py-2">
            {firms.filter((f) => f.logo).map((f) => (
              <img
                key={f.id}
                src={f.logo!}
                alt={f.short}
                className="h-7 w-7 shrink-0 rounded-md object-contain bg-background"
              />
            ))}
            <span className="truncate text-sm font-medium">All companies</span>
          </div>
        ) : (
          <p className="truncate px-3 text-sm font-medium">{activeFirm?.short || "Avighna ERP"}</p>
        )}
        <CompanySwitcher hideThumb={hasBrandLogo} />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-1 sm:px-4">
        <div className="flex flex-col gap-4">
          {activeNav.map((section) => (
            <div key={section.group}>
              <p className="px-3 pb-1 text-[0.65rem] uppercase tracking-[0.16em] text-sidebar-foreground/55">
                {section.group}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.to;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm leading-snug transition-colors active:scale-[0.98]",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                        )}
                      >
                        <item.icon className="size-4 shrink-0 opacity-70" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-3 py-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          to="/profile"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            pathname === "/profile"
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <ProfileAvatar
            name={me?.user.full_name || ""}
            photoUrl={me?.user.photo_url}
            className="size-8 shrink-0 text-xs"
          />
          <span className="min-w-0">
            <span className="block truncate font-medium leading-snug text-foreground">{me?.user.full_name || "Profile"}</span>
            <span className="block truncate text-xs capitalize leading-snug text-muted-foreground">{roleLabel}</span>
          </span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 overflow-hidden border-r border-sidebar-border lg:flex lg:flex-col">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-foreground/25" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
          <div className="absolute inset-y-0 left-0 flex w-[min(100%,18rem)] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar shadow-lg">
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/90 px-3 py-2 backdrop-blur supports-[padding:max(0px)]:pt-[max(0.5rem,env(safe-area-inset-top))] sm:gap-3 sm:px-6 sm:py-3">
          <button
            className="rounded-lg p-2 hover:bg-secondary lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          {activeFirm?.logo ? (
            <img src={activeFirm.logo} alt="" className="hidden h-8 w-8 rounded object-contain border border-border bg-card sm:block lg:hidden" />
          ) : null}
          <div className="min-w-0 flex-1 lg:hidden">
            <CompanySwitcher compact />
          </div>
          <div className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground lg:block">{firmName(firm)}</div>
          <div className="relative">
            <button
              type="button"
              className="relative rounded-lg p-2 hover:bg-secondary"
              aria-label="Notifications"
              aria-expanded={notifOpen}
              onClick={() => setNotifOpen((v) => !v)}
            >
              <Bell className="size-5" />
              {alertBadge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold text-warning-foreground">
                  {alertBadge}
                </span>
              )}
            </button>
            {notifOpen && (
              <>
                <button className="fixed inset-0 z-40 cursor-default" aria-label="Close" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,20rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-[var(--shadow-soft)]">
                  <div className="border-b border-border px-3 py-2">
                    <p className="text-sm font-medium">Notifications</p>
                  </div>
                  {canApprove && items.length > 0 && (
                    <Link
                      to="/sales"
                      className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm hover:bg-secondary/60"
                      onClick={() => setNotifOpen(false)}
                    >
                      <span>Order requests waiting</span>
                      <Badge tone="warn">{items.length}</Badge>
                    </Link>
                  )}
                  {canInvoice && invoiceRequests.length > 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left text-sm hover:bg-secondary/60"
                      onClick={() => {
                        setNotifOpen(false);
                        setInvoiceOpen(true);
                      }}
                    >
                      <span>Invoices to raise</span>
                      <Badge tone="warn">{invoiceRequests.length}</Badge>
                    </button>
                  )}
                  <ul className="max-h-72 overflow-y-auto py-1">
                    {alerts.map((a) => (
                      <li key={a.id}>
                        <Link
                          to={a.to}
                          className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-secondary/60"
                          onClick={() => setNotifOpen(false)}
                        >
                          <span>{a.label}</span>
                          <Badge tone={a.tone}>{a.count}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="px-3 py-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-7 lg:px-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 backdrop-blur lg:hidden pb-[env(safe-area-inset-bottom)]">
        {bottomTabs.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors",
                active ? "text-primary font-medium" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              <span className="max-w-[4.5rem] truncate">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground"
        >
          <Menu className="size-5" />
          More
        </button>
      </nav>

      <InvoiceRequestPopup
        open={invoiceOpen && invoiceRequests.length > 0}
        onClose={() => setInvoiceOpen(false)}
        items={invoiceRequests}
        onDismiss={dismissInvoice}
      />
    </div>
  );
}
