import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInstallPrompt } from "./useInstallPrompt";

/**
 * "Install app" button (P6-01). Rendered in the app shell chrome; it only
 * appears while the browser is offering installation (`beforeinstallprompt`
 * fired) and the app is not already installed.
 */
export function InstallAppButton({ className }: { className?: string }) {
  const { canInstall, promptInstall } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      aria-label="Install app"
      title="Install app"
      className={cn(
        "flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-md px-3 text-sm font-medium",
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Download aria-hidden="true" className="h-5 w-5 shrink-0" />
      <span className="hidden xl:inline">Install app</span>
    </button>
  );
}
