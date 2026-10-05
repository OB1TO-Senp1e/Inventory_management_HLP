import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { importPosSales, listImportedExternalIds } from "./pos";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);
const mockRpc = vi.fn();

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const rpcPayload = {
  provider: "stub",
  sale_date: "2026-10-05",
  imported: 2,
  sales: {
    sale_date: "2026-10-05",
    lines: [{ menu_item_id: DISH_A, name: "Butter Chicken", dishes: 6 }],
    ingredients: [
      {
        item_id: "61000000-0000-0000-0000-000000000001",
        name: "Tomatoes",
        quantity: "3",
        unit_symbol: "kg",
      },
    ],
  },
};

function chainable(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: unknown) => void) =>
    resolve(result);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSupabaseClient.mockReturnValue({
    rpc: mockRpc,
    from: vi.fn(),
  } as unknown as SupabaseClient);
});

describe("importPosSales", () => {
  it("calls import_pos_sales with snake_case params and maps the result", async () => {
    mockRpc.mockResolvedValue({ data: rpcPayload, error: null });
    const result = await importPosSales({
      provider: "stub",
      saleDate: "2026-10-05",
      lines: [
        {
          externalSaleId: "stub-0001",
          menuItemId: DISH_A,
          dishes: 4,
          soldAt: "2026-10-04T13:05:00+05:30",
        },
        {
          externalSaleId: "stub-0003",
          menuItemId: DISH_A,
          dishes: 2,
          soldAt: null,
        },
      ],
    });
    expect(mockRpc).toHaveBeenCalledWith("import_pos_sales", {
      p_provider: "stub",
      p_sales: [
        {
          external_sale_id: "stub-0001",
          menu_item_id: DISH_A,
          dishes: 4,
          sold_at: "2026-10-04T13:05:00+05:30",
        },
        {
          external_sale_id: "stub-0003",
          menu_item_id: DISH_A,
          dishes: 2,
          sold_at: null,
        },
      ],
      p_sale_date: "2026-10-05",
    });
    expect(result.provider).toBe("stub");
    expect(result.imported).toBe(2);
    expect(result.sales.lines[0]).toMatchObject({
      menuItemId: DISH_A,
      name: "Butter Chicken",
      dishes: 6,
    });
  });

  it("throws the RPC error message", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "import_pos_sales: sale stub-0001 was already imported." },
    });
    await expect(
      importPosSales({
        provider: "stub",
        saleDate: "2026-10-05",
        lines: [
          { externalSaleId: "stub-0001", menuItemId: DISH_A, dishes: 1, soldAt: null },
        ],
      }),
    ).rejects.toThrow("already imported");
  });

  it("rejects invalid input before the network", async () => {
    await expect(
      importPosSales({ provider: "stub", saleDate: "2026-10-05", lines: [] }),
    ).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("listImportedExternalIds", () => {
  it("returns the imported external ids as a set", async () => {
    const from = vi.fn(() =>
      chainable({
        data: [
          { external_sale_id: "stub-0001" },
          { external_sale_id: "stub-0002" },
        ],
        error: null,
      }),
    );
    mockedGetSupabaseClient.mockReturnValue({
      rpc: mockRpc,
      from,
    } as unknown as SupabaseClient);
    const ids = await listImportedExternalIds("stub");
    expect(ids).toEqual(new Set(["stub-0001", "stub-0002"]));
    expect(from).toHaveBeenCalledWith("pos_imports");
  });
});
