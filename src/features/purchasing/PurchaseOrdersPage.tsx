import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { usePurchaseOrders } from "./hooks";
import { PurchaseOrderDialog } from "./PurchaseOrderDialog";
import type { PurchaseOrderStatus } from "@/schemas/purchaseOrder";
import { formatDate, formatINR } from "@/lib/format";

const PAGE_SIZE = 20;

const inputClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type StatusFilter = "all" | PurchaseOrderStatus;

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  partially_received:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  received: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading purchase orders" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

/**
 * Purchase orders list (P3-01). Owner/manager only (route guard + RLS).
 * Draft POs are created here; the lifecycle (send/receive/cancel) lands
 * in P3-02.
 */
export function PurchaseOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const input = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      page,
      pageSize: PAGE_SIZE,
    }),
    [statusFilter, page],
  );
  const ordersQuery = usePurchaseOrders(input);
  const orders = ordersQuery.data?.orders ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Order stock from suppliers. Drafts become locked once sent (P3-02)."
        actions={
          <Button onClick={() => setDialogOpen(true)} className="min-h-[44px]">
            <Plus className="mr-1 size-4" aria-hidden="true" />
            New purchase order
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="po-status-filter" className="text-sm font-medium">
          Status
        </label>
        <select
          id="po-status-filter"
          className={inputClass}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setPage(1);
          }}
        >
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABELS) as PurchaseOrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {ordersQuery.isLoading ? (
        <LoadingSkeleton />
      ) : ordersQuery.isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load purchase orders.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={() => ordersQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="font-medium">No purchase orders yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {statusFilter === "all"
              ? "Create your first draft purchase order."
              : "No orders with this status. Try another filter."}
          </p>
          {statusFilter === "all" ? (
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 size-4" aria-hidden="true" />
              New purchase order
            </Button>
          ) : (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setStatusFilter("all");
                setPage(1);
              }}
            >
              Clear filter
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Order date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Lines</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => (
                  <tr key={po.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        to={`/purchase-orders/${po.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {po.supplierName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{formatDate(po.orderDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={po.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{po.lineCount}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatINR(po.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {orders.map((po) => (
              <Link
                key={po.id}
                to={`/purchase-orders/${po.id}`}
                className="block rounded-lg border p-4 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{po.supplierName}</p>
                  <StatusBadge status={po.status} />
                </div>
                <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{formatDate(po.orderDate)}</span>
                  <span className="tabular-nums">
                    {po.lineCount} lines · {formatINR(po.total)}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <p className="text-muted-foreground" aria-live="polite">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {dialogOpen && <PurchaseOrderDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}
