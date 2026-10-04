import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatNumber } from "@/lib/format";
import {
  createOpeningBalanceSchema,
  type CreateOpeningBalanceInput,
} from "@/schemas/stock";
import { useCreateOpeningBalance, useCurrentStock } from "./stockHooks";
import type { Item } from "@/api/items";

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

export interface OpeningBalanceDialogProps {
  item: Item;
  onClose: () => void;
}

/**
 * Opening-balance dialog (P2-01): posts the one-time opening stock for an
 * item via the `create_opening_balance` RPC. Owner/manager only — the
 * ItemsPage hides the action from staff, and the RPC enforces the role.
 *
 * Shows the current derived stock first: posting a balance when stock
 * already exists is usually a mistake (the RPC rejects true duplicates, but
 * a heads-up here prevents confusion).
 */
export function OpeningBalanceDialog({ item, onClose }: OpeningBalanceDialogProps) {
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const quantityRef = useRef<HTMLInputElement | null>(null);
  const createOpeningBalance = useCreateOpeningBalance();
  const currentStock = useCurrentStock(item.id);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<CreateOpeningBalanceInput>({
    resolver: zodResolver(createOpeningBalanceSchema),
    defaultValues: { itemId: item.id, quantity: undefined, unitCost: 0 },
  });

  useEffect(() => {
    quantityRef.current?.focus();
  }, []);

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

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const quantityField = register("quantity", { valueAsNumber: true });
  const unitCostField = register("unitCost", { valueAsNumber: true });
  const busy = isSubmitting || createOpeningBalance.isPending;

  const onSubmit = (values: CreateOpeningBalanceInput) => {
    createOpeningBalance.mutate(
      { itemId: item.id, quantity: values.quantity, unitCost: values.unitCost },
      { onSuccess: onClose },
    );
  };

  const existingQty = currentStock.data?.quantity;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="opening-balance-dialog-title"
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <h2
              id="opening-balance-dialog-title"
              className="text-xl font-semibold tracking-tight"
            >
              Set opening balance
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

          <p className="mt-2 text-sm text-muted-foreground">
            {item.name} · current stock:{" "}
            {currentStock.isLoading ? (
              "…"
            ) : existingQty !== undefined && existingQty !== null ? (
              <strong>
                {formatNumber(existingQty)} {item.unitSymbol}
              </strong>
            ) : (
              <strong>none yet</strong>
            )}
          </p>
          {existingQty !== undefined &&
            existingQty !== null &&
            existingQty !== 0 && (
              <p role="note" className="mt-2 text-sm text-amber-600">
                This item already has stock movements. An opening balance can
                only be set once — use a stock count to correct stock instead.
              </p>
            )}

          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="mt-6 space-y-4"
          >
            <div>
              <label htmlFor="opening-quantity" className={labelClass}>
                Quantity ({item.unitSymbol})
              </label>
              <input
                id="opening-quantity"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                aria-invalid={errors.quantity ? "true" : undefined}
                aria-describedby={
                  errors.quantity ? "opening-quantity-error" : undefined
                }
                className={inputClass}
                disabled={busy}
                {...quantityField}
                ref={(el) => {
                  quantityField.ref(el);
                  quantityRef.current = el;
                }}
              />
              <FieldError
                id="opening-quantity-error"
                message={errors.quantity?.message}
              />
            </div>

            <div>
              <label htmlFor="opening-unit-cost" className={labelClass}>
                Unit cost (₹ per {item.unitSymbol})
              </label>
              <input
                id="opening-unit-cost"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                aria-invalid={errors.unitCost ? "true" : undefined}
                aria-describedby={
                  errors.unitCost ? "opening-unit-cost-error" : undefined
                }
                className={inputClass}
                disabled={busy}
                {...unitCostField}
              />
              <FieldError
                id="opening-unit-cost-error"
                message={errors.unitCost?.message}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This seeds the item&apos;s average cost per {item.unitSymbol}.
                Future receipts recalculate it automatically.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={requestClose}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" className="h-11" disabled={busy}>
                {busy ? "Posting…" : "Post opening balance"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title="Discard unsaved changes?"
        description="You have unsaved changes. They will be lost."
        confirmLabel="Discard"
        onConfirm={onClose}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
