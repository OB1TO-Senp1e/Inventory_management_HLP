import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Menu, UtensilsCrossed, X } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { AuthLoading } from "@/routes/AuthLoading";
import { getNavItems } from "@/routes/nav";
import { AppNav } from "./AppNav";
import { Breadcrumbs } from "./Breadcrumbs";
import { InstallAppButton } from "@/features/pwa/InstallAppButton";
import { SyncStatusBadge } from "@/features/sync/SyncStatusBadge";
import { OutletSwitcher } from "@/features/outlets/OutletSwitcher";
import { useSyncEngine } from "@/features/sync/engine";
import { AlertBell } from "@/features/alerts/AlertBell";
import { useAlertEngine } from "@/features/alerts/useAlertEngine";
import { cn } from "@/lib/utils";

function Brand() {
  return (
    <Link
      to="/"
      className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-md px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <UtensilsCrossed aria-hidden="true" className="h-6 w-6 shrink-0 text-gold" />
      <span className="font-display truncate text-lg font-semibold tracking-tight">
        Restaurant Inventory
      </span>
    </Link>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex min-h-[28px] items-center rounded-full bg-secondary px-2.5 py-1 text-xs font-medium capitalize text-secondary-foreground">
      {role}
    </span>
  );
}

function UserFooter({
  email,
  role,
}: {
  email: string | null;
  role: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium" title={email ?? undefined}>
          {email ?? "Signed in"}
        </p>
        <RoleBadge role={role} />
      </div>
      <SignOutButton />
      <p className="text-xs text-muted-foreground">© 2026 Biswajit Dey</p>
    </div>
  );
}

const iconButtonClass = cn(
  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md",
  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

/**
 * The single app layout. Desktop (lg+): fixed sidebar navigation. Mobile:
 * top bar with a hamburger opening a slide-over drawer. Protected content
 * renders in the <Outlet/>; breadcrumbs sit in the desktop header (and above
 * the content on mobile).
 */
export function AppShell() {
  const { profile, session } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // P6-02: the offline sync engine lives as long as the authenticated
  // shell — drains the queue on mount, on `online`, and on an interval.
  useSyncEngine();
  useAlertEngine();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Focus management, Escape to close, and scroll lock while open.
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  // ProtectedRoute guarantees a signed-in user, but guard anyway.
  if (!profile) {
    return <AuthLoading />;
  }

  const items = getNavItems(profile.role);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-card print:hidden lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b px-4">
          <Brand />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <AppNav items={items} />
        </div>
        <div className="shrink-0 border-t p-4">
          <UserFooter email={session?.email ?? null} role={profile.role} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-card shadow-xl"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
              <Brand />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className={iconButtonClass}
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              <AppNav items={items} onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="shrink-0 border-t p-4">
              <UserFooter email={session?.email ?? null} role={profile.role} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-dvh flex-col lg:pl-64 print:lg:pl-0">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-1 border-b bg-background px-4 print:hidden lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className={iconButtonClass}
          >
            <Menu aria-hidden="true" className="h-6 w-6" />
          </button>
          <Brand />
          {/* shrink-0: action buttons must never be squeezed by flex — a
              crushed container breaks hit-testing on mobile. Brand truncates
              instead (min-w-0 above). */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <AlertBell />
            <OutletSwitcher />
            <SyncStatusBadge />
            <InstallAppButton />
          </div>
        </div>

        {/* Desktop header */}
        <header className="sticky top-0 z-30 hidden h-16 shrink-0 items-center justify-between gap-4 border-b bg-background px-6 print:hidden lg:flex">
          <Breadcrumbs />
          <div className="flex shrink-0 items-center gap-3">
            <AlertBell />
            <OutletSwitcher />
            <SyncStatusBadge />
            <InstallAppButton />
            <RoleBadge role={profile.role} />
            <SignOutButton />
          </div>
        </header>

        <main className="w-full flex-1 px-4 py-6 print:p-0 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl print:max-w-none">
            <div className="mb-4 print:hidden lg:hidden">
              <Breadcrumbs />
            </div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
