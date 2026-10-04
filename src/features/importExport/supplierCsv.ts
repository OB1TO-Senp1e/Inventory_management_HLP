import type { Supplier } from "@/api/suppliers";
import {
  createSupplierSchema,
  type CreateSupplierInput,
} from "@/schemas/supplier";
import type { CsvColumnDef, ResolvedRow } from "./csvTypes";

/**
 * Supplier CSV mapping (P1-05). Suppliers need no name→id lookups — every
 * column maps straight onto the create-supplier Zod schema (blank optional
 * fields become NULL via the schema's blankToNull preprocess, exactly like
 * the SupplierDialog form).
 */

export const SUPPLIER_CSV_HEADERS = [
  "name",
  "contact_person",
  "phone",
  "email",
  "address",
  "gstin",
  "notes",
] as const;

export const SUPPLIER_CSV_COLUMNS: CsvColumnDef[] = [
  { header: "name", required: true, description: "Supplier name — must be unique." },
  { header: "contact_person", required: false, description: "Contact person name." },
  { header: "phone", required: false, description: "Phone number." },
  { header: "email", required: false, description: "Email address." },
  { header: "address", required: false, description: "Address." },
  {
    header: "gstin",
    required: false,
    description: "15-character GSTIN, e.g. 27ABCDE1234F1Z5.",
  },
  { header: "notes", required: false, description: "Free-text notes." },
];

export type SupplierCsvInput = Omit<CreateSupplierInput, "restaurantId">;

/** Validate one CSV record (header-keyed) against the create-supplier schema. */
export function resolveSupplierRow(
  record: Record<string, string>,
): ResolvedRow<SupplierCsvInput> {
  const get = (key: string): string => (record[key] ?? "").trim();
  const parsed = createSupplierSchema
    .omit({ restaurantId: true })
    .safeParse({
      name: get("name"),
      contactPerson: get("contact_person"),
      phone: get("phone"),
      email: get("email"),
      address: get("address"),
      gstin: get("gstin"),
      notes: get("notes"),
    });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }
  return { ok: true, input: parsed.data };
}

/** One export row per supplier, matching SUPPLIER_CSV_HEADERS order. */
export function supplierToCsvRow(supplier: Supplier): string[] {
  return [
    supplier.name,
    supplier.contactPerson ?? "",
    supplier.phone ?? "",
    supplier.email ?? "",
    supplier.address ?? "",
    supplier.gstin ?? "",
    supplier.notes ?? "",
  ];
}
