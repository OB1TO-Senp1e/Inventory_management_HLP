import { describe, expect, it } from "vitest";
import { isExpiring, isLowStock } from "./stockStatus";
import type { StockOverviewRow } from "@/api/stock";

function iso(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function row(overrides: Partial<StockOverviewRow>): StockOverviewRow {
  return {
    itemId: "item-1",
    name: "Tomato",
    categoryId: null,
    categoryName: null,
    locationId: null,
    locationName: null,
    unitSymbol: "kg",
    reorderPoint: 10,
    parLevel: 50,
    quantity: 42.5,
    lastMovementAt: null,
    earliestExpiry: null,
    ...overrides,
  };
}

describe("isLowStock", () => {
  it("flags quantities at or below the reorder point", () => {
    expect(isLowStock(row({ quantity: 10, reorderPoint: 10 }))).toBe(true);
    expect(isLowStock(row({ quantity: 3, reorderPoint: 10 }))).toBe(true);
    expect(isLowStock(row({ quantity: 0, reorderPoint: 10 }))).toBe(true);
  });

  it("does not flag quantities above the reorder point", () => {
    expect(isLowStock(row({ quantity: 10.5, reorderPoint: 10 }))).toBe(false);
  });
});

describe("isExpiring", () => {
  it("flags soon and expired batches", () => {
    expect(isExpiring(row({ earliestExpiry: iso(3) }))).toBe(true);
    expect(isExpiring(row({ earliestExpiry: iso(-1) }))).toBe(true);
  });

  it("does not flag healthy or untracked expiries", () => {
    expect(isExpiring(row({ earliestExpiry: iso(30) }))).toBe(false);
    expect(isExpiring(row({ earliestExpiry: null }))).toBe(false);
  });
});
