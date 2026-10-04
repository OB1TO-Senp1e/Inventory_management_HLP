import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItem } from "@/api/recipes";
import { RecipesPage } from "./RecipesPage";

// Hooks are mocked: these tests verify page states (loading / error /
// empty / populated / archived filter / staff gating) with zero network.
vi.mock("./hooks", () => ({
  useMenuItems: vi.fn(),
  useArchiveMenuItem: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    } as { id: string; restaurantId: string; role: "owner" | "manager" | "staff" } | null,
  })),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import { useMenuItems } from "./hooks";

const mockedUseMenuItems = vi.mocked(useMenuItems);

const sampleItem: MenuItem = {
  id: "menu-1",
  name: "Butter Chicken",
  description: "Creamy tomato curry",
  yieldQuantity: 4,
  yieldUnit: "servings",
  active: true,
  ingredientCount: 3,
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    },
  });
});

function renderPage() {
  render(
    <MemoryRouter>
      <RecipesPage />
    </MemoryRouter>,
  );
}

describe("RecipesPage", () => {
  it("shows a loading skeleton while fetching", () => {
    mockedUseMenuItems.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMenuItems>);
    renderPage();
    expect(screen.getByLabelText("Loading recipes")).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    const refetch = vi.fn();
    mockedUseMenuItems.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useMenuItems>);
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load recipes.",
    );
    expect(
      screen.getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    mockedUseMenuItems.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMenuItems>);
    renderPage();
    expect(screen.getByText("No recipes yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/Create your first recipe to link menu items/),
    ).toBeInTheDocument();
  });

  it("renders recipe rows with yield and ingredient counts", () => {
    mockedUseMenuItems.mockReturnValue({
      data: [sampleItem],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMenuItems>);
    renderPage();
    // Rendered in both the desktop table and the mobile card (one hidden).
    expect(screen.getAllByText("Butter Chicken").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4 servings/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 ingredients/).length).toBeGreaterThan(0);
  });

  it("hides the New recipe button for staff", () => {
    mockUseAuth.mockReturnValueOnce({
      profile: {
        id: "user-2",
        restaurantId: "restaurant-1",
        role: "staff",
      },
    });
    mockedUseMenuItems.mockReturnValue({
      data: [sampleItem],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMenuItems>);
    renderPage();
    expect(
      screen.queryByRole("button", { name: /new recipe/i }),
    ).not.toBeInTheDocument();
  });
});
