import { useCallback, useEffect, useState } from "react";

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
 * PWA install prompt (P6-01). Captures `beforeinstallprompt` so the app can
 * surface its own install button, and hides once the app is installed
 * (either via `appinstalled` or an already-standalone display mode).
 */
export function useInstallPrompt(): InstallPromptState {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches
      : false,
  );

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress the automatic mini-infobar; the app shows its own button.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    // Hide the button once the user has seen the prompt; the
    // `appinstalled` event covers acceptance.
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  return { canInstall: !installed && deferredPrompt !== null, promptInstall };
}
