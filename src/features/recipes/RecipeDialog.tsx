import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useItems } from "@/features/items/hooks";
import {
  useAddIngredient,
  useCreateMenuItem,
  useMenuItem,
  useRemoveIngredient,
  useUnitConversions,
  useUnits,
  useUpdateIngredient,
  useUpdateMenuItem,
} from "./hooks";
import { convertibleUnits } from "@/lib/units";
import {
  costPerDish,
  foodCostPct,
  totalIngredientCost,
  type CostedIngredient,
} from "@/lib/costing";
import { formatINR, formatNumber } from "@/lib/format";
import {
  createMenuItemSchema,
  type CreateMenuItemInput,
} from "@/schemas/recipe";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

/**
 * Coerce a raw form value (number | numeric string | undefined) to a
 * positive number, or null when it is empty/invalid. React Hook Form hands
 * number inputs back as strings until the Zod resolver runs, so the live
 * cost preview must tolerate the raw shapes.
 */
function toPositiveNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} role="alert" className={errorClass}>
      {message}
    </p>
  );
}

interface IngredientLine {
  /** Present for lines already saved; absent for newly added lines. */
  id?: string;
  itemId: string;
  itemName: string;
  baseUnitId: string;
  baseUnitSymbol: string;
  quantity: string;
  unitId: string;
}

/**
 * Recipe builder dialog (P4-01). Creates a menu item or edits an existing
 * one, including its ingredient lines. Each line picks an inventory item, a
 * quantity, and a unit — the unit choices are limited to the item's base
 * unit plus directly-convertible units (see `convertibleUnits`).
 */
export function RecipeDialog({
  menuItemId,
  onClose,
}: {
  menuItemId: string | null;
  onClose: () => void;
}) {
  const isEdit = menuItemId !== null;
  const detailQuery = useMenuItem(menuItemId);
  const createMutation = useCreateMenuItem();
  const updateMutation = useUpdateMenuItem();
  const addIngredient = useAddIngredient();
  const updateIngredient = useUpdateIngredient();
  const removeIngredient = useRemoveIngredient();

  const itemsQuery = useItems({ active: true, page: 1, pageSize: 100 });
  const unitsQuery = useUnits();
  const conversionsQuery = useUnitConversions();

  const items = useMemo(
    () => itemsQuery.data?.items ?? [],
    [itemsQuery.data],
  );
  const units = useMemo(
    () =>
      (unitsQuery.data ?? [])
        .filter((u) => u.symbol !== undefined)
        .map((u) => ({ id: u.id, symbol: u.symbol as string })),
    [unitsQuery.data],
  );
  const conversions = conversionsQuery.data ?? [];
  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateMenuItemInput>({
    resolver: zodResolver(createMenuItemSchema),
    defaultValues: {
      name: "",
      description: "",
      yieldQuantity: 1,
      yieldUnit: "servings",
      sellingPrice: undefined,
    },
  });

  const [lines, setLines] = useState<IngredientLine[]>([]);
  const [itemToAdd, setItemToAdd] = useState("");
  const [linesError, setLinesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Populate the form when editing.
  const detail = detailQuery.data;
  useEffect(() => {
    if (detail) {
      reset({
        name: detail.name,
        description: detail.description ?? "",
        yieldQuantity: detail.yieldQuantity,
        yieldUnit: detail.yieldUnit,
        sellingPrice: detail.sellingPrice ?? undefined,
      });
      setLines(
        detail.ingredients.map((ing) => ({
          id: ing.id,
          itemId: ing.itemId,
          itemName: ing.itemName,
          baseUnitId: itemById.get(ing.itemId)?.unitId ?? ing.unitId,
          baseUnitSymbol: ing.baseUnitSymbol,
          quantity: String(ing.quantity),
          unitId: ing.unitId,
        })),
      );
    }
  }, [detail, reset, itemById]);

  const addableItems = useMemo(() => {
    const used = new Set(lines.map((l) => l.itemId));
    return items.filter((i) => !used.has(i.id));
  }, [items, lines]);

  const addLine = () => {
    const item = itemById.get(itemToAdd);
    if (!item) return;
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        baseUnitId: item.unitId,
        baseUnitSymbol: item.unitSymbol,
        quantity: "1",
        unitId: item.unitId,
      },
    ]);
    setItemToAdd("");
    setLinesError(null);
  };

  const updateLine = (index: number, patch: Partial<IngredientLine>) => {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        // If the item changed, reset the unit to its base unit.
        if (patch.itemId && patch.itemId !== line.itemId) {
          const item = itemById.get(patch.itemId);
          if (item) {
            next.baseUnitId = item.unitId;
            next.baseUnitSymbol = item.unitSymbol;
            next.unitId = item.unitId;
            next.itemName = item.name;
          }
        }
        return next;
      }),
    );
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const unitOptionsFor = (line: IngredientLine) =>
    convertibleUnits(line.baseUnitId, units, conversions);

  // Live cost preview (P4-02): recomputed on every render from the current
  // lines, the items' live avg_unit_cost, and the form's yield / selling
  // price. Nothing is stored — receiving stock updates these numbers
  // automatically on the next render.
  const previewYield = toPositiveNumber(watch("yieldQuantity"));
  const previewSellingPrice = toPositiveNumber(watch("sellingPrice"));
  const previewLines: CostedIngredient[] = lines.map((line) => ({
    quantity: Number(line.quantity),
    unitId: line.unitId,
    itemBaseUnitId: line.baseUnitId,
    avgUnitCost: itemById.get(line.itemId)?.avgUnitCost ?? 0,
  }));
  const previewLinesValid =
    lines.length > 0 &&
    previewLines.every(
      (l) => Number.isFinite(l.quantity) && l.quantity > 0 && l.unitId !== "",
    );
  const previewTotal =
    previewLinesValid ? totalIngredientCost(previewLines, conversions) : null;
  const previewCostPerDish =
    previewTotal !== null && previewYield !== null
      ? costPerDish(previewTotal, previewYield)
      : null;
  const previewFoodCostPct =
    previewCostPerDish === null
      ? null
      : foodCostPct(previewCostPerDish, previewSellingPrice);

  const onSubmit = async (input: CreateMenuItemInput) => {
    if (lines.length === 0) {
      setLinesError("Add at least one ingredient.");
      return;
    }
    // Validate every line client-side before any network call.
    for (const line of lines) {
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setLinesError(
          `Quantity for "${line.itemName}" must be greater than zero.`,
        );
        return;
      }
      if (!line.unitId) {
        setLinesError(`Pick a unit for "${line.itemName}".`);
        return;
      }
    }
    setLinesError(null);
    setSaving(true);
    try {
      if (!isEdit) {
        const created = await createMutation.mutateAsync(input);
        for (const line of lines) {
          await addIngredient.mutateAsync({
            menuItemId: created.id,
            input: {
              itemId: line.itemId,
              quantity: Number(line.quantity),
              unitId: line.unitId,
            },
          });
        }
      } else {
        const id = menuItemId as string;
        await updateMutation.mutateAsync({ id, input });
        const prevIds = new Set((detail?.ingredients ?? []).map((i) => i.id));
        const nextIds = new Set(
          lines.filter((l) => l.id).map((l) => l.id as string),
        );
        // Removed lines.
        for (const ing of detail?.ingredients ?? []) {
          if (!nextIds.has(ing.id)) {
            await removeIngredient.mutateAsync(ing.id);
          }
        }
        // Added + updated lines.
        for (const line of lines) {
          const payload = {
            itemId: line.itemId,
            quantity: Number(line.quantity),
            unitId: line.unitId,
          };
          if (line.id) {
            await updateIngredient.mutateAsync({ id: line.id, input: payload });
          } else {
            await addIngredient.mutateAsync({ menuItemId: id, input: payload });
          }
        }
        void prevIds;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const loading =
    (isEdit && detailQuery.isLoading) ||
    itemsQuery.isLoading ||
    unitsQuery.isLoading ||
    conversionsQuery.isLoading;
  const loadError =
    detailQuery.isError || itemsQuery.isError || unitsQuery.isError || conversionsQuery.isError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-dialog-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="recipe-dialog-title" className="text-xl font-semibold tracking-tight">
            {isEdit ? "Edit recipe" : "New recipe"}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X />
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2" aria-label="Loading recipe">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-md border p-6 text-center">
            <p role="alert" className="font-medium">
              Could not load the recipe builder.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 min-h-[44px]"
              onClick={() => detailQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="recipe-name" className={labelClass}>
                  Dish name
                </label>
                <input
                  id="recipe-name"
                  className={inputClass}
                  {...register("name")}
                  aria-invalid={!!errors.name}
                />
                <FieldError id="recipe-name-error" message={errors.name?.message} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="recipe-description" className={labelClass}>
                  Description <span className="text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="recipe-description"
                  className={`${inputClass} min-h-20 py-2`}
                  {...register("description")}
                />
                <FieldError
                  id="recipe-description-error"
                  message={errors.description?.message}
                />
              </div>
              <div>
                <label htmlFor="recipe-yield-qty" className={labelClass}>
                  Yield quantity
                </label>
                <input
                  id="recipe-yield-qty"
                  type="number"
                  min="0"
                  step="any"
                  className={inputClass}
                  {...register("yieldQuantity")}
                  aria-invalid={!!errors.yieldQuantity}
                />
                <FieldError
                  id="recipe-yield-qty-error"
                  message={errors.yieldQuantity?.message}
                />
              </div>
              <div>
                <label htmlFor="recipe-yield-unit" className={labelClass}>
                  Yield unit
                </label>
                <input
                  id="recipe-yield-unit"
                  placeholder="servings"
                  className={inputClass}
                  {...register("yieldUnit")}
                  aria-invalid={!!errors.yieldUnit}
                />
                <FieldError
                  id="recipe-yield-unit-error"
                  message={errors.yieldUnit?.message}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="recipe-selling-price" className={labelClass}>
                  Selling price{" "}
                  <span className="font-normal text-muted-foreground">
                    (₹, optional)
                  </span>
                </label>
                <input
                  id="recipe-selling-price"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 199"
                  className={inputClass}
                  {...register("sellingPrice")}
                  aria-invalid={!!errors.sellingPrice}
                />
                <FieldError
                  id="recipe-selling-price-error"
                  message={errors.sellingPrice?.message}
                />
              </div>
            </div>

            <h3 className="mb-2 mt-6 font-medium">
              Ingredients{" "}
              <span className="text-sm font-normal text-muted-foreground">
                (quantities are for the full yield)
              </span>
            </h3>

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No ingredients yet — add one below.
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((line, index) => (
                  <li
                    key={line.id ?? `new-${index}`}
                    className="flex flex-wrap items-end gap-2 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <span className="font-medium">{line.itemName}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        (stocked in {line.baseUnitSymbol})
                      </span>
                    </div>
                    <div className="w-24">
                      <label
                        htmlFor={`ing-qty-${index}`}
                        className="mb-1 block text-xs font-medium"
                      >
                        Qty
                      </label>
                      <input
                        id={`ing-qty-${index}`}
                        type="number"
                        min="0"
                        step="any"
                        aria-label={`Quantity for ${line.itemName}`}
                        className={inputClass}
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(index, { quantity: e.target.value })
                        }
                      />
                    </div>
                    <div className="w-24">
                      <label
                        htmlFor={`ing-unit-${index}`}
                        className="mb-1 block text-xs font-medium"
                      >
                        Unit
                      </label>
                      <select
                        id={`ing-unit-${index}`}
                        aria-label={`Unit for ${line.itemName}`}
                        className={inputClass}
                        value={line.unitId}
                        onChange={(e) =>
                          updateLine(index, { unitId: e.target.value })
                        }
                      >
                        {unitOptionsFor(line).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.symbol}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${line.itemName}`}
                      className="min-h-[44px]"
                      onClick={() => removeLine(index)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {linesError && (
              <p role="alert" className={errorClass}>
                {linesError}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <select
                aria-label="Add ingredient"
                className={inputClass}
                value={itemToAdd}
                onChange={(e) => setItemToAdd(e.target.value)}
              >
                <option value="">Add an ingredient…</option>
                {addableItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unitSymbol})
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={!itemToAdd}
                onClick={addLine}
              >
                <Plus className="mr-1 size-4" aria-hidden="true" />
                Add
              </Button>
            </div>

            <div
              className="mt-4 rounded-lg border bg-muted/40 p-4"
              aria-live="polite"
              aria-label="Live recipe cost"
            >
              <h3 className="text-sm font-medium">
                Recipe cost{" "}
                <span className="font-normal text-muted-foreground">
                  (live)
                </span>
              </h3>
              {previewTotal === null ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Add ingredients to see the live cost.
                </p>
              ) : (
                <>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">
                        Ingredients, full yield
                      </dt>
                      <dd className="font-medium tabular-nums">
                        {formatINR(previewTotal)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Cost per dish</dt>
                      <dd className="font-medium tabular-nums">
                        {previewCostPerDish === null
                          ? "—"
                          : formatINR(previewCostPerDish)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Food cost</dt>
                      <dd className="font-medium tabular-nums">
                        {previewFoodCostPct === null ? (
                          <span title="Set a selling price to see the food cost">
                            —
                          </span>
                        ) : (
                          `${formatNumber(previewFoodCostPct)}%`
                        )}
                      </dd>
                    </div>
                  </dl>
                  {previewSellingPrice === null && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Set a selling price to see the food-cost %.
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={saving || createMutation.isPending || updateMutation.isPending}
              >
                {saving ? "Saving…" : isEdit ? "Save changes" : "Create recipe"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}