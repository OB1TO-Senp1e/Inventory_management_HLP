import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { cn } from "@/lib/utils";
import { useUnreadAlertCount } from "./hooks";

/**
 * Alert inbox bell (V2-03). Renders in the AppShell header (desktop +
 * mobile) next to the sync badge. Owner/manager only — staff never see
 * the inbox (RLS has no staff policies either).
 *
 * The badge shows the unread count (capped at 99+); the bell is always
 * visible for eligible roles so the inbox is one tap away even when
 * empty. Links to `/notifications`.
 */
export function AlertBell() {
  const { profile } = useAuth();
  const unread = useUnreadAlertCount();

  const role = profile?.role;
  if (role !== "owner" && role !== "manager") {
    return null;
  }

  const count = unread;
  const label =
    count === 0
      ? "Notifications"
      : `Notifications, ${count} unread`;

  return (
    <Link
      to="/notifications"
      aria-label={label}
      data-testid="alert-bell"
      className={cn(
        "relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Bell aria-hidden="true" className="h-5 w-5" />
      {count > 0 && (
        <span
          aria-hidden="true"
          data-testid="alert-bell-badge"
          className={cn(
            "absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center",
            "rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
