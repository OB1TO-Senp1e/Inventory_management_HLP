import { describe, expect, it } from "vitest";
import {
  createItemSchema,
  findItemByBarcodeSchema,
} from "./item";

const baseInput = {
  restaurantId: "11111111-1111-1111-1111-111111111111",
  name: "Tomato",
  unitId: "a0000000-0000-0000-0000-000000000001",
  parLevel: 10,
  reorderPoint: 2,
};

describe("createItemSchema barcode (V2-01)", () => {
  it("accepts a missing barcode (optional)", () => {
    const parsed = createItemSchema.parse(baseInput);
    expect(parsed.barcode).toBeUndefined();
  });

  it("accepts a valid barcode", () => {
    const parsed = createItemSchema.parse({
      ...baseInput,
      barcode: "8901234567890",
    });
    expect(parsed.barcode).toBe("8901234567890");
  });

  it("trims surrounding whitespace", () => {
    const parsed = createItemSchema.parse({
      ...baseInput,
      barcode: "  8901234567890  ",
    });
    expect(parsed.barcode).toBe("8901234567890");
  });

  it("rejects barcodes longer than 64 characters", () => {
    const result = createItemSchema.safeParse({
      ...baseInput,
      barcode: "x".repeat(65),
    });
    expect(result.success).toBe(false);
  });

  it("accepts an explicit null (clearing the barcode)", () => {
    const parsed = createItemSchema.parse({ ...baseInput, barcode: null });
    expect(parsed.barcode).toBeNull();
  });
});

describe("findItemByBarcodeSchema", () => {
  it("accepts a code and trims it", () => {
    expect(
      findItemByBarcodeSchema.parse({ barcode: "  123  " }).barcode,
    ).toBe("123");
  });

  it("rejects blank codes (they never reach the RPC)", () => {
    expect(
      findItemByBarcodeSchema.safeParse({ barcode: "   " }).success,
    ).toBe(false);
    expect(findItemByBarcodeSchema.safeParse({ barcode: "" }).success).toBe(
      false,
    );
  });

  it("rejects codes longer than 64 characters", () => {
    expect(
      findItemByBarcodeSchema.safeParse({ barcode: "x".repeat(65) }).success,
    ).toBe(false);
  });
});
