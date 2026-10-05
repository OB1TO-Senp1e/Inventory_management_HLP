import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { subscribeToStockMovements } from "@/api/stock";
import { recipesQueryKey, useRecipeCostRealtime } from "./hooks";

// The API modules are mocked: these tests verify hook wiring (gating,
// invalidation) with zero network.
vi.mock("@/api/stock", () => ({
  subscribeToStockMovements: vi.fn(),
}));
vi.mock("@/api/recipes", () => ({
  listMenuItems: vi.fn(),
  getMenuItem: vi.fn(),
  createMenuItem: vi.fn(),
  updateMenuItem: vi.fn(),
  archiveMenuItem: vi.fn(),
  addIngredient: vi.fn(),
  updateIngredient: vi.fn(),
  removeIngredient: vi.fn(),
  listUnitConversions: vi.fn(),
}));
vi.mock("@/api/items", () => ({
  listUnits: vi.fn(),
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

const mockedSubscribeToStockMovements = vi.mocked(subscribeToStockMovements);

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

describe("useRecipeCostRealtime", () => {
  it("subscribes on mount and invalidates recipes on new movements", async () => {
    const movementCallbacks: Array<() => void> = [];
    mockedSubscribeToStockMovements.mockImplementation((cb) => {
      movementCallbacks.push(cb);
      return vi.fn();
    });
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderHook(() => useRecipeCostRealtime(), { wrapper });
    expect(mockedSubscribeToStockMovements).toHaveBeenCalledWith(
      expect.any(Function),
    );
    movementCallbacks[0]?.();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: recipesQueryKey,
      }),
    );
    invalidateSpy.mockRestore();
  });

  it("unsubscribes on unmount and survives subscription failure", () => {
    const unsubscribe = vi.fn();
    mockedSubscribeToStockMovements.mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useRecipeCostRealtime(), {
      wrapper,
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    mockedSubscribeToStockMovements.mockImplementation(() => {
      throw new Error("no supabase config");
    });
    expect(() =>
      renderHook(() => useRecipeCostRealtime(), { wrapper }),
    ).not.toThrow();
  });

  it("does nothing without a restaurant profile", () => {
    authState.profile = null;
    renderHook(() => useRecipeCostRealtime(), { wrapper });
    expect(mockedSubscribeToStockMovements).not.toHaveBeenCalled();
  });
});
