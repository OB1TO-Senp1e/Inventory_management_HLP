import { describe, expect, it } from "vitest";
import {
  createPurchaseOrderSchema,
  purchaseOrderStatusSchema,
} from "./purchaseOrder";

const SUPPLIER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ITEM_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM_ID_2 = "dddddddd-dddd-dddd-dddd-dddddddddddd";

describe("purchaseOrderStatusSchema", () => {
  it("accepts the five lifecycle states", () => {
    for (const s of ["draft", "sent", "partially_received", "received", "cancelled"]) {
      expect(purchaseOrderStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown states", () => {
    expect(() => purchaseOrderStatusSchema.parse("shipped")).toThrow();
  });
});

describe("createPurchaseOrderSchema", () => {
  const valid = {
    supplierId: SUPPLIER_ID,
    orderDate: "2026-10-05",
    lines: [{ itemId: ITEM_ID, quantity: 10, unitPrice: 32.5 }],
  };

  it("accepts a minimal valid draft", () => {
    const parsed = createPurchaseOrderSchema.parse(valid);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.gstRate).toBe(0);
  });

  it("accepts an explicit GST rate", () => {
    const parsed = createPurchaseOrderSchema.parse({ ...valid, gstRate: 18 });
    expect(parsed.gstRate).toBe(18);
  });

  it("rejects out-of-range GST rates", () => {
    expect(() =>
      createPurchaseOrderSchema.parse({ ...valid, gstRate: -1 }),
    ).toThrow(/cannot be negative/);
    expect(() =>
      createPurchaseOrderSchema.parse({ ...valid, gstRate: 101 }),
    ).toThrow(/cannot exceed 100/);
  });

  it("rejects empty lines", () => {
    expect(() =>
      createPurchaseOrderSchema.parse({ ...valid, lines: [] }),
    ).toThrow(/at least one line/);
  });

  it("rejects duplicate items", () => {
    expect(() =>
      createPurchaseOrderSchema.parse({
        ...valid,
        lines: [
          { itemId: ITEM_ID, quantity: 1, unitPrice: 10 },
          { itemId: ITEM_ID, quantity: 2, unitPrice: 11 },
        ],
      }),
    ).toThrow(/only once/);
  });

  it("accepts two different items", () => {
    const parsed = createPurchaseOrderSchema.parse({
      ...valid,
      lines: [
        { itemId: ITEM_ID, quantity: 1, unitPrice: 10 },
        { itemId: ITEM_ID_2, quantity: 2, unitPrice: 11 },
      ],
    });
    expect(parsed.lines).toHaveLength(2);
  });

  it("rejects non-positive quantity and price", () => {
    expect(() =>
      createPurchaseOrderSchema.parse({
        ...valid,
        lines: [{ itemId: ITEM_ID, quantity: 0, unitPrice: 10 }],
      }),
    ).toThrow();
    expect(() =>
      createPurchaseOrderSchema.parse({
        ...valid,
        lines: [{ itemId: ITEM_ID, quantity: 1, unitPrice: -5 }],
      }),
    ).toThrow();
  });

  it("rejects malformed dates", () => {
    expect(() =>
      createPurchaseOrderSchema.parse({ ...valid, orderDate: "05-10-2026" }),
    ).toThrow();
  });

  it("coerces numeric strings (form inputs)", () => {
    const parsed = createPurchaseOrderSchema.parse({
      ...valid,
      lines: [{ itemId: ITEM_ID, quantity: "10", unitPrice: "32.5" }],
    });
    expect(parsed.lines[0].quantity).toBe(10);
    expect(parsed.lines[0].unitPrice).toBe(32.5);
  });
});
