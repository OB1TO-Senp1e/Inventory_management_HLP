import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/features/auth/useAuth";
import { useCreateSupplier, useSupplier, useUpdateSupplier } from "./hooks";
import { createSupplierSchema, type CreateSupplierInput } from "@/schemas/supplier";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";

const errorClass = "mt-1 text-sm text-destructive";

const optionalHint = (
  <span className="font-normal text-muted-foreground"> (optional)</span>
);

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

export interface SupplierDialogProps {
  /** Null = create mode; an id = edit mode. */
  supplierId: string | null;
  onClose: () => void;
}

/**
 * Create/edit dialog for suppliers. Create mode uses blank defaults; edit
 * mode loads the supplier via `useSupplier`. Unsaved changes are guarded:
 * closing a dirty form (Cancel, X, overlay, Escape) asks for confirmation
 * first.
 */
export function SupplierDialog({ supplierId, onClose }: SupplierDialogProps) {
  const { profile } = useAuth();
  const isEdit = supplierId !== null;
  const { data: editingSupplier, isLoading: isLoadingSupplier } =
    useSupplier(supplierId);
  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  type FormValues = Omit<CreateSupplierInput, "restaurantId">;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createSupplierSchema.omit({ restaurantId: true })),
    defaultValues: {
      name: "",
      contactPerson: undefined,
      phone: undefined,
      email: undefined,
      address: undefined,
      gstin: undefined,
      notes: undefined,
    },
  });

  // Populate the form once the edited supplier loads.
  useEffect(() => {
    if (isEdit && editingSupplier) {
      reset({
        name: editingSupplier.name,
        contactPerson: editingSupplier.contactPerson ?? undefined,
        phone: editingSupplier.phone ?? undefined,
        email: editingSupplier.email ?? undefined,
        address: editingSupplier.address ?? undefined,
        gstin: editingSupplier.gstin ?? undefined,
        notes: editingSupplier.notes ?? undefined,
      });
    }
  }, [isEdit, editingSupplier, reset]);

  // Focus the name field when the dialog opens.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const nameField = register("name");

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

  const onSubmit = (values: FormValues) => {
    if (!profile) {
      return;
    }
    if (isEdit && supplierId) {
      updateMutation.mutate(
        { id: supplierId, input: values },
        { onSuccess: () => onClose() },
      );
    } else {
      createMutation.mutate(values, { onSuccess: () => onClose() });
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-dialog-title"
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <h2
              id="supplier-dialog-title"
              className="text-xl font-semibold tracking-tight"
            >
              {isEdit ? "Edit supplier" : "Add supplier"}
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

          {isEdit && isLoadingSupplier ? (
            <div
              className="mt-6 space-y-3"
              aria-busy="true"
              aria-label="Loading supplier"
            >
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
                <label htmlFor="supplier-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="supplier-name"
                  type="text"
                  autoComplete="off"
                  aria-invalid={errors.name ? "true" : undefined}
                  aria-describedby={errors.name ? "supplier-name-error" : undefined}
                  className={inputClass}
                  {...nameField}
                  ref={(el) => {
                    nameField.ref(el);
                    nameRef.current = el;
                  }}
                />
                <FieldError
                  id="supplier-name-error"
                  message={errors.name?.message}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="supplier-contact" className={labelClass}>
                    Contact person{optionalHint}
                  </label>
                  <input
                    id="supplier-contact"
                    type="text"
                    autoComplete="off"
                    aria-invalid={errors.contactPerson ? "true" : undefined}
                    aria-describedby={
                      errors.contactPerson
                        ? "supplier-contact-error"
                        : undefined
                    }
                    className={inputClass}
                    {...register("contactPerson")}
                  />
                  <FieldError
                    id="supplier-contact-error"
                    message={errors.contactPerson?.message}
                  />
                </div>

                <div>
                  <label htmlFor="supplier-phone" className={labelClass}>
                    Phone{optionalHint}
                  </label>
                  <input
                    id="supplier-phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="+91 98765 43210"
                    aria-invalid={errors.phone ? "true" : undefined}
                    aria-describedby={
                      errors.phone ? "supplier-phone-error" : undefined
                    }
                    className={inputClass}
                    {...register("phone")}
                  />
                  <FieldError
                    id="supplier-phone-error"
                    message={errors.phone?.message}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="supplier-email" className={labelClass}>
                  Email{optionalHint}
                </label>
                <input
                  id="supplier-email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={errors.email ? "true" : undefined}
                  aria-describedby={
                    errors.email ? "supplier-email-error" : undefined
                  }
                  className={inputClass}
                  {...register("email")}
                />
                <FieldError
                  id="supplier-email-error"
                  message={errors.email?.message}
                />
              </div>

              <div>
                <label htmlFor="supplier-address" className={labelClass}>
                  Address{optionalHint}
                </label>
                <textarea
                  id="supplier-address"
                  rows={2}
                  aria-invalid={errors.address ? "true" : undefined}
                  aria-describedby={
                    errors.address ? "supplier-address-error" : undefined
                  }
                  className={`${inputClass} min-h-11 py-2`}
                  {...register("address")}
                />
                <FieldError
                  id="supplier-address-error"
                  message={errors.address?.message}
                />
              </div>

              <div>
                <label htmlFor="supplier-gstin" className={labelClass}>
                  GSTIN{optionalHint}
                </label>
                <input
                  id="supplier-gstin"
                  type="text"
                  autoComplete="off"
                  inputMode="text"
                  placeholder="27ABCDE1234F1Z5"
                  aria-invalid={errors.gstin ? "true" : undefined}
                  aria-describedby={
                    errors.gstin ? "supplier-gstin-error" : undefined
                  }
                  className={`${inputClass} uppercase`}
                  {...register("gstin")}
                />
                <FieldError
                  id="supplier-gstin-error"
                  message={errors.gstin?.message}
                />
              </div>

              <div>
                <label htmlFor="supplier-notes" className={labelClass}>
                  Notes{optionalHint}
                </label>
                <textarea
                  id="supplier-notes"
                  rows={2}
                  aria-invalid={errors.notes ? "true" : undefined}
                  aria-describedby={
                    errors.notes ? "supplier-notes-error" : undefined
                  }
                  className={`${inputClass} min-h-11 py-2`}
                  {...register("notes")}
                />
                <FieldError
                  id="supplier-notes-error"
                  message={errors.notes?.message}
                />
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
                <Button type="submit" size="lg" disabled={busy || !profile}>
                  {busy
                    ? isEdit
                      ? "Saving…"
                      : "Adding…"
                    : isEdit
                      ? "Save changes"
                      : "Add supplier"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title="Discard unsaved changes?"
        description="Your changes to this supplier will be lost."
        confirmLabel="Discard"
        destructive
        onConfirm={onClose}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
