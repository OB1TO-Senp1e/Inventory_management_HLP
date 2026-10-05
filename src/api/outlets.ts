import { getSupabaseClient } from "@/lib/supabase";
import {
  createOutletSchema,
  switchOutletSchema,
  toOutlet,
  updateOutletSchema,
  type CreateOutletInput,
  type Outlet,
  type SwitchOutletInput,
  type UpdateOutletInput,
} from "@/schemas/outlet";

/**
 * Outlets API (V2-07). The client's outlet context lives in
 * profiles.current_outlet_id and is written only via switch_outlet() —
 * the source outlet for every stock RPC is therefore unforgeable.
 * Outlet CRUD is owner-only (RLS); listing is visible to all roles.
 */

const OUTLET_SELECT =
  "id, restaurant_id, name, address, is_active, is_default, created_at";

function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, input: unknown, what: string): T {
  try {
    return schema.parse(input);
  } catch (err) {
    const first =
      err instanceof Error ? err.message : `Invalid ${what}.`;
    throw new Error(first);
  }
}

/** All active outlets of the caller's restaurant, default first. */
export async function listOutlets(): Promise<Outlet[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("outlets")
    .select(OUTLET_SELECT)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("name");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map(toOutlet);
}

/** All outlets including deactivated ones (owner management view). */
export async function listAllOutlets(): Promise<Outlet[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("outlets")
    .select(OUTLET_SELECT)
    .order("is_active", { ascending: false })
    .order("is_default", { ascending: false })
    .order("name");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map(toOutlet);
}

/** Create an outlet (owner only, enforced by RLS). */
export async function createOutlet(rawInput: unknown): Promise<Outlet> {
  const input: CreateOutletInput = parseOrThrow(
    createOutletSchema,
    rawInput,
    "outlet",
  );
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("outlets")
    .insert({ name: input.name, address: input.address })
    .select(OUTLET_SELECT)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toOutlet(data);
}

/** Rename / re-address an outlet (owner only). */
export async function updateOutlet(rawInput: unknown): Promise<Outlet> {
  const input: UpdateOutletInput = parseOrThrow(
    updateOutletSchema,
    rawInput,
    "outlet",
  );
  const { id, ...patch } = input;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("outlets")
    .update(patch)
    .eq("id", id)
    .select(OUTLET_SELECT)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toOutlet(data);
}

/**
 * Deactivate an outlet (owner only). The DB guard blocks deactivating an
 * outlet that still holds stock or the last active outlet, with a clear
 * message — the caller surfaces error.message directly.
 */
export async function deactivateOutlet(outletId: string): Promise<Outlet> {
  const id = parseOrThrow(
    { parse: (v: unknown) => String(v) },
    outletId,
    "outlet id",
  );
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("outlets")
    .update({ is_active: false })
    .eq("id", id)
    .select(OUTLET_SELECT)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toOutlet(data);
}

/** Reactivate a deactivated outlet (owner only). */
export async function reactivateOutlet(outletId: string): Promise<Outlet> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("outlets")
    .update({ is_active: true })
    .eq("id", outletId)
    .select(OUTLET_SELECT)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toOutlet(data);
}

/**
 * Pin the caller's outlet context. Any signed-in role may switch; the RPC
 * validates same-restaurant + active. Returns the newly current outlet.
 */
export async function switchOutlet(rawInput: unknown): Promise<Outlet> {
  const input: SwitchOutletInput = parseOrThrow(
    switchOutletSchema,
    rawInput,
    "outlet",
  );
  const client = getSupabaseClient();
  const { data, error } = await client
    .rpc("switch_outlet", { p_outlet_id: input.outletId })
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toOutlet(data);
}

/**
 * Ensure the caller has a current outlet (provisions "Main outlet" for
 * restaurants that predate V2-07). Used at sign-in when the profile's
 * current_outlet_id is null.
 */
export async function ensureCurrentOutlet(): Promise<string> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc("ensure_current_outlet").single();
  if (error) {
    throw new Error(error.message);
  }
  return String(data);
}
