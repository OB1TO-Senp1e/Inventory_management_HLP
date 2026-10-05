import { z } from "zod";
import { todayISODateIST } from "@/lib/datetime";

/**
 * Reports schemas (P5-04). Every report filters by a shared inclusive
 * date range on the restaurant's wall clock (Asia/Kolkata).
 */

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const reportRangeSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((range) => range.from <= range.to, {
    message: "The start date must be on or before the end date.",
    path: ["from"],
  });

export type ReportRange = z.infer<typeof reportRangeSchema>;

/**
 * Default range: the last 30 days including today (IST). Kept in the
 * schema module so the page, hooks and tests share one definition.
 */
export function defaultReportRange(): ReportRange {
  const today = todayISODateIST();
  const fromDate = new Date(`${today}T00:00:00+05:30`);
  fromDate.setDate(fromDate.getDate() - 29);
  const from = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fromDate);
  return reportRangeSchema.parse({ from, to: today });
}
