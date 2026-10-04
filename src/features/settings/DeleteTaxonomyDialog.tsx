import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useArchiveCategory,
  useArchiveLocation,
  useDeleteCategory,
  useDeleteLocation,
  useTaxonomyUsage,
  type TaxonomyItem,
  type TaxonomyKind,
} from "./hooks";

const KIND_LABEL: Record<TaxonomyKind, string> = {
  category: "Category",
  location: "Storage location",
};

export interface DeleteTaxonomyDialogProps {
  kind: TaxonomyKind;
  entry: TaxonomyItem;
  onClose: () => void;
}

/**
 * Delete dialog for one taxonomy entry. Loads the referencing-item count
 * first: when the entry is still in use, the hard delete is blocked and the
 * dialog offers archiving instead (the database RESTRICT is the final
 * enforcer; the API pre-check produces the friendly message).
 */
export function DeleteTaxonomyDialog({
  kind,
  entry,
  onClose,
}: DeleteTaxonomyDialogProps) {
  const label = KIND_LABEL[kind];
  const usageQuery = useTaxonomyUsage(kind, entry.id);
  const deleteCategory = useDeleteCategory();
  const deleteLocation = useDeleteLocation();
  const archiveCategory = useArchiveCategory();
  const archiveLocation = useArchiveLocation();

  const deleteMutation = kind === "category" ? deleteCategory : deleteLocation;
  const archiveMutation =
    kind === "category" ? archiveCategory : archiveLocation;
  const busy = deleteMutation.isPending || archiveMutation.isPending;

  const usage = usageQuery.data;
  const inUse = typeof usage === "number" && usage > 0;

  const handleDelete = () => {
    deleteMutation.mutate(entry.id, { onSuccess: onClose });
  };

  const handleArchive = () => {
    archiveMutation.mutate(entry.id, { onSuccess: onClose });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-taxonomy-title"
      aria-describedby="delete-taxonomy-description"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="delete-taxonomy-title"
            className="text-lg font-semibold tracking-tight"
          >
            Delete {label.toLowerCase()}?
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

        <div id="delete-taxonomy-description" className="mt-2 text-sm">
          {usageQuery.isLoading && (
            <p className="text-muted-foreground" aria-busy="true">
              Checking whether any items use “{entry.name}”…
            </p>
          )}
          {usageQuery.isError && (
            <p role="alert" className="text-destructive">
              Could not check usage for “{entry.name}”. Deletion is disabled
              for safety — you can archive it instead.
            </p>
          )}
          {!usageQuery.isLoading && !usageQuery.isError && inUse && (
            <p className="text-muted-foreground">
              “{entry.name}” is still used by{" "}
              <strong className="text-foreground">
                {usage} item{usage === 1 ? "" : "s"}
              </strong>
              , so it cannot be deleted. Archive it instead — archived{" "}
              {kind === "category" ? "categories" : "locations"} stay in
              history but are hidden from pickers.
            </p>
          )}
          {!usageQuery.isLoading && !usageQuery.isError && !inUse && (
            <p className="text-muted-foreground">
              Delete “{entry.name}” permanently? No items use it, so this is
              safe. This cannot be undone.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          {inUse || usageQuery.isError ? (
            <Button
              type="button"
              size="lg"
              onClick={handleArchive}
              disabled={busy}
            >
              {busy ? "Archiving…" : "Archive instead"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              onClick={handleDelete}
              disabled={busy || usageQuery.isLoading}
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
