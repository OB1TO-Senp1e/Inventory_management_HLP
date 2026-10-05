import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { SalesEntryPage } from "./SalesEntryPage";
import { usePreviewSalesDeductions, useRecordSales } from "./hooks";
import { useMenuItems } from "@/features/recipes/hooks";

vi.mock("./hooks", () => ({
  useRecordSales: vi.fn(),
  usePreviewSalesDeductions: vi.fn(),
  useImportPosSales: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// The real useMenuItems needs an auth session + backend; mock it — these
// tests verify the page's wiring (rows, validation, aggregation, reset,
// over-sale confirm flow).
vi.mock("@/features/recipes/hooks", () => ({
  useMenuItems: vi.fn(),
}));

const mockedUseMenuItems = vi.mocked(useMenuItems);
const mockedUseRecordSales = vi.mocked(useRecordSales);
const mockedUsePreviewSalesDeductions = vi.mocked(usePreviewSalesDeductions);

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DISH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const menuItems = [
  {
    id: DISH_A,
    name: "Butter Chicken",
    yieldQuantity: 4,
    yieldUnit: "servings",
    sellingPrice: 199,
  },
  {
    id: DISH_B,
    name: "Naan",
    yieldQuantity: 2,
    yieldUnit: "servings",
    sellingPrice: null,
  },
];

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

const mutate = vi.fn();
const previewMutateAsync = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseMenuItems.mockReturnValue({
    data: menuItems,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMenuItems>);
  mockedUseRecordSales.mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useRecordSales>);
  // Default: nothing would go negative — the entry posts without a dialog.
  previewMutateAsync.mockResolvedValue([]);
  mockedUsePreviewSalesDeductions.mockReturnValue({
    mutateAsync: previewMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof usePreviewSalesDeductions>);
});

describe("SalesEntryPage", () => {
  it("renders the sales form with today's date by default", () => {
    render(<SalesEntryPage />, { wrapper });
    expect(
      screen.getByRole("heading", { name: /sales entry/i }),
    ).toBeInTheDocument();
    const dateInput = screen.getByLabelText(/sale date/i) as HTMLInputElement;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(dateInput.value).toBe(today);
    expect(
      screen.getByRole("button", { name: /add dish/i }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when there are no active dishes", () => {
    mockedUseMenuItems.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useMenuItems>);
    render(<SalesEntryPage />, { wrapper });
    expect(screen.getByText(/no active dishes yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /record sales/i }),
    ).not.toBeInTheDocument();
  });

  it("submits the entry with aggregated lines and resets the form", async () => {
    render(<SalesEntryPage />, { wrapper });

    // First row: Butter Chicken x4.
    fireEvent.change(screen.getByLabelText(/dish 1/i), {
      target: { value: DISH_A },
    });
    fireEvent.change(screen.getByLabelText(/dishes sold \(butter chicken\)/i), {
      target: { value: "4" },
    });

    // Second row: Butter Chicken again (aggregated on submit).
    fireEvent.click(screen.getByRole("button", { name: /add dish/i }));
    const dishSelects = screen.getAllByLabelText(/dish \d/i);
    fireEvent.change(dishSelects[1], { target: { value: DISH_A } });
    fireEvent.change(
      screen.getAllByLabelText(/dishes sold \(butter chicken\)/i)[1],
      { target: { value: "2" } },
    );

    fireEvent.click(screen.getByRole("button", { name: /record sales/i }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          saleDate: expect.any(String),
          lines: [{ menuItemId: DISH_A, dishes: 6 }],
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    // The revenue estimate reflects the priced dish (199 x 6 = 1194).
    expect(screen.getByText(/revenue estimate/i)).toBeInTheDocument();

    // onSuccess resets the form to one empty row.
    const onSuccess = mutate.mock.calls[0][1].onSuccess;
    onSuccess();
    await waitFor(() => {
      expect(screen.getAllByLabelText(/dish \d/i)).toHaveLength(1);
    });
  });

  it("shows a validation error for an empty dish count", async () => {
    render(<SalesEntryPage />, { wrapper });
    fireEvent.change(screen.getByLabelText(/dish 1/i), {
      target: { value: DISH_A },
    });
    // No quantity entered.
    fireEvent.click(screen.getByRole("button", { name: /record sales/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/dishes sold must be greater than zero/i),
      ).toBeInTheDocument();
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows the revenue estimate and flags unpriced dishes", async () => {
    render(<SalesEntryPage />, { wrapper });
    fireEvent.change(screen.getByLabelText(/dish 1/i), {
      target: { value: DISH_B },
    });
    fireEvent.change(screen.getByLabelText(/dishes sold \(naan\)/i), {
      target: { value: "3" },
    });
    await waitFor(() => {
      expect(screen.getByText(/revenue estimate/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/no selling price set/i)).toBeInTheDocument();
  });

  it("retries loading dishes after an error", () => {
    const refetch = vi.fn();
    mockedUseMenuItems.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useMenuItems>);
    render(<SalesEntryPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("over-sale confirmation", () => {
  const flaggedPreview = [
    {
      itemId: "item-1",
      itemName: "Tomatoes",
      unitSymbol: "kg",
      currentQuantity: 2,
      deductionQuantity: 4,
      projectedQuantity: -2,
      wouldGoNegative: true,
    },
  ];

  function fillOneRow() {
    fireEvent.change(screen.getByLabelText(/dish 1/i), {
      target: { value: DISH_A },
    });
    fireEvent.change(screen.getByLabelText(/dishes sold \(butter chicken\)/i), {
      target: { value: "8" },
    });
  }

  it("asks for explicit confirmation listing the flagged items", async () => {
    previewMutateAsync.mockResolvedValue(flaggedPreview);
    render(<SalesEntryPage />, { wrapper });
    fillOneRow();
    fireEvent.click(screen.getByRole("button", { name: /record sales/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/insufficient stock/i);
    expect(dialog).toHaveTextContent(/tomatoes/i);
    expect(dialog).toHaveTextContent(/-2/);
    // The entry is NOT posted before explicit confirmation.
    expect(mutate).not.toHaveBeenCalled();
  });

  it("posts the entry when the over-sale is explicitly confirmed", async () => {
    previewMutateAsync.mockResolvedValue(flaggedPreview);
    render(<SalesEntryPage />, { wrapper });
    fillOneRow();
    fireEvent.click(screen.getByRole("button", { name: /record sales/i }));
    const confirmButton = await screen.findByRole("button", {
      name: /record sale anyway/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        {
          saleDate: expect.any(String),
          lines: [{ menuItemId: DISH_A, dishes: 8 }],
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });

  it("aborts the entry when the dialog is cancelled", async () => {
    previewMutateAsync.mockResolvedValue(flaggedPreview);
    render(<SalesEntryPage />, { wrapper });
    fillOneRow();
    fireEvent.click(screen.getByRole("button", { name: /record sales/i }));
    const cancelButton = await screen.findByRole("button", {
      name: /^cancel$/i,
    });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not post when the preview fails", async () => {
    previewMutateAsync.mockRejectedValue(new Error("preview failed"));
    render(<SalesEntryPage />, { wrapper });
    fillOneRow();
    fireEvent.click(screen.getByRole("button", { name: /record sales/i }));

    await waitFor(() => {
      expect(previewMutateAsync).toHaveBeenCalled();
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
