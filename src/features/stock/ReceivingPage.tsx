import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { formatINR, formatNumber } from "@/lib/format";
import {
  receiveGoodsSchema,
  type ReceiveGoodsInput,
} from "@/schemas/stock";
import type { ReceiveGoodsResult } from "@/api/stock";
import { useReceivableItems, useReceiveGoods } from "./hooks";
import { useAuth } from "@/features/auth/useAuth";

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

function emptyLine() {
  return {
    itemId: "",
    quantity: undefined as unknown as number,
    unitCost: undefined as unknown as number,
    batchNo: "",
    expiryDate: "",
    notes: "",
  };
}

/**
 * Ad hoc goods receiving (P2-02): a multi-line receipt form posting through
 * the `receive_goods` RPC. One atomic call per receipt; the success report
 * shows per-line movement ids and old→new average costs straight from the
 * RPC result.
 *
 * Roles: owner, manager, staff (route guard enforces; the RPC re-checks).
 * Quantities are entered in the item's base unit — every quantity label
 * names the unit (unit conversion lands in P2-05).
 */
export function ReceivingPage() {
  const receivable = useReceivableItems();
  const receiveGoods = useReceiveGoods();
  const [result, setResult] = useState<ReceiveGoodsResult | null>(null);
  const { profile } = useAuth();
  // Role matrix §7: staff see no costs. The receipt form's unit-cost input
  // is typed by the user (not revealed by the app), but the RPC-returned
  // costs in the success report are hidden from staff.
  const canViewCosts =
    profile?.role === "owner" || profile?.role === "manager";

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ReceiveGoodsInput>({
    resolver: zodResolver(receiveGoodsSchema),
    defaultValues: { lines: [emptyLine()] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = watch("lines");

  // Warn about losing an in-progress receipt on tab close / refresh.
  useEffect(() => {
    if (!isDirty || result) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty, result]);

  const itemById = new Map(receivable.items.map((item) => [item.id, item]));

  const lineTotals = watchedLines.map((line) => {
    const qty = Number(line.quantity);
    const cost = Number(line.unitCost);
    return Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0;
  });
  const receiptTotal = lineTotals.reduce((sum, t) => sum + t, 0);

  const onSubmit = (input: ReceiveGoodsInput) => {
    receiveGoods.mutate(input, {
      onSuccess: (res) => {
        setResult(res);
      },
    });
  };

  const startNewReceipt = () => {
    setResult(null);
    reset({ lines: [emptyLine()] });
  };

  // -- success report -------------------------------------------------------
  if (result) {
    return (
      <div>
        <PageHeader
          title="Receiving"
          description="Receipt posted to the stock ledger."
          actions={
            <Button onClick={startNewReceipt} className="min-h-[44px]">
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              New receipt
            </Button>
          }
        />
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                {canViewCosts && (
                  <>
                    <th className="px-4 py-3 font-medium">Unit cost</th>
                    <th className="px-4 py-3 font-medium">Avg cost (old → new)</th>
                  </>
                )}
                <th className="px-4 py-3 font-medium">Movement</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((line) => {
                const item = itemById.get(line.itemId);
                return (
                  <tr key={line.movementId} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {item ? `${item.name} (${item.unitSymbol})` : line.itemId}
                    </td>
                    <td className="px-4 py-3">{formatNumber(line.quantity)}</td>
                    {canViewCosts && (
                      <>
                        <td className="px-4 py-3">{formatINR(line.unitCost)}</td>
                        <td className="px-4 py-3">
                          {formatINR(line.oldAvgCost)} →{" "}
                          {formatINR(line.newAvgCost)}
                        </td>
                      </>
                    )}
                    <td
                      className="px-4 py-3 font-mono text-xs text-muted-foreground"
                      title={line.movementId}
                    >
                      {line.movementId.slice(0, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Stock levels and average costs are updated. Corrections are posted
          as new movements — receipts cannot be edited.
        </p>
      </div>
    );
  }

  // -- receipt form ----------------------------------------------------------
  return (
    <div>
      <PageHeader
        title="Receiving"
        description="Record an ad hoc delivery. Every line posts a receipt movement to the append-only ledger and recalculates the item's average cost."
      />

      {receivable.isLoading && (
        <div className="space-y-3" aria-label="Loading items">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-md border bg-muted/40"
            />
          ))}
        </div>
      )}

      {receivable.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
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
        <div className="rounded-md border p-6 text-center">
          <p className="font-medium">No active items yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add items on the Items page before recording a receipt.
          </p>
        </div>
      )}

      {!receivable.isLoading &&
        !receivable.isError &&
        receivable.items.length > 0 && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-4">
              {fields.map((field, index) => {
                const selectedItem = itemById.get(
                  watchedLines[index]?.itemId ?? "",
                );
                const unitLabel = selectedItem
                  ? `Quantity (${selectedItem.unitSymbol})`
                  : "Quantity";
                const lineError = errors.lines?.[index];
                return (
                  <fieldset
                    key={field.id}
                    className="rounded-md border p-4"
                    aria-label={`Receipt line ${index + 1}`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold" aria-hidden>
                        Line {index + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-[44px]"
                        disabled={fields.length <= 1 || isSubmitting}
                        onClick={() => remove(index)}
                        aria-label={`Remove line ${index + 1}`}
                      >
                        <Trash2
                          className="mr-1 h-4 w-4 text-destructive"
                          aria-hidden
                        />
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="sm:col-span-2 lg:col-span-1">
                        <label
                          className={labelClass}
                          htmlFor={`lines.${index}.itemId`}
                        >
                          Item
                        </label>
                        <select
                          id={`lines.${index}.itemId`}
                          className={inputClass}
                          disabled={isSubmitting}
                          {...register(`lines.${index}.itemId`)}
                        >
                          <option value="">Select an item…</option>
                          {receivable.items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unitSymbol})
                            </option>
                          ))}
                        </select>
                        <FieldError message={lineError?.itemId?.message} />
                      </div>

                      <div>
                        <label
                          className={labelClass}
                          htmlFor={`lines.${index}.quantity`}
                        >
                          {unitLabel}
                        </label>
                        <input
                          id={`lines.${index}.quantity`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          className={inputClass}
                          disabled={isSubmitting}
                          {...register(`lines.${index}.quantity`)}
                        />
                        <FieldError message={lineError?.quantity?.message} />
                      </div>

                      <div>
                        <label
                          className={labelClass}
                          htmlFor={`lines.${index}.unitCost`}
                        >
                          Unit cost (₹)
                        </label>
                        <input
                          id={`lines.${index}.unitCost`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          className={inputClass}
                          disabled={isSubmitting}
                          {...register(`lines.${index}.unitCost`)}
                        />
                        <FieldError message={lineError?.unitCost?.message} />
                      </div>

                      <div>
                        <label
                          className={labelClass}
                          htmlFor={`lines.${index}.batchNo`}
                        >
                          Batch no. <span className="font-normal text-muted-foreground">(optional)</span>
                        </label>
                        <input
                          id={`lines.${index}.batchNo`}
                          type="text"
                          className={inputClass}
                          disabled={isSubmitting}
                          {...register(`lines.${index}.batchNo`)}
                        />
                        <FieldError message={lineError?.batchNo?.message} />
                      </div>

                      <div>
                        <label
                          className={labelClass}
                          htmlFor={`lines.${index}.expiryDate`}
                        >
                          Expiry <span className="font-normal text-muted-foreground">(optional)</span>
                        </label>
                        <input
                          id={`lines.${index}.expiryDate`}
                          type="date"
                          className={inputClass}
                          disabled={isSubmitting}
                          {...register(`lines.${index}.expiryDate`)}
                        />
                        <FieldError message={lineError?.expiryDate?.message} />
                      </div>

                      <div>
                        <label
                          className={labelClass}
                          htmlFor={`lines.${index}.notes`}
                        >
                          Notes <span className="font-normal text-muted-foreground">(optional)</span>
                        </label>
                        <input
                          id={`lines.${index}.notes`}
                          type="text"
                          className={inputClass}
                          disabled={isSubmitting}
                          {...register(`lines.${index}.notes`)}
                        />
                        <FieldError message={lineError?.notes?.message} />
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-muted-foreground">
                      Line total:{" "}
                      <span className="font-medium text-foreground">
                        {formatINR(lineTotals[index] ?? 0)}
                      </span>
                    </p>
                  </fieldset>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={isSubmitting}
                onClick={() => append(emptyLine())}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Add line
              </Button>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Receipt total:{" "}
                <span className="font-semibold text-foreground">
                  {formatINR(receiptTotal)}
                </span>
              </p>
            </div>

            {typeof errors.lines?.message === "string" && (
              <FieldError message={errors.lines.message} />
            )}

            <div className="mt-6">
              <Button
                type="submit"
                className="min-h-[44px] w-full sm:w-auto"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Posting receipt…" : "Post receipt"}
              </Button>
            </div>
          </form>
        )}
    </div>
  );
}
