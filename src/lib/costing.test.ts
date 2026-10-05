import { describe, expect, it } from "vitest";
import {
  costPerDish,
  foodCostPct,
  totalIngredientCost,
  type CostedIngredient,
} from "./costing";
import type { UnitConversion } from "./units";

// g -> kg at 0.001, mirroring the seeded conversion.
const conversions: UnitConversion[] = [
  { fromUnitId: "unit-g", toUnitId: "unit-kg", factor: 0.001 },
];

const tomatoKg: CostedIngredient = {
  quantity: 2,
  unitId: "unit-kg",
  itemBaseUnitId: "unit-kg",
  avgUnitCost: 32.5,
};

describe("totalIngredientCost", () => {
  it("sums base-unit lines without conversions", () => {
    const milk: CostedIngredient = {
      quantity: 1,
      unitId: "unit-l",
      itemBaseUnitId: "unit-l",
      avgUnitCost: 58,
    };
    expect(totalIngredientCost([tomatoKg, milk], conversions)).toBeCloseTo(
      123,
      10,
    );
  });

  it("converts a line to the base unit before costing", () => {
    // 500 g of tomatoes at ₹32.50/kg = ₹16.25.
    const line: CostedIngredient = {
      quantity: 500,
      unitId: "unit-g",
      itemBaseUnitId: "unit-kg",
      avgUnitCost: 32.5,
    };
    expect(totalIngredientCost([line], conversions)).toBeCloseTo(16.25, 10);
  });

  it("returns 0 for an empty recipe", () => {
    expect(totalIngredientCost([], conversions)).toBe(0);
  });

  it("returns null when a line is not convertible", () => {
    const line: CostedIngredient = {
      quantity: 1,
      unitId: "unit-l", // no L -> kg conversion
      itemBaseUnitId: "unit-kg",
      avgUnitCost: 10,
    };
    expect(totalIngredientCost([line], conversions)).toBeNull();
  });

  it("reflects a changed avg unit cost (live, not snapshotted)", () => {
    const before = totalIngredientCost([tomatoKg], conversions);
    const after = totalIngredientCost(
      [{ ...tomatoKg, avgUnitCost: 40 }],
      conversions,
    );
    expect(before).toBeCloseTo(65, 10);
    expect(after).toBeCloseTo(80, 10);
  });
});

describe("costPerDish", () => {
  it("divides the full-yield cost by the yield", () => {
    expect(costPerDish(123, 4)).toBeCloseTo(30.75, 10);
  });

  it("is 0 for an empty recipe", () => {
    expect(costPerDish(0, 4)).toBe(0);
  });
});

describe("foodCostPct", () => {
  it("computes cost / price * 100", () => {
    expect(foodCostPct(30.75, 199)).toBeCloseTo(15.4523, 3);
  });

  it("returns null when no selling price is set", () => {
    expect(foodCostPct(30.75, null)).toBeNull();
  });

  it("returns null for a non-positive selling price", () => {
    expect(foodCostPct(30.75, 0)).toBeNull();
    expect(foodCostPct(30.75, -5)).toBeNull();
  });
});
