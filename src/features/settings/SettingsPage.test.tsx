import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

// Hooks are mocked: these tests verify page states (tabs, loading, error,
// empty, populated) with zero network.
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "u1",
      restaurantId: "r1",
      role: "owner",
      currentOutletId: "o1",
    },
    status: "signed-in",
    session: null,
    error: null,
    signOut: async () => {},
    refreshProfile: async () => {},
  }),
}));

vi.mock("./hooks", () => ({
  useCategories: vi.fn(),
  useLocations: vi.fn(),
  useCategoryUsage: vi.fn(),
  useLocationUsage: vi.fn(),
  useTaxonomyUsage: vi.fn(),
  useCreateCategory: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateCategory: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useArchiveCategory: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteCategory: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateLocation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateLocation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useArchiveLocation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteLocation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import { useCategories, useLocations } from "./hooks";

const mockedUseCategories = vi.mocked(useCategories);
const mockedUseLocations = vi.mocked(useLocations);

const sampleCategory = {
  id: "c1",
  name: "Vegetables",
  active: true,
  createdAt: "",
  updatedAt: "",
};

const sampleLocation = {
  id: "l1",
  name: "Dry Store",
  active: true,
  createdAt: "",
  updatedAt: "",
};

function mockList(value: Partial<ReturnType<typeof useCategories>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useCategories>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseCategories.mockReturnValue(mockList({ data: [sampleCategory] }));
  mockedUseLocations.mockReturnValue(mockList({ data: [sampleLocation] }));
});

describe("SettingsPage", () => {
  it("renders the settings header and defaults to the categories tab", () => {
    render(<SettingsPage />);
    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Categories" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Vegetables")).toBeInTheDocument();
    expect(screen.queryByText("Dry Store")).not.toBeInTheDocument();
  });

  it("switches to the storage locations tab", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Storage locations" }));
    expect(
      screen.getByRole("tab", { name: "Storage locations" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Dry Store")).toBeInTheDocument();
    expect(screen.queryByText("Vegetables")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton", () => {
    mockedUseCategories.mockReturnValue(mockList({ isLoading: true }));
    render(<SettingsPage />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("shows the error state with a retry button", () => {
    const refetch = vi.fn();
    mockedUseCategories.mockReturnValue(
      mockList({ isError: true, refetch }),
    );
    render(<SettingsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    mockedUseLocations.mockReturnValue(mockList({ data: [] }));
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Storage locations" }));
    expect(screen.getByText(/no storage locations yet/i)).toBeInTheDocument();
  });

  it("opens the create dialog", () => {
    render(<SettingsPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Add category" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add category" }),
    ).toBeInTheDocument();
  });
});
