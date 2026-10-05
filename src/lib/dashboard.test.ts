import { describe, expect, it } from "vitest";
import {
  computeStockValue,
  summarizeMovements,
  type MovementForSummary,
} from "./dashboard";

const TOMATO = "tomato-id";
const MILK = "milk-id";
const FLOUR = "flour-id";

const costs = new Map<string, number | null>([
  [TOMATO, 32.5],
  [MILK, 58],
  [FLOUR, null], // no cost recorded yet
]);

const movements: MovementForSummary[] = [
  { itemId: TOMATO, movementType: "usage", quantity: -20 },
  { itemId: TOMATO, movementType: "usage", quantity: -10 },
  { itemId: MILK, movementType: "wastage", quantity: -1 },
  { itemId: TOMATO, movementType: "receipt", quantity: 50 },
];

describe("summarizeMovements", () => {
  it("sums lines, absolute quantity and costed value for one type", () => {
    expect(summarizeMovements(movements, costs, "usage")).toEqual({
      lines: 2,
      quantity: 30,
      value: 30 * 32.5,
    });
  });

  it("summarizes wastage separately from usage", () => {
    expect(summarizeMovements(movements, costs, "wastage")).toEqual({
      lines: 1,
      quantity: 1,
      value: 58,
    });
  });

  it("counts items without a cost at zero value but keeps quantity", () => {
    const rows: MovementForSummary[] = [
      { itemId: FLOUR, movementType: "wastage", quantity: -5 },
    ];
    expect(summarizeMovements(rows, costs, "wastage")).toEqual({
      lines: 1,
      quantity: 5,
      value: 0,
    });
  });

  it("returns zeros when no movements match the type", () => {
    expect(summarizeMovements(movements, costs, "sale_deduction")).toEqual({
      lines: 0,
      quantity: 0,
      value: 0,
    });
  });
});

describe("computeStockValue", () => {
  it("sums quantity × avg_unit_cost per item", () => {
    const stock = [
      { itemId: TOMATO, quantity: 42.5 },
      { itemId: MILK, quantity: 3 },
    ];
    expect(computeStockValue(stock, costs)).toBeCloseTo(
      42.5 * 32.5 + 3 * 58,
      6,
    );
  });

  it("treats missing costs and missing stock rows as zero", () => {
    const stock = [
      { itemId: FLOUR, quantity: 10 },
      { itemId: "unknown-id", quantity: 5 },
    ];
    expect(computeStockValue(stock, costs)).toBe(0);
  });
});
