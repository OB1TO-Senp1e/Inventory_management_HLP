import { z } from "zod";

/**
 * Purchase order schemas (P3-01). Client-side validation for draft POs.
 * The `purchase_orders` / `purchase_order_lines` tables are the DB source of
 * truth; these schemas mirror their constraints so bad input never reaches
 * the network. RLS remains the real enforcement.
 *
 * Status lifecycle (draft → sent → partially_received → received, cancelled)
 * is enforced by P3-02; P3-01 only ever creates drafts.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

/** Blank date inputs become undefined (field stays optional). */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const dateSchema = (message: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, message)
      .optional(),
  );

export const purchaseOrderStatusSchema = z.enum([
  "draft",
  "sent",
  "partially_received",
  "received",
  "cancelled",
]);

export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

/**
 * V2-05: channel a PO was sent through. Mirrors the
 * `purchase_orders.sent_via` CHECK constraint.
 */
export const poSendChannelSchema = z.enum(["whatsapp", "email"]);

export type PoSendChannel = z.infer<typeof poSendChannelSchema>;

/** One line on a purchase order: item + ordered quantity + price snapshot. */
export const purchaseOrderLineInputSchema = z.object({
  itemId: uuidSchema,
  // Ordered quantity in the item's base unit.
  quantity: z.coerce.number().positive("Quantity must be greater than zero."),
  // Snapshot of the supplier's unit price at PO creation (₹, base unit).
  unitPrice: z.coerce.number().positive("Unit price must be greater than zero."),
  notes: z
    .string()
    .trim()
    .max(500, "Line notes must be 500 characters or fewer.")
    .optional(),
});

export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

/** GST percent applied to the PO subtotal on the print view (P3-04). Snapshotted at creation. */
const gstRateSchema = z.coerce
  .number()
  .min(0, "GST rate cannot be negative.")
  .max(100, "GST rate cannot exceed 100%.")
  .default(0);

/** Create a draft PO: supplier + dates + notes + at least one line. */
export const createPurchaseOrderSchema = z.object({
  supplierId: uuidSchema,
  orderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid order date.")
    .default(() => new Date().toISOString().slice(0, 10)),
  expectedDate: dateSchema("Enter a valid expected date."),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1000 characters or fewer.")
    .optional(),
  gstRate: gstRateSchema,
  lines: z
    .array(purchaseOrderLineInputSchema)
    .min(1, "A purchase order needs at least one line.")
    .refine(
      (lines) => new Set(lines.map((l) => l.itemId)).size === lines.length,
      "Each item can appear only once per purchase order.",
    ),
});

export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

/** Edit a draft PO's header (lines are managed separately). */
export const updatePurchaseOrderSchema = z.object({
  id: uuidSchema,
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid expected date.")
    .nullable()
    .optional(),
  notes: z
    .string()
    .trim()
    .max(1000, "Notes must be 1000 characters or fewer.")
    .nullable()
    .optional(),
  gstRate: z.coerce
    .number()
    .min(0, "GST rate cannot be negative.")
    .max(100, "GST rate cannot exceed 100%.")
    .nullable()
    .optional(),
});

export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
