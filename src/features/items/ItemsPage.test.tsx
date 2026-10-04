import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@/api/items";
import { ItemsPage } from "./ItemsPage";

// Hooks are mocked: these tests verify page states (loading / error /
// empty / populated / staff gating) with zero network.
vi.mock("./hooks", () => ({
  useItems: vi.fn(),
  useItem: vi.fn(),
  useItemLookups: vi.fn(),
  useCreateItem: vi.fn(),
  useUpdateItem: vi.fn(),
  useArchiveItem: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    } as { id: string; restaurantId: string; role: "owner" | "manager" | "staff" } | null,
  },
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ profile: authState.profile }),
}));

import { useItemLookups, useItems } from "./hooks";

const mockedUseItems = vi.mocked(useItems);
const mockedUseItemLookups = vi.mocked(useItemLookups);

const sampleItem: Item = {
  id: "item-1",
  name: "Tomato",
  categoryId: "c1",
  categoryName: "Vegetables",
  unitId: "u1",
  unitName: "kilogram",
  unitSymbol: "kg",
  storageLocationId: null,
  storageLocationName: null,
  parLevel: 10,
  reorderPoint: 4,
  active: true,
  createdAt: "",
  updatedAt: "",
};

const lookupsValue = {
  categories: [{ id: "c1", name: "Vegetables" }],
  locations: [],
  units: [{ id: "u1", name: "kilogram", symbol: "kg" }],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
  mockedUseItemLookups.mockReturnValue(lookupsValue);
});

describe("ItemsPage", () => {
  it("shows a loading skeleton while fetching", () => {
    mockedUseItems.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<ItemsPage />);
    expect(screen.getByLabelText("Loading items")).toBeInTheDocument();
  });

  it("shows an error state with a retry button", () => {
    const refetch = vi.fn();
    mockedUseItems.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never);
    render(<ItemsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load items.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state with the exact onboarding copy", () => {
    mockedUseItems.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<ItemsPage />);
    expect(
      screen.getByText("No items yet — add your first item."),
    ).toBeInTheDocument();
    // Header action + empty-state CTA both offer to add the first item.
    expect(
      screen.getAllByRole("button", { name: /add item/i }),
    ).toHaveLength(2);
  });

  it("renders rows with units next to quantities", () => {
    mockedUseItems.mockReturnValue({
      data: { items: [sampleItem], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<ItemsPage />);
    // Rendered twice: once in the desktop table, once in the mobile card
    // (CSS hides one per breakpoint; jsdom keeps both in the DOM).
    expect(screen.getAllByText("Tomato")).toHaveLength(2);
    // Unit symbol appears next to par/reorder levels (desktop + mobile markup).
    expect(screen.getAllByText("kg").length).toBeGreaterThan(0);
    expect(screen.getByText(/Showing 1–1 of 1 items/)).toBeInTheDocument();
  });

  it("hides management actions from staff", () => {
    authState.profile = {
      id: "user-3",
      restaurantId: "restaurant-1",
      role: "staff",
    };
    mockedUseItems.mockReturnValue({
      data: { items: [sampleItem], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<ItemsPage />);
    expect(
      screen.queryByRole("button", { name: /add item/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit tomato/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /archive tomato/i }),
    ).not.toBeInTheDocument();
    // …but the data itself still renders (desktop table + mobile card).
    expect(screen.getAllByText("Tomato")).toHaveLength(2);
  });

  it("shows management actions to managers", () => {
    authState.profile = {
      id: "user-2",
      restaurantId: "restaurant-1",
      role: "manager",
    };
    mockedUseItems.mockReturnValue({
      data: { items: [sampleItem], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<ItemsPage />);
    expect(
      screen.getByRole("button", { name: /add item/i }),
    ).toBeInTheDocument();
  });
});
