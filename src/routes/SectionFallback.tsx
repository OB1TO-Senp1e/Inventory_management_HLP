import { Loader2 } from "lucide-react";

/**
 * Minimal loading fallback for lazily-loaded section pages (P6-03).
 *
 * Kept deliberately tiny — it ships in the main entry bundle, so it must
 * not pull in any feature code. Pages keep their own richer skeletons for
 * data loading; this only covers the chunk-download moment.
 */
export function SectionFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-label="Loading section"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
