import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { previewSalesDeductions, recordSales } from "@/api/sales";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import {
  posImportsQueryKey,
  salesQueryKey,
  useImportedExternalIds,
  useImportPosSales,
  usePreviewSalesDeductions,
  useRecordSales,
} from "./hooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// invalidation, toasts) with zero network.
vi.mock("@/api/sales", () => ({
  recordSales: vi.fn(),
  previewSalesDeductions: vi.fn(),
}));
vi.mock("@/api/pos", () => ({
  importPosSales: vi.fn(),
  listImportedExternalIds: vi.fn(),
}));

const mockedRecordSales = vi.mocked(recordSales);
const mockedPreviewSalesDeductions = vi.mocked(previewSalesDeductions);

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const input = {
  saleDate: "2026-10-05",
  lines: [{ menuItemId: DISH_A, dishes: 4 }],
};

const summary = {
  saleDate: "2026-10-05",
  lines: [{ menuItemId: DISH_A, name: "Butter Chicken", dishes: 4 }],
  ingredients: [
    { itemId: "item-1", name: "Tomatoes", quantity: 2, unitSymbol: "kg" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salesQueryKey", () => {
  it("is the stable sales key", () => {
    expect(salesQueryKey).toEqual(["sales"]);
  });
});

describe("useRecordSales", () => {
  it("delegates to recordSales and invalidates stock/item/recipe queries", async () => {
    mockedRecordSales.mockResolvedValue(summary);

    const { result } = renderHook(() => useRecordSales(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate(input);

    await waitFor(() => {
      expect(mockedRecordSales).toHaveBeenCalledWith(input);
    });
    await waitFor(() => {
      expect(
        screen.getByText(/sales recorded for 2026-10-05/i),
      ).toBeInTheDocument();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: stockQueryKey });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: itemsQueryKey });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: recipesQueryKey });
  });

  it("toasts the RPC error on failure", async () => {
    mockedRecordSales.mockRejectedValue(
      new Error('record_sales: "Old Dish" is archived.'),
    );
    const { result } = renderHook(() => useRecordSales(), { wrapper });
    result.current.mutate(input);

    await waitFor(() => {
      expect(screen.getByText(/is archived/i)).toBeInTheDocument();
    });
  });
});

describe("usePreviewSalesDeductions", () => {
  const preview = [
    {
      itemId: "item-1",
      itemName: "Tomatoes",
      unitSymbol: "kg",
      currentQuantity: 2,
      deductionQuantity: 4,
      projectedQuantity: -2,
      wouldGoNegative: true,
    },
  ];

  it("delegates to previewSalesDeductions and resolves the rows", async () => {
    mockedPreviewSalesDeductions.mockResolvedValue(preview);
    const { result } = renderHook(() => usePreviewSalesDeductions(), {
      wrapper,
    });
    const rows = await result.current.mutateAsync(input);
    expect(mockedPreviewSalesDeductions).toHaveBeenCalledWith(input);
    expect(rows).toEqual(preview);
  });

  it("toasts the RPC error and does not invalidate anything", async () => {
    mockedPreviewSalesDeductions.mockRejectedValue(
      new Error('preview_sales_deductions: "Old Dish" is archived.'),
    );
    const { result } = renderHook(() => usePreviewSalesDeductions(), {
      wrapper,
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await expect(result.current.mutateAsync(input)).rejects.toThrow(
      /is archived/,
    );
    await waitFor(() => {
      expect(screen.getByText(/is archived/i)).toBeInTheDocument();
    });
    // A preview is not an action: no success toast, no invalidation.
    expect(
      screen.queryByText(/sales recorded/i),
    ).not.toBeInTheDocument();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useImportedExternalIds", () => {
  it("is disabled without a provider and queries per provider", async () => {
    const { listImportedExternalIds } = await import("@/api/pos");
    const mocked = vi.mocked(listImportedExternalIds);
    mocked.mockResolvedValue(new Set(["pos-1"]));

    const { result, rerender } = renderHook(
      ({ provider }: { provider: string | null }) =>
        useImportedExternalIds(provider),
      { wrapper, initialProps: { provider: null as string | null } },
    );
    expect(result.current.isPending).toBe(true);
    expect(mocked).not.toHaveBeenCalled();

    rerender({ provider: "stub" });
    await waitFor(() => expect(mocked).toHaveBeenCalledWith("stub"));
    await waitFor(() =>
      expect(result.current.data).toEqual(new Set(["pos-1"])),
    );
  });
});

describe("useImportPosSales", () => {
  it("delegates to importPosSales, invalidates stock/item/recipe/import queries and toasts", async () => {
    const { importPosSales } = await import("@/api/pos");
    const mocked = vi.mocked(importPosSales);
    const result_payload = {
      provider: "stub",
      saleDate: "2026-10-05",
      imported: 2,
      sales: summary,
    };
    mocked.mockResolvedValue(result_payload);

    const { result } = renderHook(() => useImportPosSales(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({
      provider: "stub",
      saleDate: "2026-10-05",
      lines: [
        {
          externalSaleId: "pos-1",
          menuItemId: DISH_A,
          dishes: 4,
          soldAt: null,
        },
      ],
    });

    await waitFor(() => expect(mocked).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        screen.getByText(/Imported 2 POS sales for 2026-10-05/),
      ).toBeInTheDocument();
    });
    const keys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(stockQueryKey);
    expect(keys).toContainEqual(itemsQueryKey);
    expect(keys).toContainEqual(recipesQueryKey);
    expect(keys).toContainEqual(posImportsQueryKey);
  });

  it("toasts the RPC error", async () => {
    const { importPosSales } = await import("@/api/pos");
    const mocked = vi.mocked(importPosSales);
    mocked.mockRejectedValue(new Error("import_pos_sales: sale pos-1 was already imported."));

    const { result } = renderHook(() => useImportPosSales(), { wrapper });
    result.current.mutate({
      provider: "stub",
      saleDate: "2026-10-05",
      lines: [
        {
          externalSaleId: "pos-1",
          menuItemId: DISH_A,
          dishes: 4,
          soldAt: null,
        },
      ],
    });
    await waitFor(() => {
      expect(screen.getByText(/already imported/)).toBeInTheDocument();
    });
  });
});
