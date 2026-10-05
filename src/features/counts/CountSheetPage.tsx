import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { formatNumber } from "@/lib/format";
import {
  countProgressPercent,
  isLargeVariance,
  lineVariance,
  type StockCountDetail,
  type StockCountLine,
} from "@/api/counts";
import {
  useApplyStockCount,
  useSaveCountLine,
  useStockCount,
  useSubmitStockCount,
  useUpdateStockCountStatus,
} from "./hooks";

const inputClass =
  "h-12 w-28 rounded-md border border-input bg-background px-3 text-base tabular-nums " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const SAVE_DEBOUNCE_MS = 600;
const SAVED_FLASH_MS = 2500;

type SaveState = "idle" | "saving" | "saved" | "error";

function parseQty(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return "invalid";
  }
  return n;
}

/**
 * One count-sheet row: item, expected (snapshot) qty, counted qty input
 * with debounced auto-save. A cleared input means "not counted" (null) —
 * the progress bar only counts non-null lines.
 */
function CountLineRow({
  countId,
  line,
  disabled,
  showVariance,
  onSaved,
}: {
  countId: string;
  line: StockCountLine;
  disabled: boolean;
  /** Variance review (submitted/applied sheets): show the per-line variance. */
  showVariance: boolean;
  onSaved: () => void;
}) {
  const [text, setText] = useState(
    line.countedQty === null ? "" : String(line.countedQty),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [localError, setLocalError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<number | null | undefined>(undefined);
  const savedFlashRef = useRef<number | null>(null);
  const saveLine = useSaveCountLine();

  // Keep the input in sync when the server value changes from outside
  // (e.g. a refetch). Debounced saves update the cache directly, so this
  // does not clobber in-progress typing.
  useEffect(() => {
    setText(line.countedQty === null ? "" : String(line.countedQty));
  }, [line.countedQty]);

  const doSave = (qty: number | null) => {
    timerRef.current = null;
    pendingRef.current = undefined;
    setSaveState("saving");
    setLocalError(null);
    saveLine.mutate(
      { countId, itemId: line.itemId, countedQty: qty, countIdForKey: countId },
      {
        onSuccess: () => {
          setSaveState("saved");
          onSaved();
          if (savedFlashRef.current) {
            window.clearTimeout(savedFlashRef.current);
          }
          savedFlashRef.current = window.setTimeout(
            () => setSaveState("idle"),
            SAVED_FLASH_MS,
          );
        },
        onError: () => setSaveState("error"),
      },
    );
  };

  // Flush a pending debounced save on unmount so no keystroke is lost.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        if (pendingRef.current !== undefined) {
          doSave(pendingRef.current);
        }
      }
      if (savedFlashRef.current) {
        window.clearTimeout(savedFlashRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = (raw: string) => {
    setText(raw);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    const parsed = parseQty(raw);
    if (parsed === "invalid") {
      setLocalError("Enter 0 or more.");
      setSaveState("idle");
      pendingRef.current = undefined;
      return;
    }
    setLocalError(null);
    pendingRef.current = parsed;
    timerRef.current = window.setTimeout(() => doSave(parsed), SAVE_DEBOUNCE_MS);
  };

  const retry = () => {
    const parsed = parseQty(text);
    if (parsed !== "invalid") {
      doSave(parsed);
    }
  };

  const variance = showVariance ? lineVariance(line) : null;
  const large = showVariance && isLargeVariance(line);

  return (
    <div
      className={`flex items-center gap-3 border-b py-3 last:border-0 ${
        large ? "rounded-md bg-amber-50 px-2 dark:bg-amber-950/40" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {line.itemName}
          {large && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              <TriangleAlert className="size-3" aria-hidden="true" />
              Large variance
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          System: {formatNumber(line.expectedQty)} {line.unitSymbol}
          {variance !== null && line.countedQty !== null && (
            <>
              {" · "}Counted: {formatNumber(line.countedQty)} {line.unitSymbol}
            </>
          )}
        </p>
        {variance !== null && (
          <p
            className={`text-xs font-medium tabular-nums ${
              variance === 0
                ? "text-muted-foreground"
                : variance > 0
                  ? "text-green-700 dark:text-green-300"
                  : "text-destructive"
            }`}
          >
            Variance: {variance > 0 ? "+" : ""}
            {formatNumber(variance)} {line.unitSymbol}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Counted quantity for ${line.itemName}`}
          placeholder="—"
          value={text}
          onChange={(e) => scheduleSave(e.target.value)}
          disabled={disabled}
          className={inputClass}
        />
        <div className="flex h-4 items-center" aria-live="polite">
          {localError && (
            <span role="alert" className="text-xs text-destructive">
              {localError}
            </span>
          )}
          {!localError && saveState === "saving" && (
            <span className="text-xs text-muted-foreground">Saving…</span>
          )}
          {!localError && saveState === "saved" && (
            <span className="inline-flex items-center gap-0.5 text-xs text-green-700 dark:text-green-300">
              <Check className="size-3" aria-hidden="true" /> Saved
            </span>
          )}
          {!localError && saveState === "error" && (
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-[24px] items-center gap-1 text-xs text-destructive underline"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Couldn&apos;t save — retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Count sheet (P5-01): the mobile-optimised counting surface. Each row
 * auto-saves (debounced) with visible per-row state and retry — this is the
 * "offline-tolerant" acceptance: a dropped request shows an inline retry
 * instead of silently losing the count. The real offline queue is P6-02's
 * scope.
 *
 * Submitting moves the session to `submitted` (frozen). A submitted sheet
 * shows the variance review (counted − expected per line, large variances
 * highlighted); an owner/manager can approve it, which posts the
 * adjustments to the ledger via `apply_stock_count` (P5-02) and moves the
 * session to `applied` (terminal).
 */
export function CountSheetPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const detailQuery = useStockCount(id ?? null);
  const detail: StockCountDetail | undefined = detailQuery.data;
  const submitCount = useSubmitStockCount();
  const applyCount = useApplyStockCount();
  const advanceStatus = useUpdateStockCountStatus();
  const advanceFiredRef = useRef(false);

  const [searchInput, setSearchInput] = useState("");
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  const canApprove = profile?.role === "owner" || profile?.role === "manager";

  const lines = detail?.lines ?? [];
  const q = searchInput.trim().toLowerCase();
  const visibleLines = q
    ? lines.filter((line) => line.itemName.toLowerCase().includes(q))
    : lines;

  const allCounted =
    detail !== undefined &&
    detail.lines.length > 0 &&
    detail.lines.every((line) => line.countedQty !== null);
  const isSubmitted = detail?.status === "submitted";
  const isApplied = detail?.status === "applied";
  const inReview = isSubmitted || isApplied;
  const readOnly = inReview || detailQuery.isLoading;

  // Variance review: per-line variances from the frozen snapshot +
  // counted quantities (client-side display math; the posting is DB-side).
  const variances = inReview
    ? lines.map((line) => ({ line, variance: lineVariance(line) ?? 0 }))
    : [];
  const nonZeroCount = variances.filter((v) => v.variance !== 0).length;
  const largeCount = inReview
    ? lines.filter((line) => isLargeVariance(line)).length
    : 0;

  // First successful save moves draft → in_progress so the list reflects
  // real progress (the status trigger enforces the machine server-side).
  const handleSaved = () => {
    if (detail?.status === "draft" && !advanceFiredRef.current && id) {
      advanceFiredRef.current = true;
      advanceStatus.mutate({ countId: id, status: "in_progress" });
    }
  };

  const doSubmit = () => {
    if (!id) {
      return;
    }
    setConfirmSubmit(false);
    submitCount.mutate(id);
  };

  const doApply = () => {
    if (!id) {
      return;
    }
    setConfirmApply(false);
    applyCount.mutate(id);
  };

  return (
    <div>
      <PageHeader
        title={detail?.title ?? "Count sheet"}
        description={
          detail
            ? inReview
              ? `Variance review — ${nonZeroCount} of ${detail.totalLines} lines differ from the system count`
              : `${detail.countedLines} of ${detail.totalLines} items counted`
            : "Loading the count sheet…"
        }
        actions={
          !readOnly && allCounted ? (
            <Button
              onClick={() => setConfirmSubmit(true)}
              className="min-h-[44px]"
              disabled={submitCount.isPending}
            >
              {submitCount.isPending ? "Submitting…" : "Submit for review"}
            </Button>
          ) : isSubmitted && canApprove ? (
            <Button
              onClick={() => setConfirmApply(true)}
              className="min-h-[44px]"
              disabled={applyCount.isPending}
            >
              {applyCount.isPending ? "Applying…" : "Approve & apply"}
            </Button>
          ) : undefined
        }
      />

      {detailQuery.isLoading && (
        <div aria-label="Loading count sheet" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md bg-muted"
            />
          ))}
        </div>
      )}

      {detailQuery.isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 p-6 text-center"
        >
          <p className="font-medium">Couldn&apos;t load this count.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, or you may not have access to it.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              onClick={() => detailQuery.refetch()}
              variant="outline"
              className="min-h-[44px]"
            >
              Retry
            </Button>
            <Button asChild variant="ghost" className="min-h-[44px]">
              <Link to="/stock-counts">Back to counts</Link>
            </Button>
          </div>
        </div>
      )}

      {detail && isSubmitted && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-600/30 bg-amber-50 p-3 text-sm dark:bg-amber-950"
        >
          <p className="font-medium">Awaiting variance review.</p>
          <p className="mt-1 text-muted-foreground">
            {nonZeroCount === 0
              ? "Every line matches the system count — approving posts no adjustments."
              : `Approving posts ${nonZeroCount} stock adjustment${nonZeroCount === 1 ? "" : "s"} to the ledger.`}
            {largeCount > 0 &&
              ` ${largeCount} line${largeCount === 1 ? " has" : "s have"} a large variance (highlighted).`}
            {!canApprove &&
              " Only an owner or manager can approve."}
          </p>
        </div>
      )}

      {detail && isApplied && (
        <div
          role="status"
          className="mb-4 rounded-md border border-green-600/30 bg-green-50 p-3 text-sm dark:bg-green-950"
        >
          This count was applied — its variances are posted to the stock
          ledger and the session is read-only.
        </div>
      )}

      {detail && !isSubmitted && (
        <>
          <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur">
            <div
              className="flex items-center gap-2"
              role="progressbar"
              aria-valuenow={countProgressPercent(detail)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Count progress: ${detail.countedLines} of ${detail.totalLines} items counted`}
            >
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${countProgressPercent(detail)}%` }}
                />
              </div>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {detail.countedLines}/{detail.totalLines}
              </span>
            </div>
          </div>

          <div className="mb-2 mt-2">
            <input
              type="search"
              aria-label="Search items in this count"
              placeholder="Search items…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
            />
          </div>
        </>
      )}

      {detail && (
        <>
          <div className="rounded-md border px-4" aria-label="Count sheet">
            {visibleLines.map((line) => (
              <CountLineRow
                key={line.id}
                countId={detail.id}
                line={line}
                disabled={readOnly}
                showVariance={inReview}
                onSaved={handleSaved}
              />
            ))}
            {visibleLines.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {lines.length === 0
                  ? "This count has no items."
                  : "No items match your search."}
              </p>
            )}
          </div>

          {!isSubmitted && (
            <p className="mt-3 text-xs text-muted-foreground">
              Quantities save automatically as you type. Clear an input to
              mark an item as not counted yet.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmSubmit}
        title="Submit for review?"
        description={`All ${detail?.totalLines ?? 0} items are counted. Submitting locks the sheet for variance review and approval.`}
        confirmLabel="Submit count"
        onConfirm={doSubmit}
        onCancel={() => setConfirmSubmit(false)}
      />

      <ConfirmDialog
        open={confirmApply}
        title="Approve & apply this count?"
        description={
          nonZeroCount === 0
            ? "Every line matches the system count. Approving marks the count applied and posts no adjustments."
            : `This posts ${nonZeroCount} stock adjustment${nonZeroCount === 1 ? "" : "s"} ` +
              `(counted − expected) to the ledger and marks the count applied. ` +
              `Lines that match post nothing. This can't be undone — a re-count needs a new session.`
        }
        confirmLabel={applyCount.isPending ? "Applying…" : "Approve & apply"}
        onConfirm={doApply}
        onCancel={() => setConfirmApply(false)}
      />
    </div>
  );
}
