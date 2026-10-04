import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierPrice } from "@/api/prices";
import { SupplierPricesPage } from "./SupplierPricesPage";

// Hooks are mocked: these tests verify page states (loading / error /
// empty / populated / staff gating) with zero network.
vi.mock("./hooks", () => ({
  useSupplier: vi.fn(),
}));
vi.mock("./priceHooks", () => ({
  useSupplierPrices: vi.fn(),
  usePriceHistory: vi.fn(),
  useSetPreferredSupplier: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useUpsertPrice: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));
vi.mock("@/features/items/hooks", () => ({
  useItems: vi.fn(() => ({ data: undefined })),
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

vi.mock("react-router-dom", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useParams: () => ({ id: "sup-1" }) };
});

import { useSupplier } from "./hooks";
import { useSupplierPrices } from "./priceHooks";

const mockedUseSupplier = vi.mocked(useSupplier);
const mockedUseSupplierPrices = vi.mocked(useSupplierPrices);

const samplePrice: SupplierPrice = {
  id: "price-1",
  supplierId: "sup-1",
  itemId: "item-1",
  unitPrice: 45.5,
  currency: "INR",
  isPreferred: true,
  itemName: "Tomatoes",
  itemUnit: "kg",
  supplierName: "Fresh Farms",
  updatedAt: "2026-10-04T00:00:00Z",
};

function mockLoaded(prices: SupplierPrice[]) {
  mockedUseSupplier.mockReturnValue({
    data: { id: "sup-1", name: "Fresh Farms" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  mockedUseSupplierPrices.mockReturnValue({
    data: prices,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <SupplierPricesPage />
    </MemoryRouter>,
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

describe("SupplierPricesPage", () => {
  it("shows a loading skeleton while fetching", () => {
    mockedUseSupplier.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    mockedUseSupplierPrices.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(screen.getByLabelText("Loading price list")).toBeTruthy();
  });

  it("shows the error state with a retry button", () => {
    mockedUseSupplier.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    mockedUseSupplierPrices.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(
      screen.getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when the supplier has no prices", () => {
    mockLoaded([]);
    renderPage();
    expect(screen.getByText(/no prices yet/i)).toBeInTheDocument();
    // The header action and the empty state both offer "Add price".
    expect(
      screen.getAllByRole("button", { name: "Add price" }).length,
    ).toBeGreaterThan(0);
  });

  it("renders prices in ₹ with the preferred badge", () => {
    mockLoaded([samplePrice]);
    renderPage();
    // Both the table row and the mobile card render the name.
    expect(screen.getAllByText("Tomatoes").length).toBeGreaterThan(0);
    // en-IN currency formatting of 45.50
    expect(screen.getAllByText(/₹\s?45\.50/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Preferred").length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /show price history/i }).length,
    ).toBeGreaterThan(0);
  });

  it("links back to the suppliers list", () => {
    mockLoaded([]);
    renderPage();
    const back = screen.getByRole("link", { name: /back to suppliers/i });
    expect(back.getAttribute("href")).toBe("/suppliers");
  });

  it("hides management actions from staff", () => {
    authState.profile = {
      id: "user-3",
      restaurantId: "restaurant-1",
      role: "staff",
    };
    mockLoaded([samplePrice]);
    renderPage();
    expect(
      screen.queryByRole("button", { name: "Add price" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /set .* as preferred/i }),
    ).not.toBeInTheDocument();
  });
});
