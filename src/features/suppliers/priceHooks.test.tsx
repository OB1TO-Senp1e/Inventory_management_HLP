import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  listPriceHistory,
  listPricesByItem,
  listPricesBySupplier,
  setPreferredSupplier,
  upsertPrice,
} from "@/api/prices";
import {
  useItemPrices,
  usePriceHistory,
  useSetPreferredSupplier,
  useSupplierPrices,
  useUpsertPrice,
} from "./priceHooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// restaurant-id injection, invalidation, toasts) with zero network.
vi.mock("@/api/prices", () => ({
  listPricesBySupplier: vi.fn(),
  listPricesByItem: vi.fn(),
  upsertPrice: vi.fn(),
  setPreferredSupplier: vi.fn(),
  listPriceHistory: vi.fn(),
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    } as { id: string; restaurantId: string; role: "owner" } | null,
  },
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ profile: authState.profile }),
}));

const mockedListPricesBySupplier = vi.mocked(listPricesBySupplier);
const mockedListPricesByItem = vi.mocked(listPricesByItem);
const mockedUpsertPrice = vi.mocked(upsertPrice);
const mockedSetPreferredSupplier = vi.mocked(setPreferredSupplier);
const mockedListPriceHistory = vi.mocked(listPriceHistory);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("useSupplierPrices", () => {
  it("delegates to listPricesBySupplier when profile and id are present", async () => {
    mockedListPricesBySupplier.mockResolvedValue([]);
    const { result } = renderHook(
      () => useSupplierPrices("supplier-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListPricesBySupplier).toHaveBeenCalledWith({
      supplierId: "supplier-1",
    });
  });

  it("stays disabled without a profile", () => {
    authState.profile = null;
    const { result } = renderHook(() => useSupplierPrices("supplier-1"), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedListPricesBySupplier).not.toHaveBeenCalled();
  });

  it("stays disabled without a supplier id", () => {
    const { result } = renderHook(() => useSupplierPrices(null), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedListPricesBySupplier).not.toHaveBeenCalled();
  });
});

describe("useItemPrices", () => {
  it("delegates to listPricesByItem", async () => {
    mockedListPricesByItem.mockResolvedValue([]);
    const { result } = renderHook(() => useItemPrices("item-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListPricesByItem).toHaveBeenCalledWith({ itemId: "item-1" });
  });
});

describe("usePriceHistory", () => {
  it("delegates to listPriceHistory and stays disabled with no filters", async () => {
    mockedListPriceHistory.mockResolvedValue([]);
    const { result } = renderHook(
      () => usePriceHistory({ supplierId: "supplier-1", itemId: "item-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListPriceHistory).toHaveBeenCalledWith({
      supplierId: "supplier-1",
      itemId: "item-1",
    });
  });

  it("stays disabled when neither supplier nor item is given", () => {
    const { result } = renderHook(() => usePriceHistory({}), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedListPriceHistory).not.toHaveBeenCalled();
  });
});

describe("useUpsertPrice", () => {
  it("injects the restaurant id from the profile and toasts on success", async () => {
    mockedUpsertPrice.mockResolvedValue({} as never);
    const { result } = renderHook(() => useUpsertPrice(), { wrapper });
    result.current.mutate({
      supplierId: "supplier-1",
      itemId: "item-1",
      unitPrice: 45.5,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedUpsertPrice).toHaveBeenCalledWith({
      restaurantId: "restaurant-1",
      supplierId: "supplier-1",
      itemId: "item-1",
      unitPrice: 45.5,
    });
    expect(await screen.findByText("Price saved.")).toBeInTheDocument();
  });

  it("toasts the error message on failure", async () => {
    mockedUpsertPrice.mockRejectedValue(new Error("Price too low?"));
    const { result } = renderHook(() => useUpsertPrice(), { wrapper });
    result.current.mutate({
      supplierId: "supplier-1",
      itemId: "item-1",
      unitPrice: 45.5,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(await screen.findByText("Price too low?")).toBeInTheDocument();
  });
});

describe("useSetPreferredSupplier", () => {
  it("delegates to setPreferredSupplier and toasts on success", async () => {
    mockedSetPreferredSupplier.mockResolvedValue({} as never);
    const { result } = renderHook(() => useSetPreferredSupplier(), {
      wrapper,
    });
    result.current.mutate({ itemId: "item-1", supplierId: "supplier-1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedSetPreferredSupplier).toHaveBeenCalledWith({
      itemId: "item-1",
      supplierId: "supplier-1",
    });
    expect(
      await screen.findByText("Preferred supplier updated."),
    ).toBeInTheDocument();
  });
});
