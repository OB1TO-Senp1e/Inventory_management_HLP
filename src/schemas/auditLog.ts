import { z } from "zod";
import { reportRangeSchema } from "./reports";

/**
 * Audit log schemas (P5-05). The audit log is owner-only to read (RLS),
 * so the page has no staff/manager surface at all.
 */

/**
 * Machine-readable audit actions the app can write. Kept as an enum so
 * the action filter dropdown and the details renderer stay in sync with
 * the writers (`record_sales` → over_sale, `apply_stock_count` →
 * stock_count_applied).
 */
export const auditActionSchema = z.enum(["over_sale", "stock_count_applied"]);
export type AuditAction = z.infer<typeof auditActionSchema>;

/** Human-readable labels for the known actions. */
export const auditActionLabels: Record<AuditAction, string> = {
  over_sale: "Over sale",
  stock_count_applied: "Stock count applied",
};

export const listAuditLogInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  action: auditActionSchema.optional(),
  range: reportRangeSchema.optional(),
});
export type ListAuditLogInput = z.infer<typeof listAuditLogInputSchema>;
