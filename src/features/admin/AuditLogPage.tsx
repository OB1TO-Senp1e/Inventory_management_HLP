import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  auditActionLabels,
  auditActionSchema,
  type AuditAction,
  type ListAuditLogInput,
} from "@/schemas/auditLog";
import { defaultReportRange, reportRangeSchema } from "@/schemas/reports";
import { useAuditLog } from "./hooks";

/**
 * Audit log (P5-05): owner only. Lists the sensitive actions recorded by
 * the SECURITY DEFINER RPCs (`over_sale` from record_sales,
 * `stock_count_applied` from apply_stock_count), with actor, time and a
 * human-readable summary of each payload. Filters: action type and
 * inclusive date range (Asia/Kolkata wall clock, the reports pattern).
 *
 * Read-only: the table is append-only and has no write UI.
 */

const PAGE_SIZE = 25;

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-4 py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function Cell({
  children,
  numeric,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <td className={cn("px-4 py-2 align-top", numeric && "text-right tabular-nums")}>
      {children}
    </td>
  );
}

/** "owner · a1b2c3d4" — the actor's role plus a short id fragment. */
function ActorLabel({
  role,
  id,
}: {
  role: string | null;
  id: string | null;
}) {
  if (!id) {
    return <span className="text-muted-foreground">System</span>;
  }
  return (
    <span>
      {role ?? "unknown"}
      <span className="text-muted-foreground"> · {id.slice(0, 8)}</span>
    </span>
  );
}

export function AuditLogPage() {
  const [action, setAction] = useState<AuditAction | "all">("all");
  const [range, setRange] = useState(() => defaultReportRange());
  const [draft, setDraft] = useState({ from: range.from, to: range.to });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const applyRange = () => {
    const parsed = reportRangeSchema.safeParse(draft);
    if (!parsed.success) {
      setRangeError(
        parsed.error.issues[0]?.message ?? "Enter a valid date range.",
      );
      return;
    }
    setRangeError(null);
    setRange(parsed.data);
    setPage(1);
  };

  const applyAction = (value: string) => {
    const parsed = value === "all" ? "all" : auditActionSchema.safeParse(value);
    if (parsed === "all" || parsed.success) {
      setAction(parsed === "all" ? "all" : parsed.data);
      setPage(1);
    }
  };

  const input: ListAuditLogInput = {
    page,
    pageSize: PAGE_SIZE,
    ...(action === "all" ? {} : { action }),
    range,
  };
  const query = useAuditLog(input);
  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Sensitive actions recorded by the system — who did what, and when."
      />

      <div className="flex flex-wrap items-end gap-3" aria-label="Audit log filters">
        <div className="space-y-1">
          <label htmlFor="audit-action" className="text-sm font-medium">
            Action
          </label>
          <select
            id="audit-action"
            value={action}
            onChange={(e) => applyAction(e.target.value)}
            className="block rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All actions</option>
            {(Object.keys(auditActionLabels) as AuditAction[]).map((key) => (
              <option key={key} value={key}>
                {auditActionLabels[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-from" className="text-sm font-medium">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            value={draft.from}
            max={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="block rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="audit-to" className="text-sm font-medium">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="block rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <Button onClick={applyRange}>Apply</Button>
        {rangeError && (
          <p role="alert" className="text-sm text-destructive">
            {rangeError}
          </p>
        )}
      </div>

      {query.isLoading ? (
        <div
          className="h-48 animate-pulse rounded-lg border bg-muted/40"
          aria-label="Loading audit log"
        />
      ) : query.isError ? (
        <EmptyState message="Could not load the audit log. Try again." />
      ) : entries.length === 0 ? (
        <EmptyState message="No audit entries match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Audit log entries, newest first</caption>
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Time
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Actor
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <Cell>
                      <span className="whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </Cell>
                    <Cell>
                      <span className="whitespace-nowrap font-medium">
                        {entry.actionLabel}
                      </span>
                    </Cell>
                    <Cell>
                      <ActorLabel role={entry.createdByRole} id={entry.createdBy} />
                    </Cell>
                    <Cell>{entry.summary}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Showing {formatNumber(showingFrom)}–{formatNumber(showingTo)} of{" "}
              {formatNumber(total)} entries
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
    </div>
  );
}
