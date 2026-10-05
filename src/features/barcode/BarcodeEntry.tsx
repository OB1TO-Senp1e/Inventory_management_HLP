import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ScanLine, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/useAuth";
import type { ReceivableItem } from "@/api/stock";
import { useBarcodeLookup } from "./hooks";

/**
 * Lazy-loaded: the scanner pulls in @zxing/browser (~300KB), which is only
 * needed when the user actually taps "Scan". The typed-code path never
 * downloads it.
 */
const BarcodeScanner = lazy(() =>
  import("./BarcodeScanner").then((module) => ({
    default: module.BarcodeScanner,
  })),
);

export interface BarcodeEntryProps {
  /**
   * Called with the resolved item. The parent owns what happens next:
   * the receiving page appends a receipt line, the count sheet jumps to
   * the item's row.
   */
  onResolved: (item: ReceivableItem) => void;
  /** Short hint rendered under the input (e.g. what a scan does here). */
  hint?: string;
  /** id prefix for the input, to keep labels unique when used twice. */
  idPrefix?: string;
}

const inputClass =
  "h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

type LookupOutcome =
  | { kind: "found"; code: string; item: ReceivableItem }
  | { kind: "not-found"; code: string }
  | null;

/**
 * Reusable barcode entry (V2-01): a manual code input plus a camera-scan
 * button. Keyboard-wedge scanners type digits and press Enter — that is
 * just a form submit, so typed, pasted and scanned codes all resolve
 * through the same lookup. Unknown codes get a clear "no item found"
 * state with a path to create the item (owner/manager) or guidance for
 * staff.
 */
export function BarcodeEntry({ onResolved, hint, idPrefix }: BarcodeEntryProps) {
  const { profile } = useAuth();
  const [code, setCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [outcome, setOutcome] = useState<LookupOutcome>(null);
  const lookup = useBarcodeLookup();

  const canManageItems =
    profile?.role === "owner" || profile?.role === "manager";
  const inputId = `${idPrefix ?? "barcode"}-entry`;

  const resolve = (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) {
      return;
    }
    setOutcome(null);
    lookup.mutate(trimmed, {
      onSuccess: (item) => {
        if (item) {
          setOutcome({ kind: "found", code: trimmed, item });
          setCode("");
          onResolved(item);
        } else {
          setOutcome({ kind: "not-found", code: trimmed });
        }
      },
    });
  };

  const handleScanResult = (scanned: string) => {
    setScannerOpen(false);
    resolve(scanned);
  };

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          resolve(code);
        }}
        noValidate
      >
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
          Barcode
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Scan or type a barcode…"
            aria-describedby={hint ? `${inputId}-hint` : undefined}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={lookup.isPending}
            className={inputClass}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] shrink-0"
            disabled={lookup.isPending}
            onClick={() => setScannerOpen(true)}
            aria-label="Scan with camera"
          >
            <ScanLine className="mr-2 h-4 w-4" aria-hidden />
            Scan
          </Button>
          <Button
            type="submit"
            className="min-h-[44px] shrink-0"
            disabled={lookup.isPending || code.trim() === ""}
          >
            {lookup.isPending ? "Looking up…" : "Find"}
          </Button>
        </div>
        {hint && (
          <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </form>

      <div className="mt-2 min-h-[1.25rem]" aria-live="polite">
        {lookup.isError && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t look up the barcode —{" "}
            <button
              type="button"
              className="underline"
              onClick={() => resolve(code)}
            >
              try again
            </button>
            .
          </p>
        )}
        {outcome?.kind === "found" && (
          <p className="inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-300">
            <Check className="h-4 w-4" aria-hidden />
            Found: {outcome.item.name} ({outcome.item.unitSymbol})
          </p>
        )}
        {outcome?.kind === "not-found" && (
          <div className="rounded-md border border-amber-600/30 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
            <p className="inline-flex items-center gap-1.5 font-medium">
              <TriangleAlert
                className="h-4 w-4 text-amber-700 dark:text-amber-300"
                aria-hidden
              />
              No item found for barcode “{outcome.code}”.
            </p>
            <p className="mt-1 text-muted-foreground">
              {canManageItems ? (
                <>
                  Add the barcode to the item first —{" "}
                  <Link to="/items" className="font-medium underline">
                    go to Items
                  </Link>
                  .
                </>
              ) : (
                "Ask an owner or manager to add this barcode to the item on the Items page."
              )}
            </p>
          </div>
        )}
      </div>

      {scannerOpen && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black text-white"
              role="dialog"
              aria-modal="true"
              aria-label="Loading scanner"
            >
              <p className="text-sm">Loading the scanner…</p>
            </div>
          }
        >
          <BarcodeScanner
            onResult={handleScanResult}
            onClose={() => setScannerOpen(false)}
            title="Scan item barcode"
          />
        </Suspense>
      )}
    </div>
  );
}
