import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import {
  applyStockCount,
  countProgressPercent,
  createStockCount,
  getStockCount,
  isLargeVariance,
  lineVariance,
  listStockCounts,
  saveCountLine,
  submitStockCount,
  updateStockCountStatus,
} from "./counts";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);
const mockRpc = vi.fn();
const mockFrom = vi.fn();

type QueryResult = { data: unknown; error: null };

function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "order",
    "single",
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) =>
    resolve(result);
  return builder;
}

const COUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const listRow = {
  id: COUNT_ID,
  title: "Weekly full count",
  status: "in_progress",
  assigned_to: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T01:00:00Z",
  stock_count_lines: [
    { counted_qty: 6 },
    { counted_qty: null },
    { counted_qty: 2.5 },
  ],
};

const detailRow = {
  id: COUNT_ID,
  title: "Weekly full count",
  status: "in_progress",
  assigned_to: null,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T01:00:00Z",
  stock_count_lines: [
    {
      id: "d0000000-0000-0000-0000-000000000001",
      item_id: ITEM_ID,
      expected_qty: 7.5,
      counted_qty: 6,
      items: { name: "Tomatoes", units: { symbol: "kg" } },
    },
  ],
};

const lineRow = {
  id: "d0000000-0000-0000-0000-000000000001",
  item_id: ITEM_ID,
  expected_qty: 7.5,
  counted_qty: 6,
  items: { name: "Tomatoes", units: { symbol: "kg" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    rpc: mockRpc,
    from: mockFrom,
  } as unknown as SupabaseClient);
});

describe("countProgressPercent", () => {
  it("computes the counted/total ratio, rounding down to whole percent", () => {
    expect(
      countProgressPercent({
        id: COUNT_ID,
        title: "t",
        status: "draft",
        assignedTo: null,
        createdAt: "",
        updatedAt: "",
        countedLines: 2,
        totalLines: 3,
      }),
    ).toBe(67);
  });

  it("is 0 for a session with no lines", () => {
    expect(
      countProgressPercent({
        id: COUNT_ID,
        title: "t",
        status: "draft",
        assignedTo: null,
        createdAt: "",
        updatedAt: "",
        countedLines: 0,
        totalLines: 0,
      }),
    ).toBe(0);
  });
});

describe("listStockCounts", () => {
  it("maps rows and computes counted/total progress", async () => {
    mockFrom.mockReturnValue(chainable({ data: [listRow], error: null }));
    const counts = await listStockCounts();
    expect(mockFrom).toHaveBeenCalledWith("stock_counts");
    expect(counts).toEqual([
      {
        id: COUNT_ID,
        title: "Weekly full count",
        status: "in_progress",
        assignedTo: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T01:00:00Z",
        countedLines: 2,
        totalLines: 3,
      },
    ]);
  });

  it("throws on RPC/client errors", async () => {
    mockFrom.mockReturnValue(
      chainable({ data: null, error: { message: "denied" } } as never),
    );
    await expect(listStockCounts()).rejects.toThrow("denied");
  });
});

describe("getStockCount", () => {
  it("loads the session with its sheet lines sorted by item name", async () => {
    mockFrom.mockReturnValue(chainable({ data: detailRow, error: null }));
    const detail = await getStockCount(COUNT_ID);
    expect(mockFrom).toHaveBeenCalledWith("stock_counts");
    expect(detail.title).toBe("Weekly full count");
    expect(detail.countedLines).toBe(1);
    expect(detail.totalLines).toBe(1);
    expect(detail.lines).toEqual([
      {
        id: "d0000000-0000-0000-0000-000000000001",
        itemId: ITEM_ID,
        itemName: "Tomatoes",
        unitSymbol: "kg",
        expectedQty: 7.5,
        countedQty: 6,
      },
    ]);
  });
});

describe("createStockCount", () => {
  it("calls the create_stock_count RPC with snake_case params", async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: COUNT_ID,
        title: "Weekly full count",
        status: "draft",
        assigned_to: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        created_at: "2026-10-05T00:00:00Z",
        updated_at: "2026-10-05T00:00:00Z",
      },
      error: null,
    });
    const count = await createStockCount({
      title: "Weekly full count",
      assignedTo: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
    expect(mockRpc).toHaveBeenCalledWith("create_stock_count", {
      p_title: "Weekly full count",
      p_assigned_to: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
    expect(count.status).toBe("draft");
    expect(count.countedLines).toBe(0);
  });

  it("passes null assignee through and validates input first", async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: COUNT_ID,
        title: "Count",
        status: "draft",
        assigned_to: null,
        created_at: "2026-10-05T00:00:00Z",
        updated_at: "2026-10-05T00:00:00Z",
      },
      error: null,
    });
    await createStockCount({ title: "Count" });
    expect(mockRpc).toHaveBeenCalledWith("create_stock_count", {
      p_title: "Count",
      p_assigned_to: null,
    });
    await expect(createStockCount({ title: "  " })).rejects.toThrow();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe("saveCountLine", () => {
  it("updates counted_qty by (count_id, item_id) and maps the row", async () => {
    mockFrom.mockReturnValue(chainable({ data: lineRow, error: null }));
    const line = await saveCountLine({
      countId: COUNT_ID,
      itemId: ITEM_ID,
      countedQty: 6,
    });
    expect(mockFrom).toHaveBeenCalledWith("stock_count_lines");
    expect(line).toEqual({
      id: "d0000000-0000-0000-0000-000000000001",
      itemId: ITEM_ID,
      itemName: "Tomatoes",
      unitSymbol: "kg",
      expectedQty: 7.5,
      countedQty: 6,
    });
  });

  it("rejects negative quantities before any network call", async () => {
    await expect(
      saveCountLine({ countId: COUNT_ID, itemId: ITEM_ID, countedQty: -1 }),
    ).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("submitStockCount", () => {
  it("sets the status to submitted and maps the row", async () => {
    mockFrom.mockReturnValue(
      chainable({ data: { ...listRow, status: "submitted" }, error: null }),
    );
    const count = await submitStockCount(COUNT_ID);
    expect(count.status).toBe("submitted");
  });
});

describe("updateStockCountStatus", () => {
  it("updates the status and validates it first", async () => {
    mockFrom.mockReturnValue(chainable({ data: listRow, error: null }));
    const count = await updateStockCountStatus(COUNT_ID, "in_progress");
    expect(count.status).toBe("in_progress");
    await expect(
      updateStockCountStatus(COUNT_ID, "approved" as never),
    ).rejects.toThrow();
  });
});

describe("lineVariance", () => {
  it("computes counted − expected", () => {
    expect(lineVariance({ expectedQty: 7.5, countedQty: 8 })).toBe(0.5);
    expect(lineVariance({ expectedQty: 2, countedQty: 1.5 })).toBe(-0.5);
    expect(lineVariance({ expectedQty: 5, countedQty: 5 })).toBe(0);
  });

  it("is null for an uncounted line", () => {
    expect(lineVariance({ expectedQty: 7.5, countedQty: null })).toBeNull();
  });
});

describe("isLargeVariance", () => {
  it("flags variances at or above 20% of expected", () => {
    expect(isLargeVariance({ expectedQty: 10, countedQty: 12 })).toBe(true);
    expect(isLargeVariance({ expectedQty: 10, countedQty: 8 })).toBe(true);
    expect(isLargeVariance({ expectedQty: 10, countedQty: 11 })).toBe(false);
    expect(isLargeVariance({ expectedQty: 10, countedQty: 10 })).toBe(false);
  });

  it("flags any non-zero variance when the system expected nothing", () => {
    expect(isLargeVariance({ expectedQty: 0, countedQty: 0.5 })).toBe(true);
    expect(isLargeVariance({ expectedQty: 0, countedQty: 0 })).toBe(false);
  });

  it("never flags an uncounted line", () => {
    expect(isLargeVariance({ expectedQty: 10, countedQty: null })).toBe(false);
  });
});

describe("applyStockCount", () => {
  const rpcSummary = {
    count_id: COUNT_ID,
    title: "October full count",
    status: "applied",
    total_lines: 3,
    posted_adjustments: 2,
    adjustments: [
      {
        item_id: ITEM_ID,
        name: "Tomatoes",
        unit_symbol: "kg",
        expected_qty: 7.5,
        counted_qty: 8,
        variance: 0.5,
      },
      {
        item_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        name: "Milk",
        unit_symbol: "L",
        expected_qty: 2,
        counted_qty: 1.5,
        variance: -0.5,
      },
    ],
  };

  it("calls the RPC and maps the summary", async () => {
    mockRpc.mockResolvedValue({ data: rpcSummary, error: null });
    const result = await applyStockCount(COUNT_ID);
    expect(mockRpc).toHaveBeenCalledWith("apply_stock_count", {
      p_count_id: COUNT_ID,
    });
    expect(result.status).toBe("applied");
    expect(result.postedAdjustments).toBe(2);
    expect(result.totalLines).toBe(3);
    expect(result.adjustments).toHaveLength(2);
    expect(result.adjustments[0]).toMatchObject({
      name: "Tomatoes",
      variance: 0.5,
    });
  });

  it("rejects an invalid count id before calling", async () => {
    await expect(applyStockCount("not-a-uuid")).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(applyStockCount(COUNT_ID)).rejects.toThrow("nope");
  });
});
