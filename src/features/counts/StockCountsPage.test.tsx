import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StockCount } from "@/api/counts";
import { StockCountsPage } from "./StockCountsPage";

// Hooks are mocked: these tests verify page states (loading / error /
// empty / populated / staff gating / create dialog) with zero network.
vi.mock("./hooks", () => ({
  useStockCounts: vi.fn(),
  useAssignees: vi.fn(),
  useCreateStockCount: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(() => ({
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    } as {
      id: string;
      restaurantId: string;
      role: "owner" | "manager" | "staff";
    } | null,
  })),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import { useAssignees, useCreateStockCount, useStockCounts } from "./hooks";

const mockedUseStockCounts = vi.mocked(useStockCounts);
const mockedUseAssignees = vi.mocked(useAssignees);
const mockedUseCreateStockCount = vi.mocked(useCreateStockCount);

const sampleCount: StockCount = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  title: "Weekly full count",
  status: "in_progress",
  assignedTo: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T01:00:00Z",
  countedLines: 2,
  totalLines: 4,
};

const submittedCount: StockCount = {
  ...sampleCount,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  title: "October opening count",
  status: "submitted",
  assignedTo: null,
  countedLines: 4,
  totalLines: 4,
};

function loadingState() {
  return { data: undefined, isLoading: true, isError: false, isSuccess: false, refetch: vi.fn() };
}
function errorState() {
  return { data: undefined, isLoading: false, isError: true, isSuccess: false, refetch: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAuth.mockReturnValue({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "owner" },
  });
  mockedUseAssignees.mockReturnValue({
    data: [{ id: "cccccccc-cccc-cccc-cccc-cccccccccccc", role: "staff" }],
  } as never);
  mockedUseCreateStockCount.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
});

function renderPage() {
  render(
    <MemoryRouter>
      <StockCountsPage />
    </MemoryRouter>,
  );
}

describe("StockCountsPage", () => {
  it("shows a loading skeleton while fetching", () => {
    mockedUseStockCounts.mockReturnValue(loadingState() as never);
    renderPage();
    expect(
      screen.getByLabelText("Loading stock counts"),
    ).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    const refetch = vi.fn();
    mockedUseStockCounts.mockReturnValue({
      ...errorState(),
      refetch,
    } as never);
    renderPage();
    expect(
      screen.getByText(/couldn't load stock counts/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state for owners", () => {
    mockedUseStockCounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(screen.getByText("No stock counts yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/create the first count/i),
    ).toBeInTheDocument();
  });

  it("lists sessions with progress and status badges", () => {
    mockedUseStockCounts.mockReturnValue({
      data: [sampleCount, submittedCount],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(
      screen.getAllByText("Weekly full count").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("October opening count").length,
    ).toBeGreaterThan(0);
    // 2/4 = 50% on the draft session; the link cards + table both render
    // (desktop table hidden on mobile breakpoints is still in the DOM).
    expect(screen.getAllByText(/2\/4 \(50%\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
  });

  it("filters by status", () => {
    mockedUseStockCounts.mockReturnValue({
      data: [sampleCount, submittedCount],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    } as never);
    renderPage();
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "submitted" },
    });
    expect(screen.queryAllByText("Weekly full count")).toHaveLength(0);
    expect(
      screen.getAllByText("October opening count").length,
    ).toBeGreaterThan(0);
  });

  it("hides the create button from staff", () => {
    mockUseAuth.mockReturnValue({
      profile: { id: "staff-1", restaurantId: "restaurant-1", role: "staff" },
    });
    mockedUseStockCounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(
      screen.queryByRole("button", { name: /new count/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No stock counts yet.")).toBeInTheDocument();
  });

  it("creates a count from the dialog (title + assignee)", async () => {
    const mutate = vi.fn();
    mockedUseCreateStockCount.mockReturnValue({
      mutate,
      isPending: false,
    } as never);
    mockedUseStockCounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    } as never);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /new count/i }));
    expect(
      screen.getByRole("dialog", { name: "New stock count" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Weekly full count" },
    });
    fireEvent.change(screen.getByLabelText(/assign to/i), {
      target: { value: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create count" }));
    // RHF validation is async — wait for the mutation to be called.
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          title: "Weekly full count",
          assignedTo: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        },
        expect.anything(),
      );
    });
  });

  it("shows a validation error for a blank title", async () => {
    mockedUseStockCounts.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    } as never);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /new count/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create count" }));
    expect(
      await screen.findByText("Give the count a title."),
    ).toBeInTheDocument();
  });
});
