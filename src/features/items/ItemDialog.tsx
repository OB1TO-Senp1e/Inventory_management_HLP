import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/features/auth/useAuth";
import {
  useCreateItem,
  useItem,
  useItemLookups,
  useUpdateItem,
} from "./hooks";
import {
  createItemSchema,
  type CreateItemInput,
} from "@/schemas/item";

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

export interface ItemDialogProps {
  /** Null = create mode; an id = edit mode. */
  itemId: string | null;
  onClose: () => void;
}

/**
 * Create/edit dialog for items. Create mode uses blank defaults; edit mode
 * loads the item via `useItem`. Unsaved changes are guarded: closing a dirty
 * form (Cancel, X, overlay, Escape) asks for confirmation first.
 */
export function ItemDialog({ itemId, onClose }: ItemDialogProps) {
  const { profile } = useAuth();
  const isEdit = itemId !== null;
  const { data: editingItem, isLoading: isLoadingItem } = useItem(itemId);
  const lookups = useItemLookups();
  const createMutation = useCreateItem();
  const updateMutation = useUpdateItem();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  type FormValues = Omit<CreateItemInput, "restaurantId">;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(
      createItemSchema.omit({ restaurantId: true }),
    ),
    defaultValues: {
      name: "",
      categoryId: null,
      unitId: "",
      storageLocationId: null,
      parLevel: 0,
      reorderPoint: 0,
    },
  });

  // Populate the form once the edited item loads.
  useEffect(() => {
    if (isEdit && editingItem) {
      reset({
        name: editingItem.name,
        categoryId: editingItem.categoryId,
        unitId: editingItem.unitId,
        storageLocationId: editingItem.storageLocationId,
        parLevel: editingItem.parLevel,
        reorderPoint: editingItem.reorderPoint,
      });
    }
  }, [isEdit, editingItem, reset]);

  // Focus the name field when the dialog opens.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const nameField = register("name");
  const selectedUnitId = watch("unitId");
  const selectedUnit = lookups.units.find((u) => u.id === selectedUnitId);

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  // Warn on tab close / refresh with unsaved changes.
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

  const mutationPending =
    createMutation.isPending || updateMutation.isPending;
  const busy = isSubmitting || mutationPending;
  const lookupsFailed = lookups.isError;

  const onSubmit = (values: FormValues) => {
    if (!profile) {
      return;
    }
    if (isEdit && itemId) {
      updateMutation.mutate(
        { id: itemId, input: values },
        { onSuccess: () => onClose() },
      );
    } else {
      createMutation.mutate(values, { onSuccess: () => onClose() });
    }
  };

  const toNullable = (value: string): string | null =>
    value === "" ? null : value;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-dialog-title"
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <h2
              id="item-dialog-title"
              className="text-xl font-semibold tracking-tight"
            >
              {isEdit ? "Edit item" : "Add item"}
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

          {isEdit && isLoadingItem ? (
            <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading item">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-md bg-muted"
                />
              ))}
            </div>
          ) : (
            <form
              onSubmit={handleSubmit(onSubmit)}
              noValidate
              className="mt-6 space-y-4"
            >
              <div>
                <label htmlFor="item-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="item-name"
                  type="text"
                  autoComplete="off"
                  aria-invalid={errors.name ? "true" : undefined}
                  aria-describedby={errors.name ? "item-name-error" : undefined}
                  className={inputClass}
                  {...nameField}
                  ref={(el) => {
                    nameField.ref(el);
                    nameRef.current = el;
                  }}
                />
                <FieldError id="item-name-error" message={errors.name?.message} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="item-category" className={labelClass}>
                    Category <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <select
                    id="item-category"
                    aria-invalid={errors.categoryId ? "true" : undefined}
                    aria-describedby={errors.categoryId ? "item-category-error" : undefined}
                    className={inputClass}
                    {...register("categoryId", { setValueAs: toNullable })}
                  >
                    <option value="">No category</option>
                    {lookups.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id="item-category-error" message={errors.categoryId?.message} />
                </div>

                <div>
                  <label htmlFor="item-unit" className={labelClass}>
                    Unit
                  </label>
                  <select
                    id="item-unit"
                    aria-invalid={errors.unitId ? "true" : undefined}
                    aria-describedby={errors.unitId ? "item-unit-error" : undefined}
                    className={inputClass}
                    disabled={lookups.isLoading}
                    {...register("unitId")}
                  >
                    <option value="">
                      {lookups.isLoading ? "Loading units…" : "Choose a unit"}
                    </option>
                    {lookups.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.symbol})
                      </option>
                    ))}
                  </select>
                  <FieldError id="item-unit-error" message={errors.unitId?.message} />
                </div>
              </div>

              <div>
                <label htmlFor="item-location" className={labelClass}>
                  Storage location <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <select
                  id="item-location"
                  aria-invalid={errors.storageLocationId ? "true" : undefined}
                  aria-describedby={errors.storageLocationId ? "item-location-error" : undefined}
                  className={inputClass}
                  {...register("storageLocationId", { setValueAs: toNullable })}
                >
                  <option value="">No fixed location</option>
                  {lookups.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <FieldError
                  id="item-location-error"
                  message={errors.storageLocationId?.message}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="item-par" className={labelClass}>
                    Par level
                    {selectedUnit && (
                      <span className="font-normal text-muted-foreground">
                        {" "}({selectedUnit.symbol})
                      </span>
                    )}
                  </label>
                  <input
                    id="item-par"
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    aria-invalid={errors.parLevel ? "true" : undefined}
                    aria-describedby={errors.parLevel ? "item-par-error" : undefined}
                    className={inputClass}
                    {...register("parLevel", { valueAsNumber: true })}
                  />
                  <FieldError id="item-par-error" message={errors.parLevel?.message} />
                </div>

                <div>
                  <label htmlFor="item-reorder" className={labelClass}>
                    Reorder point
                    {selectedUnit && (
                      <span className="font-normal text-muted-foreground">
                        {" "}({selectedUnit.symbol})
                      </span>
                    )}
                  </label>
                  <input
                    id="item-reorder"
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    aria-invalid={errors.reorderPoint ? "true" : undefined}
                    aria-describedby={errors.reorderPoint ? "item-reorder-error" : undefined}
                    className={inputClass}
                    {...register("reorderPoint", { valueAsNumber: true })}
                  />
                  <FieldError
                    id="item-reorder-error"
                    message={errors.reorderPoint?.message}
                  />
                </div>
              </div>

              {lookupsFailed && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p role="alert">
                    Could not load categories, units or locations.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="mt-2"
                    onClick={() => lookups.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              )}

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
                <Button type="submit" size="lg" disabled={busy || !profile}>
                  {busy
                    ? isEdit
                      ? "Saving…"
                      : "Adding…"
                    : isEdit
                      ? "Save changes"
                      : "Add item"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title="Discard unsaved changes?"
        description="Your changes to this item will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={onClose}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
