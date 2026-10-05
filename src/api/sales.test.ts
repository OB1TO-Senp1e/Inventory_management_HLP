import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { recordSales } from "./sales";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);
const mockRpc = vi.fn();

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DISH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const rpcPayload = {
  sale_date: "2026-10-05",
  lines: [
    { menu_item_id: DISH_A, name: "Butter Chicken", dishes: 4 },
    { menu_item_id: DISH_B, name: "Naan", dishes: 2 },
  ],
  ingredients: [
    {
      item_id: "61000000-0000-0000-0000-000000000001",
      name: "Tomatoes",
      quantity: "2.5",
      unit_symbol: "kg",
    },
    {
      item_id: "61000000-0000-0000-0000-000000000002",
      name: "Milk",
      quantity: "0.5",
      unit_symbol: "L",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    rpc: mockRpc,
  } as unknown as SupabaseClient);
});

describe("recordSales", () => {
  it("calls the record_sales RPC with snake_case params and maps the summary", async () => {
    mockRpc.mockResolvedValue({ data: rpcPayload, error: null });
    const result = await recordSales({
      saleDate: "2026-10-05",
      lines: [
        { menuItemId: DISH_A, dishes: 4 },
        { menuItemId: DISH_B, dishes: 2 },
      ],
    });
    expect(mockRpc).toHaveBeenCalledWith("record_sales", {
      p_lines: [
        { menu_item_id: DISH_A, dishes: 4 },
        { menu_item_id: DISH_B, dishes: 2 },
      ],
      p_sale_date: "2026-10-05",
    });
    expect(result).toEqual({
      saleDate: "2026-10-05",
      lines: [
        { menuItemId: DISH_A, name: "Butter Chicken", dishes: 4 },
        { menuItemId: DISH_B, name: "Naan", dishes: 2 },
      ],
      ingredients: [
        {
          itemId: "61000000-0000-0000-0000-000000000001",
          name: "Tomatoes",
          quantity: 2.5,
          unitSymbol: "kg",
        },
        {
          itemId: "61000000-0000-0000-0000-000000000002",
          name: "Milk",
          quantity: 0.5,
          unitSymbol: "L",
        },
      ],
    });
  });

  it("rejects invalid input before any network call", async () => {
    await expect(
      recordSales({ saleDate: "2026-10-05", lines: [] }),
    ).rejects.toThrow(/at least one dish/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'record_sales: "Old Dish" is archived.' },
    });
    await expect(
      recordSales({
        saleDate: "2026-10-05",
        lines: [{ menuItemId: DISH_A, dishes: 1 }],
      }),
    ).rejects.toThrow(/is archived/);
  });

  it("rejects a malformed RPC summary", async () => {
    mockRpc.mockResolvedValue({ data: { bogus: true }, error: null });
    await expect(
      recordSales({
        saleDate: "2026-10-05",
        lines: [{ menuItemId: DISH_A, dishes: 1 }],
      }),
    ).rejects.toThrow();
  });
});
