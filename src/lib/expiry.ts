/**
 * Batch expiry helpers (extracted from ItemDetailPage in P2-05 so the stock
 * overview reuses the exact same thresholds — no drift between pages).
 *
 * Dates are ISO `YYYY-MM-DD` strings. Comparisons pin both sides to
 * `T00:00:00` so a date-only expiry never shifts a day across timezones.
 */

export type ExpiryStatus = "expired" | "soon" | "ok" | "none";

/** Days before expiry at which a batch counts as "expiring soon". */
export const EXPIRY_SOON_DAYS = 7;

export function expiryStatus(expiry: string | null): ExpiryStatus {
  if (!expiry) {
    return "none";
  }
  const today = new Date().toISOString().slice(0, 10);
  if (expiry < today) {
    return "expired";
  }
  const daysLeft =
    (new Date(`${expiry}T00:00:00`).getTime() -
      new Date(`${today}T00:00:00`).getTime()) /
    86_400_000;
  return daysLeft <= EXPIRY_SOON_DAYS ? "soon" : "ok";
}
