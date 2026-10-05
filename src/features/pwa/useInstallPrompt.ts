import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getInstallPrompt,
  stashInstallPrompt,
  subscribeInstallPrompt,
} from "./earlyInstallPrompt";

/**
 * The install prompt event Chromium fires when the PWA is installable.
 * Not part of the TS DOM lib, so it is declared here.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface InstallPromptState {
  /** True when the browser has offered installation and the app is not yet installed. */
  canInstall: boolean;
  /** Show the browser install prompt. No-op when there is nothing to prompt. */
  promptInstall: () => Promise<void>;
}

/**
 * PWA install prompt (P6-01, shared store P6-03). The deferred
 * `beforeinstallprompt` event lives in a module-level store (see
 * `./earlyInstallPrompt`) so every hook instance — the button is rendered
 * in both the mobile top bar and the desktop header — sees it, and hiding
 * after prompting hides all instances. The entry bundle captures the event
 * early via `captureEarlyInstallPrompt` so a fast-firing event isn't lost
 * while the lazy shell chunk downloads.
 */
export function useInstallPrompt(): InstallPromptState {
  const deferredPrompt = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPrompt,
  );
  const [installed, setInstalled] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches
      : false,
  );

  useEffect(() => {
    // Fallback for environments where captureEarlyInstallPrompt was not
    // called (unit tests): forward late-firing events into the shared store.
    // In the app the entry bundle's listener is already attached and also
    // calls preventDefault(); double-handling is harmless (idempotent stash).
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      stashInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      stashInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const promptEvent = getInstallPrompt();
    // Clear first: hides every button instance, and a remount won't re-offer
    // the consumed event.
    stashInstallPrompt(null);
    await promptEvent?.prompt();
  }, []);

  return { canInstall: !installed && deferredPrompt !== null, promptInstall };
}
