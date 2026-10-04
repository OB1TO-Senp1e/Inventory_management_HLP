import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { createOpeningBalance, getCurrentStock } from "@/api/stock";
import { itemsQueryKey } from "@/features/items/hooks";
import {
  stockQueryKey,
  useCreateOpeningBalance,
  useCurrentStock,
} from "./stockHooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// gating, invalidation, toasts) with zero network.
vi.mock("@/api/stock", () => ({
  createOpeningBalance: vi.fn(),
  getCurrentStock: vi.fn(),
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

const mockedGetCurrentStock = vi.mocked(getCurrentStock);
const mockedCreateOpeningBalance = vi.mocked(createOpeningBalance);

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

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("useCurrentStock", () => {
  it("delegates to getCurrentStock when profile and item id are present", async () => {
    mockedGetCurrentStock.mockResolvedValue({
      itemId: "item-1",
      quantity: 65,
      lastMovementAt: null,
    });
    const { result } = renderHook(() => useCurrentStock("item-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetCurrentStock).toHaveBeenCalledWith({ itemId: "item-1" });
    expect(result.current.data?.quantity).toBe(65);
  });

  it("stays disabled without a profile", () => {
    authState.profile = null;
    const { result } = renderHook(() => useCurrentStock("item-1"), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetCurrentStock).not.toHaveBeenCalled();
  });

  it("stays disabled without an item id", () => {
    const { result } = renderHook(() => useCurrentStock(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetCurrentStock).not.toHaveBeenCalled();
  });
});

describe("useCreateOpeningBalance", () => {
  it("posts via the API, invalidates items+stock, and toasts success", async () => {
    mockedCreateOpeningBalance.mockResolvedValue({ movementId: "m-1" });
    const invalidateSpy = vi.fn();
    const { result } = renderHook(() => useCreateOpeningBalance(), {
      wrapper,
    });
    // Spy after the client exists inside the wrapper closure.
    const client = queryClient;
    const origInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = vi.fn((...args: unknown[]) => {
      invalidateSpy(...args);
      return origInvalidate(
        ...(args as Parameters<typeof origInvalidate>),
      );
    });

    result.current.mutate({ itemId: "item-1", quantity: 10, unitCost: 5 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedCreateOpeningBalance).toHaveBeenCalledWith({
      itemId: "item-1",
      quantity: 10,
      unitCost: 5,
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: itemsQueryKey }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: stockQueryKey }),
    );
    await screen.findByText("Opening balance posted.");
  });

  it("toasts the error message on failure", async () => {
    mockedCreateOpeningBalance.mockRejectedValue(
      new Error("create_opening_balance: quantity must be greater than zero."),
    );
    const { result } = renderHook(() => useCreateOpeningBalance(), {
      wrapper,
    });
    result.current.mutate({ itemId: "item-1", quantity: 10, unitCost: 5 });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await screen.findByText(/quantity must be greater than zero/);
  });
});
