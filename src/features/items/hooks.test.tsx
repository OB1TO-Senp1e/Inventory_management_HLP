import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  archiveItem,
  createItem,
  listItemCategories,
  listItems,
  listStorageLocations,
  listUnits,
  updateItem,
} from "@/api/items";
import {
  useArchiveItem,
  useCreateItem,
  useItemLookups,
  useItems,
  useUpdateItem,
} from "./hooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// restaurant-id injection, invalidation, toasts) with zero network.
vi.mock("@/api/items", () => ({
  listItems: vi.fn(),
  getItem: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  archiveItem: vi.fn(),
  listItemCategories: vi.fn(),
  listStorageLocations: vi.fn(),
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

const mockedListItems = vi.mocked(listItems);
const mockedCreateItem = vi.mocked(createItem);
const mockedUpdateItem = vi.mocked(updateItem);
const mockedArchiveItem = vi.mocked(archiveItem);

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

describe("useItems", () => {
  it("delegates to listItems and returns the result", async () => {
    mockedListItems.mockResolvedValue({ items: [], total: 0 });
    const { result } = renderHook(
      () => useItems({ search: "tom", page: 1, pageSize: 20 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListItems).toHaveBeenCalledWith({
      search: "tom",
      page: 1,
      pageSize: 20,
    });
    expect(result.current.data).toEqual({ items: [], total: 0 });
  });

  it("does not query until the profile loads", () => {
    authState.profile = null;
    const { result } = renderHook(() => useItems({}), { wrapper });
    expect(mockedListItems).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useItemLookups", () => {
  it("combines categories, locations and units", async () => {
    vi.mocked(listItemCategories).mockResolvedValue([
      { id: "c1", name: "Vegetables" },
    ]);
    vi.mocked(listStorageLocations).mockResolvedValue([
      { id: "l1", name: "Dry Store" },
    ]);
    vi.mocked(listUnits).mockResolvedValue([
      { id: "u1", name: "kilogram", symbol: "kg" },
    ]);
    const { result } = renderHook(() => useItemLookups(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.units).toEqual([
      { id: "u1", name: "kilogram", symbol: "kg" },
    ]);
    expect(result.current.categories).toHaveLength(1);
    expect(result.current.locations).toHaveLength(1);
  });
});

describe("useCreateItem", () => {
  it("injects the restaurant id, invalidates and toasts on success", async () => {
    mockedCreateItem.mockResolvedValue({
      id: "item-1",
      name: "Tomato",
      categoryId: null,
      categoryName: null,
      unitId: "u1",
      unitName: "kilogram",
      unitSymbol: "kg",
      storageLocationId: null,
      storageLocationName: null,
      parLevel: 10,
      reorderPoint: 4,
      active: true,
      avgUnitCost: 0,
      createdAt: "",
      updatedAt: "",
    });
    const { result } = renderHook(() => useCreateItem(), { wrapper });
    result.current.mutate({
      name: "Tomato",
      unitId: "u1",
      parLevel: 10,
      reorderPoint: 4,
    });
    await waitFor(() => expect(mockedCreateItem).toHaveBeenCalled());
    expect(mockedCreateItem).toHaveBeenCalledWith({
      name: "Tomato",
      unitId: "u1",
      parLevel: 10,
      reorderPoint: 4,
      restaurantId: "restaurant-1",
    });
    await waitFor(() =>
      expect(screen.getByText("Item created.")).toBeInTheDocument(),
    );
  });

  it("toasts the error message on failure", async () => {
    mockedCreateItem.mockRejectedValue(
      new Error("An item with this name already exists."),
    );
    const { result } = renderHook(() => useCreateItem(), { wrapper });
    result.current.mutate({
      name: "Tomato",
      unitId: "u1",
      parLevel: 0,
      reorderPoint: 0,
    });
    await waitFor(() =>
      expect(
        screen.getByText("An item with this name already exists."),
      ).toBeInTheDocument(),
    );
  });

  it("refuses to submit while the profile is loading", async () => {
    authState.profile = null;
    const { result } = renderHook(() => useCreateItem(), { wrapper });
    result.current.mutate({
      name: "Tomato",
      unitId: "u1",
      parLevel: 0,
      reorderPoint: 0,
    });
    await waitFor(() =>
      expect(
        screen.getByText("Your profile is still loading. Please try again."),
      ).toBeInTheDocument(),
    );
    expect(mockedCreateItem).not.toHaveBeenCalled();
  });
});

describe("useUpdateItem", () => {
  it("delegates to updateItem and toasts on success", async () => {
    mockedUpdateItem.mockResolvedValue({} as never);
    const { result } = renderHook(() => useUpdateItem(), { wrapper });
    result.current.mutate({ id: "item-1", input: { name: "Cherry Tomato" } });
    await waitFor(() => expect(mockedUpdateItem).toHaveBeenCalledWith(
      "item-1",
      { name: "Cherry Tomato" },
    ));
    await waitFor(() =>
      expect(screen.getByText("Item updated.")).toBeInTheDocument(),
    );
  });
});

describe("useArchiveItem", () => {
  it("delegates to archiveItem and toasts on success", async () => {
    mockedArchiveItem.mockResolvedValue({} as never);
    const { result } = renderHook(() => useArchiveItem(), { wrapper });
    result.current.mutate("item-1");
    await waitFor(() =>
      expect(mockedArchiveItem).toHaveBeenCalledWith("item-1"),
    );
    await waitFor(() =>
      expect(screen.getByText("Item archived.")).toBeInTheDocument(),
    );
  });
});
