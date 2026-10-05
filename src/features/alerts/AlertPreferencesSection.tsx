import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast/useToast";
import { cn } from "@/lib/utils";
import {
  useAlertPreferences,
  useUpdateAlertPreferences,
} from "./hooks";

/**
 * Alert preferences (V2-03): owner/manager only, rendered as a tab on
 * /settings. Controls which smart-alert types the background engine
 * generates and how far ahead expiry alerts look.
 *
 * Also hosts the browser-notification permission request — the
 * Notification API prompt must come from a user gesture, so it lives on
 * an explicit button rather than firing automatically.
 */

function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

type PushState = "unsupported" | "granted" | "denied" | "default";

function pushState(): PushState {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission as PushState;
}

export function AlertPreferencesSection() {
  const { success, error: toastError } = useToast();
  const { data, isLoading, isError, refetch } = useAlertPreferences();
  const update = useUpdateAlertPreferences();

  const [lowStock, setLowStock] = useState(true);
  const [expiry, setExpiry] = useState(true);
  const [windowDays, setWindowDays] = useState("7");
  const [windowError, setWindowError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>(() => pushState());

  // Seed the form once the preferences load.
  useEffect(() => {
    if (data) {
      setLowStock(data.lowStockEnabled);
      setExpiry(data.expiryEnabled);
      setWindowDays(String(data.expiryDaysWindow));
    }
  }, [data]);

  const dirty =
    data != null &&
    (lowStock !== data.lowStockEnabled ||
      expiry !== data.expiryEnabled ||
      windowDays !== String(data.expiryDaysWindow));

  const save = () => {
    const days = Number(windowDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      setWindowError("Enter a whole number of days between 1 and 90.");
      return;
    }
    setWindowError(null);
    update.mutate(
      {
        lowStockEnabled: lowStock,
        expiryEnabled: expiry,
        expiryDaysWindow: days,
      },
      {
        onSuccess: () => success("Alert preferences saved."),
        onError: (e) =>
          toastError(
            e instanceof Error ? e.message : "Couldn't save preferences.",
          ),
      },
    );
  };

  const requestPush = async () => {
    if (typeof Notification === "undefined") {
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPush(result as PushState);
      if (result === "granted") {
        success("Browser notifications enabled.");
      }
    } catch {
      setPush(pushState());
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" aria-label="Loading alert preferences">
        {[0, 1].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-12 text-center">
        <p className="text-sm font-medium">
          Couldn&apos;t load alert preferences.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => void refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Switch
          checked={lowStock}
          onChange={setLowStock}
          label="Low-stock alerts"
          description="Alert when an item's stock falls to or below its reorder point."
        />
        <Switch
          checked={expiry}
          onChange={setExpiry}
          label="Expiring-soon alerts"
          description="Alert for batches that still hold stock and expire within the window below."
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <label
          htmlFor="expiry-window"
          className="block text-sm font-medium"
        >
          Expiry alert window (days)
        </label>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Batches expiring within this many days trigger an alert.
        </p>
        <input
          id="expiry-window"
          type="number"
          min={1}
          max={90}
          inputMode="numeric"
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
          className={cn(
            "mt-2 h-11 w-32 rounded-md border bg-background px-3 text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            windowError && "border-destructive",
          )}
        />
        {windowError && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {windowError}
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">Browser notifications</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {push === "unsupported" &&
            "This browser doesn't support notifications — alerts still appear in the inbox."}
          {push === "granted" &&
            "Enabled. New alerts will also pop up while the app is open."}
          {push === "denied" &&
            "Blocked. Allow notifications in your browser settings to get pop-ups — alerts still appear in the inbox."}
          {push === "default" &&
            "Get a pop-up for new alerts while the app is open (the inbox always has them)."}
        </p>
        {(push === "default" || push === "denied") && (
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => void requestPush()}
          >
            <BellRing aria-hidden="true" className="mr-2 h-4 w-4" />
            {push === "denied" ? "Try again" : "Enable browser notifications"}
          </Button>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}
