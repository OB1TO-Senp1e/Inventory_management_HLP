import { useState } from "react";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useArchiveCategory,
  useArchiveLocation,
  useCategories,
  useLocations,
  type TaxonomyItem,
  type TaxonomyKind,
} from "./hooks";
import { TaxonomyDialog } from "./TaxonomyDialog";
import { DeleteTaxonomyDialog } from "./DeleteTaxonomyDialog";

const KIND_CONFIG = {
  category: {
    label: "Category",
    plural: "categories",
    addLabel: "Add category",
    emptyText: "No categories yet. Add your first category.",
    errorText: "Could not load categories.",
    useList: useCategories,
    useArchive: useArchiveCategory,
  },
  location: {
    label: "Storage location",
    plural: "storage locations",
    addLabel: "Add location",
    emptyText: "No storage locations yet. Add your first location.",
    errorText: "Could not load storage locations.",
    useList: useLocations,
    useArchive: useArchiveLocation,
  },
} as const;

type DialogState =
  | { mode: "create" }
  | { mode: "edit"; entry: TaxonomyItem }
  | null;

export interface TaxonomySectionProps {
  kind: TaxonomyKind;
}

/**
 * Management section for one taxonomy kind (categories or storage
 * locations): list with create / rename / archive / delete. Delete loads
 * the referencing-item count first and is blocked (with an archive offer)
 * while the entry is in use. Every state — loading skeleton, empty, error
 * with retry — is rendered; destructive actions confirm.
 */
export function TaxonomySection({ kind }: TaxonomySectionProps) {
  const config = KIND_CONFIG[kind];
  const listQuery = config.useList();
  const archiveMutation = config.useArchive();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [archiveTarget, setArchiveTarget] = useState<TaxonomyItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaxonomyItem | null>(null);

  const items = listQuery.data ?? [];

  return (
    <section aria-label={config.plural}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? config.label.toLowerCase() : config.plural}
        </p>
        <Button
          type="button"
          size="lg"
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus aria-hidden="true" />
          {config.addLabel}
        </Button>
      </div>

      {listQuery.isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      )}

      {listQuery.isError && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center"
          role="alert"
        >
          <p className="text-sm">{config.errorText}</p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-3"
            onClick={() => void listQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">{config.emptyText}</p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={() => setDialog({ mode: "create" })}
          >
            <Plus aria-hidden="true" />
            {config.addLabel}
          </Button>
        </div>
      )}

      {!listQuery.isLoading && !listQuery.isError && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border bg-card p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {entry.name}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="flex-1 sm:flex-none"
                  onClick={() => setDialog({ mode: "edit", entry })}
                  aria-label={`Edit ${entry.name}`}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="flex-1 sm:flex-none"
                  onClick={() => setArchiveTarget(entry)}
                  aria-label={`Archive ${entry.name}`}
                >
                  <Archive aria-hidden="true" />
                  Archive
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="flex-1 text-destructive sm:flex-none"
                  onClick={() => setDeleteTarget(entry)}
                  aria-label={`Delete ${entry.name}`}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <TaxonomyDialog
          kind={kind}
          entry={dialog.mode === "edit" ? dialog.entry : null}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title={`Archive ${config.label.toLowerCase()}?`}
        description={
          archiveTarget
            ? `“${archiveTarget.name}” will be hidden from pickers but kept for history.`
            : ""
        }
        confirmLabel={archiveMutation.isPending ? "Archiving…" : "Archive"}
        onConfirm={() => {
          if (archiveTarget) {
            archiveMutation.mutate(archiveTarget.id, {
              onSuccess: () => setArchiveTarget(null),
            });
          }
        }}
        onCancel={() => setArchiveTarget(null)}
      />

      {deleteTarget && (
        <DeleteTaxonomyDialog
          kind={kind}
          entry={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
