import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/useToast";
import { formatINR } from "@/lib/format";
import { createPurchaseOrder } from "@/api/purchasing";
import type { ReorderSuggestionGroup } from "@/api/purchasing";
import { useReorderSuggestions } from "./hooks";

function LoadingSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading reorder suggestions">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-md border bg-muted/40"
        />
      ))}
    </div>
  );
}

function GroupCard({
  group,
  onCreate,
  creating,
}: {
  group: ReorderSuggestionGroup;
  onCreate: (group: ReorderSuggestionGroup) => void;
  creating: string | null;
}) {
  const canOrder = group.supplierId !== null;
  const groupTotal = group.lines.reduce(
    (sum, line) => sum + (line.unitPrice ?? 0) * line.suggestedQty,
    0,
  );

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{group.supplierName}</h3>
        {canOrder ? (
          <Button
            type="button"
            size="sm"
            className="min-h-[44px]"
            disabled={creating !== null}
            onClick={() => onCreate(group)}
          >
            {creating === group.supplierId
              ? "Creating…"
              : `Create draft PO (${group.lines.length} item${group.lines.length === 1 ? "" : "s"})`}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Set a preferred supplier on each item&apos;s price list to order.
          </p>
        )}
      </div>
      <ul className="divide-y text-sm">
        {group.lines.map((line) => (
          <li
            key={line.itemId}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
          >
            <div className="min-w-0">
              <span className="font-medium">{line.itemName}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {line.currentQty} {line.unitSymbol} on hand · reorder at{" "}
                {line.reorderPoint}
              </span>
            </div>
            <div className="text-right">
              <span>
                Order {line.suggestedQty} {line.unitSymbol}
              </span>
              {line.unitPrice !== null && (
                <span className="ml-2 text-muted-foreground">
                  @ {formatINR(line.unitPrice)} ={" "}
                  {formatINR(line.unitPrice * line.suggestedQty)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {canOrder && (
        <p className="mt-2 text-right text-sm font-medium">
          Estimated total: {formatINR(groupTotal)}
        </p>
      )}
    </div>
  );
}

/**
 * Reorder suggestions (P3-03): low-stock items grouped by preferred
 * supplier, with one-click draft PO creation per supplier. Owner/manager
 * only — the section shows unit prices, so it never renders for staff
 * (the /stock route guard already enforces this; the component assumes
 * it).
 */
export function ReorderSuggestions() {
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const suggestions = useReorderSuggestions();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const handleCreate = async (
    group: ReorderSuggestionGroup,
  ) => {
    if (!group.supplierId) return;
    setCreatingFor(group.supplierId);
    try {
      const poId = await createPurchaseOrder({
        supplierId: group.supplierId,
        lines: group.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.suggestedQty,
          // Orderable groups always have a preferred price (positive by DB
          // constraint); unassigned groups never reach this handler.
          unitPrice: line.unitPrice ?? 0,
        })),
      });
      navigate(`/purchase-orders/${poId}`);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not create the purchase order.",
      );
      setCreatingFor(null);
    }
  };

  const groups = suggestions.data ?? [];

  return (
    <section aria-labelledby="reorder-suggestions-heading" className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <ShoppingCart className="size-5" aria-hidden="true" />
        <h2 id="reorder-suggestions-heading" className="text-lg font-semibold">
          Reorder suggestions
        </h2>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Items at or below their reorder point, grouped by preferred supplier.
        One click creates a draft purchase order.
      </p>

      {suggestions.isLoading ? (
        <LoadingSkeleton />
      ) : suggestions.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p role="alert" className="font-medium">
            Couldn&apos;t load reorder suggestions.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-[44px]"
            onClick={() => suggestions.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          Nothing needs reordering — every item is above its reorder point.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <GroupCard
              key={group.supplierId ?? "unassigned"}
              group={group}
              onCreate={handleCreate}
              creating={creatingFor}
            />
          ))}
        </div>
      )}
    </section>
  );
}
