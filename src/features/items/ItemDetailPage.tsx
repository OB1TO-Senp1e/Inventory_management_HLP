import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PackagePlus, ClipboardList, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useItem } from "@/features/items/hooks";
import {
  LEDGER_PAGE_SIZE,
  useItemBatches,
  useItemMovements,
  useStockRealtime,
  useCurrentStock,
} from "@/features/items/stockHooks";
import { OpeningBalanceDialog } from "@/features/items/OpeningBalanceDialog";
import type { Item } from "@/api/items";
import type { StockMovement, ItemBatch } from "@/api/stock";
import type { MovementType } from "@/schemas/stock";
import {
  formatDate,
  formatDateTime,
  formatINR,
  formatNumber,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const MOVEMENT_LABELS: Record<MovementType, string> = {
  receipt: "Receipt",
  usage: "Usage",
  sale_deduction: "Sale",
  wastage: "Wastage",
  count_adjustment: "Count adjustment",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  opening_balance: "Opening balance",
};

const MOVEMENT_BADGE_CLASSES: Record<MovementType, string> = {
  receipt:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  usage: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  sale_deduction:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  wastage: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  count_adjustment:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  transfer_in: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  transfer_out:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  opening_balance:
    "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground",
};

/** "over_prepared" -> "Over prepared". */
function prettifyCode(code: string): string {
  const spaced = code.split("_").join(" ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type ExpiryStatus = "expired" | "soon" | "ok" | "none";

function expiryStatus(expiry: string | null): ExpiryStatus {
  if (!expiry) {
    return "none";
  }
  const today = new Date().toISOString().slice(0, 10);
  if (expiry < today) {
    return "expired";
  }
  const daysLeft =
    (new Date(`${expiry}T00:00:00`).getTime() -
      new Date(`${today}T00:00:00`).getTime()) /
    86_400_000;
  return daysLeft <= 7 ? "soon" : "ok";
}

function MovementBadge({ type }: { type: MovementType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        MOVEMENT_BADGE_CLASSES[type],
      )}
    >
      {MOVEMENT_LABELS[type]}
    </span>
  );
}

function ExpiryCell({ expiry }: { expiry: string | null }) {
  if (!expiry) {
    return <span className="text-muted-foreground">—</span>;
  }
  const status = expiryStatus(expiry);
  return (
    <span
      className={cn(
        "tabular-nums",
        status === "expired" && "font-medium text-red-700 dark:text-red-300",
        status === "soon" && "font-medium text-amber-700 dark:text-amber-300",
      )}
      title={
        status === "expired"
          ? "Expired"
          : status === "soon"
            ? "Expires within 7 days"
            : undefined
      }
    >
      {formatDate(expiry)}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading item details">
      <div className="h-9 w-64 animate-pulse rounded-md bg-muted/60" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-36 animate-pulse rounded-lg border bg-muted/40" />
        <div className="h-36 animate-pulse rounded-lg border bg-muted/40" />
      </div>
      <div className="h-64 animate-pulse rounded-lg border bg-muted/40" />
    </div>
  );
}

function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border p-8 text-center">
      <p role="alert" className="font-medium">
        {title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-4 min-h-[44px]"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && (
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Item detail page (P2-04): live stock, paginated append-only ledger
 * history, and per-batch totals with expiry warnings. Read-only — stock
 * changes happen through the Record actions (opening balance, receiving,
 * usage/wastage), never by editing the ledger.
 *
 * Owner/manager only — the route guard enforces it; RLS is the authority.
 * New ledger inserts arrive over the realtime channel and refresh the
 * stock, ledger and batch sections without a page reload.
 */
export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = id ?? null;
  const [ledgerPage, setLedgerPage] = useState(1);
  const [balanceOpen, setBalanceOpen] = useState(false);

  const itemQuery = useItem(itemId);
  const stockQuery = useCurrentStock(itemId);
  const movementsQuery = useItemMovements(itemId, ledgerPage);
  const batchesQuery = useItemBatches(itemId);
  useStockRealtime(itemId);

  // A new item id resets the ledger to page one.
  useEffect(() => {
    setLedgerPage(1);
  }, [itemId]);

  const item: Item | undefined = itemQuery.data;
  const stockQty = stockQuery.data?.quantity ?? null;
  const lastMovementAt = stockQuery.data?.lastMovementAt ?? null;
  const lowStock =
    item !== undefined && stockQty !== null && stockQty <= item.reorderPoint;

  const movements: StockMovement[] = movementsQuery.data?.movements ?? [];
  const movementTotal = movementsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(movementTotal / LEDGER_PAGE_SIZE));
  const showingFrom =
    movementTotal === 0 ? 0 : (ledgerPage - 1) * LEDGER_PAGE_SIZE + 1;
  const showingTo = Math.min(ledgerPage * LEDGER_PAGE_SIZE, movementTotal);

  const batches: ItemBatch[] = batchesQuery.data ?? [];

  if (itemQuery.isLoading) {
    return (
      <div>
        <div className="mb-4">
          <Link
            to="/items"
            className="inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to items
          </Link>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (itemQuery.isError || !item) {
    const notFound =
      itemQuery.error instanceof Error &&
      itemQuery.error.message.includes("0 rows");
    return (
      <div>
        <div className="mb-4">
          <Link
            to="/items"
            className="inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to items
          </Link>
        </div>
        <PageHeader
          title="Item details"
          description="Stock level, ledger history and batches."
        />
        <ErrorState
          title={notFound ? "Item not found." : "Could not load this item."}
          message={
            notFound
              ? "It may have been deleted."
              : "Check your connection and try again."
          }
          onRetry={() => itemQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/items"
          className="inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to items
        </Link>
      </div>

      <PageHeader
        title={item.name}
        description={[
          item.categoryName ?? "No category",
          `${item.unitName} (${item.unitSymbol})`,
          item.storageLocationName ?? "No storage location",
        ].join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setBalanceOpen(true)}
            >
              <Scale aria-hidden="true" />
              Opening balance
            </Button>
            <Button type="button" variant="outline" size="lg" asChild>
              <Link to="/receiving">
                <PackagePlus aria-hidden="true" />
                Record receipt
              </Link>
            </Button>
            <Button type="button" size="lg" asChild>
              <Link to="/wastage">
                <ClipboardList aria-hidden="true" />
                Log usage / wastage
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            item.active
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-muted text-muted-foreground",
          )}
        >
          {item.active ? "Active" : "Archived"}
        </span>
        {lowStock && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Low stock — at or below reorder point ({formatNumber(item.reorderPoint)}{" "}
            {item.unitSymbol})
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          Avg cost {formatINR(item.avgUnitCost)} per {item.unitSymbol}
        </span>
      </div>

      <div className="space-y-6">
        <SectionCard
          title="Stock now"
          description="Live from the append-only ledger — never edited, only added to."
        >
          {stockQuery.isLoading ? (
            <div
              className="h-16 animate-pulse rounded-md bg-muted/40"
              aria-label="Loading stock"
            />
          ) : stockQuery.isError ? (
            <ErrorState
              title="Could not load stock."
              message="Check your connection and try again."
              onRetry={() => stockQuery.refetch()}
            />
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-4xl font-bold tabular-nums">
                {formatNumber(stockQty ?? 0)}{" "}
                <span className="text-xl font-medium text-muted-foreground">
                  {item.unitSymbol}
                </span>
              </p>
              {lastMovementAt && (
                <p className="text-sm text-muted-foreground">
                  Last movement {formatDateTime(lastMovementAt)}
                </p>
              )}
              {stockQty === null && (
                <p className="text-sm text-muted-foreground">
                  No movements recorded yet.
                </p>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Ledger history"
          description="Every stock movement for this item, newest first. Corrections are new movements — entries are never edited or deleted."
        >
          {movementsQuery.isLoading && movements.length === 0 ? (
            <div
              className="h-48 animate-pulse rounded-md bg-muted/40"
              aria-label="Loading ledger"
            />
          ) : movementsQuery.isError ? (
            <ErrorState
              title="Could not load the ledger."
              message="Check your connection and try again."
              onRetry={() => movementsQuery.refetch()}
            />
          ) : movements.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No movements yet. Record an opening balance or a receipt to start
              the history.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Quantity</th>
                      <th className="px-4 py-3 font-medium">Batch</th>
                      <th className="px-4 py-3 font-medium">Expiry</th>
                      <th className="px-4 py-3 font-medium">Reason</th>
                      <th className="px-4 py-3 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <MovementBadge type={m.movementType} />
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-4 py-3 font-medium tabular-nums",
                            m.quantity > 0
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-red-700 dark:text-red-300",
                          )}
                        >
                          {m.quantity > 0 ? "+" : ""}
                          {formatNumber(m.quantity)} {item.unitSymbol}
                        </td>
                        <td className="px-4 py-3">
                          {m.batchNo ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ExpiryCell expiry={m.expiryDate} />
                        </td>
                        <td className="px-4 py-3">
                          {m.reasonCode ? (
                            prettifyCode(m.reasonCode)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">
                          {m.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p
                  className="text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  Showing {showingFrom}–{showingTo} of {movementTotal}{" "}
                  movements
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={ledgerPage <= 1 || movementsQuery.isFetching}
                    onClick={() => setLedgerPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={
                      ledgerPage >= totalPages || movementsQuery.isFetching
                    }
                    onClick={() => setLedgerPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Batches"
          description="Batch totals summed from the ledger, with expiry warnings."
        >
          {batchesQuery.isLoading ? (
            <div
              className="h-24 animate-pulse rounded-md bg-muted/40"
              aria-label="Loading batches"
            />
          ) : batchesQuery.isError ? (
            <ErrorState
              title="Could not load batches."
              message="Check your connection and try again."
              onRetry={() => batchesQuery.refetch()}
            />
          ) : batches.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No batches tracked — none of this item's movements recorded a
              batch number.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">Batch</th>
                    <th className="px-4 py-3 font-medium">Quantity</th>
                    <th className="px-4 py-3 font-medium">Earliest expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr
                      key={b.batchNo}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-medium">{b.batchNo}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {formatNumber(b.quantity)} {item.unitSymbol}
                      </td>
                      <td className="px-4 py-3">
                        <ExpiryCell expiry={b.earliestExpiry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {balanceOpen && (
        <OpeningBalanceDialog
          item={item}
          onClose={() => setBalanceOpen(false)}
        />
      )}
    </div>
  );
}
