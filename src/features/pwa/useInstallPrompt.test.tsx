import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAppButton } from "./InstallAppButton";
import { useInstallPrompt } from "./useInstallPrompt";

/** Build a synthetic beforeinstallprompt event with a mock prompt(). */
function dispatchInstallOffer(prompt = vi.fn().mockResolvedValue(undefined)) {
  const event = new Event("beforeinstallprompt");
  (event as unknown as { prompt: () => Promise<void> }).prompt = prompt;
  window.dispatchEvent(event);
  return prompt;
}

beforeEach(() => {
  // jsdom has no matchMedia; the app is not installed in tests.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useInstallPrompt", () => {
  it("is not installable before the browser offers installation", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
  });

  it("becomes installable when beforeinstallprompt fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      dispatchInstallOffer();
    });
    expect(result.current.canInstall).toBe(true);
  });

  it("calls prompt() and hides after prompting", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      dispatchInstallOffer(prompt);
    });
    await act(async () => {
      await result.current.promptInstall();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it("hides when the appinstalled event fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      dispatchInstallOffer();
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.canInstall).toBe(false);
  });
});

describe("InstallAppButton", () => {
  it("renders nothing before the install offer", () => {
    render(<InstallAppButton />);
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("appears on the install offer and prompts on click", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<InstallAppButton />);
    act(() => {
      dispatchInstallOffer(prompt);
    });
    const button = await screen.findByRole("button", { name: "Install app" });
    fireEvent.click(button);
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
    });
  });
});
