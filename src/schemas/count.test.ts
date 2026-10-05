import { describe, expect, it } from "vitest";
import {
  createStockCountSchema,
  saveCountLineSchema,
  stockCountStatusSchema,
} from "./count";

describe("stockCountStatusSchema", () => {
  it("accepts the three lifecycle statuses", () => {
    expect(stockCountStatusSchema.parse("draft")).toBe("draft");
    expect(stockCountStatusSchema.parse("in_progress")).toBe("in_progress");
    expect(stockCountStatusSchema.parse("submitted")).toBe("submitted");
  });

  it("rejects unknown statuses", () => {
    expect(() =>
      stockCountStatusSchema.parse("approved"),
    ).toThrow();
  });
});

describe("createStockCountSchema", () => {
  it("accepts a title with an assignee", () => {
    const parsed = createStockCountSchema.parse({
      title: "Weekly full count",
      assignedTo: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });
    expect(parsed.title).toBe("Weekly full count");
    expect(parsed.assignedTo).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  it("accepts a title without an assignee", () => {
    const parsed = createStockCountSchema.parse({ title: "Count" });
    expect(parsed.assignedTo).toBeUndefined();
  });

  it("trims the title and rejects a blank one", () => {
    const parsed = createStockCountSchema.parse({ title: "  Count  " });
    expect(parsed.title).toBe("Count");
    expect(() => createStockCountSchema.parse({ title: "   " })).toThrow();
  });

  it("rejects an over-long title", () => {
    expect(() =>
      createStockCountSchema.parse({ title: "x".repeat(201) }),
    ).toThrow();
  });

  it("coerces the form's empty-string assignee to null", () => {
    expect(
      createStockCountSchema.parse({ title: "Count", assignedTo: "" })
        .assignedTo,
    ).toBeNull();
  });

  it("rejects a non-uuid assignee", () => {
    expect(() =>
      createStockCountSchema.parse({
        title: "Count",
        assignedTo: "not-a-uuid",
      }),
    ).toThrow();
  });
});

describe("saveCountLineSchema", () => {
  const base = {
    countId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    itemId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  };

  it("accepts a counted quantity of zero and above", () => {
    expect(
      saveCountLineSchema.parse({ ...base, countedQty: 0 }).countedQty,
    ).toBe(0);
    expect(
      saveCountLineSchema.parse({ ...base, countedQty: 2.5 }).countedQty,
    ).toBe(2.5);
  });

  it("accepts null to mark a line as not counted", () => {
    expect(
      saveCountLineSchema.parse({ ...base, countedQty: null }).countedQty,
    ).toBeNull();
  });

  it("rejects negative quantities", () => {
    expect(() =>
      saveCountLineSchema.parse({ ...base, countedQty: -1 }),
    ).toThrow();
  });

  it("rejects non-uuid ids", () => {
    expect(() =>
      saveCountLineSchema.parse({ ...base, countId: "nope", countedQty: 1 }),
    ).toThrow();
  });
});
