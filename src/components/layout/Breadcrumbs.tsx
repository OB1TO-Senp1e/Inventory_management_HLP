import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { navLabelForPath } from "@/routes/nav";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  to: string | null;
}

/**
 * Breadcrumb trail for the current location: Home plus one crumb per path
 * segment. All but the last crumb are links; the last is the current page.
 */
export function Breadcrumbs() {
  const location = useLocation();

  const crumbs = useMemo<Crumb[]>(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const items: Crumb[] = [{ label: navLabelForPath("/"), to: "/" }];
    let acc = "";
    segments.forEach((segment, index) => {
      acc += `/${segment}`;
      items.push({
        label: navLabelForPath(acc),
        to: index === segments.length - 1 ? null : acc,
      });
    });
    return items;
  }, [location.pathname]);

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 && (
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
              )}
              <li className="min-w-0">
                {isLast || !crumb.to ? (
                  <span
                    aria-current="page"
                    className={cn(
                      "truncate",
                      isLast ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.to}
                    className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
