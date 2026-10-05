import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { recordSales } from "@/api/sales";
import { itemsQueryKey } from "@/features/items/hooks";
import { stockQueryKey } from "@/features/items/stockHooks";
import { recipesQueryKey } from "@/features/recipes/hooks";
import { salesQueryKey, useRecordSales } from "./hooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// invalidation, toasts) with zero network.
vi.mock("@/api/sales", () => ({
  recordSales: vi.fn(),
}));

const mockedRecordSales = vi.mocked(recordSales);

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
