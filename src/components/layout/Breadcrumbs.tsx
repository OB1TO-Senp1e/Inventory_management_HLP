import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { isRegisteredPath } from "@/routes/access";
import { navLabelForPath } from "@/routes/nav";
import { useItem } from "@/features/items/hooks";
import { useSupplier } from "@/features/suppliers/hooks";
import { useStockCount } from "@/features/counts/hooks";
import { cn } from "@/lib/utils";

interface Crumb {
  label: string;
  to: string | null;
}

interface DetailTarget {
  kind: "item" | "supplier" | "count" | "po";
  id: string;
}

/**
 * Detail routes whose `:id` segment should resolve to the entity's name in
 * the crumb: /items/:id, /suppliers/:id/prices, /stock-counts/:id and
 * /purchase-orders/:id(/print). Returns null elsewhere.
 */
function detailTargetFor(pathname: string): DetailTarget | null {
  const itemMatch = /^\/items\/([^/]+)$/.exec(pathname);
  if (itemMatch) {
    return { kind: "item", id: itemMatch[1] };
  }
  const supplierMatch = /^\/suppliers\/([^/]+)\/prices$/.exec(pathname);
  if (supplierMatch) {
    return { kind: "supplier", id: supplierMatch[1] };
  }
  const countMatch = /^\/stock-counts\/([^/]+)$/.exec(pathname);
  if (countMatch) {
    return { kind: "count", id: countMatch[1] };
  }
  const poMatch = /^\/purchase-orders\/([^/]+)(\/print)?$/.exec(pathname);
  if (poMatch) {
    return { kind: "po", id: poMatch[1] };
  }
  return null;
}

/**
 * Breadcrumb trail for the current location: Home plus one crumb per path
 * segment. All but the last crumb are links — but only when the accumulated
 * path is a registered route; segments with no route (e.g. the supplier id
 * in "/suppliers/:id/prices", which has no detail page) render as plain
 * text so the trail never links to a 404.
 *
 * On the detail routes the `:id` segment resolves to the entity's name
 * (via the same cached detail queries the pages use); purchase order
 * numbers are derived from the id itself (`#` + first 8 chars, matching the
 * print page). While loading — or when the fetch fails — the raw segment
 * is shown as before.
 */
export function Breadcrumbs() {
  const location = useLocation();
  const detail = detailTargetFor(location.pathname);
  const itemQuery = useItem(detail?.kind === "item" ? detail.id : null);
  const supplierQuery = useSupplier(
    detail?.kind === "supplier" ? detail.id : null,
  );
  const countQuery = useStockCount(detail?.kind === "count" ? detail.id : null);
  const detailName =
    detail?.kind === "po"
      ? `#${detail.id.slice(0, 8).toUpperCase()}`
      : detail?.kind === "item"
        ? itemQuery.data?.name
        : detail?.kind === "supplier"
          ? supplierQuery.data?.name
          : detail?.kind === "count"
            ? countQuery.data?.title
            : undefined;

  const crumbs = useMemo<Crumb[]>(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const items: Crumb[] = [{ label: navLabelForPath("/"), to: "/" }];
    let acc = "";
    segments.forEach((segment, index) => {
      acc += `/${segment}`;
      const isLast = index === segments.length - 1;
      items.push({
        label:
          detail && segment === detail.id && detailName
            ? detailName
            : navLabelForPath(acc),
        to: isLast || !isRegisteredPath(acc) ? null : acc,
      });
    });
    return items;
  }, [location.pathname, detail, detailName]);

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
                    {...(isLast ? { "aria-current": "page" as const } : {})}
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
