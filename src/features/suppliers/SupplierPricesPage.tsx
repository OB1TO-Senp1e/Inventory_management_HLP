import { Fragment, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  History,
  Pencil,
  Plus,
  Star,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { formatDateTime, formatINR } from "@/lib/format";
import type { SupplierPrice } from "@/api/prices";
import { useSupplier } from "./hooks";
import { useItems } from "@/features/items/hooks";
import {
  usePriceHistory,
  useSetPreferredSupplier,
  useSupplierPrices,
} from "./priceHooks";
import {
  PriceDialog,
  type AvailableItem,
  type PricedItem,
} from "./PriceDialog";

const ITEM_PICKER_PAGE_SIZE = 100;

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading price list">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border bg-muted/50"
        />
      ))}
    </div>
  );
}

function PreferredStar({
  price,
  disabled,
  onToggle,
}: {
  price: SupplierPrice;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-11 w-11"
      disabled={disabled}
      onClick={onToggle}
      aria-label={
        price.isPreferred
          ? `${price.itemName} is the preferred price`
          : `Set ${price.itemName} as preferred`
      }
      aria-pressed={price.isPreferred}
      title={
        price.isPreferred
          ? "Preferred supplier for this item"
          : "Set as preferred supplier"
      }
    >
      <Star
        className={
          price.isPreferred
            ? "fill-amber-400 text-amber-400"
            : "text-muted-foreground"
        }
        aria-hidden="true"
      />
    </Button>
  );
}

/** Expandable per-row price history (newest first, date-stamped). */
function PriceHistoryPanel({
  supplierId,
  itemId,
}: {
  supplierId: string;
  itemId: string;
}) {
  const historyQuery = usePriceHistory({ supplierId, itemId });
  const entries = historyQuery.data ?? [];

  if (historyQuery.isLoading) {
    return (
      <div
        className="space-y-2 py-2"
        aria-busy="true"
        aria-label="Loading price history"
      >
        {[0, 1].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    );
  }

  if (historyQuery.isError) {
    return (
      <div className="flex items-center justify-between gap-3 py-2">
        <p role="alert" className="text-sm text-muted-foreground">
          Could not load history.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => historyQuery.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No price changes recorded yet.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5 py-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
        >
          <span className="tabular-nums">
            {entry.oldPrice === null && entry.newPrice !== null && (
              <>Set at {formatINR(entry.newPrice)}</>
            )}
            {entry.oldPrice !== null && entry.newPrice !== null && (
              <>
                {formatINR(entry.oldPrice)} →{" "}
                <span className="font-medium">
                  {formatINR(entry.newPrice)}
                </span>
              </>
            )}
            {entry.oldPrice !== null && entry.newPrice === null && (
              <>Removed (was {formatINR(entry.oldPrice)})</>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(entry.changedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PriceRowActions({
  price,
  onEdit,
  onTogglePreferred,
  preferredPending,
  historyOpen,
  onToggleHistory,
}: {
  price: SupplierPrice;
  onEdit: () => void;
  onTogglePreferred: () => void;
  preferredPending: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <PreferredStar
        price={price}
        disabled={preferredPending}
        onToggle={onTogglePreferred}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={onToggleHistory}
        aria-expanded={historyOpen}
        aria-label={
          historyOpen
            ? `Hide price history for ${price.itemName}`
            : `Show price history for ${price.itemName}`
        }
      >
        <History aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        onClick={onEdit}
        aria-label={`Edit price for ${price.itemName}`}
      >
        <Pencil />
      </Button>
    </div>
  );
}

/**
 * Supplier price list (P1-04). One row per item this supplier prices:
 * current price in ₹ (en-IN), preferred-supplier star toggle, per-row
 * history expander, and an add-price dialog with an item picker.
 * Owner/manager only — the route guard enforces it; RLS is the authority.
 */
export function SupplierPricesPage() {
  const { id } = useParams<{ id: string }>();
  const supplierId = id ?? null;
  const { profile } = useAuth();
  const canManage = profile?.role === "owner" || profile?.role === "manager";

  const [dialog, setDialog] = useState<{ price: PricedItem | null } | null>(
    null,
  );
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);

  const supplierQuery = useSupplier(supplierId);
  const pricesQuery = useSupplierPrices(supplierId);
  const preferredMutation = useSetPreferredSupplier();

  // Items available for "add price": active items without a price row yet.
  const itemsQuery = useItems({
    active: true,
    page: 1,
    pageSize: ITEM_PICKER_PAGE_SIZE,
  });

  const prices = useMemo(
    () => pricesQuery.data ?? [],
    [pricesQuery.data],
  );
  const pricedItemIds = useMemo(
    () => new Set(prices.map((p) => p.itemId)),
    [prices],
  );
  const availableItems: AvailableItem[] = useMemo(
    () =>
      (itemsQuery.data?.items ?? [])
        .filter((item) => !pricedItemIds.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.name,
          unitSymbol: item.unitSymbol,
        })),
    [itemsQuery.data, pricedItemIds],
  );

  const isLoading = supplierQuery.isLoading || pricesQuery.isLoading;
  const isError = supplierQuery.isError || pricesQuery.isError;
  const supplierName = supplierQuery.data?.name ?? "Supplier";

  const openAddDialog = () => setDialog({ price: null });
  const openEditDialog = (price: SupplierPrice) =>
    setDialog({
      price: {
        itemId: price.itemId,
        itemName: price.itemName,
        itemUnit: price.itemUnit,
        unitPrice: price.unitPrice,
      },
    });

  const togglePreferred = (price: SupplierPrice) => {
    if (price.isPreferred) {
      return;
    }
    preferredMutation.mutate({
      itemId: price.itemId,
      supplierId: price.supplierId,
    });
  };

  return (
    <div>
      <div className="mb-4">
        <Link
          to="/suppliers"
          className="inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to suppliers
        </Link>
      </div>

      <PageHeader
        title={isLoading ? "Price list" : `Price list — ${supplierName}`}
        description="Per-item prices from this supplier, in the item's base unit."
        actions={
          canManage ? (
            <Button type="button" size="lg" onClick={openAddDialog}>
              <Plus aria-hidden="true" />
              Add price
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingSkeleton />
      ) : isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load the price list.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={() => {
              supplierQuery.refetch();
              pricesQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : prices.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <Tag
            className="mx-auto size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium">
            No prices yet — add the first price for this supplier.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Prices feed the purchase-order prefill and recipe costing.
          </p>
          {canManage && (
            <Button
              type="button"
              size="lg"
              className="mt-4"
              onClick={openAddDialog}
            >
              <Plus aria-hidden="true" />
              Add price
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Price list for {supplierName} — star marks the preferred
                supplier for each item
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Price
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Preferred
                  </th>
                  {canManage && (
                    <th scope="col" className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {prices.map((price) => {
                  const historyOpen = historyOpenId === price.id;
                  return (
                    <Fragment key={price.id}>
                      <tr className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">
                          {price.itemName}
                          {price.itemUnit && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              per {price.itemUnit}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {formatINR(price.unitPrice)}
                        </td>
                        <td className="px-4 py-3">
                          {price.isPreferred ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
                              <Star
                                className="size-4 fill-amber-400 text-amber-400"
                                aria-hidden="true"
                              />
                              Preferred
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-1">
                            <PriceRowActions
                              price={price}
                              onEdit={() => openEditDialog(price)}
                              onTogglePreferred={() => togglePreferred(price)}
                              preferredPending={preferredMutation.isPending}
                              historyOpen={historyOpen}
                              onToggleHistory={() =>
                                setHistoryOpenId(
                                  historyOpen ? null : price.id,
                                )
                              }
                            />
                          </td>
                        )}
                      </tr>
                      {historyOpen && (
                        <tr>
                          <td colSpan={canManage ? 4 : 3} className="bg-muted/20 px-4">
                            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Price history
                            </p>
                            <PriceHistoryPanel
                              supplierId={price.supplierId}
                              itemId={price.itemId}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {prices.map((price) => {
              const historyOpen = historyOpenId === price.id;
              return (
                <li
                  key={price.id}
                  className="rounded-lg border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{price.itemName}</p>
                      <p className="mt-0.5 tabular-nums text-lg font-semibold">
                        {formatINR(price.unitPrice)}
                        {price.itemUnit && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            / {price.itemUnit}
                          </span>
                        )}
                      </p>
                    </div>
                    {price.isPreferred && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        <Star
                          className="size-3.5 fill-amber-400 text-amber-400"
                          aria-hidden="true"
                        />
                        Preferred
                      </span>
                    )}
                  </div>
                  {canManage && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="flex-1"
                        disabled={preferredMutation.isPending}
                        onClick={() => togglePreferred(price)}
                        aria-pressed={price.isPreferred}
                      >
                        <Star aria-hidden="true" />
                        {price.isPreferred ? "Preferred" : "Set preferred"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="flex-1"
                        onClick={() =>
                          setHistoryOpenId(historyOpen ? null : price.id)
                        }
                        aria-expanded={historyOpen}
                      >
                        <History aria-hidden="true" />
                        History
                        <ChevronDown
                          aria-hidden="true"
                          className={`transition-transform ${historyOpen ? "rotate-180" : ""}`}
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="flex-1"
                        onClick={() => openEditDialog(price)}
                        aria-label={`Edit price for ${price.itemName}`}
                      >
                        <Pencil aria-hidden="true" />
                        Edit
                      </Button>
                    </div>
                  )}
                  {historyOpen && (
                    <div className="mt-3 border-t pt-1">
                      <PriceHistoryPanel
                        supplierId={price.supplierId}
                        itemId={price.itemId}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {dialog && supplierId && (
        <PriceDialog
          supplierId={supplierId}
          supplierName={supplierName}
          price={dialog.price}
          availableItems={availableItems}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
