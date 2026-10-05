import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BarcodeScanner,
  SIMULATED_BARCODE,
} from "./BarcodeScanner";

const { readerState } = vi.hoisted(() => ({
  readerState: {
    behavior: "success" as "success" | "denied" | "no-camera",
    stop: vi.fn(),
  },
}));

type ScanCallback = (
  result: unknown,
  err: unknown,
  controls: { stop: () => void },
) => void;

// The zxing reader is mocked: these tests verify the component's state
// machine (starting / scanning / error kinds), the one-shot result flow,
// cleanup, and the ?simulateScan=1 test seam — with zero camera.
vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromVideoDevice(
      _deviceId: unknown,
      _video: unknown,
      callback: ScanCallback,
    ): Promise<{ stop: () => void }> {
      if (readerState.behavior === "denied") {
        return Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        );
      }
      if (readerState.behavior === "no-camera") {
        return Promise.reject(
          new DOMException("No video device", "NotFoundError"),
        );
      }
      const controls = { stop: readerState.stop };
      queueMicrotask(() =>
        callback({ getText: () => "8901234567890" }, undefined, controls),
      );
      return Promise.resolve(controls);
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  readerState.behavior = "success";
  window.history.replaceState({}, "", "/");
});

function renderScanner(props?: Partial<{ title: string }>) {
  const onResult = vi.fn();
  const onClose = vi.fn();
  render(
    <BarcodeScanner onResult={onResult} onClose={onClose} title={props?.title} />,
  );
  return { onResult, onClose };
}

describe("BarcodeScanner", () => {
  it("renders as a dialog and reports the first decoded code once", async () => {
    const { onResult } = renderScanner({ title: "Scan item barcode" });
    expect(
      screen.getByRole("dialog", { name: "Scan item barcode" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith("8901234567890"),
    );
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(readerState.stop).toHaveBeenCalled();
  });

  it("shows the permission-denied state with a way back", async () => {
    readerState.behavior = "denied";
    const { onClose } = renderScanner();
    await waitFor(() =>
      expect(screen.getByText("Camera access was denied")).toBeVisible(),
    );
    expect(
      screen.getByText(/Allow camera access in your browser settings/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /type the code instead/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the no-camera state when the device has no camera", async () => {
    readerState.behavior = "no-camera";
    renderScanner();
    await waitFor(() =>
      expect(screen.getByText("No camera found")).toBeVisible(),
    );
  });

  it("close button calls onClose", async () => {
    const { onClose } = renderScanner();
    await waitFor(() =>
      expect(screen.getByText(/point the camera at a barcode/i)).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close scanner" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the simulate-scan seam only with ?simulateScan=1", async () => {
    const first = renderScanner();
    await waitFor(() =>
      expect(first.onResult).toHaveBeenCalledWith("8901234567890"),
    );
    expect(
      screen.queryByRole("button", { name: /simulate scan/i }),
    ).not.toBeInTheDocument();
    first.onResult.mockClear();

    window.history.replaceState({}, "", "/?simulateScan=1");
    const { onResult } = renderScanner();
    const simulate = await screen.findByRole("button", {
      name: /simulate scan/i,
    });
    fireEvent.click(simulate);
    expect(onResult).toHaveBeenCalledWith(SIMULATED_BARCODE);
  });
});
