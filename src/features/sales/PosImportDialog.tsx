import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/toast/useToast";
import { formatDate, formatNumber } from "@/lib/format";
import { matchItemsByName, type MatchableItem } from "@/lib/fuzzyMatch";
import {
  getPosProvider,
  normalizePosPayload,
  POS_PROVIDERS,
  type PosSaleLine,
} from "@/lib/pos";
import {
  listImportedExternalIds,
  type PosImportResult,
} from "@/api/pos";
import type { SalesPreviewItem } from "@/api/sales";
import {
  aggregateImportLines,
  type PosImportLine,
} from "@/schemas/pos";
import { saleDateSchema, todayISODate } from "@/schemas/sales";
import { useMenuItems } from "@/features/recipes/hooks";
import {
  useImportPosSales,
  usePreviewSalesDeductions,
} from "./hooks";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

/**
 * POS sales import (V2-06). Owner/manager only — the dialog lives on
 * /sales, which the route guard already restricts (P4-03 role matrix).
 *
 * Flow: pick provider + date range → fetch → preview (POS dish names are
 * fuzzy-matched to menu items; unmatched lines can be mapped manually or
 * skipped; already-imported sales are marked and excluded) → confirm.
 * The confirm step runs the same over-sale preview as manual entry
 * (P4-04) and posts through `import_pos_sales`, which calls
 * `record_sales` internally — identical ledger effects, over_sale flags
 * and audit entries. Re-importing an external sale raises server-side;
 * the client pre-filters so the preview shows "already imported" badges.
 */

interface PreviewRow {
  externalSaleId: string;
  soldAt: string;
  dishName: string;
  quantity: number;
  alreadyImported: boolean;
  /** Best fuzzy-match score (0 when nothing matched). */
  bestScore: number;
  /** Chosen menu item id, or "" to skip this sale. */
  menuItemId: string;
}

interface PendingOverSale {
  lines: PosImportLine[];
  flagged: SalesPreviewItem[];
}

type Phase = "setup" | "preview" | "done";

function weekAgoISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function matchBadge(score: number): string | null {
  if (score >= 80) return "Auto-matched";
  if (score >= 50) return "Suggested — review";
  return null;
}

export function PosImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { error: toastError } = useToast();
  const dishes = useMenuItems({ active: true });
  const previewDeductions = usePreviewSalesDeductions();
  const importSales = useImportPosSales();

  const [phase, setPhase] = useState<Phase>("setup");
  const [providerId, setProviderId] = useState("stub");
  const [fromDate, setFromDate] = useState(weekAgoISODate());
  const [toDate, setToDate] = useState(todayISODate());
  const [saleDate, setSaleDate] = useState(todayISODate());
  const [formError, setFormError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [skippedInvalid, setSkippedInvalid] = useState(0);
  const [importResult, setImportResult] = useState<PosImportResult | null>(null);
  const [pendingOverSale, setPendingOverSale] =
    useState<PendingOverSale | null>(null);

  // Fresh state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setPhase("setup");
      setProviderId("stub");
      setFromDate(weekAgoISODate());
      setToDate(todayISODate());
      setSaleDate(todayISODate());
      setFormError(null);
      setFetching(false);
      setRows([]);
      setSkippedInvalid(0);
      setImportResult(null);
      setPendingOverSale(null);
    }
  }, [open ]);

  const menuItems = useMemo(() => dishes.data ?? [], [dishes.data]);
  const matchables: MatchableItem[] = useMemo(
    () =>
      menuItems.map((item) => ({
        id: item.id,
        name: item.name,
        unitSymbol: "",
      })),
    [menuItems],
  );

  if (!open) {
    return null;
  }

  const validateRange = (): string | null => {
    const from = saleDateSchema.safeParse(fromDate);
    const to = saleDateSchema.safeParse(toDate);
    if (!from.success) return "Pick a valid start date.";
    if (!to.success) return "Pick a valid end date.";
    if (fromDate > toDate) return "The start date must be on or before the end date.";
    return null;
  };

  const fetchSales = async () => {
    const rangeError = validateRange();
    if (rangeError) {
      setFormError(rangeError);
      return;
    }
    const provider = getPosProvider(providerId);
    if (!provider) {
      setFormError("Choose a POS provider.");
      return;
    }
    setFormError(null);
    setFetching(true);
    try {
      const [rawLines, importedIds] = await Promise.all([
        provider.fetchSales({ from: fromDate, to: toDate }),
        listImportedExternalIds(provider.id),
      ]);
      const { lines, skipped } = normalizePosPayload(rawLines);
      setSkippedInvalid(skipped);
      setRows(
        lines.map((line: PosSaleLine) => {
          const alreadyImported = importedIds.has(line.externalSaleId);
          const matches = matchItemsByName(line.dishName, matchables, 3);
          const best = matches[0];
          const bestScore = best?.score ?? 0;
          return {
            externalSaleId: line.externalSaleId,
            soldAt: line.soldAt,
            dishName: line.dishName,
            quantity: line.quantity,
            alreadyImported,
            bestScore,
            menuItemId:
              alreadyImported || bestScore < 50 ? "" : (best?.item.id ?? ""),
          };
        }),
      );
      setPhase("preview");
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Could not fetch POS sales.",
      );
    } finally {
      setFetching(false);
    }
  };

  const setRowMenuItem = (externalSaleId: string, menuItemId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.externalSaleId === externalSaleId ? { ...row, menuItemId } : row,
      ),
    );
  };

  const importableRows = rows.filter(
    (row) => !row.alreadyImported && row.menuItemId !== "",
  );
  const skippedRows = rows.filter(
    (row) => !row.alreadyImported && row.menuItemId === "",
  ).length;
  const alreadyImportedCount = rows.filter((row) => row.alreadyImported).length;

  const confirmImport = async () => {
    const lines: PosImportLine[] = importableRows.map((row) => ({
      externalSaleId: row.externalSaleId,
      menuItemId: row.menuItemId,
      dishes: row.quantity,
      soldAt: row.soldAt,
    }));
    if (lines.length === 0) {
      return;
    }
    const parsedSaleDate = saleDateSchema.safeParse(saleDate);
    if (!parsedSaleDate.success) {
      setFormError("Pick a valid sale date.");
      return;
    }
    setFormError(null);
    // P4-04: same pre-submit over-sale check as manual entry — the RPC
    // still computes the authoritative flag at post time.
    let preview: SalesPreviewItem[];
    try {
      preview = await previewDeductions.mutateAsync({
        saleDate,
        lines: aggregateImportLines(lines),
      });
    } catch {
      return; // error already toasted by the hook
    }
    const flagged = preview.filter((row) => row.wouldGoNegative);
    if (flagged.length > 0) {
      setPendingOverSale({ lines, flagged });
      return;
    }
    doImport(lines);
  };

  const doImport = (lines: PosImportLine[]) => {
    importSales.mutate(
      { provider: providerId, saleDate, lines },
      {
        onSuccess: (result) => {
          setImportResult(result);
          setPendingOverSale(null);
          setPhase("done");
        },
      },
    );
  };

  const busy =
    fetching || previewDeductions.isPending || importSales.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import sales from POS"
      data-testid="pos-import-dialog"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-6 shadow-lg">
        {phase === "setup" && (
          <>
            <h2 className="text-lg font-semibold">Import sales from POS</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fetch sales from your point of sale, review each line, then
              import. Imported sales post exactly like a manual entry —
              ingredients are deducted from stock on the ledger.
            </p>

            {dishes.isLoading && (
              <div className="mt-4 space-y-2" aria-label="Loading dishes">
                <div className="h-11 animate-pulse rounded-md bg-muted" />
                <div className="h-11 animate-pulse rounded-md bg-muted" />
              </div>
            )}

            {dishes.isError && (
              <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                Couldn&apos;t load dishes.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => dishes.refetch()}
                >
                  Retry
                </button>
              </p>
            )}

            {!dishes.isLoading && !dishes.isError && (
              <div className="mt-4 space-y-4">
                <div>
                  <label className={labelClass} htmlFor="pos-provider">
                    POS provider
                  </label>
                  <select
                    id="pos-provider"
                    className={inputClass}
                    value={providerId}
                    disabled={busy}
                    onChange={(e) => setProviderId(e.target.value)}
                  >
                    {POS_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {POS_PROVIDERS.find((p) => p.id === providerId)?.description}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="pos-from">
                      Sales from
                    </label>
                    <input
                      id="pos-from"
                      type="date"
                      className={inputClass}
                      value={fromDate}
                      disabled={busy}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pos-to">
                      Sales to
                    </label>
                    <input
                      id="pos-to"
                      type="date"
                      className={inputClass}
                      value={toDate}
                      disabled={busy}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </div>
                </div>

                {formError && (
                  <p role="alert" className={errorClass}>
                    {formError}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    onClick={fetchSales}
                    disabled={busy}
                    className="min-h-[44px]"
                    data-testid="pos-fetch-button"
                  >
                    {fetching ? "Fetching…" : "Fetch sales"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {phase === "preview" && (
          <>
            <h2 className="text-lg font-semibold">Review POS sales</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Match each POS dish to a menu item, or skip it. Sales already
              imported are marked and can&apos;t be imported again.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-2.5 py-1">
                {importableRows.length} to import
              </span>
              {skippedRows > 0 && (
                <span className="rounded-full bg-muted px-2.5 py-1">
                  {skippedRows} skipped
                </span>
              )}
              {alreadyImportedCount > 0 && (
                <span className="rounded-full bg-muted px-2.5 py-1">
                  {alreadyImportedCount} already imported
                </span>
              )}
              {skippedInvalid > 0 && (
                <span className="rounded-full bg-muted px-2.5 py-1">
                  {skippedInvalid} invalid {skippedInvalid === 1 ? "row" : "rows"} from POS
                </span>
              )}
            </div>

            {rows.length === 0 ? (
              <div className="mt-4 rounded-md border p-6 text-center">
                <p className="font-medium">No sales in this range.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a wider date range, or check the POS provider.
                </p>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2 font-medium">POS sale</th>
                      <th className="px-3 py-2 font-medium">Menu item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.externalSaleId}
                        className="border-b align-top last:border-0"
                        data-testid={`pos-row-${row.externalSaleId}`}
                      >
                        <td className="px-3 py-3">
                          <p className="font-medium">{row.dishName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatNumber(row.quantity)} sold ·{" "}
                            {formatDate(row.soldAt.slice(0, 10))}
                          </p>
                          {row.alreadyImported && (
                            <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">
                              Already imported
                            </span>
                          )}
                          {!row.alreadyImported &&
                            matchBadge(row.bestScore) && (
                              <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">
                                {matchBadge(row.bestScore)}
                              </span>
                            )}
                          {!row.alreadyImported &&
                            !matchBadge(row.bestScore) && (
                              <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                                No match — map or skip
                              </span>
                            )}
                        </td>
                        <td className="px-3 py-3">
                          {row.alreadyImported ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : (
                            <select
                              className={inputClass}
                              value={row.menuItemId}
                              disabled={busy}
                              aria-label={`Menu item for ${row.dishName}`}
                              onChange={(e) =>
                                setRowMenuItem(row.externalSaleId, e.target.value)
                              }
                            >
                              <option value="">Skip this sale</option>
                              {menuItems.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {formError && (
              <p role="alert" className={errorClass}>
                {formError}
              </p>
            )}

            <div className="mt-4">
              <label className={labelClass} htmlFor="pos-sale-date">
                Record as sales for
              </label>
              <input
                id="pos-sale-date"
                type="date"
                className={inputClass}
                value={saleDate}
                disabled={busy}
                onChange={(e) => setSaleDate(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Imported sales post under this date, like a manual entry.
                The original POS timestamps are kept with the import record.
              </p>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              If any ingredient would go below zero, you&apos;ll be asked to
              confirm before the import posts — confirmed over-sales are
              flagged in the ledger and written to the audit log.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setPhase("setup")}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                onClick={confirmImport}
                disabled={busy || importableRows.length === 0}
                className="min-h-[44px]"
                data-testid="pos-import-button"
              >
                {previewDeductions.isPending
                  ? "Checking…"
                  : importSales.isPending
                    ? "Importing…"
                    : `Import ${importableRows.length} ${importableRows.length === 1 ? "sale" : "sales"}`}
              </Button>
            </div>
            {rows.length > 0 && importableRows.length === 0 && (
              <p className="mt-2 text-right text-xs text-muted-foreground">
                {skippedRows === 0 && alreadyImportedCount > 0
                  ? "Every sale in this range was already imported."
                  : "Map at least one sale to a menu item to import."}
              </p>
            )}
          </>
        )}

        {phase === "done" && importResult && (
          <>
            <h2 className="text-lg font-semibold">Import complete</h2>
            <div className="mt-4 rounded-md border bg-muted/40 p-4 text-sm">
              <p>
                <span className="font-semibold">{importResult.imported}</span>{" "}
                {importResult.imported === 1 ? "sale" : "sales"} imported for{" "}
                <span className="font-semibold">
                  {formatDate(importResult.saleDate)}
                </span>
                .
              </p>
              <p className="mt-1 text-muted-foreground">
                {importResult.sales.lines.reduce(
                  (sum, line) => sum + line.dishes,
                  0,
                )}{" "}
                dishes · {importResult.sales.ingredients.length} ingredients
                deducted from stock.
              </p>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                onClick={onClose}
                className="min-h-[44px]"
                data-testid="pos-import-close"
              >
                Done
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingOverSale !== null}
        title="Insufficient stock"
        description="This import would take the following ingredients below zero. Confirm to import anyway — the flagged movements and an audit entry are written to the ledger."
        confirmLabel="Import anyway"
        destructive
        onConfirm={() => pendingOverSale && doImport(pendingOverSale.lines)}
        onCancel={() => setPendingOverSale(null)}
      >
        <ul className="mt-3 space-y-1.5 text-sm" aria-label="Ingredients that would go below zero">
          {pendingOverSale?.flagged.map((row) => (
            <li key={row.itemId} className="flex items-baseline justify-between gap-2 rounded-md bg-muted/60 px-3 py-2">
              <span className="font-medium">{row.itemName}</span>
              <span className="text-muted-foreground">
                {formatNumber(row.currentQuantity)} {row.unitSymbol} −{" "}
                {formatNumber(row.deductionQuantity)} {row.unitSymbol} ={" "}
                <span className="font-semibold text-destructive">
                  {formatNumber(row.projectedQuantity)} {row.unitSymbol}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
