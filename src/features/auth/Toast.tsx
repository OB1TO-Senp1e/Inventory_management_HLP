import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ToastKind = "error" | "success";

/**
 * Minimal toast with an assertive live region. Interim component for the auth
 * feature — the app-wide toast system lands in P0-05 (AppShell) and replaces
 * this. Kept inside features/auth so no other module depends on it.
 */
export function Toast({
  kind,
  message,
  onDismiss,
}: {
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
}) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-4 bottom-4 z-50 rounded-md border px-4 py-3 text-sm shadow-lg",
        kind === "error"
          ? "border-destructive bg-destructive text-destructive-foreground"
          : "border-input bg-card text-card-foreground",
      )}
    >
      {message}
    </div>
  );
}
