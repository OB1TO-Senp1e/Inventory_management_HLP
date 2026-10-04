import { z } from "zod";

/**
 * Supplier schemas (P1-03). Client-side validation for the suppliers catalog.
 * The `suppliers` table itself is the DB source of truth; these schemas
 * mirror its constraints (name length, per-restaurant uniqueness is enforced
 * by the DB) so bad input never reaches the network. RLS remains the real
 * enforcement.
 *
 * Strictness lives here: the DB check on `gstin` is deliberately loose
 * (15 alphanumeric chars) while this schema enforces the real GSTIN shape
 * (state code + PAN + entity code + 'Z' + check digit), normalized to
 * uppercase. Empty-string form fields normalize to `null` (stored as NULL)
 * so optional fields stay truly optional — and clearing a field in the edit
 * dialog clears it in the database rather than silently keeping the old value.
 */

const uuidSchema = z.string().uuid("Invalid identifier.");

/**
 * Blank form fields become `null` (NULL in the DB); omitted fields stay
 * `undefined`. This matters for updates: clearing a field in the edit
 * dialog must clear it in the database, not silently keep the old value.
 */
const blankToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a supplier name.")
  .max(200, "Name must be 200 characters or fewer.");

const contactPersonSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .min(1, "Enter a contact name.")
    .max(120, "Contact name must be 120 characters or fewer.")
    .nullable()
    .optional(),
);

const phoneSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]+$/, "Enter a valid phone number.")
    .refine(
      (value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 15;
      },
      { message: "Enter a valid phone number." },
    )
    .nullable()
    .optional(),
);

const emailSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(320, "Email must be 320 characters or fewer.")
    .email("Enter a valid email address.")
    .nullable()
    .optional(),
);

const addressSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .min(1, "Enter an address.")
    .max(500, "Address must be 500 characters or fewer.")
    .nullable()
    .optional(),
);

/**
 * GSTIN (India, 15 chars): 2-digit state code + 10-char PAN
 * (5 letters, 4 digits, 1 letter) + 1 entity code + 'Z' + 1 check digit.
 * Normalized to uppercase before validation.
 */
const gstinSchema = z.preprocess(
  (value: unknown) => {
    if (typeof value !== "string" || value.trim() === "") {
      return null;
    }
    return value.trim().toUpperCase();
  },
  z
    .string()
    .length(15, "GSTIN must be 15 characters.")
    .regex(
      /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
      "Enter a valid 15-character GSTIN.",
    )
    .nullable()
    .optional(),
);

const notesSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .min(1, "Enter a note.")
    .max(1000, "Notes must be 1000 characters or fewer.")
    .nullable()
    .optional(),
);

export const supplierSortColumnSchema = z.enum(["name", "created_at"]);
export type SupplierSortColumn = z.infer<typeof supplierSortColumnSchema>;

const supplierFields = {
  name: nameSchema,
  contactPerson: contactPersonSchema,
  phone: phoneSchema,
  email: emailSchema,
  address: addressSchema,
  gstin: gstinSchema,
  notes: notesSchema,
};

export const createSupplierSchema = z.object({
  restaurantId: uuidSchema,
  ...supplierFields,
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema
  .omit({ restaurantId: true })
  .partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const listSuppliersInputSchema = z.object({
  search: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
  sortColumn: supplierSortColumnSchema.default("name"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ListSuppliersInput = z.infer<typeof listSuppliersInputSchema>;
/** Pre-defaults input shape, for hook/component props. */
export type ListSuppliersQuery = z.input<typeof listSuppliersInputSchema>;
