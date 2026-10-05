import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  getFoodCostTrend,
  getMenuEngineeringReport,
  getPriceChangeReport,
  getUsageReport,
  getWastageReport,
} from "./reports";
import { listPriceHistory } from "./prices";
import { listMenuItems } from "./recipes";

// No network in these tests: the client factory and the prices API are
// mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("./prices", () => ({ listPriceHistory: vi.fn() }));
vi.mock("./recipes", () => ({ listMenuItems: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);
const mockedListPriceHistory = vi.mocked(listPriceHistory);
const mockedListMenuItems = vi.mocked(listMenuItems);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/**
 * Thenable chainable mock: every builder method returns the builder
 * itself and awaiting it resolves the canned result. Includes the range
 * filters the report queries use.
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "gte",
    "lte",
    "not",
    "order",
    "limit",
    "range",
    "single",
    "maybeSingle",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) =>
    resolve(result);
  return builder;
}

const TOMATO = "b0000000-0000-0000-0000-000000000001";
const MILK = "b0000000-0000-0000-0000-000000000002";

function movementRow(overrides: Record<string, unknown>) {
  return {
    item_id: TOMATO,
    movement_type: "usage",
    quantity: -2,
    reason_code: "kitchen_use",
    created_at: "2026-10-04T08:30:00.000Z",
    items: {
      name: "Tomato",
      avg_unit_cost: 32.5,
      units: { symbol: "kg" },
    },
    ...overrides,
  };
}

function mockMovements(data: unknown[]): void {
  mockedGetSupabaseClient.mockReturnValue({
    from: vi.fn(() => chainable({ data, error: null })),
  } as unknown as SupabaseClient);
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" };

describe("getUsageReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates usage and sale_deduction rows per item and type", async () => {
    mockMovements([
      movementRow({ movement_type: "usage", quantity: -2 }),
      movementRow({
        movement_type: "sale_deduction",
        quantity: -4,
        reason_code: null,
      }),
      movementRow({
        movement_type: "sale_deduction",
        item_id: MILK,
        quantity: -1,
        reason_code: null,
        items: { name: "Milk", avg_unit_cost: 58, units: { symbol: "L" } },
      }),
    ]);
    const rows = await getUsageReport(RANGE);
    expect(rows).toHaveLength(3);
    const sale = rows.find(
      (r) => r.movementType === "sale_deduction" && r.itemId === TOMATO,
    )!;
    expect(sale.quantity).toBe(4);
    expect(sale.value).toBeCloseTo(4 * 32.5, 6);
  });

  it("throws a readable error when the query fails", async () => {
    mockedGetSupabaseClient.mockReturnValue({
      from: vi.fn(() =>
        chainable({ data: null, error: { message: "boom" } }),
      ),
    } as unknown as SupabaseClient);
    await expect(getUsageReport(RANGE)).rejects.toThrow("boom");
  });
});

describe("getWastageReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups wastage rows by reason code", async () => {
    mockMovements([
      movementRow({ movement_type: "wastage", reason_code: "expired" }),
      movementRow({ movement_type: "wastage", reason_code: "expired" }),
      movementRow({ movement_type: "wastage", reason_code: "spoiled" }),
    ]);
    const rows = await getWastageReport(RANGE);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.reasonCode === "expired")!.lines).toBe(2);
  });
});

describe("getFoodCostTrend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buckets sale deductions onto IST days with ₹ costs", async () => {
    mockMovements([
      movementRow({
        movement_type: "sale_deduction",
        quantity: -4,
        reason_code: null,
        // 2026-10-04T20:00Z is 2026-10-05 01:30 IST.
        created_at: "2026-10-04T20:00:00.000Z",
      }),
    ]);
    const days = await getFoodCostTrend(RANGE);
    expect(days).toEqual([{ date: "2026-10-05", foodCost: 4 * 32.5 }]);
  });
});

describe("getPriceChangeReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters history to the range and summarizes net changes", async () => {
    mockedListPriceHistory.mockResolvedValue([
      {
        id: "h1",
        supplierId: "s1",
        itemId: TOMATO,
        oldPrice: 30,
        newPrice: 33,
        changedAt: "2026-10-10T08:00:00.000Z",
        supplierName: "Fresh Farms",
        itemName: "Tomato",
      },
      {
        id: "h2",
        supplierId: "s1",
        itemId: TOMATO,
        oldPrice: 28,
        newPrice: 30,
        changedAt: "2026-09-01T08:00:00.000Z",
        supplierName: "Fresh Farms",
        itemName: "Tomato",
      },
    ]);
    const report = await getPriceChangeReport(RANGE);
    expect(report.events).toHaveLength(1);
    expect(report.events[0].changePct).toBeCloseTo(10, 6);
    expect(report.summaries).toHaveLength(1);
    expect(report.summaries[0].changes).toBe(1);
  });

  it("returns empty reports when nothing changed in the range", async () => {
    mockedListPriceHistory.mockResolvedValue([]);
    const report = await getPriceChangeReport(RANGE);
    expect(report.events).toEqual([]);
    expect(report.summaries).toEqual([]);
  });
});

describe("getMenuEngineeringReport", () => {
  const BUTTER_CHICKEN = {
    id: "f0000000-0000-0000-0000-000000000001",
    name: "Butter Chicken",
    description: null,
    yieldQuantity: 4,
    yieldUnit: "servings",
    sellingPrice: 199,
    active: true,
    ingredientCount: 2,
    ingredientCost: 123,
    costPerDish: 30.75,
    foodCostPct: 15.45,
    createdAt: "2026-10-04T08:30:00.000Z",
    updatedAt: "2026-10-04T08:30:00.000Z",
  };
  const DAL_MAKHANI = {
    id: "f0000000-0000-0000-0000-000000000002",
    name: "Dal Makhani",
    description: null,
    yieldQuantity: 6,
    yieldUnit: "servings",
    sellingPrice: 149,
    active: true,
    ingredientCount: 1,
    ingredientCost: 48,
    costPerDish: 8,
    foodCostPct: 5.37,
    createdAt: "2026-10-04T08:30:00.000Z",
    updatedAt: "2026-10-04T08:30:00.000Z",
  };

  function mockSaleNotes(data: unknown[]): void {
    mockedGetSupabaseClient.mockReturnValue({
      from: vi.fn(() => chainable({ data, error: null })),
    } as unknown as SupabaseClient);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses dish quantities from sale notes and classifies against live costs", async () => {
    mockSaleNotes([
      {
        notes: "Sale 2026-10-05: Butter Chicken x4",
        created_at: "2026-10-05T08:30:00.000Z",
      },
      {
        notes: "Sale 2026-10-06: Dal Makhani x6, Butter Chicken x2",
        created_at: "2026-10-06T08:30:00.000Z",
      },
    ]);
    mockedListMenuItems.mockResolvedValue([BUTTER_CHICKEN, DAL_MAKHANI]);

    const report = await getMenuEngineeringReport(RANGE);
    expect(report.classifiedCount).toBe(2);
    const byName = new Map(report.dishes.map((d) => [d.name, d]));
    // Butter Chicken: sold 6, margin 199 − 30.75 = 168.25.
    expect(byName.get("Butter Chicken")?.qtySold).toBe(6);
    expect(byName.get("Butter Chicken")?.contributionMargin).toBeCloseTo(
      168.25,
      5,
    );
    // Dal Makhani: sold 6, margin 149 − 8 = 141.
    expect(byName.get("Dal Makhani")?.qtySold).toBe(6);
    // avg popularity = 6, avg margin = 154.625 → Butter Chicken is a Star
    // (on both averages), Dal Makhani a Plowhorse (popular, below margin).
    expect(byName.get("Butter Chicken")?.classification).toBe("star");
    expect(byName.get("Dal Makhani")?.classification).toBe("plowhorse");
    expect(mockedListMenuItems).toHaveBeenCalledWith({});
  });

  it("marks recipe-less dishes as cost-unknown via ingredientCount", async () => {
    mockSaleNotes([
      {
        notes: "Sale 2026-10-05: Mystery Thali x3",
        created_at: "2026-10-05T08:30:00.000Z",
      },
    ]);
    mockedListMenuItems.mockResolvedValue([
      {
        ...BUTTER_CHICKEN,
        id: "f0000000-0000-0000-0000-000000000003",
        name: "Mystery Thali",
        sellingPrice: 299,
        ingredientCount: 0,
        ingredientCost: 0,
        costPerDish: 0,
      },
    ]);

    const report = await getMenuEngineeringReport(RANGE);
    const row = report.dishes[0];
    expect(row.costPerDish).toBeNull();
    expect(row.classification).toBeNull();
    expect(row.unclassifiedReason).toBe("no-recipe");
    expect(report.classifiedCount).toBe(0);
  });

  it("returns an empty report when no sales were posted in the range", async () => {
    mockSaleNotes([]);
    mockedListMenuItems.mockResolvedValue([BUTTER_CHICKEN]);

    const report = await getMenuEngineeringReport(RANGE);
    expect(report.dishes).toEqual([]);
    expect(report.totalDishesSold).toBe(0);
  });

  it("throws a friendly error when the notes query fails", async () => {
    mockedGetSupabaseClient.mockReturnValue({
      from: vi.fn(() =>
        chainable({ data: null, error: { message: "boom" } }),
      ),
    } as unknown as SupabaseClient);
    await expect(getMenuEngineeringReport(RANGE)).rejects.toThrow("boom");
  });
});
