import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { getNavItems } from "@/routes/nav";
import { cn } from "@/lib/utils";

/**
 * Role-aware landing page. Greets the signed-in user and links to every
 * section their role may access. Guards redirect denied roles here, so this
 * is always a safe place to land.
 */
export function HomePage() {
  const { profile } = useAuth();
  const items = profile
    ? getNavItems(profile.role).filter((item) => item.path !== "/")
    : [];

  return (
    <div>
      <PageHeader
        title="Home"
        description="Choose a section below to get started."
      />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sections are available for your account. Ask your manager if you
          need access.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex min-h-[64px] items-center gap-4 rounded-lg border bg-card p-4",
                    "transition-colors hover:bg-accent/50",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <Icon aria-hidden="true" className="h-5 w-5 text-secondary-foreground" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.label}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
