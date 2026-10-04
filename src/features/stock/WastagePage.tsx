import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/format";
import { useCurrentStock } from "@/features/items/stockHooks";
import {
  logUsageSchema,
  logWastageSchema,
  type UsageReason,
  type WastageReason,
} from "@/schemas/stock";
import { useLogUsage, useLogWastage, useReceivableItems } from "./hooks";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className={errorClass}>
      {message}
    </p>
  );
}

/**
 * One form, two movement types: the entry kind discriminates between the
 * usage and wastage Zod schemas (each with its own closed reason-code set),
 * so validation is reused, never duplicated.
 */
const pageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("usage") }).merge(logUsageSchema),
  z.object({ kind: z.literal("wastage") }).merge(logWastageSchema),
]);
type PageInput = z.infer<typeof pageSchema>;

const USAGE_REASONS: { value: UsageReason; label: string }[] = [
  { value: "kitchen_use", label: "Kitchen use" },
  { value: "staff_meal", label: "Staff meal" },
  { value: "tasting", label: "Tasting" },
  { value: "other_usage", label: "Other" },
];

const WASTAGE_REASONS: { value: WastageReason; label: string }[] = [
  { value: "expired", label: "Expired" },
  { value: "spoiled", label: "Spoiled" },
  { value: "damaged", label: "Damaged" },
  { value: "over_prepared", label: "Over-prepared" },
  { value: "other_wastage", label: "Other" },
];

function emptyForm(kind: "usage" | "wastage"): PageInput {
  const base = {
    itemId: "",
    quantity: undefined as unknown as number,
    notes: "",
  };
  return kind === "usage"
    ? { ...base, kind: "usage" as const, reason: "" as unknown as UsageReason }
    : {
        ...base,
        kind: "wastage" as const,
        reason: "" as unknown as WastageReason,
      };
}

/**
 * Log usage & wastage (P2-03): a quick single-entry form for kitchen staff
 * (and managers/owners). Posts through the `log_usage` / `log_wastage`
 * RPCs — negative-quantity ledger movements with a required closed-set
 * reason code. No cost fields anywhere on this page (role matrix §7).
 *
 * Over-logging past zero stock is permitted (the count catches up later)
 * but the form warns loudly before submit.
 */
export function WastagePage() {
  const receivable = useReceivableItems();
  const logUsage = useLogUsage();
  const logWastage = useLogWastage();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<PageInput>({
    resolver: zodResolver(pageSchema),
    defaultValues: emptyForm("usage"),
  });

  const kind = watch("kind");
  const watchedItemId = watch("itemId");
  const watchedQuantity = watch("quantity");

  const currentStock = useCurrentStock(watchedItemId ? watchedItemId : null);

  // Warn about losing an in-progress entry on tab close / refresh.
  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const itemById = new Map(receivable.items.map((item) => [item.id, item]));
  const selectedItem = watchedItemId ? itemById.get(watchedItemId) : undefined;
  const stockQty = currentStock.data?.quantity;
  const enteredQty = Number(watchedQuantity);
  const overLogging =
    stockQty !== undefined &&
    Number.isFinite(enteredQty) &&
    enteredQty > 0 &&
    enteredQty > stockQty;

  const switchKind = (next: "usage" | "wastage") => {
    if (next === kind) {
      return;
    }
    // Reason codes differ per kind — clear the stale one.
    reset(emptyForm(next));
  };

  const reasons = kind === "usage" ? USAGE_REASONS : WASTAGE_REASONS;
  const activeMutation = kind === "usage" ? logUsage : logWastage;

  const onSubmit = (input: PageInput) => {
    // The `kind` discriminator is stripped by the Zod schemas in the api
    // layer; the narrowed variant is assignable to the mutation input.
    const options = {
      onSuccess: () => {
        reset(emptyForm(input.kind));
      },
    };
    if (input.kind === "usage") {
      logUsage.mutate(input, options);
    } else {
      logWastage.mutate(input, options);
    }
  };

  return (
    <div>
      <PageHeader
        title="Usage & wastage"
        description="Log stock consumed or thrown away. Every entry posts to the append-only ledger — entries cannot be edited afterwards."
      />

      <div
        role="group"
        aria-label="Entry type"
        className="mb-6 grid max-w-md grid-cols-2 gap-1 rounded-md border bg-muted p-1"
      >
        {(["usage", "wastage"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => switchKind(k)}
            className={
              "min-h-[44px] rounded-sm text-sm font-medium transition-colors " +
              (kind === k
                ? "bg-background text-foreground shadow"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {k === "usage" ? "Usage" : "Wastage"}
          </button>
        ))}
      </div>

      {receivable.isLoading && (
        <div className="max-w-xl space-y-3" aria-label="Loading items">
          <div className="h-40 animate-pulse rounded-md border bg-muted/40" />
        </div>
      )}

      {receivable.isError && (
        <div className="max-w-xl rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="font-medium">Couldn&apos;t load items.</p>
          <Button
            variant="outline"
            className="mt-3 min-h-[44px]"
            onClick={() => receivable.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {!receivable.isLoading && !receivable.isError && receivable.items.length === 0 && (
        <div className="max-w-xl rounded-md border p-6 text-center">
          <p className="font-medium">No active items yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add items on the Items page before logging usage or wastage.
          </p>
        </div>
      )}

      {!receivable.isLoading &&
        !receivable.isError &&
        receivable.items.length > 0 && (
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="max-w-xl space-y-4"
          >
            <div>
              <label className={labelClass} htmlFor="itemId">
                Item
              </label>
              <select
                id="itemId"
                className={inputClass}
                disabled={isSubmitting}
                {...register("itemId")}
              >
                <option value="">Select an item…</option>
                {receivable.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.unitSymbol})
                  </option>
                ))}
              </select>
              <FieldError message={errors.itemId?.message} />
              {selectedItem && (
                <p
                  className="mt-1 text-sm text-muted-foreground"
                  aria-live="polite"
                >
                  Current stock:{" "}
                  {currentStock.isLoading
                    ? "…"
                    : `${formatNumber(stockQty ?? 0)} ${selectedItem.unitSymbol}`}
                </p>
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="quantity">
                {selectedItem
                  ? `Quantity (${selectedItem.unitSymbol})`
                  : "Quantity"}
              </label>
              <input
                id="quantity"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={inputClass}
                disabled={isSubmitting}
                {...register("quantity")}
              />
              <FieldError message={errors.quantity?.message} />
              {overLogging && selectedItem && (
                <p role="alert" className="mt-1 text-sm font-medium text-destructive">
                  This will take stock negative (current:{" "}
                  {formatNumber(stockQty ?? 0)} {selectedItem.unitSymbol}).
                </p>
              )}
            </div>

            <div>
              <label className={labelClass} htmlFor="reason">
                Reason
              </label>
              <select
                id="reason"
                className={inputClass}
                disabled={isSubmitting}
                {...register("reason")}
              >
                <option value="">Select a reason…</option>
                {reasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <FieldError message={errors.reason?.message} />
            </div>

            <div>
              <label className={labelClass} htmlFor="notes">
                Notes{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <input
                id="notes"
                type="text"
                className={inputClass}
                disabled={isSubmitting}
                {...register("notes")}
              />
              <FieldError message={errors.notes?.message} />
            </div>

            <Button
              type="submit"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={isSubmitting || activeMutation.isPending}
            >
              {isSubmitting
                ? "Logging…"
                : kind === "usage"
                  ? "Log usage"
                  : "Log wastage"}
            </Button>
          </form>
        )}
    </div>
  );
}
