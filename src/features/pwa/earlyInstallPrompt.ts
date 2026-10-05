import type { BeforeInstallPromptEvent } from "./useInstallPrompt";

declare global {
  interface Window {
    /**
     * Mirror of the module-level stash, for debugging and tests.
     * The module state (not this) is the source of truth.
     */
    __riDeferredInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/**
 * Shared stash for the `beforeinstallprompt` event (P6-03).
 *
 * The install button is rendered twice (mobile top bar + desktop header),
 * so two `useInstallPrompt` instances mount. A single-consumer stash would
 * let whichever mounts first swallow the event and leave the other (possibly
 * the visible one) without it. This module-level store notifies ALL
 * subscribers, and `useInstallPrompt` reads it via `useSyncExternalStore`.
 */
let current: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function syncWindow(): void {
  if (typeof window !== "undefined") {
    window.__riDeferredInstallPrompt = current;
  }
}

/** Store (or clear) the event and notify every hook instance. */
export function stashInstallPrompt(
  event: BeforeInstallPromptEvent | null,
): void {
  current = event;
  syncWindow();
  subscribers.forEach((fn) => fn());
}

/** The currently stashed event, if any. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return current;
}

/** Subscribe to stash changes; returns an unsubscribe function. */
export function subscribeInstallPrompt(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Capture `beforeinstallprompt` as early as possible (P6-03).
 *
 * Called once from the entry bundle. The install button lives in the lazy
 * shell chunk; without this, a fast-firing `beforeinstallprompt` would be
 * lost while that chunk is still downloading and the user would never see
 * the install affordance.
 */
export function captureEarlyInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress the automatic mini-infobar; the app shows its own button.
    event.preventDefault();
    stashInstallPrompt(event as BeforeInstallPromptEvent);
  });
}
