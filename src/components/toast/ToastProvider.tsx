import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastContext, type ToastItem, type ToastKind } from "./ToastContext";

const AUTO_DISMISS_MS = 5000;
const MAX_STACK = 4;

function ToastView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const Icon = toast.kind === "error" ? AlertCircle : CheckCircle2;

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-h-[44px] items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg",
        toast.kind === "error"
          ? "border-destructive bg-destructive text-destructive-foreground"
          : "border-input bg-card text-card-foreground",
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className={cn(
          "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          toast.kind === "error" ? "hover:bg-black/10" : "hover:bg-accent",
        )}
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * App-wide toast system. Wrap the whole app once; any component calls
 * `useToast()` to queue success/error notifications. Toasts stack
 * (newest last, capped), auto-dismiss after 5s, and announce via a
 * polite live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-(MAX_STACK - 1)), { id, kind, message }]);
  }, []);

  const api = useMemo(
    () => ({
      notify,
      success: (message: string) => notify("success", message),
      error: (message: string) => notify("error", message),
      dismiss,
    }),
    [notify, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
