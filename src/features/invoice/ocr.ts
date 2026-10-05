/**
 * Client-side OCR engine (V2-04). tesseract.js is dynamically imported so it
 * lives in its own lazy chunk and never touches the entry bundle (P6-03
 * bundle discipline).
 *
 * The worker script, wasm core and language data load from the tesseract.js
 * CDN at runtime on first use (then HTTP-cached by the browser), so the
 * first scan needs connectivity — no account or key is required. The photo
 * itself is session-only: it is OCR'd from an object URL and discarded
 * afterwards, never persisted anywhere.
 */

export interface OcrProgress {
  /** Raw tesseract status, e.g. "recognizing text". */
  status: string;
  /** 0..1 progress within the current status. */
  progress: number;
}

const STATUS_COPY: Record<string, string> = {
  "loading tesseract core": "Loading the scanner…",
  "initializing tesseract": "Starting the scanner…",
  "loading language traineddata":
    "Loading language data — this needs internet the first time…",
  "initializing api": "Preparing the scanner…",
  "recognizing text": "Reading the bill…",
};

/** User-facing copy for a raw tesseract status string. */
export function ocrStatusCopy(status: string): string {
  return STATUS_COPY[status] ?? "Working…";
}

/**
 * Run OCR on an image (object URL or data URL) and return the recognized
 * text. Throws a friendly Error when the engine cannot load or the image
 * cannot be read.
 */
export async function recognizeInvoiceImage(
  image: string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  let createWorker: typeof import("tesseract.js").createWorker;
  try {
    ({ createWorker } = await import("tesseract.js"));
  } catch {
    throw new Error(
      "Couldn't load the scanner — check your connection and try again.",
    );
  }
  const worker = await createWorker("eng", undefined, {
    logger: (m) =>
      onProgress?.({ status: m.status, progress: m.progress ?? 0 }),
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(image);
    return text;
  } catch {
    throw new Error(
      "Couldn't read the bill photo — try a clearer, well-lit photo.",
    );
  } finally {
    await worker.terminate();
  }
}
