import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { unitPriceSchema } from "@/schemas/price";
import { useUpsertPrice } from "./priceHooks";

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

const priceFormSchema = z.object({
  itemId: z.string().uuid("Choose an item."),
  unitPrice: unitPriceSchema,
});

type PriceFormValues = z.infer<typeof priceFormSchema>;

export interface PricedItem {
  itemId: string;
  itemName: string;
  itemUnit: string | null;
  unitPrice: number;
}

export interface AvailableItem {
  id: string;
  name: string;
  unitSymbol: string | null;
}

export interface PriceDialogProps {
  supplierId: string;
  supplierName: string;
  /** Null = add mode (item picker); otherwise edit the price for this item. */
  price: PricedItem | null;
  /** Active items this supplier has no price for yet (add mode). */
  availableItems: AvailableItem[];
  onClose: () => void;
}

/**
 * Add/edit dialog for a supplier's price list (P1-04). Add mode shows an
 * item picker (items without a price from this supplier); edit mode shows
 * the item name and the current price. Unsaved changes are guarded.
 */
export function PriceDialog({
  supplierId,
  supplierName,
  price,
  availableItems,
  onClose,
}: PriceDialogProps) {
  const isEdit = price !== null;
  const upsertMutation = useUpsertPrice();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const priceRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<PriceFormValues>({
    resolver: zodResolver(priceFormSchema),
    defaultValues: {
      itemId: price?.itemId ?? "",
      unitPrice: price?.unitPrice ?? ("" as unknown as number),
    },
  });

  useEffect(() => {
    priceRef.current?.focus();
  }, []);

  const priceField = register("unitPrice");

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !showDiscardConfirm) {
        requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, showDiscardConfirm]);

  const busy = isSubmitting || upsertMutation.isPending;

  const onSubmit = (values: PriceFormValues) => {
    upsertMutation.mutate(
      {
        supplierId,
        itemId: isEdit ? (price as PricedItem).itemId : values.itemId,
        unitPrice: values.unitPrice,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-dialog-title"
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="price-dialog-title"
                className="text-xl font-semibold tracking-tight"
              >
                {isEdit ? "Edit price" : "Add price"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {supplierName}
              </p>
            </div>
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

          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="mt-6 space-y-4"
          >
            {isEdit ? (
              <div>
                <span className={labelClass}>Item</span>
                <p className="text-sm font-medium">
                  {price.itemName}
                  {price.itemUnit ? ` (${price.itemUnit})` : ""}
                </p>
              </div>
            ) : (
              <div>
                <label htmlFor="price-item" className={labelClass}>
                  Item
                </label>
                {availableItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Every active item already has a price from this supplier.
                  </p>
                ) : (
                  <>
                    <select
                      id="price-item"
                      aria-invalid={errors.itemId ? "true" : undefined}
                      aria-describedby={
                        errors.itemId ? "price-item-error" : undefined
                      }
                      className={inputClass}
                      defaultValue=""
                      {...register("itemId")}
                    >
                      <option value="" disabled>
                        Choose an item…
                      </option>
                      {availableItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.unitSymbol ? ` (${item.unitSymbol})` : ""}
                        </option>
                      ))}
                    </select>
                    <FieldError
                      id="price-item-error"
                      message={errors.itemId?.message}
                    />
                  </>
                )}
              </div>
            )}

            <div>
              <label htmlFor="price-unit-price" className={labelClass}>
                Price per unit (₹)
              </label>
              <input
                id="price-unit-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                aria-invalid={errors.unitPrice ? "true" : undefined}
                aria-describedby={
                  errors.unitPrice ? "price-unit-price-error" : undefined
                }
                className={`${inputClass} tabular-nums`}
                {...priceField}
                ref={(el) => {
                  priceField.ref(el);
                  priceRef.current = el;
                }}
              />
              <FieldError
                id="price-unit-price-error"
                message={errors.unitPrice?.message}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Price per the item&apos;s base unit.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={requestClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="lg"
                disabled={
                  busy || (!isEdit && availableItems.length === 0)
                }
              >
                {busy ? "Saving…" : isEdit ? "Save price" : "Add price"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title="Discard unsaved changes?"
        description="Your changes to this price will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={onClose}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
