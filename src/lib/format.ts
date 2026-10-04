/**
 * Formats a number as Indian Rupees using en-IN conventions.
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

/**
 * Formats a plain number using en-IN digit grouping (e.g. 1,00,000).
 * Always show the unit next to a formatted quantity at the call site.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
    value,
  );
}
