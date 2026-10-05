import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useItemLookups } from "@/features/items/hooks";
import {
  useStockOverview,
  useStockOverviewRealtime,
} from "@/features/items/stockHooks";
import { ReorderSuggestions } from "@/features/purchasing/ReorderSuggestions";
import { isExpiring, isLowStock } from "./stockStatus";
import type { StockOverviewRow } from "@/api/stock";
import { expiryStatus } from "@/lib/expiry";
import { formatDate, formatNumber } from "@/lib/format";

const inputClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function LowStockBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
      Low stock
    </span>
  );
}

function ExpiryBadge({ expiry }: { expiry: string }) {
  const status = expiryStatus(expiry);
  if (status === "expired") {
    return (
      <span
        className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
        title={`Expired on ${formatDate(expiry)}`}
      >
        Expired
      </span>
    );
  }
  if (status === "soon") {
    return (
      <span
        className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        title={`Expires on ${formatDate(expiry)}`}
      >
        Expiring soon
      </span>
    );
  }
  return null;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading stock overview">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md border bg-muted/40"
        />
      ))}
    </div>
  );
}

function StockTable({ rows }: { rows: StockOverviewRow[] }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Current stock per item, with low-stock and expiry status
        </caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th scope="col" className="px-4 py-2 font-medium">
              Item
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Category
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Location
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              On hand
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Last movement
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.itemId}
              className="border-b last:border-0 hover:bg-muted/30"
            >
              <td className="px-4 py-3 font-medium">
                <Link
                  to={`/items/${row.itemId}`}
                  className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.categoryName ?? "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.locationName ?? "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatNumber(row.quantity)}{" "}
                <span className="text-muted-foreground">{row.unitSymbol}</span>
              </td>
              <td className="px-4 py-3">
                <span className="flex flex-wrap gap-1">
                  {isLowStock(row) && <LowStockBadge />}
                  {row.earliestExpiry && (
                    <ExpiryBadge expiry={row.earliestExpiry} />
                  )}
                  {!isLowStock(row) && !row.earliestExpiry && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.lastMovementAt ? formatDate(row.lastMovementAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockCards({ rows }: { rows: StockOverviewRow[] }) {
  return (
    <ul className="space-y-3 md:hidden">
      {rows.map((row) => (
        <li
          key={row.itemId}
          className="rounded-lg border p-4"
        >
          <div className="flex items-baseline justify-between gap-2">
            <Link
              to={`/items/${row.itemId}`}
              className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.name}
            </Link>
            <span className="shrink-0 tabular-nums text-sm">
              {formatNumber(row.quantity)}{" "}
              <span className="text-muted-foreground">{row.unitSymbol}</span>
            </span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {[row.categoryName, row.locationName]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {isLowStock(row) && <LowStockBadge />}
            {row.earliestExpiry && <ExpiryBadge expiry={row.earliestExpiry} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stock overview (P2-05): every active item with its derived on-hand
 * quantity, low-stock and batch-expiry badges, and combinable filters.
 * Owner/manager only (route guard). Realtime movement inserts invalidate
 * the overview so it refreshes without a reload (best-effort).
 */
export function StockOverviewPage() {
  // The dashboard links here with ?low=1 / ?expiring=1; the checkboxes stay
  // interactive afterwards.
  const [searchParams] = useSearchParams();
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lowOnly, setLowOnly] = useState(
    () => searchParams.get("low") === "1",
  );
  const [expiringOnly, setExpiringOnly] = useState(
    () => searchParams.get("expiring") === "1",
  );

  const overview = useStockOverview();
  const lookups = useItemLookups();
  useStockOverviewRealtime();

  const rows = useMemo(() => {
    const all = overview.data ?? [];
    return all.filter(
      (row) =>
        (categoryId === "" || row.categoryId === categoryId) &&
        (locationId === "" || row.locationId === locationId) &&
        (!lowOnly || isLowStock(row)) &&
        (!expiringOnly || isExpiring(row)),
    );
  }, [overview.data, categoryId, locationId, lowOnly, expiringOnly]);

  const hasActiveFilters =
    categoryId !== "" || locationId !== "" || lowOnly || expiringOnly;

  const clearFilters = () => {
    setCategoryId("");
    setLocationId("");
    setLowOnly(false);
    setExpiringOnly(false);
  };

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Live on-hand quantities for every active item. New receipts, usage and wastage update this screen automatically."
      />

      <ReorderSuggestions />

      <fieldset className="mb-4 flex flex-wrap items-end gap-2">
        <legend className="sr-only">Filter stock</legend>
        <div>
          <label
            htmlFor="stock-category-filter"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Category
          </label>
          <select
            id="stock-category-filter"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={`${inputClass} min-w-0 flex-1 sm:flex-none`}
          >
            <option value="">All categories</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="stock-location-filter"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Location
          </label>
          <select
            id="stock-location-filter"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={`${inputClass} min-w-0 flex-1 sm:flex-none`}
          >
            <option value="">All locations</option>
            {lookups.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Low stock only
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm">
          <input
            type="checkbox"
            checked={expiringOnly}
            onChange={(e) => setExpiringOnly(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Expiring soon
        </label>
        {hasActiveFilters && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </fieldset>

      {overview.isLoading ? (
        <LoadingSkeleton />
      ) : overview.isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load stock.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={() => overview.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="font-medium">
            {hasActiveFilters
              ? "No items match these filters."
              : "No active items yet."}
          </p>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Add items on the Items page to start tracking stock.
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
            Showing {rows.length} of {overview.data?.length ?? 0} items
          </p>
          <StockTable rows={rows} />
          <StockCards rows={rows} />
        </>
      )}
    </div>
  );
}
