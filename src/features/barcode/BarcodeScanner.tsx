import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { CameraOff, ScanLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface BarcodeScannerProps {
  /** Called once with the first successfully decoded code. */
  onResult: (code: string) => void;
  onClose: () => void;
  title?: string;
}

/**
 * Test seam for deterministic e2e: with `?simulateScan=1` in the URL the
 * overlay also renders a "Simulate scan" button that reports a canned code.
 * The real camera path (zxing decodeFromVideoDevice) is always the primary
 * implementation — the seam is only a fallback for environments where the
 * fake camera is flaky. Unit tests mock `@zxing/browser` instead.
 */
export const SIMULATE_SCAN_PARAM = "simulateScan";
export const SIMULATED_BARCODE = "8901234567890";

type ScannerStatus = "starting" | "scanning" | "error";
type ScannerErrorKind = "denied" | "no-camera" | "in-use" | "failed";

const ERROR_COPY: Record<ScannerErrorKind, { title: string; body: string }> = {
  denied: {
    title: "Camera access was denied",
    body: "Allow camera access in your browser settings, then try again. You can also type the barcode below instead.",
  },
  "no-camera": {
    title: "No camera found",
    body: "This device doesn't have a camera available. Type the barcode manually instead.",
  },
  "in-use": {
    title: "Camera is busy",
    body: "Another app is using the camera. Close it and try again — or type the barcode manually.",
  },
  failed: {
    title: "Couldn't start the camera",
    body: "Something went wrong starting the camera. Try again, or type the barcode manually.",
  },
};

function toErrorKind(error: unknown): ScannerErrorKind {
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === "object" && error !== null && "name" in error
        ? String((error as { name: unknown }).name)
        : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "no-camera";
  if (name === "NotReadableError" || name === "AbortError") return "in-use";
  return "failed";
}

/**
 * Full-screen camera barcode scanner (V2-01). Phone-first: the video fills
 * the viewport with a scan-frame guide, large touch targets, and explicit
 * error states for denied permission / missing camera / busy camera.
 *
 * Decodes once and reports — the parent decides what to do with the code
 * (receiving appends a line, the count sheet jumps to the row). Stream and
 * decoder are always released on unmount.
 */
export function BarcodeScanner({ onResult, onClose, title }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const settledRef = useRef(false);
  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [errorKind, setErrorKind] = useState<ScannerErrorKind>("failed");
  const [attempt, setAttempt] = useState(0);

  const allowSimulate =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has(SIMULATE_SCAN_PARAM);

  useEffect(() => {
    settledRef.current = false;
    // No format hints: the multi-format reader tries every supported
    // symbology by default (EAN/UPC/Code 128/39/ITF/QR…).
    const reader = new BrowserMultiFormatReader();
    const video = videoRef.current;
    let cancelled = false;

    const start = async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          video ?? undefined,
          (result, _err, controls) => {
            if (cancelled || settledRef.current) {
              return;
            }
            if (result) {
              settledRef.current = true;
              controls.stop();
              onResult(result.getText());
            }
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStatus("scanning");
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorKind(toErrorKind(error));
        setStatus("error");
      }
    };

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      // Belt-and-braces: release any tracks the reader left behind.
      // (MediaStream is undefined in jsdom — the typeof guard keeps the
      // cleanup test-safe.)
      const stream = video?.srcObject;
      if (
        typeof MediaStream !== "undefined" &&
        stream instanceof MediaStream
      ) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (video) {
        video.srcObject = null;
      }
    };
    // `attempt` re-runs the whole setup after a manual retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = () => {
    setStatus("starting");
    setAttempt((n) => n + 1);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Scan barcode"}
    >
      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between gap-4 p-4">
        <p className="text-base font-semibold text-white">
          {title ?? "Scan barcode"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 text-white hover:bg-white/10 hover:text-white"
          onClick={onClose}
          aria-label="Close scanner"
        >
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </div>

      {/* Viewfinder */}
      <div className="relative min-h-0 flex-1">
        {status !== "error" && (
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            aria-label="Camera viewfinder"
          />
        )}

        {status === "scanning" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Scan frame with corner accents */}
            <div className="relative h-48 w-72 sm:h-56 sm:w-96">
              <div className="absolute left-0 top-0 h-10 w-10 rounded-tl-lg border-l-4 border-t-4 border-white" />
              <div className="absolute right-0 top-0 h-10 w-10 rounded-tr-lg border-r-4 border-t-4 border-white" />
              <div className="absolute bottom-0 left-0 h-10 w-10 rounded-bl-lg border-b-4 border-l-4 border-white" />
              <div className="absolute bottom-0 right-0 h-10 w-10 rounded-br-lg border-b-4 border-r-4 border-white" />
              <div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/90" />
            </div>
          </div>
        )}

        {status === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <ScanLine className="h-10 w-10 animate-pulse" aria-hidden />
            <p className="text-sm">Starting the camera…</p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center dark:bg-neutral-900">
              <CameraOff
                className="mx-auto h-10 w-10 text-muted-foreground"
                aria-hidden
              />
              <p className="mt-3 text-base font-semibold">
                {ERROR_COPY[errorKind].title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {ERROR_COPY[errorKind].body}
              </p>
              <Button
                type="button"
                className="mt-4 min-h-[44px] w-full"
                onClick={retry}
              >
                Try again
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="mt-2 min-h-[44px] w-full"
                onClick={onClose}
              >
                Type the code instead
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom hint + test seam */}
      <div className="relative z-10 p-4 pb-6 text-center">
        {status === "scanning" && (
          <p className="text-sm text-white/90">
            Point the camera at a barcode — it scans automatically.
          </p>
        )}
        {allowSimulate && (
          <Button
            type="button"
            variant="secondary"
            className="mt-2 min-h-[44px]"
            onClick={() => onResult(SIMULATED_BARCODE)}
          >
            Simulate scan
          </Button>
        )}
      </div>
    </div>
  );
}
