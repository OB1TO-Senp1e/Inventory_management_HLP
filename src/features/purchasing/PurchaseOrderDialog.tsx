import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/features/auth/useAuth";
import { useSuppliers } from "@/features/suppliers/hooks";
import { useReceivableItems } from "@/features/stock/hooks";
import {
  useCreatePurchaseOrder,
  useSupplierPricesForPrefill,
} from "./hooks";
import {
  createPurchaseOrderSchema,
  type CreatePurchaseOrderInput,
} from "@/schemas/purchaseOrder";
import { formatINR } from "@/lib/format";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

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

interface DraftLine {
  itemId: string;
  itemName: string;
  unitSymbol: string;
  quantity: number;
  unitPrice: number;
}

export function PurchaseOrderDialog({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const createMutation = useCreatePurchaseOrder();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);
  const [itemToAdd, setItemToAdd] = useState("");

  type FormValues = Omit<CreatePurchaseOrderInput, "lines">;
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createPurchaseOrderSchema.omit({ lines: true })),
    defaultValues: {
      supplierId: "",
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDate: undefined,
      notes: undefined,
    },
  });

  const supplierId = watch("supplierId");
  const { data: suppliersData } = useSuppliers({ pageSize: 100 });
  const { data: prefill } = useSupplierPricesForPrefill(supplierId || null);
  const receivable = useReceivableItems();

  const suppliers = useMemo(
    () => suppliersData?.suppliers ?? [],
    [suppliersData],
  );

  const addableItems = useMemo(() => {
    const inLines = new Set(lines.map((l) => l.itemId));
    return (receivable.items ?? []).filter((i) => !inLines.has(i.id));
  }, [receivable.items, lines]);

  const unaddedPricedItems = useMemo(() => {
    const inLines = new Set(lines.map((l) => l.itemId));
    return (prefill ?? []).filter((p) => !inLines.has(p.itemId));
  }, [prefill, lines]);

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  const addLine = (itemId: string, itemName: string, unitSymbol: string, unitPrice: number) => {
    setLinesError(null);
    setLines((prev) => [...prev, { itemId, itemName, unitSymbol, quantity: 1, unitPrice }]);
  };

  const addPricedItem = (itemId: string) => {
    const priced = (prefill ?? []).find((p) => p.itemId === itemId);
    if (priced) {
      addLine(priced.itemId, priced.itemName, priced.itemUnit ?? "", priced.unitPrice);
    }
  };

  const addAllPriced = () => {
    setLinesError(null);
    setLines((prev) => [
      ...prev,
      ...unaddedPricedItems.map((p) => ({
        itemId: p.itemId,
        itemName: p.itemName,
        unitSymbol: p.itemUnit ?? "",
        quantity: 1,
        unitPrice: p.unitPrice,
      })),
    ]);
  };

  const updateLine = (itemId: string, patch: Partial<Pick<DraftLine, "quantity" | "unitPrice">>) => {
    setLines((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)),
    );
  };

  const removeLine = (itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  };

  const requestClose = () => {
    if (isDirty || lines.length > 0) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !showDiscardConfirm) {
        requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, lines.length, showDiscardConfirm]);

  const onSubmit = (values: FormValues) => {
    if (!profile) {
      return;
    }
    if (lines.length === 0) {
      setLinesError("Add at least one line item.");
      return;
    }
    const badLine = lines.find((l) => !(l.quantity > 0) || !(l.unitPrice > 0));
    if (badLine) {
      setLinesError(`Check the quantity and price for ${badLine.itemName}.`);
      return;
    }
    createMutation.mutate(
      {
        ...values,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      },
      { onSuccess: () => onClose() },
    );
  };

  const busy = isSubmitting || createMutation.isPending;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="po-dialog-title"
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <h2 id="po-dialog-title" className="text-xl font-semibold tracking-tight">
              New purchase order
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={requestClose}
              aria-label="Close dialog"
            >
              <X />
            </Button>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="po-supplier" className={labelClass}>
                  Supplier
                </label>
                <select id="po-supplier" className={inputClass} {...register("supplierId")}>
                  <option value="">Select a supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <FieldError id="po-supplier-error" message={errors.supplierId?.message} />
              </div>
              <div>
                <label htmlFor="po-order-date" className={labelClass}>
                  Order date
                </label>
                <input
                  id="po-order-date"
                  type="date"
                  className={inputClass}
                  {...register("orderDate")}
                />
                <FieldError id="po-order-date-error" message={errors.orderDate?.message} />
              </div>
              <div>
                <label htmlFor="po-expected-date" className={labelClass}>
                  Expected delivery <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="po-expected-date"
                  type="date"
                  className={inputClass}
                  {...register("expectedDate")}
                />
                <FieldError id="po-expected-date-error" message={errors.expectedDate?.message} />
              </div>
              <div>
                <label htmlFor="po-notes" className={labelClass}>
                  Notes <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="po-notes"
                  type="text"
                  className={inputClass}
                  placeholder="Delivery instructions…"
                  {...register("notes")}
                />
                <FieldError id="po-notes-error" message={errors.notes?.message} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Line items</h3>
                {supplierId && unaddedPricedItems.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addAllPriced}
                  >
                    <Plus className="mr-1 size-4" aria-hidden="true" />
                    Add all {unaddedPricedItems.length} priced items
                  </Button>
                )}
              </div>

              {supplierId && unaddedPricedItems.length > 0 && (
                <div className="mb-3 rounded-md border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    From {suppliers.find((s) => s.id === supplierId)?.name ?? "supplier"}&apos;s
                    price list — prices prefilled:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unaddedPricedItems.slice(0, 12).map((p) => (
                      <Button
                        key={p.itemId}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addPricedItem(p.itemId)}
                      >
                        <Plus className="mr-1 size-3" aria-hidden="true" />
                        {p.itemName} · {formatINR(p.unitPrice)}
                      </Button>
                    ))}
                    {unaddedPricedItems.length > 12 && (
                      <span className="self-center text-xs text-muted-foreground">
                        +{unaddedPricedItems.length - 12} more — use “Add all”
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="mb-3 flex gap-2">
                <select
                  aria-label="Add item"
                  className={inputClass}
                  value={itemToAdd}
                  onChange={(e) => setItemToAdd(e.target.value)}
                >
                  <option value="">Add an item…</option>
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
                  onClick={() => {
                    const item = addableItems.find((i) => i.id === itemToAdd);
                    if (item) {
                      // Prefill from the supplier's price list when available.
                      const priced = (prefill ?? []).find((p) => p.itemId === item.id);
                      addLine(item.id, item.name, item.unitSymbol, priced?.unitPrice ?? 0);
                      setItemToAdd("");
                    }
                  }}
                >
                  <Plus className="mr-1 size-4" aria-hidden="true" />
                  Add
                </Button>
              </div>

              {lines.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No lines yet. Pick a supplier to prefill from their price list, or add items manually.
                </p>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => (
                    <div
                      key={line.itemId}
                      className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border p-3 sm:grid-cols-[1fr_7rem_7rem_auto_auto]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{line.itemName}</p>
                        <p className="text-xs text-muted-foreground">per {line.unitSymbol}</p>
                      </div>
                      <label className="flex items-center gap-1 text-sm">
                        <span className="sr-only">Quantity for {line.itemName}</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          aria-label={`Quantity for ${line.itemName}`}
                          className="h-10 w-24 rounded-md border border-input bg-background px-2 text-sm"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.itemId, { quantity: Number(e.target.value) })
                          }
                        />
                        <span className="text-xs text-muted-foreground">{line.unitSymbol}</span>
                      </label>
                      <label className="flex items-center gap-1 text-sm">
                        <span className="sr-only">Unit price for {line.itemName}</span>
                        <span className="text-muted-foreground">₹</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          aria-label={`Unit price for ${line.itemName}`}
                          className="h-10 w-24 rounded-md border border-input bg-background px-2 text-sm"
                          value={line.unitPrice || ""}
                          placeholder="0.00"
                          onChange={(e) =>
                            updateLine(line.itemId, { unitPrice: Number(e.target.value) })
                          }
                        />
                      </label>
                      <p className="text-sm font-medium tabular-nums">
                        {formatINR(line.quantity * line.unitPrice)}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        aria-label={`Remove ${line.itemName}`}
                        onClick={() => removeLine(line.itemId)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {linesError && (
                <p role="alert" className={errorClass}>
                  {linesError}
                </p>
              )}

              {lines.length > 0 && (
                <p className="mt-3 text-right text-base font-semibold tabular-nums">
                  Total: {formatINR(total)}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={requestClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy} className="min-h-[44px]">
                {busy ? "Creating…" : "Create draft"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {showDiscardConfirm && (
        <ConfirmDialog
          open
          title="Discard this purchase order?"
          description="Your entries will be lost."
          confirmLabel="Discard"
          onConfirm={onClose}
          onCancel={() => setShowDiscardConfirm(false)}
        />
      )}
    </>
  );
}
