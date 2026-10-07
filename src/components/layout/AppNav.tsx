import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/routes/nav";

/**
 * The primary navigation list, shared by the desktop sidebar and the mobile
 * drawer. Touch targets are at least 44px; the active section is highlighted
 * and exposed via aria-current.
 */
export function AppNav({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary">
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "relative flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-accent text-accent-foreground shadow-[inset_3px_0_0_0_hsl(var(--gold))]"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )
                }
              >
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
