import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { useCurrentOutlet, useOutlets, useSwitchOutlet } from "./hooks";
import { cn } from "@/lib/utils";

/**
 * Outlet switcher (V2-07). Renders in the AppShell header (desktop + mobile)
 * following the SyncStatusBadge precedent. Shows the current outlet; opening
 * it lists every active outlet for one-tap switching. Hidden when the
 * restaurant has a single outlet (the common case — no UI noise).
 *
 * Switching re-scopes every stock view via RLS; the hook invalidates all
 * queries so the UI refreshes into the new outlet.
 */
export function OutletSwitcher() {
  const { profile } = useAuth();
  const { data: outlets, isLoading } = useOutlets();
  const current = useCurrentOutlet();
  const switchMutation = useSwitchOutlet();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  if (!profile || isLoading || !outlets || outlets.length <= 1) {
    return null;
  }

  const switching = switchMutation.isPending;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current outlet: ${current?.name ?? "…"}. Switch outlet.`}
        disabled={switching}
        className={cn(
          "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs font-medium",
          "border border-input bg-background hover:bg-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-wait disabled:opacity-70",
        )}
      >
        {switching ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Building2 aria-hidden="true" className="h-4 w-4" />
        )}
        {/* V2-07 fix: icon-only on mobile. The full label made the 390px
            header overflow, expanding the layout viewport and breaking
            Playwright hit-testing (and real taps) across the app. */}
        <span className="hidden max-w-28 truncate sm:inline sm:max-w-36">
          {current?.name ?? "…"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="hidden h-3.5 w-3.5 opacity-70 sm:inline"
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Outlets"
          className={cn(
            "absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border",
            "bg-popover text-popover-foreground shadow-lg",
          )}
        >
          {outlets.map((outlet) => {
            const active = outlet.id === current?.id;
            return (
              <button
                key={outlet.id}
                type="button"
                role="option"
                aria-selected={active}
                disabled={active || switching}
                onClick={() => {
                  setOpen(false);
                  if (!active) {
                    switchMutation.mutate(outlet.id);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  "disabled:cursor-default",
                  active && "font-medium",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{outlet.name}</span>
                  {outlet.isDefault && (
                    <span className="block text-xs text-muted-foreground">Default</span>
                  )}
                </span>
                {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
