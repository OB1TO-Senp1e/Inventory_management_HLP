import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  updateTaxonomySchema,
  type UpdateTaxonomyInput,
} from "@/schemas/taxonomy";
import {
  useCreateCategory,
  useCreateLocation,
  useUpdateCategory,
  useUpdateLocation,
  type TaxonomyItem,
  type TaxonomyKind,
} from "./hooks";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

const KIND_LABEL: Record<TaxonomyKind, string> = {
  category: "Category",
  location: "Storage location",
};

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

export interface TaxonomyDialogProps {
  kind: TaxonomyKind;
  /** Null = create mode; an entry = edit mode. */
  entry: TaxonomyItem | null;
  onClose: () => void;
}

/**
 * Create/edit dialog for one taxonomy entry (categories, storage locations).
 * Unsaved changes are guarded like the item dialog (confirm on dirty close).
 */
export function TaxonomyDialog({ kind, entry, onClose }: TaxonomyDialogProps) {
  const isEdit = entry !== null;
  const label = KIND_LABEL[kind];
  const createCategory = useCreateCategory();
  const createLocation = useCreateLocation();
  const updateCategory = useUpdateCategory();
  const updateLocation = useUpdateLocation();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UpdateTaxonomyInput>({
    resolver: zodResolver(updateTaxonomySchema),
    defaultValues: { name: entry?.name ?? "" },
  });

  // Populate the form when editing; reset when switching entries.
  useEffect(() => {
    reset({ name: entry?.name ?? "" });
  }, [entry, reset]);

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

  const createMutation = kind === "category" ? createCategory : createLocation;
  const updateMutation = kind === "category" ? updateCategory : updateLocation;
  const busy = isSubmitting || createMutation.isPending || updateMutation.isPending;

  const onSubmit = (values: UpdateTaxonomyInput) => {
    if (isEdit && entry) {
      updateMutation.mutate(
        { id: entry.id, input: values },
        { onSuccess: onClose },
      );
    } else {
      createMutation.mutate(values, { onSuccess: onClose });
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="taxonomy-dialog-title"
      >
        <div
          className="absolute inset-0 bg-black/50"
          onClick={requestClose}
          aria-hidden="true"
        />
        <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
          <div className="flex items-start justify-between gap-4">
            <h2
              id="taxonomy-dialog-title"
              className="text-xl font-semibold tracking-tight"
            >
              {isEdit ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
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

          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="mt-6 space-y-4"
          >
            <div>
              <label htmlFor="taxonomy-name" className={labelClass}>
                Name
              </label>
              <input
                id="taxonomy-name"
                type="text"
                autoComplete="off"
                aria-invalid={errors.name ? "true" : undefined}
                aria-describedby={errors.name ? "taxonomy-name-error" : undefined}
                className={inputClass}
                disabled={busy}
                {...nameField}
                ref={(el) => {
                  nameField.ref(el);
                  nameRef.current = el;
                }}
              />
              <FieldError
                id="taxonomy-name-error"
                message={errors.name?.message}
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
              <Button type="submit" size="lg" disabled={busy}>
                {busy
                  ? isEdit
                    ? "Saving…"
                    : "Adding…"
                  : isEdit
                    ? "Save changes"
                    : `Add ${label.toLowerCase()}`}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        open={showDiscardConfirm}
        title="Discard unsaved changes?"
        description={`Your changes to this ${label.toLowerCase()} will be lost.`}
        confirmLabel="Discard"
        destructive
        onConfirm={onClose}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </>
  );
}
