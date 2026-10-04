import { useContext } from "react";
import { ToastContext } from "./ToastContext";

/** Access the app-wide toast queue. Must be used inside <ToastProvider>. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
