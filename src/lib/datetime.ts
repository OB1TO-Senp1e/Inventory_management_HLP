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
