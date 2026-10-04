import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Download,
  FileUp,
  Package,
  PackagePlus,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  CsvImportDialog,
  type ValidatedRow,
} from "@/components/CsvImportDialog";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { formatNumber } from "@/lib/format";
import type { ItemSortColumn } from "@/schemas/item";
import type { Item } from "@/api/items";
import {
  useExportItems,
  useImportItems,
} from "@/features/importExport/hooks";
import {
  ITEM_CSV_COLUMNS,
  resolveItemRow,
  type ItemCsvInput,
} from "@/features/importExport/itemCsv";
import {
  useArchiveItem,
  useItemLookups,
  useItems,
} from "./hooks";
import { ItemDialog } from "./ItemDialog";

const PAGE_SIZE = 20;

const inputClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type StatusFilter = "active" | "archived";
type DialogState = { mode: "create" } | { mode: "edit"; id: string } | null;

function SortButton({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
}: {
  label: string;
  column: ItemSortColumn;
  sortColumn: ItemSortColumn;
  sortDirection: "asc" | "desc";
  onSort: (column: ItemSortColumn) => void;
}) {
  const active = sortColumn === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="inline-flex h-11 items-center gap-1 font-medium hover:text-foreground"
      aria-label={`Sort by ${label} ${active && sortDirection === "asc" ? "descending" : "ascending"}`}
    >
      {label}
      {active ? (
        sortDirection === "asc" ? (
          <ArrowUp className="size-4" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-4" aria-hidden="true" />
        )
      ) : (
        <ChevronsUpDown className="size-4 opacity-40" aria-hidden="true" />
      )}
    </button>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
          : "inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
      }
    >
      {active ? "Active" : "Archived"}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading items">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border bg-muted/50"
        />
      ))}
    </div>
  );
}

/**
 * Items list (P1-01). Server-side search, category/status filters, sortable
 * columns, pagination. Cards on mobile, table on desktop (no horizontal
 * scroll at 360px). Create/edit/archive are hidden from staff — and blocked
 * by RLS regardless.
 */
export function ItemsPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === "owner" || profile?.role === "manager";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortColumn, setSortColumn] = useState<ItemSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [archiveTarget, setArchiveTarget] = useState<Item | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Debounce the search box so we don't query on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(
    () => ({
      search: search === "" ? undefined : search,
      categoryId: categoryId === "" ? undefined : categoryId,
      active: statusFilter === "active",
      sortColumn,
      sortDirection,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, categoryId, statusFilter, sortColumn, sortDirection, page],
  );

  const itemsQuery = useItems(filters);
  const lookups = useItemLookups();
  const archiveMutation = useArchiveItem();
  const exportItems = useExportItems();
  const importItems = useImportItems();

  /** Validate CSV records against the item schema (lookups resolved by name). */
  const validateRecords = useCallback(
    (records: Record<string, string>[]): ValidatedRow<ItemCsvInput>[] =>
      records.map((raw, i) => ({
        index: i + 1,
        raw,
        result: resolveItemRow(raw, {
          categories: lookups.categories,
          locations: lookups.locations,
          units: lookups.units,
        }),
      })),
    [lookups.categories, lookups.locations, lookups.units],
  );

  const items = itemsQuery.data?.items ?? [];
  const total = itemsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  const handleSort = (column: ItemSortColumn) => {
    if (column === sortColumn) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setPage(1);
  };

  const handleCategoryChange = (value: string) => {
    setCategoryId(value);
    setPage(1);
  };

  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setCategoryId("");
    setStatusFilter("active");
    setPage(1);
  };

  const hasActiveFilters =
    search !== "" || categoryId !== "" || statusFilter !== "active";

  const confirmArchive = () => {
    if (!archiveTarget) {
      return;
    }
    archiveMutation.mutate(archiveTarget.id, {
      onSuccess: () => setArchiveTarget(null),
    });
  };

  const renderActions = (item: Item) => {
    if (!canManage) {
      return null;
    }
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          onClick={() => setDialog({ mode: "edit", id: item.id })}
          aria-label={`Edit ${item.name}`}
        >
          <Pencil />
        </Button>
        {item.active && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-destructive hover:text-destructive"
            onClick={() => setArchiveTarget(item)}
            aria-label={`Archive ${item.name}`}
          >
            <Trash2 />
          </Button>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Items"
        description="Ingredients and supplies. Quantities are shown in each item's base unit."
        actions={
          canManage ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => exportItems.mutate()}
                disabled={exportItems.isPending}
              >
                <Download aria-hidden="true" />
                Export
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportOpen(true)}
              >
                <FileUp aria-hidden="true" />
                Import
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={() => setDialog({ mode: "create" })}
              >
                <PackagePlus aria-hidden="true" />
                Add item
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="items-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search items…"
            aria-label="Search items"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <div className="flex gap-3">
          <select
            id="items-category-filter"
            aria-label="Filter by category"
            value={categoryId}
            onChange={(event) => handleCategoryChange(event.target.value)}
            className={`${inputClass} min-w-0 flex-1 sm:flex-none`}
          >
            <option value="">All categories</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            id="items-status-filter"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) =>
              handleStatusChange(event.target.value as StatusFilter)
            }
            className={`${inputClass} flex-1 sm:flex-none`}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {itemsQuery.isLoading ? (
        <LoadingSkeleton />
      ) : itemsQuery.isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load items.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={() => itemsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <Package
            className="mx-auto size-10 text-muted-foreground"
            aria-hidden="true"
          />
          {hasActiveFilters ? (
            <>
              <p className="mt-3 font-medium">No items match your filters.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different search or clear the filters.
              </p>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="mt-4"
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <p className="mt-3 font-medium">
                No items yet — add your first item.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Items are the ingredients and supplies you track stock for.
              </p>
              {canManage && (
                <Button
                  type="button"
                  size="lg"
                  className="mt-4"
                  onClick={() => setDialog({ mode: "create" })}
                >
                  <PackagePlus aria-hidden="true" />
                  Add item
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Items — sortable by name, par level and reorder point
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th scope="col" aria-sort={sortColumn === "name" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="px-4 py-2">
                    <SortButton label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">Category</th>
                  <th scope="col" className="px-4 py-2 font-medium">Unit</th>
                  <th scope="col" aria-sort={sortColumn === "par_level" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="px-4 py-2">
                    <SortButton label="Par level" column="par_level" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  </th>
                  <th scope="col" aria-sort={sortColumn === "reorder_point" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="px-4 py-2">
                    <SortButton label="Reorder point" column="reorder_point" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  {canManage && (
                    <th scope="col" className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.categoryName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.unitSymbol}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatNumber(item.parLevel)}{" "}
                      <span className="text-muted-foreground">{item.unitSymbol}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatNumber(item.reorderPoint)}{" "}
                      <span className="text-muted-foreground">{item.unitSymbol}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={item.active} />
                    </td>
                    {canManage && (
                      <td className="px-4 py-1">{renderActions(item)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {item.categoryName ?? "No category"} · {item.unitName} (
                      {item.unitSymbol})
                    </p>
                  </div>
                  <StatusBadge active={item.active} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Par level</dt>
                    <dd className="tabular-nums">
                      {formatNumber(item.parLevel)} {item.unitSymbol}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reorder point</dt>
                    <dd className="tabular-nums">
                      {formatNumber(item.reorderPoint)} {item.unitSymbol}
                    </dd>
                  </div>
                </dl>
                {canManage && (
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      onClick={() => setDialog({ mode: "edit", id: item.id })}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                    {item.active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="flex-1 text-destructive"
                        onClick={() => setArchiveTarget(item)}
                      >
                        <Trash2 aria-hidden="true" />
                        Archive
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {formatNumber(showingFrom)}–{formatNumber(showingTo)} of{" "}
              {formatNumber(total)} items
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {dialog && (
        <ItemDialog
          itemId={dialog.mode === "edit" ? dialog.id : null}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive this item?"
        description={
          archiveTarget
            ? `“${archiveTarget.name}” will be hidden from the active list. Its history is kept.`
            : ""
        }
        confirmLabel="Archive item"
        destructive
        onConfirm={confirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <CsvImportDialog<ItemCsvInput>
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import items"
        description="Add many items at once from a CSV file. Every row is validated first — nothing is saved until you review the preview and confirm."
        templateFilename="items-template.csv"
        columns={ITEM_CSV_COLUMNS}
        lookupsStatus={
          lookups.isLoading ? "loading" : lookups.isError ? "error" : "ready"
        }
        onRetryLookups={lookups.refetch}
        validateRecords={validateRecords}
        importRows={(input) => importItems.mutateAsync(input)}
      />
    </div>
  );
}
