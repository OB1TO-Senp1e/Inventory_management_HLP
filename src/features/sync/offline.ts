/**
 * Offline detection helpers (P6-02).
 */

/** True when the browser reports a live connection. */
export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * Distinguish "the network is down" from "the server said no".
 *
 * A failed fetch surfaces as a TypeError (or AbortError) — the Supabase
 * client propagates the rejection unwrapped. PostgREST application errors
 * (400s, RLS denials, RPC validation raises) arrive as `{ error }` payloads
 * and are thrown by the api layer as plain `Error`s with the server message,
 * which must NEVER be treated as offline (those are conflicts, not outages).
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    return true;
  }
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "NetworkError";
  }
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|network request failed|err_internet_disconnected|err_network_changed|err_connection|load failed|offline/i.test(
    message,
  );
}
