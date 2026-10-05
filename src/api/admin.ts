import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import { endOfDayIST, startOfDayIST } from "@/lib/datetime";
import {
  auditActionLabels,
  listAuditLogInputSchema,
  type AuditAction,
  type ListAuditLogInput,
} from "@/schemas/auditLog";

/**
 * Admin API (P5-05). Owner-only at the route level AND at the RLS level:
 * the `audit_log_select_owner` policy returns zero rows for managers and
 * staff, so this module has no role branching of its own.
 *
 * Reads only: `audit_log` (append-only, written by SECURITY DEFINER RPCs)
 * plus a batched `profiles` lookup to label each entry's actor.
 */

const AUDIT_LOG_SELECT =
  "id, action, entity_type, entity_id, details, created_by, created_at";

const auditLogRowSchema = z.object({
  id: z.string(),
  action: z.string(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  details: z.unknown(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

const profileRoleSchema = z.object({
  id: z.string(),
  role: z.string(),
});

/** Payload shapes written by the RPCs (see their migrations). */
const overSaleDetailsSchema = z.object({
  sale_date: z.string(),
  lines: z
    .array(z.object({ name: z.string(), dishes: z.number() }))
    .default([]),
  flagged_items: z
    .array(
      z.object({
        name: z.string(),
        unit_symbol: z.string(),
        current_quantity: z.number(),
        projected_quantity: z.number(),
      }),
    )
    .default([]),
});

const stockCountAppliedDetailsSchema = z.object({
  title: z.string(),
  total_lines: z.number(),
  posted_adjustments: z.number(),
  adjustments: z
    .array(z.object({ name: z.string(), variance: z.number() }))
    .default([]),
});

export interface AuditLogEntry {
  id: string;
  action: string;
  actionLabel: string;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
  /** Human-readable one-line summary of the payload. */
  summary: string;
  createdBy: string | null;
  /** Actor's role, for display ("owner"). Null when the actor is unknown. */
  createdByRole: string | null;
  createdAt: string;
}

export interface ListAuditLogResult {
  entries: AuditLogEntry[];
  total: number;
}

function isAuditAction(action: string): action is AuditAction {
  return (
    action === "over_sale" ||
    action === "stock_count_applied" ||
    action === "stock_transfer" ||
    action === "po_sent" ||
    action === "po_resend"
  );
}

const stockTransferDetailsSchema = z.object({
  from_outlet_name: z.string(),
  to_outlet_name: z.string(),
  item_name: z.string(),
  quantity: z.coerce.number(),
  unit_symbol: z.string(),
  batch_no: z.string().nullable().optional(),
});

/**
 * Human-readable one-line summary of an entry's payload. Unknown actions
 * or unparsable payloads fall back to the raw JSON so nothing is hidden.
 */
export function summarizeAuditDetails(action: string, details: unknown): string {
  if (action === "over_sale") {
    const parsed = overSaleDetailsSchema.safeParse(details);
    if (!parsed.success) {
      return JSON.stringify(details);
    }
    const { sale_date, lines, flagged_items } = parsed.data;
    const dishWord = lines.length === 1 ? "dish" : "dishes";
    const flagged = flagged_items
      .map(
        (item) =>
          `${item.name} (${item.current_quantity} → ${item.projected_quantity} ${item.unit_symbol})`,
      )
      .join(", ");
    return `Sale ${sale_date} — ${lines.length} ${dishWord} sold; below-zero items: ${flagged}`;
  }
  if (action === "stock_count_applied") {
    const parsed = stockCountAppliedDetailsSchema.safeParse(details);
    if (!parsed.success) {
      return JSON.stringify(details);
    }
    const { title, total_lines, posted_adjustments } = parsed.data;
    const lineWord = total_lines === 1 ? "line" : "lines";
    return `Count "${title}" — ${posted_adjustments} of ${total_lines} ${lineWord} adjusted`;
  }
  if (action === "stock_transfer") {
    const parsed = stockTransferDetailsSchema.safeParse(details);
    if (!parsed.success) {
      return JSON.stringify(details);
    }
    const { from_outlet_name, to_outlet_name, item_name, quantity, unit_symbol, batch_no } =
      parsed.data;
    const batch = batch_no ? ` (batch ${batch_no})` : "";
    return `${quantity} ${unit_symbol} ${item_name}${batch}: ${from_outlet_name} → ${to_outlet_name}`;
  }
  return JSON.stringify(details);
}

/**
 * List audit entries, newest first, with server-side action/date filters
 * and pagination. Actor roles come from a single batched profiles query.
 */
export async function listAuditLogEntries(
  rawInput: unknown,
): Promise<ListAuditLogResult> {
  const input: ListAuditLogInput = listAuditLogInputSchema.parse(rawInput);
  const client = getSupabaseClient();
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  let query = client.from("audit_log").select(AUDIT_LOG_SELECT, { count: "exact" });
  if (input.action) {
    query = query.eq("action", input.action);
  }
  if (input.range) {
    query = query
      .gte("created_at", startOfDayIST(input.range.from))
      .lte("created_at", endOfDayIST(input.range.to));
  }
  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw new Error(error.message);
  }
  const rows = z.array(auditLogRowSchema).parse(data);

  // Batched actor lookup: one profiles query for the page's distinct
  // created_by ids (owner can read same-restaurant profiles).
  const actorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => id !== null))];
  let roleById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles, error: profileError } = await client
      .from("profiles")
      .select("id, role")
      .in("id", actorIds);
    if (profileError) {
      throw new Error(profileError.message);
    }
    roleById = new Map(
      z.array(profileRoleSchema).parse(profiles).map((p) => [p.id, p.role]),
    );
  }

  const entries: AuditLogEntry[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    actionLabel: isAuditAction(row.action)
      ? auditActionLabels[row.action]
      : row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    summary: summarizeAuditDetails(row.action, row.details),
    createdBy: row.created_by,
    createdByRole: row.created_by ? (roleById.get(row.created_by) ?? null) : null,
    createdAt: row.created_at,
  }));
  return { entries, total: count ?? rows.length };
}
