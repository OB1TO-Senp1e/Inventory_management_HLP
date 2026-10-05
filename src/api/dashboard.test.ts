import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { getDashboardSummary } from "./dashboard";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/**
 * Thenable chainable mock: every builder method returns the builder itself
 * and awaiting it resolves the canned result. Includes `in` and `gte`,
 * which the dashboard summary query uses.
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "eq",
    "neq",
    "in",
    "gte",
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

function mockClient(
  movements: QueryResult,
  costs: QueryResult,
  stock: QueryResult,
): void {
  const from = vi.fn((table: string) => {
    if (table === "stock_movements") return chainable(movements);
    if (table === "items") return chainable(costs);
    return chainable(stock);
  });
  mockedGetSupabaseClient.mockReturnValue({ from } as unknown as SupabaseClient);
}

const COSTS = {
  data: [
    { id: TOMATO, avg_unit_cost: 32.5 },
    { id: MILK, avg_unit_cost: null },
  ],
  error: null,
};
const STOCK = {
  data: [
    { item_id: TOMATO, quantity: 42.5 },
    { item_id: MILK, quantity: 3 },
  ],
  error: null,
};

describe("getDashboardSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes today's usage and wastage with costed values", async () => {
    mockClient(
      {
        data: [
          { item_id: TOMATO, movement_type: "usage", quantity: -20 },
          { item_id: TOMATO, movement_type: "usage", quantity: -10 },
          { item_id: MILK, movement_type: "wastage", quantity: -1 },
        ],
        error: null,
      },
      COSTS,
      STOCK,
    );
    const summary = await getDashboardSummary();
    expect(summary.usage).toEqual({ lines: 2, quantity: 30, value: 30 * 32.5 });
    // Milk has no recorded cost: quantity counts, value is zero.
    expect(summary.wastage).toEqual({ lines: 1, quantity: 1, value: 0 });
  });

  it("computes total stock value from current stock and avg costs", async () => {
    mockClient({ data: [], error: null }, COSTS, STOCK);
    const summary = await getDashboardSummary();
    expect(summary.stockValue).toBeCloseTo(42.5 * 32.5 + 3 * 0, 6);
    expect(summary.usage).toEqual({ lines: 0, quantity: 0, value: 0 });
    expect(summary.wastage).toEqual({ lines: 0, quantity: 0, value: 0 });
  });

  it("throws when any of the three reads fails", async () => {
    mockClient(
      { data: null, error: { message: "boom" } },
      COSTS,
      STOCK,
    );
    await expect(getDashboardSummary()).rejects.toThrow("boom");
  });

  it("rejects rows that fail schema validation", async () => {
    mockClient(
      {
        data: [{ item_id: TOMATO, movement_type: "bogus", quantity: -1 }],
        error: null,
      },
      COSTS,
      STOCK,
    );
    await expect(getDashboardSummary()).rejects.toThrow();
  });
});
