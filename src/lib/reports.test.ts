import { describe, expect, it } from "vitest";
import {
  aggregateFoodCostByDay,
  aggregatePriceChanges,
  aggregateUsage,
  aggregateWastageByReason,
  priceChangePct,
  type PriceChangeEvent,
  type ReportMovement,
} from "./reports";

const TOMATO = "tomato-id";
const MILK = "milk-id";

const COSTS = new Map<string, number | null>([
  [TOMATO, 32.5],
  [MILK, 58],
]);

function movement(
  overrides: Partial<ReportMovement> & { movementType: string },
): ReportMovement {
  return {
    itemId: TOMATO,
    itemName: "Tomato",
    unitSymbol: "kg",
    quantity: -2,
    reasonCode: null,
    createdAt: "2026-10-04T08:30:00.000Z",
    ...overrides,
  };
}

describe("aggregateUsage", () => {
  it("groups usage and sale_deduction separately per item", () => {
    const rows = aggregateUsage(
      [
        movement({ movementType: "usage", quantity: -2 }),
        movement({ movementType: "usage", quantity: -3 }),
        movement({ movementType: "sale_deduction", quantity: -4 }),
        movement({
          movementType: "sale_deduction",
          itemId: MILK,
          itemName: "Milk",
          unitSymbol: "L",
          quantity: -1,
        }),
        movement({ movementType: "wastage", quantity: -1 }),
      ],
      COSTS,
    );
    expect(rows).toHaveLength(3);
    const usage = rows.find((r) => r.movementType === "usage")!;
    expect(usage.lines).toBe(2);
    expect(usage.quantity).toBe(5);
    expect(usage.value).toBeCloseTo(5 * 32.5, 6);
    const sale = rows.find(
      (r) => r.movementType === "sale_deduction" && r.itemId === MILK,
    )!;
    expect(sale.value).toBeCloseTo(58, 6);
  });

  it("counts items without a cost as ₹0", () => {
    const rows = aggregateUsage(
      [movement({ movementType: "usage", quantity: -2 })],
      new Map(),
    );
    expect(rows[0].value).toBe(0);
  });

  it("sorts by value descending", () => {
    const rows = aggregateUsage(
      [
        movement({ movementType: "usage", quantity: -1 }),
        movement({
          movementType: "usage",
          itemId: MILK,
          itemName: "Milk",
          unitSymbol: "L",
          quantity: -1,
        }),
      ],
      COSTS,
    );
    expect(rows[0].itemName).toBe("Milk");
  });
});

describe("aggregateWastageByReason", () => {
  it("groups wastage by reason code with value lost", () => {
    const rows = aggregateWastageByReason(
      [
        movement({
          movementType: "wastage",
          reasonCode: "expired",
          quantity: -2,
        }),
        movement({
          movementType: "wastage",
          reasonCode: "expired",
          quantity: -1,
        }),
        movement({
          movementType: "wastage",
          reasonCode: "spoiled",
          itemId: MILK,
          itemName: "Milk",
          unitSymbol: "L",
          quantity: -1,
        }),
        movement({ movementType: "usage", quantity: -5 }),
      ],
      COSTS,
    );
    expect(rows).toHaveLength(2);
    const expired = rows.find((r) => r.reasonCode === "expired")!;
    expect(expired.lines).toBe(2);
    expect(expired.quantity).toBe(3);
    expect(expired.value).toBeCloseTo(3 * 32.5, 6);
  });

  it("falls back to other_wastage when the reason is missing", () => {
    const rows = aggregateWastageByReason(
      [movement({ movementType: "wastage", quantity: -1 })],
      COSTS,
    );
    expect(rows[0].reasonCode).toBe("other_wastage");
  });
});

describe("aggregateFoodCostByDay", () => {
  it("buckets sale deductions onto IST calendar days", () => {
    const days = aggregateFoodCostByDay(
      [
        // 2026-10-04T20:00:00Z is 2026-10-05 01:30 IST.
        movement({
          movementType: "sale_deduction",
          quantity: -4,
          createdAt: "2026-10-04T20:00:00.000Z",
        }),
        movement({
          movementType: "sale_deduction",
          quantity: -2,
          createdAt: "2026-10-04T08:30:00.000Z",
        }),
        movement({ movementType: "usage", quantity: -10 }),
      ],
      COSTS,
    );
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({ date: "2026-10-04", foodCost: 2 * 32.5 });
    expect(days[1]).toEqual({ date: "2026-10-05", foodCost: 4 * 32.5 });
  });

  it("returns days in chronological order", () => {
    const days = aggregateFoodCostByDay(
      [
        movement({
          movementType: "sale_deduction",
          quantity: -1,
          createdAt: "2026-10-05T10:00:00.000Z",
        }),
        movement({
          movementType: "sale_deduction",
          quantity: -1,
          createdAt: "2026-10-03T10:00:00.000Z",
        }),
      ],
      COSTS,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-05"]);
  });
});

describe("priceChangePct", () => {
  it("computes the signed percentage change", () => {
    expect(priceChangePct(30, 33)).toBeCloseTo(10, 6);
    expect(priceChangePct(40, 36)).toBeCloseTo(-10, 6);
  });

  it("returns null when the change is not computable", () => {
    expect(priceChangePct(null, 33)).toBeNull();
    expect(priceChangePct(30, null)).toBeNull();
    expect(priceChangePct(0, 33)).toBeNull();
  });
});

function priceEvent(overrides: Partial<PriceChangeEvent>): PriceChangeEvent {
  return {
    supplierId: "sup-1",
    supplierName: "Fresh Farms",
    itemId: TOMATO,
    itemName: "Tomato",
    oldPrice: 30,
    newPrice: 32.5,
    changedAt: "2026-10-04T08:30:00.000Z",
    ...overrides,
  };
}

describe("aggregatePriceChanges", () => {
  it("summarizes the net change per supplier/item pair", () => {
    const summaries = aggregatePriceChanges([
      priceEvent({ oldPrice: 30, newPrice: 31, changedAt: "2026-10-05T00:00:00Z" }),
      priceEvent({ oldPrice: 28, newPrice: 30, changedAt: "2026-10-03T00:00:00Z" }),
      priceEvent({
        supplierId: "sup-2",
        supplierName: "Dairy Co",
        itemId: MILK,
        itemName: "Milk",
        oldPrice: 58,
        newPrice: 55,
        changedAt: "2026-10-04T00:00:00Z",
      }),
    ]);
    expect(summaries).toHaveLength(2);
    const tomato = summaries.find((s) => s.itemId === TOMATO)!;
    expect(tomato.changes).toBe(2);
    expect(tomato.firstOldPrice).toBe(28);
    expect(tomato.lastNewPrice).toBe(31);
    expect(tomato.changePct).toBeCloseTo(((31 - 28) / 28) * 100, 6);
    const milk = summaries.find((s) => s.itemId === MILK)!;
    expect(milk.changePct).toBeCloseTo(((55 - 58) / 58) * 100, 6);
  });

  it("sorts by absolute change percentage descending", () => {
    const summaries = aggregatePriceChanges([
      priceEvent({ oldPrice: 100, newPrice: 101 }),
      priceEvent({
        itemId: MILK,
        itemName: "Milk",
        oldPrice: 100,
        newPrice: 90,
      }),
    ]);
    expect(summaries[0].itemId).toBe(MILK);
  });
});
