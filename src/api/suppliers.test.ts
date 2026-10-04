import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  archiveSupplier,
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "./suppliers";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

/**
 * Thenable chainable mock: every builder method returns the builder itself
 * and awaiting it resolves the canned result — mirrors the supabase-js
 * PostgREST builder well enough to assert query construction.
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "eq",
    "ilike",
    "order",
    "range",
    "single",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) =>
    resolve(result);
  return builder;
}

const mockFrom = vi.fn();
const RID = "11111111-1111-1111-1111-111111111111";
const SUPPLIER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const dbRow = {
  id: SUPPLIER_ID,
  restaurant_id: RID,
  name: "Fresh Farms",
  contact_person: "Ravi Kumar",
  phone: "+919876543210",
  email: "ravi@freshfarms.example",
  address: "12 Market Road, Mumbai",
  gstin: "27ABCDE1234F1Z5",
  notes: "Delivers on Tuesdays",
  active: true,
  created_at: "2026-10-04T00:00:00Z",
  updated_at: "2026-10-04T00:00:00Z",
};

const SELECT =
  "id, restaurant_id, name, contact_person, phone, email, address, gstin, notes, active, created_at, updated_at";

function mockQuery(result: QueryResult): Record<string, unknown> {
  const builder = chainable(result);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReset();
  mockedGetSupabaseClient.mockReturnValue({
    from: mockFrom,
  } as unknown as SupabaseClient);
});

describe("listSuppliers", () => {
  it("defaults to active=true with name sort and first page", async () => {
    const builder = mockQuery({ data: [dbRow], error: null, count: 1 });
    const result = await listSuppliers({});
    expect(mockFrom).toHaveBeenCalledWith("suppliers");
    expect(builder["select"]).toHaveBeenCalledWith(SELECT, {
      count: "exact",
    });
    // Archived suppliers are hidden by default (the PO-prefill contract).
    expect(builder["eq"]).toHaveBeenCalledWith("active", true);
    expect(builder["order"]).toHaveBeenCalledWith("name", { ascending: true });
    expect(builder["range"]).toHaveBeenCalledWith(0, 19);
    expect(result.total).toBe(1);
    expect(result.suppliers[0]).toMatchObject({
      id: SUPPLIER_ID,
      name: "Fresh Farms",
      contactPerson: "Ravi Kumar",
      phone: "+919876543210",
      gstin: "27ABCDE1234F1Z5",
    });
  });

  it("honours an explicit active=false request", async () => {
    const builder = mockQuery({ data: [], error: null, count: 0 });
    await listSuppliers({ active: false });
    expect(builder["eq"]).toHaveBeenCalledWith("active", false);
  });

  it("escapes LIKE wildcards in the search term", async () => {
    const builder = mockQuery({ data: [], error: null, count: 0 });
    await listSuppliers({ search: "100%_fresh\\mart" });
    expect(builder["ilike"]).toHaveBeenCalledWith(
      "name",
      "%100\\%\\_fresh\\\\mart%",
    );
  });

  it("sorts by created_at descending on request", async () => {
    const builder = mockQuery({ data: [], error: null, count: 0 });
    await listSuppliers({ sortColumn: "created_at", sortDirection: "desc" });
    expect(builder["order"]).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
  });

  it("paginates to the requested page", async () => {
    const builder = mockQuery({ data: [], error: null, count: 45 });
    const result = await listSuppliers({ page: 3, pageSize: 20 });
    expect(builder["range"]).toHaveBeenCalledWith(40, 59);
    expect(result.total).toBe(45);
  });

  it("rejects invalid input without touching the network", async () => {
    await expect(listSuppliers({ page: 0 })).rejects.toThrow();
    await expect(
      listSuppliers({ sortColumn: "bogus" }),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("surfaces query errors", async () => {
    mockQuery({ data: null, error: { message: "boom" } });
    await expect(listSuppliers({})).rejects.toThrow("boom");
  });
});

describe("getSupplier", () => {
  it("fetches a single supplier", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    const result = await getSupplier(SUPPLIER_ID);
    expect(mockFrom).toHaveBeenCalledWith("suppliers");
    expect(builder["eq"]).toHaveBeenCalledWith("id", SUPPLIER_ID);
    expect(builder["single"]).toHaveBeenCalled();
    expect(result.name).toBe("Fresh Farms");
  });

  it("rejects a non-uuid id without a network call", async () => {
    await expect(getSupplier("not-a-uuid")).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("createSupplier", () => {
  const input = {
    restaurantId: RID,
    name: "Fresh Farms",
    contactPerson: "Ravi Kumar",
    phone: "+919876543210",
    email: "ravi@freshfarms.example",
    address: "12 Market Road, Mumbai",
    gstin: "27abcde1234f1z5", // lowercased input is normalized to uppercase
    notes: "Delivers on Tuesdays",
  };

  it("inserts with restaurant_id and normalized optional fields", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    const result = await createSupplier(input);
    expect(builder["insert"]).toHaveBeenCalledWith({
      restaurant_id: RID,
      name: "Fresh Farms",
      contact_person: "Ravi Kumar",
      phone: "+919876543210",
      email: "ravi@freshfarms.example",
      address: "12 Market Road, Mumbai",
      gstin: "27ABCDE1234F1Z5",
      notes: "Delivers on Tuesdays",
    });
    expect(result.gstin).toBe("27ABCDE1234F1Z5");
  });

  it("stores blank optional fields as NULL", async () => {
    const builder = mockQuery({
      data: { ...dbRow, phone: null, gstin: null },
      error: null,
    });
    await createSupplier({ restaurantId: RID, name: "No Frills" });
    expect(builder["insert"]).toHaveBeenCalledWith({
      restaurant_id: RID,
      name: "No Frills",
      contact_person: null,
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
    });
  });

  it("maps duplicate names to a friendly error", async () => {
    mockQuery({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(createSupplier(input)).rejects.toThrow(
      "A supplier with this name already exists.",
    );
  });

  it("rejects bad phone, email and GSTIN without a network call", async () => {
    await expect(
      createSupplier({ restaurantId: RID, name: "X", phone: "abc" }),
    ).rejects.toThrow(/phone/i);
    await expect(
      createSupplier({ restaurantId: RID, name: "X", email: "not-an-email" }),
    ).rejects.toThrow(/email/i);
    await expect(
      createSupplier({ restaurantId: RID, name: "X", gstin: "SHORT" }),
    ).rejects.toThrow(/GSTIN/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a blank name without a network call", async () => {
    await expect(
      createSupplier({ restaurantId: RID, name: "   " }),
    ).rejects.toThrow(/supplier name/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("updateSupplier", () => {
  it("patches only the provided fields", async () => {
    const builder = mockQuery({ data: dbRow, error: null });
    await updateSupplier(SUPPLIER_ID, { phone: "+911234567890" });
    expect(builder["update"]).toHaveBeenCalledWith({
      phone: "+911234567890",
    });
    expect(builder["eq"]).toHaveBeenCalledWith("id", SUPPLIER_ID);
  });

  it("maps explicitly-cleared fields to NULL", async () => {
    const builder = mockQuery({ data: { ...dbRow, notes: null }, error: null });
    await updateSupplier(SUPPLIER_ID, { notes: "" });
    expect(builder["update"]).toHaveBeenCalledWith({ notes: null });
  });

  it("rejects invalid patch values without a network call", async () => {
    await expect(
      updateSupplier(SUPPLIER_ID, { gstin: "nope" }),
    ).rejects.toThrow(/GSTIN/i);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("archiveSupplier", () => {
  it("soft-deletes via active=false", async () => {
    const builder = mockQuery({
      data: { ...dbRow, active: false },
      error: null,
    });
    const result = await archiveSupplier(SUPPLIER_ID);
    expect(builder["update"]).toHaveBeenCalledWith({ active: false });
    expect(builder["eq"]).toHaveBeenCalledWith("id", SUPPLIER_ID);
    expect(result.active).toBe(false);
  });

  it("rejects a non-uuid id without a network call", async () => {
    await expect(archiveSupplier("nope")).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
