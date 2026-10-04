import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { formatNumber } from "@/lib/format";
import type { SupplierSortColumn } from "@/schemas/supplier";
import type { Supplier } from "@/api/suppliers";
import { useArchiveSupplier, useSuppliers } from "./hooks";
import { SupplierDialog } from "./SupplierDialog";

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
  column: SupplierSortColumn;
  sortColumn: SupplierSortColumn;
  sortDirection: "asc" | "desc";
  onSort: (column: SupplierSortColumn) => void;
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
    <div className="space-y-3" aria-busy="true" aria-label="Loading suppliers">
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
 * Suppliers list (P1-03). Server-side search, active/archived filter,
 * sortable columns, pagination. Cards on mobile, table on desktop (no
 * horizontal scroll at 360px). Create/edit/archive are hidden from staff —
 * and blocked by RLS regardless.
 */
export function SuppliersPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === "owner" || profile?.role === "manager";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortColumn, setSortColumn] =
    useState<SupplierSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [archiveTarget, setArchiveTarget] = useState<Supplier | null>(null);

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
      active: statusFilter === "active",
      sortColumn,
      sortDirection,
      page,
      pageSize: PAGE_SIZE,
    }),
    [search, statusFilter, sortColumn, sortDirection, page],
  );

  const suppliersQuery = useSuppliers(filters);
  const archiveMutation = useArchiveSupplier();

  const suppliers = suppliersQuery.data?.suppliers ?? [];
  const total = suppliersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  const handleSort = (column: SupplierSortColumn) => {
    if (column === sortColumn) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setPage(1);
  };

  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatusFilter("active");
    setPage(1);
  };

  const hasActiveFilters = search !== "" || statusFilter !== "active";

  const confirmArchive = () => {
    if (!archiveTarget) {
      return;
    }
    archiveMutation.mutate(archiveTarget.id, {
      onSuccess: () => setArchiveTarget(null),
    });
  };

  const renderActions = (supplier: Supplier) => {
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
          asChild
        >
          <Link
            to={`/suppliers/${supplier.id}/prices`}
            aria-label={`Price list for ${supplier.name}`}
            title="Price list"
          >
            <Tag />
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          onClick={() => setDialog({ mode: "edit", id: supplier.id })}
          aria-label={`Edit ${supplier.name}`}
        >
          <Pencil />
        </Button>
        {supplier.active && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-destructive hover:text-destructive"
            onClick={() => setArchiveTarget(supplier)}
            aria-label={`Archive ${supplier.name}`}
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
        title="Suppliers"
        description="The vendors you buy ingredients and supplies from."
        actions={
          canManage ? (
            <Button
              type="button"
              size="lg"
              onClick={() => setDialog({ mode: "create" })}
            >
              <Plus aria-hidden="true" />
              Add supplier
            </Button>
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
            id="suppliers-search"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search suppliers…"
            aria-label="Search suppliers"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <select
          id="suppliers-status-filter"
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) =>
            handleStatusChange(event.target.value as StatusFilter)
          }
          className={`${inputClass} sm:w-auto`}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {suppliersQuery.isLoading ? (
        <LoadingSkeleton />
      ) : suppliersQuery.isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load suppliers.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="mt-4"
            onClick={() => suppliersQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <Truck
            className="mx-auto size-10 text-muted-foreground"
            aria-hidden="true"
          />
          {hasActiveFilters ? (
            <>
              <p className="mt-3 font-medium">
                No suppliers match your filters.
              </p>
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
                No suppliers yet — add your first supplier.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Suppliers are the vendors you order stock from.
              </p>
              {canManage && (
                <Button
                  type="button"
                  size="lg"
                  className="mt-4"
                  onClick={() => setDialog({ mode: "create" })}
                >
                  <Plus aria-hidden="true" />
                  Add supplier
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
                Suppliers — sortable by name and date added
              </caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th
                    scope="col"
                    aria-sort={
                      sortColumn === "name"
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="px-4 py-2"
                  >
                    <SortButton
                      label="Name"
                      column="name"
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={handleSort}
                    />
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Contact
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Phone
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    GSTIN
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  {canManage && (
                    <th scope="col" className="px-4 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-medium">{supplier.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {supplier.contactPerson ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {supplier.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {supplier.gstin ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={supplier.active} />
                    </td>
                    {canManage && (
                      <td className="px-4 py-1">{renderActions(supplier)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {suppliers.map((supplier) => (
              <li
                key={supplier.id}
                className="rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{supplier.name}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {supplier.contactPerson ?? "No contact person"}
                      {supplier.phone ? ` · ${supplier.phone}` : ""}
                    </p>
                  </div>
                  <StatusBadge active={supplier.active} />
                </div>
                {(supplier.email ?? supplier.gstin) && (
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {supplier.email && (
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">Email</dt>
                        <dd className="truncate">{supplier.email}</dd>
                      </div>
                    )}
                    {supplier.gstin && (
                      <div>
                        <dt className="text-muted-foreground">GSTIN</dt>
                        <dd className="tabular-nums">{supplier.gstin}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {canManage && (
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      asChild
                    >
                      <Link to={`/suppliers/${supplier.id}/prices`}>
                        <Tag aria-hidden="true" />
                        Prices
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="flex-1"
                      onClick={() => setDialog({ mode: "edit", id: supplier.id })}
                    >
                      <Pencil aria-hidden="true" />
                      Edit
                    </Button>
                    {supplier.active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="flex-1 text-destructive"
                        onClick={() => setArchiveTarget(supplier)}
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
              {formatNumber(total)} suppliers
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
        <SupplierDialog
          supplierId={dialog.mode === "edit" ? dialog.id : null}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive this supplier?"
        description={
          archiveTarget
            ? `“${archiveTarget.name}” will be hidden from the active list and from purchase-order supplier pickers. Its history is kept.`
            : ""
        }
        confirmLabel="Archive supplier"
        destructive
        onConfirm={confirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
