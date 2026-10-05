import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  captureEarlyInstallPrompt,
  stashInstallPrompt,
} from "./earlyInstallPrompt";
import { useInstallPrompt } from "./useInstallPrompt";

function makePromptEvent() {
  const event = new Event("beforeinstallprompt");
  (event as unknown as { prompt: () => Promise<void> }).prompt = vi
    .fn()
    .mockResolvedValue(undefined);
  return event;
}

afterEach(() => {
  stashInstallPrompt(null);
  vi.restoreAllMocks();
});

describe("captureEarlyInstallPrompt", () => {
  it("stashes a beforeinstallprompt event fired before the hook mounts", () => {
    captureEarlyInstallPrompt();
    act(() => {
      window.dispatchEvent(makePromptEvent());
    });
    // The hook mounts later (lazy shell chunk) and consumes the stash.
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(true);
  });

  it("notifies every hook instance (mobile + desktop buttons)", () => {
    captureEarlyInstallPrompt();
    // Both instances mount before the event fires (slow chunk load is the
    // other order; both must work).
    const first = renderHook(() => useInstallPrompt());
    const second = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(makePromptEvent());
    });
    expect(first.result.current.canInstall).toBe(true);
    expect(second.result.current.canInstall).toBe(true);
  });

  it("hides all instances after one prompts", async () => {
    captureEarlyInstallPrompt();
    const first = renderHook(() => useInstallPrompt());
    const second = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(makePromptEvent());
    });
    await act(async () => {
      await first.result.current.promptInstall();
    });
    expect(first.result.current.canInstall).toBe(false);
    expect(second.result.current.canInstall).toBe(false);
  });

  it("does nothing when no event was captured", () => {
    captureEarlyInstallPrompt();
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
  });
});
