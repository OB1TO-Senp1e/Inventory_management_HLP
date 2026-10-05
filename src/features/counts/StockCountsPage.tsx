import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { formatDateTime } from "@/lib/format";
import { countProgressPercent, type StockCount } from "@/api/counts";
import {
  createStockCountSchema,
  type CreateStockCountInput,
  type StockCountStatus,
} from "@/schemas/count";
import {
  useAssignees,
  useCreateStockCount,
  useStockCounts,
} from "./hooks";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

const statusLabels: Record<StockCountStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  submitted: "Submitted",
};

const statusStyles: Record<StockCountStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  submitted:
    "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
};

function StatusBadge({ status }: { status: StockCountStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

function ProgressBar({ count }: { count: StockCount }) {
  const pct = countProgressPercent(count);
  return (
    <div
      className="flex items-center gap-2"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Count progress: ${count.countedLines} of ${count.totalLines} items counted`}
    >
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {count.countedLines}/{count.totalLines} ({pct}%)
      </span>
    </div>
  );
}

/** Short id for display when a profile has no name (v1: role + id prefix). */
function assigneeLabel(id: string, assignees: Map<string, string>): string {
  const role = assignees.get(id);
  const short = id.slice(0, 8);
  return role ? `${role} · ${short}…` : short;
}

function LoadingSkeleton() {
  return (
    <div
      className="space-y-2"
      aria-label="Loading stock counts"
      aria-busy="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/50 p-6 text-center">
      <p className="font-medium">Couldn&apos;t load stock counts.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Check your connection and try again.
      </p>
      <Button onClick={onRetry} variant="outline" className="mt-4 min-h-[44px]">
        Retry
      </Button>
    </div>
  );
}

function CreateCountDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const assigneesQuery = useAssignees();
  const createCount = useCreateStockCount();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateStockCountInput>({
    resolver: zodResolver(createStockCountSchema),
    defaultValues: { title: "", assignedTo: null },
  });

  const assignees = assigneesQuery.data ?? [];

  const onSubmit = (input: CreateStockCountInput) => {
    createCount.mutate(
      { title: input.title, assignedTo: input.assignedTo ?? null },
      {
        onSuccess: (count) => {
          onCreated(count.id);
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="count-dialog-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-background p-6 shadow-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="count-dialog-title"
            className="text-xl font-semibold tracking-tight"
          >
            New stock count
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

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div>
            <label htmlFor="count-title" className={labelClass}>
              Title
            </label>
            <input
              id="count-title"
              type="text"
              placeholder="e.g. Weekly full count"
              {...register("title")}
              className={inputClass}
              disabled={isSubmitting}
            />
            {errors.title && (
              <p role="alert" className={errorClass}>
                {errors.title.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="count-assignee" className={labelClass}>
              Assign to (optional)
            </label>
            <select
              id="count-assignee"
              {...register("assignedTo")}
              className={inputClass}
              disabled={isSubmitting || assigneesQuery.isLoading}
            >
              <option value="">Unassigned</option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.role} · {person.id.slice(0, 8)}…
                </option>
              ))}
            </select>
            {assigneesQuery.isError && (
              <p role="alert" className={errorClass}>
                Couldn&apos;t load users — you can still create the count
                unassigned.
              </p>
            )}
            {errors.assignedTo && (
              <p role="alert" className={errorClass}>
                {errors.assignedTo.message}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Staff see and work only the counts assigned to them.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="min-h-[44px]"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating…" : "Create count"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Stock counts list (P5-01). Owner/manager see all sessions and can create
 * new ones; staff see only their assigned sessions (RLS is the authority).
 * Each session shows its count-sheet progress; variance review and approval
 * land in P5-02.
 */
export function StockCountsPage() {
  const { profile } = useAuth();
  const canCreate = profile?.role === "owner" || profile?.role === "manager";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<StockCountStatus | "all">(
    "all",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const countsQuery = useStockCounts();
  const counts = useMemo(
    () => countsQuery.data ?? [],
    [countsQuery.data],
  );
  // Staff never need the roster: their rows are either unassigned or
  // assigned to them.
  const assigneesQuery = useAssignees({ enabled: canCreate });

  // Profiles carry no display name in v1 — the list shows role + short id.
  const assigneeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of assigneesQuery.data ?? []) {
      map.set(person.id, person.role);
    }
    return map;
  }, [assigneesQuery.data]);

  const filtered = useMemo(() => {
    const q = search?.toLowerCase();
    return counts.filter((count) => {
      if (statusFilter !== "all" && count.status !== statusFilter) {
        return false;
      }
      if (q && !count.title.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [counts, search, statusFilter]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim() === "" ? undefined : searchInput.trim());
  };

  return (
    <div>
      <PageHeader
        title="Stock Counts"
        description="Count sessions. Assign them to staff, track progress, and submit finished sheets for review."
        actions={
          canCreate ? (
            <Button
              onClick={() => setDialogOpen(true)}
              className="min-h-[44px]"
            >
              <Plus className="mr-1 size-4" aria-hidden="true" />
              New count
            </Button>
          ) : undefined
        }
      />

      {createdId && (
        <div
          role="status"
          className="mb-4 rounded-md border border-green-600/30 bg-green-50 p-3 text-sm dark:bg-green-950"
        >
          Count created.{" "}
          <Link
            to={`/stock-counts/${createdId}`}
            className="font-medium underline"
            onClick={() => setCreatedId(null)}
          >
            Open the count sheet
          </Link>
          .
        </div>
      )}

      <form
        onSubmit={onSearch}
        className="mb-4 flex flex-wrap items-center gap-2"
        role="search"
      >
        <input
          type="search"
          aria-label="Search stock counts"
          placeholder="Search counts…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={`${inputClass} min-w-0 flex-1 sm:w-64 sm:flex-none`}
        />
        <Button type="submit" variant="outline" className="min-h-[44px]">
          Search
        </Button>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as StockCountStatus | "all")
          }
          className={`${inputClass} w-auto`}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="in_progress">In progress</option>
          <option value="submitted">Submitted</option>
        </select>
      </form>

      {countsQuery.isLoading && <LoadingSkeleton />}
      {countsQuery.isError && (
        <ErrorState onRetry={() => countsQuery.refetch()} />
      )}
      {countsQuery.isSuccess && filtered.length === 0 && (
        <div className="rounded-md border p-8 text-center">
          <p className="font-medium">
            {counts.length === 0 ? "No stock counts yet." : "No counts match."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {counts.length === 0 && canCreate
              ? "Create the first count to start a count sheet."
              : "Try a different search or status filter."}
          </p>
        </div>
      )}

      {countsQuery.isSuccess && filtered.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned to</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((count) => (
                  <tr key={count.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        to={`/stock-counts/${count.id}`}
                        className="font-medium underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                      >
                        {count.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={count.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {count.assignedTo
                        ? assigneeLabel(count.assignedTo, assigneeById)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar count={count} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateTime(count.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map((count) => (
              <Link
                key={count.id}
                to={`/stock-counts/${count.id}`}
                className="block rounded-md border p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{count.title}</span>
                  <StatusBadge status={count.status} />
                </div>
                <div className="mt-2">
                  <ProgressBar count={count} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {count.assignedTo
                      ? `Assigned: ${assigneeLabel(count.assignedTo, assigneeById)}`
                      : "Unassigned"}
                  </span>
                  <span>{formatDateTime(count.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {dialogOpen && (
        <CreateCountDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(id) => {
            setDialogOpen(false);
            setCreatedId(id);
          }}
        />
      )}
    </div>
  );
}
