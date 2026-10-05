import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { formatINR, formatNumber } from "@/lib/format";
import {
  aggregateSalesLines,
  saleDateSchema,
  salesLineSchema,
  todayISODate,
  type SalesLine,
} from "@/schemas/sales";
import { useMenuItems } from "@/features/recipes/hooks";
import { useRecordSales } from "./hooks";

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
 * The form allows the same dish on multiple rows (a busy manager may add
 * "Butter Chicken" twice by accident); lines are aggregated per dish on
 * submit, so the RPC's duplicate-dish guard never fires on honest input.
 */
const formSchema = z.object({
  saleDate: saleDateSchema,
  lines: z
    .array(salesLineSchema)
    .min(1, "Add at least one dish.")
    .max(200, "Too many dishes in one entry."),
});
type FormInput = z.infer<typeof formSchema>;

function emptyLine(): SalesLine {
  return { menuItemId: "", dishes: undefined as unknown as number };
}

/**
 * Sales entry (P4-03): manual daily, per-dish sales entry for owners and
 * managers (staff never see recipes/costs — role matrix §7). Posts through
 * the `record_sales` RPC, which explodes each dish's recipe into
 * aggregated per-ingredient `sale_deduction` movements on the append-only
 * ledger (deduction = dishes × qty / yield, in the item's base unit).
 *
 * Deducting more than current stock is permitted — stock goes negative and
 * the next count reconciles it (the same "warn + allow" precedent as
 * usage/wastage; P4-04 adds the explicit confirmation, negative flag and
 * audit entry).
 */
export function SalesEntryPage() {
  const dishes = useMenuItems({ active: true });
  const recordSales = useRecordSales();

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { saleDate: todayISODate(), lines: [emptyLine()] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = watch("lines");

  const menuItems = dishes.data ?? [];
  const itemById = new Map(menuItems.map((item) => [item.id, item]));

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

  const pricedLines = watchedLines.filter(
    (line) => line.menuItemId && Number(line.dishes) > 0,
  );
  const revenue = pricedLines.reduce((sum, line) => {
    const dish = itemById.get(line.menuItemId);
    return sum + (dish?.sellingPrice ?? 0) * Number(line.dishes);
  }, 0);
  const unpricedCount = pricedLines.filter(
    (line) => itemById.get(line.menuItemId)?.sellingPrice == null,
  ).length;

  const onSubmit = (input: FormInput) => {
    recordSales.mutate(
      {
        saleDate: input.saleDate,
        lines: aggregateSalesLines(input.lines),
      },
      {
        onSuccess: () => {
          reset({ saleDate: input.saleDate, lines: [emptyLine()] });
        },
      },
    );
  };

  return (
    <div>
      <PageHeader
        title="Sales entry"
        description="Record a day's sales per dish. Each entry deducts the recipe ingredients from stock on the append-only ledger — entries cannot be edited afterwards."
      />

      {dishes.isLoading && (
        <div className="max-w-xl space-y-3" aria-label="Loading dishes">
          <div className="h-40 animate-pulse rounded-md border bg-muted/40" />
        </div>
      )}

      {dishes.isError && (
        <div className="max-w-xl rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="font-medium">Couldn&apos;t load dishes.</p>
          <Button
            variant="outline"
            className="mt-3 min-h-[44px]"
            onClick={() => dishes.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {!dishes.isLoading && !dishes.isError && menuItems.length === 0 && (
        <div className="max-w-xl rounded-md border p-6 text-center">
          <p className="font-medium">No active dishes yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add dishes with recipes on the Recipes page before recording sales.
          </p>
        </div>
      )}

      {!dishes.isLoading && !dishes.isError && menuItems.length > 0 && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="max-w-xl space-y-4"
        >
          <div>
            <label className={labelClass} htmlFor="saleDate">
              Sale date
            </label>
            <input
              id="saleDate"
              type="date"
              className={inputClass}
              disabled={isSubmitting}
              {...register("saleDate")}
            />
            <FieldError message={errors.saleDate?.message} />
          </div>

          <div className="space-y-3">
            <p className={labelClass}>Dishes sold</p>
            {fields.map((field, index) => {
              const dish = itemById.get(watchedLines[index]?.menuItemId ?? "");
              const lineError = errors.lines?.[index];
              return (
                <div
                  key={field.id}
                  className="flex items-start gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <label
                      className="sr-only"
                      htmlFor={`lines.${index}.menuItemId`}
                    >
                      Dish {index + 1}
                    </label>
                    <select
                      id={`lines.${index}.menuItemId`}
                      className={inputClass}
                      disabled={isSubmitting}
                      {...register(`lines.${index}.menuItemId` as const)}
                    >
                      <option value="">Select a dish…</option>
                      {menuItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <FieldError message={lineError?.menuItemId?.message} />
                    {dish && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Yield: {formatNumber(dish.yieldQuantity)}{" "}
                        {dish.yieldUnit}
                        {dish.sellingPrice != null &&
                          ` · ${formatINR(dish.sellingPrice)}`}
                      </p>
                    )}
                  </div>
                  <div className="w-28 shrink-0">
                    <label
                      className="sr-only"
                      htmlFor={`lines.${index}.dishes`}
                    >
                      Dishes sold for {dish?.name ?? `row ${index + 1}`}
                    </label>
                    <input
                      id={`lines.${index}.dishes`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      placeholder="Qty"
                      aria-label={`Dishes sold (${dish?.name ?? `row ${index + 1}`})`}
                      className={inputClass}
                      disabled={isSubmitting}
                      {...register(`lines.${index}.dishes` as const)}
                    />
                    <FieldError message={lineError?.dishes?.message} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 min-h-[44px] shrink-0"
                    disabled={isSubmitting || fields.length === 1}
                    onClick={() => remove(index)}
                    aria-label={`Remove dish row ${index + 1}`}
                  >
                    ✕
                  </Button>
                </div>
              );
            })}
            <FieldError message={errors.lines?.message} />
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isSubmitting}
              onClick={() => append(emptyLine())}
            >
              Add dish
            </Button>
          </div>

          {pricedLines.length > 0 && (
            <div
              className="rounded-md border bg-muted/40 p-3 text-sm"
              aria-live="polite"
            >
              <p>
                Revenue estimate:{" "}
                <span className="font-semibold">{formatINR(revenue)}</span>
              </p>
              {unpricedCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {unpricedCount} {unpricedCount === 1 ? "dish has" : "dishes have"}{" "}
                  no selling price set — excluded from the estimate.
                </p>
              )}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Selling more than current stock is allowed but takes stock
            negative — the next count reconciles it.
          </p>

          <Button
            type="submit"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={isSubmitting || recordSales.isPending}
          >
            {isSubmitting ? "Recording…" : "Record sales"}
          </Button>
        </form>
      )}
    </div>
  );
}
