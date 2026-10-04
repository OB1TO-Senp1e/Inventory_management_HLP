import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Supplier } from "@/api/suppliers";
import { SuppliersPage } from "./SuppliersPage";

// Hooks are mocked: these tests verify page states (loading / error /
// empty / populated / staff gating) with zero network.
vi.mock("./hooks", () => ({
  useSuppliers: vi.fn(),
  useSupplier: vi.fn(),
  useCreateSupplier: vi.fn(),
  useUpdateSupplier: vi.fn(),
  useArchiveSupplier: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

import { useSuppliers } from "./hooks";

const mockedUseSuppliers = vi.mocked(useSuppliers);

const sampleSupplier: Supplier = {
  id: "sup-1",
  name: "Fresh Farms",
  contactPerson: "Ravi Kumar",
  phone: "+919876543210",
  email: "ravi@freshfarms.example",
  address: "12 Market Road",
  gstin: "27ABCDE1234F1Z5",
  notes: null,
  active: true,
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("SuppliersPage", () => {
  it("shows a loading skeleton while fetching", () => {
    mockedUseSuppliers.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>);
    expect(screen.getByLabelText("Loading suppliers")).toBeTruthy();
  });

  it("shows the error state with a retry button", () => {
    const refetch = vi.fn();
    mockedUseSuppliers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as never);
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not load suppliers/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state with a create affordance", () => {
    mockedUseSuppliers.mockReturnValue({
      data: { suppliers: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>);
    expect(
      screen.getByText(/no suppliers yet — add your first supplier/i),
    ).toBeTruthy();
    // The header action and the empty state both offer "Add supplier".
    expect(
      screen.getAllByRole("button", { name: "Add supplier" }).length,
    ).toBeGreaterThan(0);
  });

  it("renders supplier rows on desktop table and mobile cards", () => {
    mockedUseSuppliers.mockReturnValue({
      data: { suppliers: [sampleSupplier], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>);
    // Both the table row and the mobile card render the name.
    expect(screen.getAllByText("Fresh Farms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ravi Kumar").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/showing 1–1 of 1 suppliers/i),
    ).toBeTruthy();
  });

  it("hides management actions from staff", () => {
    authState.profile = {
      id: "user-3",
      restaurantId: "restaurant-1",
      role: "staff",
    };
    mockedUseSuppliers.mockReturnValue({
      data: { suppliers: [sampleSupplier], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>);
    expect(
      screen.queryByRole("button", { name: "Add supplier" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit Fresh Farms" }),
    ).toBeNull();
  });

  it("passes the active=true default filter to the query", () => {
    mockedUseSuppliers.mockReturnValue({
      data: { suppliers: [], total: 0 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>);
    const filters = mockedUseSuppliers.mock.calls[0]?.[0];
    expect(filters).toMatchObject({ active: true });
  });
});
