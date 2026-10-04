/**
 * Shared row-resolution result type for CSV imports (P1-05).
 * Either a validated create-input, or a list of human-readable errors
 * shown in the import preview.
 */
export type ResolvedRow<TInput> =
  | { ok: true; input: TInput }
  | { ok: false; errors: string[] };

/** One CSV column: header text, whether it is required, and help text. */
export interface CsvColumnDef {
  header: string;
  required: boolean;
  description: string;
}
