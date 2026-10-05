/**
 * Timezone-aware date helpers (P5-03).
 *
 * The app's locale defaults are India: timestamps like batch expiries and
 * "today" boundaries are interpreted in Asia/Kolkata, which has no DST so
 * the fixed +05:30 offset is always correct.
 */

/**
 * Today's date as `YYYY-MM-DD` in Asia/Kolkata. Used for day-boundary
 * queries (e.g. "today's usage and wastage") so the dashboard agrees with
 * the restaurant's wall clock rather than UTC.
 */
export function todayISODateIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Inclusive lower bound for "today" as an ISO timestamp with the IST
 * offset, suitable for a PostgREST `gte` filter on a timestamptz column.
 */
export function startOfTodayIST(): string {
  return `${todayISODateIST()}T00:00:00+05:30`;
}

/**
 * Start of an arbitrary `YYYY-MM-DD` day in Asia/Kolkata as an ISO
 * timestamp with the IST offset — the inclusive lower bound for a
 * PostgREST `gte` filter on a timestamptz column.
 */
export function startOfDayIST(isoDate: string): string {
  return `${isoDate}T00:00:00+05:30`;
}

/**
 * End of an arbitrary `YYYY-MM-DD` day in Asia/Kolkata as an ISO
 * timestamp with the IST offset — the inclusive upper bound for a
 * PostgREST `lte` filter on a timestamptz column.
 */
export function endOfDayIST(isoDate: string): string {
  return `${isoDate}T23:59:59.999+05:30`;
}

/**
 * Convert a timestamptz ISO string to its `YYYY-MM-DD` calendar date in
 * Asia/Kolkata. Used to bucket movements into daily series (food-cost
 * trend) on the restaurant's wall clock rather than UTC.
 */
export function toISTDateString(isoDateTime: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoDateTime));
}
