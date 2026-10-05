import { Link } from "react-router-dom";
import { AlertTriangle, IndianRupee, Timer, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useDashboardRealtime, useDashboardSummary } from "./hooks";
import {
  useStockOverview,
  useStockOverviewRealtime,
} from "@/features/items/stockHooks";
import { isExpiring, isLowStock } from "@/features/stock/stockStatus";
import { formatINR, formatNumber } from "@/lib/format";
import type { MovementSummary } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

function CardShell({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`dashboard-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className="flex flex-col rounded-lg border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
          <Icon aria-hidden="true" className="h-4 w-4 text-secondary-foreground" />
        </span>
        <h2
          id={`dashboard-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          className="text-sm font-medium text-muted-foreground"
        >
          {title}
        </h2>
      </div>
      <div className="mt-3 flex-1">{children}</div>
    </section>
  );
}

function CardLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className={cn(
        "mt-3 inline-block text-sm font-medium text-primary",
        "underline-offset-4 hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {children}
    </Link>
  );
}

function MovementRow({
  label,
  summary,
}: {
  label: string;
  summary: MovementSummary;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">
        <span className="font-medium">{summary.lines}</span>
        <span className="text-muted-foreground">
          {" "}
          {summary.lines === 1 ? "line" : "lines"} ·{" "}
        </span>
        <span className="font-medium">{formatNumber(summary.quantity)}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="font-medium">{formatINR(summary.value)}</span>
      </span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Loading dashboard"
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-lg border bg-muted/40"
        />
      ))}
    </div>
  );
}

/**
 * Dashboard (P5-03): owner/manager only. Four cards backed by the same
 * queries as the screens they describe — low-stock and expiring-soon
 * counts come from the stock overview query with the shared predicates,
 * today's usage/wastage and stock value from `getDashboardSummary()`.
 * Staff never reach this route (role guard), so no cost is exposed to
 * the staff role anywhere here.
 */
export function DashboardPage() {
  const overview = useStockOverview();
  const summary = useDashboardSummary();
  useStockOverviewRealtime();
  useDashboardRealtime();

  const isLoading = overview.isLoading || summary.isLoading;
  const isError = overview.isError || summary.isError;
  const refetch = () => {
    void overview.refetch();
    void summary.refetch();
  };

  const rows = overview.data ?? [];
  const lowStockCount = rows.filter(isLowStock).length;
  const expiringCount = rows.filter(isExpiring).length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Today's stock health at a glance. Counts match the stock overview filters."
      />
      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load the dashboard.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={refetch}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CardShell icon={AlertTriangle} title="Low stock">
            <p className="text-3xl font-semibold tabular-nums">
              {lowStockCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {lowStockCount === 1 ? "item" : "items"} at or below reorder
              point
            </p>
            <CardLink to="/stock?low=1">View low stock</CardLink>
          </CardShell>

          <CardShell icon={Timer} title="Expiring soon">
            <p className="text-3xl font-semibold tabular-nums">
              {expiringCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {expiringCount === 1 ? "item" : "items"} with batches expiring
              within 7 days
            </p>
            <CardLink to="/stock?expiring=1">View expiring</CardLink>
          </CardShell>

          <CardShell icon={Trash2} title="Today's usage & wastage">
            <div className="divide-y">
              <MovementRow label="Usage" summary={summary.data?.usage ?? { lines: 0, quantity: 0, value: 0 }} />
              <MovementRow label="Wastage" summary={summary.data?.wastage ?? { lines: 0, quantity: 0, value: 0 }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Lines · quantity · value lost, since midnight IST
            </p>
          </CardShell>

          <CardShell icon={IndianRupee} title="Stock value">
            <p className="text-3xl font-semibold tabular-nums">
              {formatINR(summary.data?.stockValue ?? 0)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              On-hand stock at average cost
            </p>
          </CardShell>
        </div>
      )}
    </div>
  );
}
