import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { WastagePage } from "./WastagePage";
import { useLogUsage, useLogWastage, useReceivableItems } from "./hooks";
import { useCurrentStock } from "@/features/items/stockHooks";

// QueuedEntriesCard reads the signed-in profile (restaurant scoping);
// mock auth — these tests verify the page's wiring, not auth.
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "owner" },
  }),
}));

vi.mock("./hooks", () => ({
  useReceivableItems: vi.fn(),
  useLogUsage: vi.fn(),
  useLogWastage: vi.fn(),
}));

// The real useCurrentStock needs an auth session; mock it — these tests
// verify the page's wiring (toggle, validation, warning, reset).
vi.mock("@/features/items/stockHooks", () => ({
  useCurrentStock: vi.fn(),
  stockQueryKey: ["stock"],
}));

const mockedUseReceivableItems = vi.mocked(useReceivableItems);
const mockedUseLogUsage = vi.mocked(useLogUsage);
const mockedUseLogWastage = vi.mocked(useLogWastage);
const mockedUseCurrentStock = vi.mocked(useCurrentStock);

const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const items = [{ id: ITEM_ID, name: "Rice", unitSymbol: "kg" }];

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const mutateUsage = vi.fn();
const mutateWastage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseReceivableItems.mockReturnValue({
    items,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockedUseLogUsage.mockReturnValue({
    mutate: mutateUsage,
    isPending: false,
  } as unknown as ReturnType<typeof useLogUsage>);
  mockedUseLogWastage.mockReturnValue({
    mutate: mutateWastage,
    isPending: false,
  } as unknown as ReturnType<typeof useLogWastage>);
  mockedUseCurrentStock.mockReturnValue({
    data: { itemId: ITEM_ID, quantity: 15, lastMovementAt: null },
    isLoading: false,
  } as unknown as ReturnType<typeof useCurrentStock>);
});

describe("WastagePage", () => {
  it("renders the usage form by default", () => {
    render(<WastagePage />, { wrapper });
    expect(
      screen.getByRole("heading", { name: /usage & wastage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Usage" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /log usage/i }),
    ).toBeInTheDocument();
  });

  it("switches reason codes when toggling to wastage", () => {
    render(<WastagePage />, { wrapper });
    // Usage codes visible by default.
    expect(
      screen.getByRole("option", { name: "Kitchen use" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wastage" }));
    expect(
      screen.getByRole("button", { name: "Wastage" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("option", { name: "Expired" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Kitchen use" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /log wastage/i }),
    ).toBeInTheDocument();
  });

  it("shows inline validation errors on empty submit", async () => {
    render(<WastagePage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /log usage/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(mutateUsage).not.toHaveBeenCalled();
  });

  it("posts usage and resets the form on success", async () => {
    mutateUsage.mockImplementation((_input, options) => {
      options?.onSuccess?.({ movementId: "m1" }, _input, undefined);
    });
    render(<WastagePage />, { wrapper });

    fireEvent.change(screen.getByLabelText("Item"), {
      target: { value: ITEM_ID },
    });
    fireEvent.change(screen.getByLabelText(/quantity \(kg\)/i), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "kitchen_use" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log usage/i }));

    await waitFor(() => {
      expect(mutateUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "usage",
          itemId: ITEM_ID,
          quantity: 2,
          reason: "kitchen_use",
        }),
        expect.anything(),
      );
    });
    // Form resets for the next quick entry (kind preserved).
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Item") as HTMLSelectElement).value,
      ).toBe("");
    });
  });

  it("posts wastage with a wastage reason code", async () => {
    render(<WastagePage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Wastage" }));
    fireEvent.change(screen.getByLabelText("Item"), {
      target: { value: ITEM_ID },
    });
    fireEvent.change(screen.getByLabelText(/quantity \(kg\)/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "expired" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log wastage/i }));

    await waitFor(() => {
      expect(mutateWastage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "wastage",
          itemId: ITEM_ID,
          quantity: 1,
          reason: "expired",
        }),
        expect.anything(),
      );
    });
    expect(mutateUsage).not.toHaveBeenCalled();
  });

  it("shows current stock and warns when logging past zero", async () => {
    render(<WastagePage />, { wrapper });
    fireEvent.change(screen.getByLabelText("Item"), {
      target: { value: ITEM_ID },
    });
    expect(
      await screen.findByText(/current stock: 15 kg/i),
    ).toBeInTheDocument();

    // Within stock: no warning.
    fireEvent.change(screen.getByLabelText(/quantity \(kg\)/i), {
      target: { value: "5" },
    });
    expect(
      screen.queryByText(/take stock negative/i),
    ).not.toBeInTheDocument();

    // Beyond stock: loud warning, submit still allowed (warn + allow).
    fireEvent.change(screen.getByLabelText(/quantity \(kg\)/i), {
      target: { value: "20" },
    });
    expect(
      await screen.findByText(/take stock negative/i),
    ).toBeInTheDocument();
  });

  it("shows a loading state while items load", () => {
    mockedUseReceivableItems.mockReturnValue({
      items: [],
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    render(<WastagePage />, { wrapper });
    expect(screen.getByLabelText(/loading items/i)).toBeInTheDocument();
  });

  it("shows an error state with retry when items fail to load", () => {
    const refetch = vi.fn();
    mockedUseReceivableItems.mockReturnValue({
      items: [],
      isLoading: false,
      isError: true,
      refetch,
    });
    render(<WastagePage />, { wrapper });
    expect(screen.getByText(/couldn't load items/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
