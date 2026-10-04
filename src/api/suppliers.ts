import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import {
  createSupplierSchema,
  listSuppliersInputSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type ListSuppliersInput,
  type UpdateSupplierInput,
} from "@/schemas/supplier";

/**
 * Suppliers API — the ONLY module allowed to touch the `suppliers` table.
 * All inputs are Zod-validated before any client call; all outputs are
 * Zod-validated before they reach components. No network calls happen
 * with unvalidated input.
 *
 * `restaurantId` for creates comes from the caller's auth profile
 * (`useAuth().profile`); RLS `WITH CHECK` enforces that it matches the
 * caller's JWT claims, so a forged id is rejected by the database.
 *
 * Active-filter contract (P1-03 → P3-01): `listSuppliers` defaults to
 * `active=true`, so archived suppliers are hidden unless explicitly
 * requested. The future purchase-order supplier prefill consumes this same
 * default — never show archived suppliers in a picker without opting in.
 */

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListSuppliersResult {
  suppliers: Supplier[];
  total: number;
}

const SUPPLIER_SELECT =
  "id, restaurant_id, name, contact_person, phone, email, address, gstin, notes, active, created_at, updated_at";

const supplierRowSchema = z.object({
  id: z.string(),
  restaurant_id: z.string(),
  name: z.string(),
  contact_person: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  gstin: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

type SupplierRow = z.infer<typeof supplierRowSchema>;

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    gstin: row.gstin,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Escape PostgREST LIKE wildcards in a user search term. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    return new Error("A supplier with this name already exists.");
  }
  return new Error(error.message);
}

/**
 * List suppliers with server-side search, active filter, sorting and
 * pagination. `active` defaults to true (archived suppliers are hidden
 * unless requested) — this is the PO-prefill contract.
 */
export async function listSuppliers(
  rawInput: unknown,
): Promise<ListSuppliersResult> {
  const input: ListSuppliersInput = listSuppliersInputSchema.parse(rawInput);
  const client = getSupabaseClient();
  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  let query = client
    .from("suppliers")
    .select(SUPPLIER_SELECT, { count: "exact" });
  query = query.eq("active", input.active ?? true);
  if (input.search) {
    query = query.ilike("name", `%${escapeLike(input.search)}%`);
  }
  query = query.order(input.sortColumn, {
    ascending: input.sortDirection === "asc",
  });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) {
    throw friendlyError(error);
  }
  const rows = z.array(supplierRowSchema).parse(data);
  return { suppliers: rows.map(toSupplier), total: count ?? rows.length };
}

/** Fetch a single supplier by id (used by the edit dialog). */
export async function getSupplier(id: string): Promise<Supplier> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("id", parsedId)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toSupplier(supplierRowSchema.parse(data));
}

/**
 * Create a supplier. `restaurantId` must come from the caller's auth
 * profile. Optional fields left blank arrive as `null` and are stored
 * as NULL.
 */
export async function createSupplier(
  rawInput: unknown,
): Promise<Supplier> {
  const parsed: CreateSupplierInput = createSupplierSchema.parse(rawInput);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("suppliers")
    .insert({
      restaurant_id: parsed.restaurantId,
      name: parsed.name,
      contact_person: parsed.contactPerson ?? null,
      phone: parsed.phone ?? null,
      email: parsed.email ?? null,
      address: parsed.address ?? null,
      gstin: parsed.gstin ?? null,
      notes: parsed.notes ?? null,
    })
    .select(SUPPLIER_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toSupplier(supplierRowSchema.parse(data));
}

/** Update a supplier's editable fields. Archiving goes through `archiveSupplier`. */
export async function updateSupplier(
  id: string,
  rawInput: unknown,
): Promise<Supplier> {
  const parsedId = z.string().uuid().parse(id);
  const parsed: UpdateSupplierInput = updateSupplierSchema.parse(rawInput);
  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) patch["name"] = parsed.name;
  if (parsed.contactPerson !== undefined)
    patch["contact_person"] = parsed.contactPerson ?? null;
  if (parsed.phone !== undefined) patch["phone"] = parsed.phone ?? null;
  if (parsed.email !== undefined) patch["email"] = parsed.email ?? null;
  if (parsed.address !== undefined)
    patch["address"] = parsed.address ?? null;
  if (parsed.gstin !== undefined) patch["gstin"] = parsed.gstin ?? null;
  if (parsed.notes !== undefined) patch["notes"] = parsed.notes ?? null;

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("suppliers")
    .update(patch)
    .eq("id", parsedId)
    .select(SUPPLIER_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toSupplier(supplierRowSchema.parse(data));
}

/**
 * Archive a supplier (soft delete: `active=false`). Suppliers are never
 * hard-deleted — purchase history must keep resolving supplier names.
 * Archived suppliers are hidden from the default list (and from the
 * future PO prefill) via the active=true default.
 */
export async function archiveSupplier(id: string): Promise<Supplier> {
  const parsedId = z.string().uuid().parse(id);
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("suppliers")
    .update({ active: false })
    .eq("id", parsedId)
    .select(SUPPLIER_SELECT)
    .single();
  if (error) {
    throw friendlyError(error);
  }
  return toSupplier(supplierRowSchema.parse(data));
}
