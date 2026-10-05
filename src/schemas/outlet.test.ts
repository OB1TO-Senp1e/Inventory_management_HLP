import { describe, expect, it } from "vitest";
import {
  createOutletSchema,
  outletSchema,
  switchOutletSchema,
  toOutlet,
  updateOutletSchema,
} from "./outlet";
import {
  toTransferResult,
  transferStockSchema,
} from "./transfer";

/**
 * V2-07 schema unit tests: outlet + transfer validation.
 */
describe("outletSchema", () => {
  it("parses a valid outlet row", () => {
    const outlet = toOutlet({
      id: "c0000000-0000-0000-0000-000000000001",
      restaurant_id: "11111111-1111-1111-1111-111111111111",
      name: "Main outlet",
      address: null,
      is_active: true,
      is_default: true,
      created_at: "2026-10-05T00:00:00Z",
    });
    expect(outlet.name).toBe("Main outlet");
    expect(outlet.isDefault).toBe(true);
    expect(outlet.address).toBeNull();
  });

  it("rejects a row with a bad id", () => {
    expect(() =>
      outletSchema.parse({
        id: "not-a-uuid",
        restaurantId: "11111111-1111-1111-1111-111111111111",
        name: "Main",
        address: null,
        isActive: true,
        isDefault: false,
        createdAt: "2026-10-05T00:00:00Z",
      }),
    ).toThrow();
  });
});

describe("createOutletSchema", () => {
  it("trims the name and rejects blanks", () => {
    expect(createOutletSchema.parse({ name: "  Downtown  " }).name).toBe("Downtown");
    expect(() => createOutletSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects names over 100 chars", () => {
    expect(() => createOutletSchema.parse({ name: "x".repeat(101) })).toThrow();
  });

  it("normalizes empty address to null", () => {
    expect(createOutletSchema.parse({ name: "A", address: "  " }).address).toBeNull();
  });
});

describe("updateOutletSchema", () => {
  it("requires a uuid id", () => {
    expect(() => updateOutletSchema.parse({ id: "nope", name: "X" })).toThrow();
  });

  it("accepts a partial patch", () => {
    const parsed = updateOutletSchema.parse({
      id: "c0000000-0000-0000-0000-000000000001",
      address: null,
    });
    expect(parsed.address).toBeNull();
    expect(parsed.name).toBeUndefined();
  });
});

describe("switchOutletSchema", () => {
  it("requires a uuid outlet id", () => {
    expect(() =>
      switchOutletSchema.parse({ outletId: "not-a-uuid" }),
    ).toThrow();
    expect(
      switchOutletSchema.parse({
        outletId: "c0000000-0000-0000-0000-000000000001",
      }).outletId,
    ).toBe("c0000000-0000-0000-0000-000000000001");
  });
});

describe("transferStockSchema", () => {
  const valid = {
    toOutletId: "c0000000-0000-0000-0000-000000000002",
    itemId: "b0000000-0000-0000-0000-000000000001",
    quantity: 5,
  };

  it("accepts a minimal valid transfer", () => {
    const parsed = transferStockSchema.parse(valid);
    expect(parsed.quantity).toBe(5);
    expect(parsed.batchNo).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("rejects non-positive quantities", () => {
    expect(() => transferStockSchema.parse({ ...valid, quantity: 0 })).toThrow();
    expect(() => transferStockSchema.parse({ ...valid, quantity: -3 })).toThrow();
  });

  it("rejects non-uuid outlet/item ids", () => {
    expect(() =>
      transferStockSchema.parse({ ...valid, toOutletId: "x" }),
    ).toThrow();
    expect(() => transferStockSchema.parse({ ...valid, itemId: "x" })).toThrow();
  });

  it("normalizes blank batch/notes to null", () => {
    const parsed = transferStockSchema.parse({
      ...valid,
      batchNo: "  ",
      notes: "",
    });
    expect(parsed.batchNo).toBeNull();
    expect(parsed.notes).toBeNull();
  });
});

describe("toTransferResult", () => {
  it("maps the RPC json to a TransferResult", () => {
    const result = toTransferResult({
      transfer_id: "t1",
      from_outlet_id: "o1",
      from_outlet_name: "Main outlet",
      to_outlet_id: "o2",
      to_outlet_name: "Downtown",
      item_id: "i1",
      item_name: "Tomato",
      quantity: "30",
      unit_symbol: "kg",
      batch_no: "B1",
      transfer_out_movement_id: "m1",
      transfer_in_movement_id: "m2",
    });
    expect(result.transferId).toBe("t1");
    expect(result.fromOutletName).toBe("Main outlet");
    expect(result.quantity).toBe(30);
    expect(result.batchNo).toBe("B1");
  });
});
