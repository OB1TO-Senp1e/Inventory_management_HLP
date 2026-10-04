import Papa from "papaparse";

/**
 * CSV utilities (P1-05). Parsing is done with papaparse (never hand-rolled:
 * quotes, embedded commas/newlines and escapes are easy to get wrong).
 * Building export content is a tiny RFC-4180 quoter over string grids.
 */

export interface CsvParseSuccess {
  ok: true;
  /** Header names as they appear in the file (trimmed). */
  headers: string[];
  /** One object per data row, keyed by header. All values are strings. */
  rows: Record<string, string>[];
}

export interface CsvParseFailure {
  ok: false;
  /** Human-friendly reason the file could not be parsed at all. */
  error: string;
}

export type CsvParseResult = CsvParseSuccess | CsvParseFailure;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — plenty for a restaurant catalog

export function isCsvFilename(name: string): boolean {
  return name.trim().toLowerCase().endsWith(".csv");
}

/**
 * Parse CSV text into header-keyed row objects.
 * Never throws and never crashes on garbage input: malformed content
 * resolves to `{ ok: false, error }` with a message suitable for display.
 * Per-row problems (wrong values, missing cells) are NOT parse errors —
 * they are reported later by row validation so the user sees them in the
 * preview table.
 */
export function parseCsvText(text: string): CsvParseResult {
  if (text.includes("\0")) {
    return {
      ok: false,
      error:
        "This doesn't look like a CSV file (it contains binary data). Please choose a proper .csv file.",
    };
  }
  if (text.trim() === "") {
    return {
      ok: false,
      error:
        "The file is empty. Choose a CSV file with a header row and data.",
    };
  }

  let result: CsvParseResult = {
    ok: false,
    error: "Could not parse the CSV file.",
  };
  // Strip a leading BOM so it doesn't pollute the first header name.
  const clean = text.replace(/^\uFEFF/, "");
  Papa.parse<Record<string, string>>(clean, {
    header: true,
    // Our templates are comma-separated; fixing the delimiter also avoids
    // papaparse's "undetectable delimiter" false positive on single-column
    // files.
    delimiter: ",",
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    complete: (results) => {
      const headers = (results.meta.fields ?? []).map((h) => h.trim());
      // Papaparse renames duplicate empty headers to _1, _2, … — treat a
      // header row of only empties/auto-renames as "no header row".
      const isBlankHeader = (h: string): boolean =>
        h === "" || /^_\d+$/.test(h);
      if (headers.length === 0 || headers.every(isBlankHeader)) {
        result = {
          ok: false,
          error:
            "No header row was found — this doesn't look like a CSV file. Download the template to see the expected format.",
        };
        return;
      }
      const fatal = results.errors.find((e) => e.type !== "FieldMismatch");
      if (fatal) {
        result = {
          ok: false,
          error: `Could not parse the CSV file (row ${fatal.row ?? "?"}: ${fatal.message}). Check the file and try again.`,
        };
        return;
      }
      const rows = (results.data as Record<string, string>[]).filter(
        (row) =>
          row !== null &&
          typeof row === "object" &&
          Object.values(row).some(
            (v) => v !== null && v !== undefined && String(v).trim() !== "",
          ),
      );
      result = { ok: true, headers, rows };
    },
    error: (err: Error) => {
      result = {
        ok: false,
        error: `Could not read the file: ${err.message}`,
      };
    },
  });
  return result;
}

/**
 * Parse a user-picked file. Validates the file itself first (extension,
 * size), then delegates to `parseCsvText`.
 */
export async function parseCsvFile(file: File): Promise<CsvParseResult> {
  if (!isCsvFilename(file.name)) {
    return {
      ok: false,
      error: `"${file.name}" is not a .csv file. Please choose a CSV file.`,
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      error:
        "The file is empty. Choose a CSV file with a header row and data.",
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error:
        "The file is larger than 5 MB. Split it into smaller files and try again.",
    };
  }
  const text = await file.text();
  return parseCsvText(text);
}

/** Quote one CSV cell per RFC 4180. */
function quoteCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build CSV text from headers + string rows. Starts with a UTF-8 BOM so
 * Excel opens non-ASCII names correctly.
 */
export function buildCsvContent(
  headers: string[],
  rows: string[][],
): string {
  const lines = [
    headers.map(quoteCell).join(","),
    ...rows.map((row) => row.map((cell) => quoteCell(cell ?? "")).join(",")),
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Trigger a download of `content` as `filename` in the browser. */
export function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** `items-2026-10-04.csv`-style filename for exports. */
export function csvFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}
