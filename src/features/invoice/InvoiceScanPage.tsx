import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  FileWarning,
  RotateCcw,
  ScanText,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { useReceivableItems, useReceiveGoods } from "@/features/stock/hooks";
import { useSuppliers } from "@/features/suppliers/hooks";
import { isQueuedSubmission } from "@/features/sync/types";
import type { ReceiveGoodsResult } from "@/api/stock";
import { formatINR, formatNumber } from "@/lib/format";
import {
  bestItemMatch,
  parseInvoiceText,
  type MatchableItem,
  type ParsedInvoiceLine,
  type ParsedLineStatus,
} from "@/lib/invoiceParse";
import { ocrStatusCopy, recognizeInvoiceImage, type OcrProgress } from "./ocr";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

/**
 * Test seam for deterministic e2e: with `?simulateOcr=1` in the URL the
 * capture step also renders a "Simulate scan" button that injects canned
 * OCR text. The real OCR path (tesseract.js) is always the primary
 * implementation — the seam only bypasses it for deterministic specs.
 */
export const SIMULATE_OCR_PARAM = "simulateOcr";
export const SIMULATED_OCR_TEXT = [
  "FRESH FARMS PRODUCE",
  "Bill No: 4821 Date: 05/10/2026",
  "Tomato 10 kg 400.00",
  "Milk 5 L 290.00",
  "Paneer 2 kg 640.00",
  "Coriander",
  "Subtotal: 1330.00",
  "GST 5%: 66.50",
  "Total: 1396.50",
  "Thank you visit again",
].join("\n");

function isSimulateOcr(): boolean {
  return new URLSearchParams(window.location.search).has(SIMULATE_OCR_PARAM);
}

interface DraftLine {
  key: string;
  rawText: string;
  parsedName: string;
  status: ParsedLineStatus;
  autoMatched: boolean;
  itemId: string;
  quantity: string;
  unitCost: string;
  fieldErrors: { itemId?: string; quantity?: string; unitCost?: string };
}

function toDraftLine(parsed: ParsedInvoiceLine, items: MatchableItem[]): DraftLine {
  const match = bestItemMatch(parsed.name, items);
  return {
    key: parsed.id,
    rawText: parsed.rawText,
    parsedName: parsed.name,
    status: parsed.status,
    autoMatched: match !== null,
    itemId: match?.id ?? "",
    quantity: parsed.quantity !== null ? String(parsed.quantity) : "",
    unitCost: parsed.unitCost !== null ? String(parsed.unitCost) : "",
    fieldErrors: {},
  };
}

type Phase = "capture" | "scanning" | "review" | "done";

/**
 * Invoice photo capture → draft receipt (V2-04).
 *
 * A supplier bill is photographed, OCR'd client-side with tesseract.js
 * (lazy chunk — never in the entry bundle), parsed into draft lines, and
 * reviewed line-by-line before posting. Posting goes through the exact
 * same `receive_goods` RPC as manual receiving (P2-02): no parallel path.
 *
 * The photo is session-only: it is OCR'd from an object URL and discarded
 * immediately afterwards — never persisted. Supplier linkage is recorded
 * in each line's notes ("Supplier: <name>") because `receive_goods` has no
 * supplier column; the draft itself lives in component state and vanishes
 * on navigation.
 */
export function InvoiceScanPage() {
  const [phase, setPhase] = useState<Phase>("capture");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [queued, setQueued] = useState(false);
  const [postedResult, setPostedResult] = useState<ReceiveGoodsResult | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const receivable = useReceivableItems();
  const receiveGoods = useReceiveGoods();
  const suppliersQuery = useSuppliers({ pageSize: 100 });
  const { profile } = useAuth();
  const canViewCosts = profile?.role === "owner" || profile?.role === "manager";
  const suppliers = suppliersQuery.data?.suppliers ?? [];
  const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? "";

  const itemById = new Map(receivable.items.map((item) => [item.id, item]));

  // Warn about losing a reviewed draft on tab close / refresh.
  useEffect(() => {
    if (phase !== "review") {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  // Revoke the object URL on unmount — the photo never outlives the page.
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  const onFileSelected = (file: File | undefined) => {
    setScanError(null);
    if (!file) {
      return;
    }
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
    setImageUrl(URL.createObjectURL(file));
  };

  const buildDraft = (text: string) => {
    const parsed = parseInvoiceText(text);
    if (parsed.length === 0) {
      setScanError(
        "Couldn't find any item lines in this photo. Try a clearer, well-lit photo of the bill.",
      );
      setRawText(text);
      setPhase("capture");
      return;
    }
    setRawText(text);
    setDraft(parsed.map((line) => toDraftLine(line, receivable.items)));
    setPhase("review");
  };

  const startScan = async () => {
    if (!imageUrl) {
      return;
    }
    setScanError(null);
    setOcrProgress({ status: "loading tesseract core", progress: 0 });
    setPhase("scanning");
    try {
      const text = await recognizeInvoiceImage(imageUrl, setOcrProgress);
      buildDraft(text);
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : "Couldn't scan the photo.",
      );
      setPhase("capture");
    } finally {
      // Discard the photo once it has been read — session-only by design.
      URL.revokeObjectURL(imageUrl);
      setImageUrl(null);
      setOcrProgress(null);
    }
  };

  const simulateScan = () => {
    setScanError(null);
    buildDraft(SIMULATED_OCR_TEXT);
  };

  const updateDraft = (key: string, patch: Partial<DraftLine>) => {
    setDraft((lines) =>
      lines.map((line) =>
        line.key === key
          ? { ...line, ...patch, fieldErrors: {} }
          : line,
      ),
    );
  };

  const removeDraftLine = (key: string) => {
    setDraft((lines) => lines.filter((line) => line.key !== key));
  };

  const validateDraft = (): boolean => {
    let valid = true;
    const validated = draft.map((line) => {
      const fieldErrors: DraftLine["fieldErrors"] = {};
      if (!line.itemId) {
        fieldErrors.itemId = "Pick an item for this line.";
        valid = false;
      }
      const quantity = Number(line.quantity);
      if (line.quantity.trim() === "" || !Number.isFinite(quantity)) {
        fieldErrors.quantity = "Enter the quantity.";
        valid = false;
      } else if (quantity <= 0) {
        fieldErrors.quantity = "Quantity must be greater than 0.";
        valid = false;
      }
      const unitCost = Number(line.unitCost);
      if (line.unitCost.trim() === "" || !Number.isFinite(unitCost)) {
        fieldErrors.unitCost = "Enter the unit cost.";
        valid = false;
      } else if (unitCost < 0) {
        fieldErrors.unitCost = "Unit cost cannot be negative.";
        valid = false;
      }
      return { ...line, fieldErrors };
    });
    setDraft(validated);
    return valid;
  };

  const postReceipt = () => {
    if (draft.length === 0 || !validateDraft()) {
      return;
    }
    const notesPrefix = supplierName ? `Supplier: ${supplierName}` : "";
    receiveGoods.mutate(
      {
        lines: draft.map((line) => ({
          itemId: line.itemId,
          quantity: Number(line.quantity),
          unitCost: Number(line.unitCost),
          batchNo: undefined,
          expiryDate: undefined,
          notes: notesPrefix || undefined,
        })),
      },
      {
        onSuccess: (result) => {
          if (isQueuedSubmission(result)) {
            // Offline (P6-02): the receipt is safely queued — same handling
            // as manual receiving.
            setQueued(true);
            setDraft([]);
            setPhase("capture");
            return;
          }
          setPostedResult(result);
          setPhase("done");
        },
      },
    );
  };

  const resetAll = () => {
    setPhase("capture");
    setImageUrl(null);
    setOcrProgress(null);
    setScanError(null);
    setRawText("");
    setDraft([]);
    setSupplierId("");
    setQueued(false);
    setPostedResult(null);
  };

  // -- posted report ---------------------------------------------------------
  if (phase === "done" && postedResult) {
    return (
      <div>
        <PageHeader
          title="Scan invoice"
          description="Receipt posted to the stock ledger."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={resetAll}
                className="min-h-[44px]"
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                Scan another bill
              </Button>
              <Button asChild className="min-h-[44px]">
                <Link to="/receiving">Back to Receiving</Link>
              </Button>
            </div>
          }
        />
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                {canViewCosts && (
                  <>
                    <th className="px-4 py-3 font-medium">Unit cost</th>
                    <th className="px-4 py-3 font-medium">Avg cost (old → new)</th>
                  </>
                )}
                <th className="px-4 py-3 font-medium">Movement</th>
              </tr>
            </thead>
            <tbody>
              {postedResult.lines.map((line) => {
                const item = itemById.get(line.itemId);
                return (
                  <tr key={line.movementId} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {item ? `${item.name} (${item.unitSymbol})` : line.itemId}
                    </td>
                    <td className="px-4 py-3">{formatNumber(line.quantity)}</td>
                    {canViewCosts && (
                      <>
                        <td className="px-4 py-3">{formatINR(line.unitCost)}</td>
                        <td className="px-4 py-3">
                          {formatINR(line.oldAvgCost)} →{" "}
                          {formatINR(line.newAvgCost)}
                        </td>
                      </>
                    )}
                    <td
                      className="px-4 py-3 font-mono text-xs text-muted-foreground"
                      title={line.movementId}
                    >
                      {line.movementId.slice(0, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Stock levels and average costs are updated. Corrections are posted
          as new movements — receipts cannot be edited.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Scan invoice"
        description="Photograph a supplier bill. The scanner drafts the receipt lines — you review every line before anything posts."
        actions={
          <Button variant="outline" asChild className="min-h-[44px]">
            <Link to="/receiving">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Receiving
            </Link>
          </Button>
        }
      />

      {queued && (
        <div
          role="status"
          className="mb-6 rounded-md border border-dashed border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/20"
        >
          <p className="font-medium">Receipt queued for sync.</p>
          <p className="mt-1 text-muted-foreground">
            You&apos;re offline — the receipt is saved on this device and will
            post to the ledger when you reconnect.
          </p>
        </div>
      )}

      {phase === "capture" && (
        <div className="mx-auto max-w-xl">
          {scanError && (
            <div
              role="alert"
              className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
            >
              <p className="font-medium">Couldn&apos;t scan that photo.</p>
              <p className="mt-1 text-muted-foreground">{scanError}</p>
              {rawText && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    What the scanner saw
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 font-mono text-xs">
                    {rawText}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div className="rounded-md border p-6 text-center">
            <ScanText
              className="mx-auto h-10 w-10 text-muted-foreground"
              aria-hidden
            />
            <p className="mt-3 font-medium">Photograph the supplier bill</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Lay the bill flat in good light. The photo is only used for
              scanning and is discarded afterwards — it is never stored.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Bill photo"
              onChange={(event) => onFileSelected(event.target.files?.[0])}
            />

            {imageUrl ? (
              <div className="mt-4">
                <img
                  src={imageUrl}
                  alt="Bill photo preview"
                  className="mx-auto max-h-64 rounded-md border object-contain"
                />
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Button
                    variant="outline"
                    className="min-h-[44px]"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="mr-2 h-4 w-4" aria-hidden />
                    Choose a different photo
                  </Button>
                  <Button
                    className="min-h-[44px]"
                    onClick={startScan}
                    disabled={receivable.isLoading}
                  >
                    <ScanText className="mr-2 h-4 w-4" aria-hidden />
                    Scan bill
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <Button
                  className="min-h-[44px]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="mr-2 h-4 w-4" aria-hidden />
                  Take a photo
                </Button>
                {isSimulateOcr() && (
                  <Button
                    variant="secondary"
                    className="min-h-[44px]"
                    onClick={simulateScan}
                    disabled={receivable.isLoading}
                  >
                    Simulate scan
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "scanning" && (
        <div
          className="mx-auto max-w-xl rounded-md border p-8 text-center"
          role="status"
          aria-live="polite"
        >
          <div
            className="mx-auto h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={ocrProgress ? ocrStatusCopy(ocrProgress.status) : "Scanning"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((ocrProgress?.progress ?? 0) * 100)}
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((ocrProgress?.progress ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-4 font-medium">
            {ocrProgress ? ocrStatusCopy(ocrProgress.status) : "Starting…"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {ocrProgress && ocrProgress.progress > 0
              ? `${Math.round(ocrProgress.progress * 100)}%`
              : "This can take a few seconds on the first scan."}
          </p>
        </div>
      )}

      {phase === "review" && (
        <div>
          {receivable.isError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center"
            >
              <p className="font-medium">Couldn&apos;t load items.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The draft is kept — retry loading items to continue reviewing.
              </p>
              <Button
                variant="outline"
                className="mt-3 min-h-[44px]"
                onClick={() => receivable.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : (
          <>
          <div className="mb-6 rounded-md border bg-muted/30 p-4">
            <p className="font-medium">
              Review the draft — {draft.length}{" "}
              {draft.length === 1 ? "line" : "lines"} from the bill
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check every line: fix the item match, quantities and costs.
              Nothing posts until you confirm.
            </p>
            <div className="mt-4 max-w-sm">
              <label className={labelClass} htmlFor="invoice-supplier">
                Bill supplier{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <select
                id="invoice-supplier"
                className={inputClass}
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
                disabled={suppliersQuery.isLoading}
              >
                <option value="">No supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Recorded in the receipt notes — ad hoc receipts don&apos;t
                link suppliers directly.
              </p>
            </div>
          </div>

          {draft.length === 0 ? (
            <div className="rounded-md border p-6 text-center">
              <p className="font-medium">No draft lines left.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You removed every line — scan the bill again to start over.
              </p>
              <Button
                variant="outline"
                className="mt-4 min-h-[44px]"
                onClick={resetAll}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                Scan again
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {draft.map((line, index) => {
                  const selectedItem = itemById.get(line.itemId);
                  return (
                    <fieldset
                      key={line.key}
                      className="rounded-md border p-4"
                      aria-label={`Draft line ${index + 1}`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold" aria-hidden>
                            Line {index + 1}
                          </span>
                          {line.autoMatched ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                              Auto-matched
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              Pick an item
                            </span>
                          )}
                          {line.status === "unparsed" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              <FileWarning className="h-3 w-3" aria-hidden />
                              Hard to read — check carefully
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px]"
                          onClick={() => removeDraftLine(line.key)}
                          aria-label={`Remove draft line ${index + 1}`}
                        >
                          <Trash2
                            className="mr-1 h-4 w-4 text-destructive"
                            aria-hidden
                          />
                          Remove
                        </Button>
                      </div>

                      <p className="mb-3 font-mono text-xs text-muted-foreground">
                        Scanned: {line.rawText || "—"}
                      </p>

                      <div className="grid gap-4 sm:grid-cols-3">
                        <div>
                          <label
                            className={labelClass}
                            htmlFor={`${line.key}-item`}
                          >
                            Item
                          </label>
                          <select
                            id={`${line.key}-item`}
                            className={inputClass}
                            value={line.itemId}
                            onChange={(event) =>
                              updateDraft(line.key, {
                                itemId: event.target.value,
                                autoMatched: false,
                              })
                            }
                          >
                            <option value="">Select an item…</option>
                            {receivable.items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ({item.unitSymbol})
                              </option>
                            ))}
                          </select>
                          {line.fieldErrors.itemId && (
                            <p role="alert" className={errorClass}>
                              {line.fieldErrors.itemId}
                            </p>
                          )}
                        </div>
                        <div>
                          <label
                            className={labelClass}
                            htmlFor={`${line.key}-qty`}
                          >
                            Quantity
                            {selectedItem ? ` (${selectedItem.unitSymbol})` : ""}
                          </label>
                          <input
                            id={`${line.key}-qty`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            className={inputClass}
                            value={line.quantity}
                            onChange={(event) =>
                              updateDraft(line.key, {
                                quantity: event.target.value,
                              })
                            }
                          />
                          {line.fieldErrors.quantity && (
                            <p role="alert" className={errorClass}>
                              {line.fieldErrors.quantity}
                            </p>
                          )}
                        </div>
                        <div>
                          <label
                            className={labelClass}
                            htmlFor={`${line.key}-cost`}
                          >
                            Unit cost (₹)
                          </label>
                          <input
                            id={`${line.key}-cost`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            className={inputClass}
                            value={line.unitCost}
                            onChange={(event) =>
                              updateDraft(line.key, {
                                unitCost: event.target.value,
                              })
                            }
                          />
                          {line.fieldErrors.unitCost && (
                            <p role="alert" className={errorClass}>
                              {line.fieldErrors.unitCost}
                            </p>
                          )}
                        </div>
                      </div>
                    </fieldset>
                  );
                })}
              </div>

              <details className="mt-6 rounded-md border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  What the scanner saw ({rawText.split("\n").length} lines)
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 font-mono text-xs">
                  {rawText}
                </pre>
              </details>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={resetAll}
                >
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  Discard and re-scan
                </Button>
                <Button
                  className="min-h-[44px]"
                  onClick={postReceipt}
                  disabled={receiveGoods.isPending}
                >
                  {receiveGoods.isPending
                    ? "Posting receipt…"
                    : `Post receipt (${draft.length} ${draft.length === 1 ? "line" : "lines"})`}
                </Button>
              </div>
            </>
          )}
          </>
        )}
      </div>
      )}
    </div>
  );
}
