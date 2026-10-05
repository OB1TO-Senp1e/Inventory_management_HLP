import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { useCurrentOutlet, useOutlets } from "@/features/outlets/hooks";
import { useTransferStock } from "./hooks";
import { listBatches } from "@/api/stock";
import { useReceivableItems } from "@/features/stock/hooks";
import { transferStockSchema, type TransferStockInput } from "@/schemas/transfer";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

/**
 * Transfers page (V2-07, owner/manager only via the route guard). Moves
 * stock from the caller's current outlet to another outlet of the same
 * restaurant, atomically (transfer_stock RPC posts paired movements).
 *
 * Flow: pick destination → item → quantity (+ optional batch/notes) →
 * confirm dialog → done. The source is always the current outlet and is
 * shown read-only; the RPC enforces on-hand stock strictly.
 */
export function TransfersPage() {
  const { profile } = useAuth();
  const currentOutlet = useCurrentOutlet();
  const { data: outlets } = useOutlets();
  const { items: receivableItems } = useReceivableItems();
  const transferMutation = useTransferStock();
  const { error: showError } = useToast();
  const [confirming, setConfirming] = useState<TransferStockInput | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransferStockInput>({
    resolver: zodResolver(transferStockSchema),
    defaultValues: {
      toOutletId: "",
      itemId: "",
      quantity: undefined as unknown as number,
      batchNo: null,
      notes: null,
    },
  });

  const selectedItemId = watch("itemId");
  const selectedOutletId = watch("toOutletId");

  const { data: batches } = useQuery({
    queryKey: ["transfer-batches", selectedItemId],
    queryFn: () => listBatches({ itemId: selectedItemId }),
    enabled: !!selectedItemId,
  });

  const destinations = useMemo(
    () => (outlets ?? []).filter((o) => o.id !== currentOutlet?.id),
    [outlets, currentOutlet],
  );
  const destinationName =
    destinations.find((o) => o.id === selectedOutletId)?.name ?? "";
  const itemName =
    receivableItems.find((i) => i.id === selectedItemId)?.name ?? "";

  const onSubmit = handleSubmit((values) => {
    if (!currentOutlet) {
      showError("No current outlet. Try reloading the page.");
      return;
    }
    setConfirming(values);
  });

  const doTransfer = () => {
    if (!confirming) {
      return;
    }
    transferMutation.mutate(confirming, {
      onSuccess: () => {
        setConfirming(null);
        reset();
      },
      onError: () => setConfirming(null),
    });
  };

  return (
    <div>
      <PageHeader
        title="Transfers"
        description={
          currentOutlet
            ? `Move stock from ${currentOutlet.name} to another outlet.`
            : "Move stock between outlets."
        }
      />

      {!currentOutlet && (
        <p className="rounded-md border border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          No outlet selected. Reload the page to pick up your outlet, then try again.
        </p>
      )}

      <form
        onSubmit={onSubmit}
        className="max-w-xl space-y-5 rounded-lg border p-4 sm:p-6"
      >
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2.5 text-sm">
          <Building2 aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>
            From: <strong>{currentOutlet?.name ?? "…"}</strong>
            <span className="text-muted-foreground"> (your current outlet)</span>
          </span>
        </div>

        <div>
          <label htmlFor="transfer-to" className={labelClass}>
            To outlet
          </label>
          <select
            id="transfer-to"
            className={inputClass}
            disabled={isSubmitting}
            {...register("toOutletId")}
          >
            <option value="">Select destination…</option>
            {destinations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {errors.toOutletId && (
            <p role="alert" className={errorClass}>
              {errors.toOutletId.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="transfer-item" className={labelClass}>
            Item
          </label>
          <select
            id="transfer-item"
            className={inputClass}
            disabled={isSubmitting}
            {...register("itemId")}
          >
            <option value="">Select item…</option>
            {receivableItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {errors.itemId && (
            <p role="alert" className={errorClass}>
              {errors.itemId.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="transfer-qty" className={labelClass}>
            Quantity
          </label>
          <input
            id="transfer-qty"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className={inputClass}
            disabled={isSubmitting}
            {...register("quantity", { valueAsNumber: true })}
          />
          {errors.quantity && (
            <p role="alert" className={errorClass}>
              {errors.quantity.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="transfer-batch" className={labelClass}>
            Batch <span className="text-muted-foreground">(optional)</span>
          </label>
          <select
            id="transfer-batch"
            className={inputClass}
            disabled={isSubmitting || !selectedItemId}
            {...register("batchNo")}
          >
            <option value="">Whole stock (no specific batch)</option>
            {(batches ?? [])
              .filter((b) => b.quantity > 0)
              .map((b) => (
                <option key={b.batchNo} value={b.batchNo}>
                  {b.batchNo} — {b.quantity} on hand
                  {b.earliestExpiry ? ` (expires ${b.earliestExpiry})` : ""}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Picking a batch moves that batch's stock and preserves its expiry date.
          </p>
        </div>

        <div>
          <label htmlFor="transfer-notes" className={labelClass}>
            Notes <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="transfer-notes"
            type="text"
            autoComplete="off"
            placeholder="e.g. weekly rebalance"
            className={inputClass}
            disabled={isSubmitting}
            {...register("notes")}
          />
          {errors.notes && (
            <p role="alert" className={errorClass}>
              {errors.notes.message}
            </p>
          )}
        </div>

        <div className={cn("flex justify-end", "pt-1")}>
          <Button type="submit" disabled={isSubmitting || !currentOutlet}>
            Review transfer
          </Button>
        </div>
      </form>

      {confirming && (
        <ConfirmDialog
          open
          title="Confirm transfer"
          description={
            `Move ${confirming.quantity} of ${itemName} ` +
            `from ${currentOutlet?.name} to ${destinationName}` +
            (confirming.batchNo ? ` (batch ${confirming.batchNo})` : "") +
            "?"
          }
          confirmLabel="Transfer stock"
          onConfirm={doTransfer}
          onCancel={() => setConfirming(null)}
        />
      )}

      <p className="mt-4 max-w-xl text-xs text-muted-foreground">
        Signed in as {profile?.role}. Transfers are atomic: both movements post
        together or neither does, and you cannot transfer more than the source
        outlet holds.
      </p>
    </div>
  );
}

// Re-exported for the lazy route chunk.
export default TransfersPage;
