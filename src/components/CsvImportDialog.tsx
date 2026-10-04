import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleCheck,
  CircleX,
  Download,
  FileUp,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildCsvContent,
  downloadCSV,
  parseCsvFile,
  type CsvParseResult,
} from "@/lib/csv";
import type { CsvColumnDef, ResolvedRow } from "@/features/importExport/csvTypes";
import type { ImportFailure } from "@/features/importExport/hooks";

/**
 * Generic CSV import dialog (P1-05). Shared by the items and suppliers
 * pages — the kind-specific bits (columns, row validation, the actual
 * import) are injected as props so this component stays purely about the
 * file → preview → import → report flow.
 *
 * Nothing is committed before the user presses "Import": parsing and row
 * validation only ever produce a preview. Closing the dialog is always
 * safe (except mid-import, when closing is disabled).
 */

export interface ValidatedRow<TInput> {
  /** 1-based data-row number (excluding the header). */
  index: number;
  /** The record as parsed, keyed by canonical header. */
  raw: Record<string, string>;
  result: ResolvedRow<TInput>;
}

export type LookupsStatus = "loading" | "error" | "ready";

export interface CsvImportDialogProps<TInput> {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  templateFilename: string;
  columns: CsvColumnDef[];
  lookupsStatus: LookupsStatus;
  onRetryLookups: () => void;
  /** Pure + cheap: called during render once a file is parsed. */
  validateRecords: (records: Record<string, string>[]) => ValidatedRow<TInput>[];
  importRows: (input: {
    rows: { index: number; input: TInput }[];
    onProgress: (done: number, total: number) => void;
  }) => Promise<{ imported: number; failures: ImportFailure[] }>;
}

type Phase = "preview" | "importing" | "done";

/** Match headers case-insensitively; report missing required columns. */
function normalizeRecords(
  headers: string[],
  rows: Record<string, string>[],
  columns: CsvColumnDef[],
): { records: Record<string, string>[]; missing: string[] } {
  const byLower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const missing = columns
    .filter((c) => c.required && !byLower.has(c.header.toLowerCase()))
    .map((c) => c.header);
  const records = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      const actual = byLower.get(col.header.toLowerCase());
      out[col.header] = actual === undefined ? "" : (row[actual] ?? "");
    }
    return out;
  });
  return { records, missing };
}

export function CsvImportDialog<TInput>({
  open,
  onClose,
  title,
  description,
  templateFilename,
  columns,
  lookupsStatus,
  onRetryLookups,
  validateRecords,
  importRows,
}: CsvImportDialogProps<TInput>) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parse, setParse] = useState<CsvParseResult | null>(null);
  const [phase, setPhase] = useState<Phase>("preview");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<{
    imported: number;
    failures: ImportFailure[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Reset all state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setFile(null);
      setParsing(false);
      setParse(null);
      setPhase("preview");
      setProgress(null);
      setResult(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [open ]);

  // Escape closes (except mid-import); initial focus on the close button.
  useEffect(() => {
    if (!open) {
      return;
    }
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "importing") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, phase]);

  const normalized = useMemo(() => {
    if (!parse || !parse.ok) {
      return null;
    }
    return normalizeRecords(parse.headers, parse.rows, columns);
  }, [parse, columns]);

  const validated: ValidatedRow<TInput>[] | null = useMemo(() => {
    if (!normalized || normalized.missing.length > 0 || lookupsStatus !== "ready") {
      return null;
    }
    return validateRecords(normalized.records);
  }, [normalized, lookupsStatus, validateRecords]);

  if (!open) {
    return null;
  }

  const pickFile = async (picked: File | null) => {
    if (!picked) {
      return;
    }
    setFile(picked);
    setParse(null);
    setResult(null);
    setPhase("preview");
    setParsing(true);
    try {
      setParse(await parseCsvFile(picked));
    } finally {
      setParsing(false);
    }
  };

  const resetToPicker = () => {
    setFile(null);
    setParse(null);
    setPhase("preview");
    setProgress(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    downloadCSV(
      templateFilename,
      buildCsvContent(
        columns.map((c) => c.header),
        [],
      ),
    );
  };

  const startImport = async () => {
    if (!validated) {
      return;
    }
    const valid = validated.filter(
      (v): v is ValidatedRow<TInput> & { result: { ok: true; input: TInput } } =>
        v.result.ok,
    );
    if (valid.length === 0) {
      return;
    }
    setPhase("importing");
    setProgress({ done: 0, total: valid.length });
    try {
      const res = await importRows({
        rows: valid.map((v) => ({ index: v.index, input: v.result.input })),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(res);
    } finally {
      setPhase("done");
    }
  };

  const validCount =
    validated?.filter((v) => v.result.ok).length ?? 0;
  const errorCount =
    validated?.filter((v) => !v.result.ok).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={phase === "importing" ? undefined : onClose}
        aria-hidden="true"
      />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-background p-6 shadow-lg">
        <div className="mb-1 flex items-start justify-between gap-4">
          <h2
            id="csv-import-title"
            className="text-lg font-semibold tracking-tight"
          >
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={phase === "importing"}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            <Download aria-hidden="true" />
            Download template
          </Button>
          <details className="text-sm">
            <summary className="cursor-pointer text-sm font-medium text-primary">
              Expected columns
            </summary>
            <ul className="mt-2 space-y-1 rounded-md border p-3">
              {columns.map((col) => (
                <li key={col.header}>
                  <code className="rounded bg-muted px-1 font-mono text-xs">
                    {col.header}
                  </code>{" "}
                  {col.required ? (
                    <span className="text-xs font-medium text-destructive">
                      required
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">optional</span>
                  )}{" "}
                  <span className="text-xs text-muted-foreground">
                    — {col.description}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!file && (
            <label
              htmlFor="csv-import-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center hover:border-primary"
            >
              <FileUp className="size-8 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">Choose a CSV file</span>
              <span className="text-sm text-muted-foreground">
                .csv only, up to 5 MB. Nothing is imported until you review the
                preview and confirm.
              </span>
              <input
                ref={fileInputRef}
                id="csv-import-file"
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={(event) => void pickFile(event.target.files?.[0] ?? null)}
              />
            </label>
          )}

          {file && parsing && (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              Reading {file.name}…
            </div>
          )}

          {file && !parsing && parse && !parse.ok && (
            <div>
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
              >
                <TriangleAlert
                  className="mt-0.5 size-5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium">Couldn't read this file</p>
                  <p className="mt-1">{parse.error}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={resetToPicker}
              >
                Choose another file
              </Button>
            </div>
          )}

          {file && !parsing && parse?.ok && phase !== "done" && (
            <div>
              {normalized && normalized.missing.length > 0 ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
                >
                  <TriangleAlert
                    className="mt-0.5 size-5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-medium">Missing required columns</p>
                    <p className="mt-1">
                      {normalized.missing.map((h) => `"${h}"`).join(", ")} —{" "}
                      download the template to see the expected format.
                    </p>
                  </div>
                </div>
              ) : lookupsStatus === "loading" ? (
                <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                  Loading reference data…
                </div>
              ) : lookupsStatus === "error" ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
                >
                  <TriangleAlert
                    className="mt-0.5 size-5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-medium">Couldn't load reference data</p>
                    <p className="mt-1">
                      Category, unit and location names can't be checked without
                      it.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={onRetryLookups}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              ) : validated && validated.length === 0 ? (
                <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                  The file has no data rows. Add rows under the header row and
                  try again.
                </p>
              ) : (
                validated && (
                  <div>
                    <p className="mb-2 text-sm" aria-live="polite">
                      <span className="font-medium">{validated.length} rows:</span>{" "}
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {validCount} valid
                      </span>
                      {", "}
                      <span className="text-destructive">
                        {errorCount} with errors
                      </span>
                    </p>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50 text-left">
                            <th className="px-3 py-2 font-medium">Row</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validated.map((row) => (
                            <tr key={row.index} className="border-b last:border-0">
                              <td className="px-3 py-2 tabular-nums">
                                {row.index}
                              </td>
                              <td className="px-3 py-2">
                                {row.result.ok ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                                    <CircleCheck
                                      className="size-4"
                                      aria-hidden="true"
                                    />
                                    Ready
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-destructive">
                                    <CircleX
                                      className="size-4"
                                      aria-hidden="true"
                                    />
                                    Error
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.result.ok ? (
                                  <span className="text-muted-foreground">
                                    Will be imported
                                  </span>
                                ) : (
                                  <ul className="list-disc space-y-0.5 pl-4">
                                    {row.result.errors.map((err, i) => (
                                      <li key={i}>{err}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {phase === "importing" && progress && (
            <div className="p-6 text-center">
              <Loader2
                className="mx-auto size-8 animate-spin text-primary"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm font-medium" aria-live="polite">
                Importing row {progress.done} of {progress.total}…
              </p>
              <div
                className="mx-auto mt-3 h-2 max-w-sm overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progress.done}
                aria-valuemin={0}
                aria-valuemax={progress.total}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {phase === "done" && result && (
            <div>
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border p-4 text-sm"
              >
                <CircleCheck
                  className="mt-0.5 size-5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium">
                    Imported {result.imported}{" "}
                    {result.imported === 1 ? "row" : "rows"}.
                  </p>
                  {result.failures.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      {result.failures.length}{" "}
                      {result.failures.length === 1 ? "row" : "rows"} failed
                      (e.g. duplicate names) — nothing else was affected.
                    </p>
                  )}
                </div>
              </div>
              {result.failures.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.failures.map((f) => (
                        <tr key={f.index} className="border-b last:border-0">
                          <td className="px-3 py-2 tabular-nums">{f.index}</td>
                          <td className="px-3 py-2">{f.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={resetToPicker}
              >
                Import another file
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={phase === "importing"}
          >
            {phase === "done" ? "Done" : "Cancel"}
          </Button>
          {phase === "preview" && validated && validated.length > 0 && (
            <Button
              type="button"
              onClick={() => void startImport()}
              disabled={
                validCount === 0 ||
                lookupsStatus !== "ready" ||
                (normalized?.missing.length ?? 0) > 0
              }
            >
              Import {validCount} valid{" "}
              {validCount === 1 ? "row" : "rows"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
