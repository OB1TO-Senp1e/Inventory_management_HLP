import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { formatDate } from "@/lib/format";
import { PosImportDialog } from "./PosImportDialog";
import { useMenuItems } from "@/features/recipes/hooks";
import { useImportPosSales, usePreviewSalesDeductions } from "./hooks";
import { listImportedExternalIds } from "@/api/pos";
import { getPosProvider } from "@/lib/pos";

vi.mock("@/features/recipes/hooks", () => ({ useMenuItems: vi.fn() }));
vi.mock("./hooks", () => ({
  useImportPosSales: vi.fn(),
  usePreviewSalesDeductions: vi.fn(),
}));
vi.mock("@/api/pos", () => ({ listImportedExternalIds: vi.fn() }));
vi.mock("@/lib/pos", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/pos")>();
  return {
    ...original,
    getPosProvider: vi.fn(),
  };
});

const mockedUseMenuItems = vi.mocked(useMenuItems);
const mockedUseImportPosSales = vi.mocked(useImportPosSales);
const mockedUsePreviewSalesDeductions = vi.mocked(usePreviewSalesDeductions);
const mockedListImported = vi.mocked(listImportedExternalIds);
const mockedGetPosProvider = vi.mocked(getPosProvider);

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DISH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const MENU_ITEMS = [
  { id: DISH_A, name: "Butter Chicken" },
  { id: DISH_B, name: "Dal Makhani" },
];

const POS_LINES = [
  {
    externalSaleId: "pos-1",
    soldAt: "2026-10-04T13:00:00+05:30",
    dishName: "Butter Chicken",
    quantity: 4,
  },
  {
    externalSaleId: "pos-2",
    soldAt: "2026-10-04T14:00:00+05:30",
    dishName: "butter chkn",
    quantity: 2,
  },
  {
    externalSaleId: "pos-3",
    soldAt: "2026-10-04T15:00:00+05:30",
    dishName: "Paneer Lababdar",
    quantity: 1,
  },
];

const previewMutateAsync = vi.fn();
const importMutate = vi.fn();

function renderDialog() {
  return render(
    <ToastProvider>
      <PosImportDialog open onClose={vi.fn()} />
    </ToastProvider>,
  );
}

async function fetchPreview() {
  renderDialog();
  fireEvent.click(screen.getByTestId("pos-fetch-button"));
  await waitFor(() =>
    expect(screen.getByTestId("pos-row-pos-1")).toBeInTheDocument(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUseMenuItems.mockReturnValue({
    data: MENU_ITEMS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMenuItems>);
  mockedGetPosProvider.mockReturnValue({
    id: "stub",
    label: "Demo POS",
    description: "demo",
    fetchSales: vi.fn().mockResolvedValue(POS_LINES),
  });
  mockedListImported.mockResolvedValue(new Set(["pos-3"]));
  mockedUsePreviewSalesDeductions.mockReturnValue({
    mutateAsync: previewMutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof usePreviewSalesDeductions>);
  mockedUseImportPosSales.mockReturnValue({
    mutate: importMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useImportPosSales>);
  previewMutateAsync.mockResolvedValue([]);
});

describe("PosImportDialog", () => {
  it("previews fetched sales with auto-match, no-match and already-imported states", async () => {
    await fetchPreview();

    // pos-1: exact match → preselected + badge
    const selectA = screen.getByLabelText(
      "Menu item for Butter Chicken",
    ) as HTMLSelectElement;
    expect(selectA.value).toBe(DISH_A);
    expect(screen.getByText("Auto-matched")).toBeInTheDocument();

    // pos-2: weak match → no auto-select, "No match" badge
    expect(screen.getByText("No match — map or skip")).toBeInTheDocument();
    const selectB = screen.getByLabelText(
      "Menu item for butter chkn",
    ) as HTMLSelectElement;
    expect(selectB.value).toBe("");

    // pos-3: already imported → badge, no select
    expect(screen.getByText("Already imported")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Menu item for Paneer Lababdar"),
    ).not.toBeInTheDocument();

    // counts
    expect(screen.getByText("1 to import")).toBeInTheDocument();
    expect(screen.getByText("1 already imported")).toBeInTheDocument();
  });

  it("maps an unmatched dish manually and imports the selected lines", async () => {
    await fetchPreview();

    // Map pos-2 to Dal Makhani; skip pos-1.
    fireEvent.change(screen.getByLabelText("Menu item for butter chkn"), {
      target: { value: DISH_B },
    });
    fireEvent.change(screen.getByLabelText("Menu item for Butter Chicken"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("pos-import-button")).toHaveTextContent(
      "Import 1 sale",
    );

    fireEvent.click(screen.getByTestId("pos-import-button"));
    await waitFor(() => expect(previewMutateAsync).toHaveBeenCalled());
    // Aggregated per dish for the preview (P4-03 shape).
    expect(previewMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ menuItemId: DISH_B, dishes: 2 }],
      }),
    );
    await waitFor(() => expect(importMutate).toHaveBeenCalled());
    const input = importMutate.mock.calls[0][0];
    expect(input.provider).toBe("stub");
    expect(input.lines).toEqual([
      {
        externalSaleId: "pos-2",
        menuItemId: DISH_B,
        dishes: 2,
        soldAt: "2026-10-04T14:00:00+05:30",
      },
    ]);

    // Done phase shows the summary.
    const doneResult = {
      provider: "stub",
      saleDate: input.saleDate,
      imported: 1,
      sales: {
        saleDate: input.saleDate,
        lines: [{ menuItemId: DISH_B, name: "Dal Makhani", dishes: 2 }],
        ingredients: [],
      },
    };
    importMutate.mock.calls[0][1].onSuccess(doneResult);
    await waitFor(() =>
      expect(screen.getByText("Import complete")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        (_content, element) =>
          element?.textContent === `1 sale imported for ${formatDate(input.saleDate)}.`,
      ),
    ).toBeInTheDocument();
  });

  it("asks for explicit confirmation when the import would over-sell", async () => {
    previewMutateAsync.mockResolvedValue([
      {
        itemId: "item-1",
        itemName: "Tomatoes",
        unitSymbol: "kg",
        currentQuantity: 1,
        deductionQuantity: 3,
        projectedQuantity: -2,
        wouldGoNegative: true,
      },
    ]);
    await fetchPreview();

    fireEvent.click(screen.getByTestId("pos-import-button"));
    await waitFor(() =>
      expect(screen.getByText("Insufficient stock")).toBeInTheDocument(),
    );
    expect(screen.getByText("Tomatoes")).toBeInTheDocument();
    // Not posted yet.
    expect(importMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Import anyway"));
    await waitFor(() => expect(importMutate).toHaveBeenCalled());
  });

  it("disables import when nothing is importable and explains why", async () => {
    await fetchPreview();
    // Skip the only importable row.
    fireEvent.change(screen.getByLabelText("Menu item for Butter Chicken"), {
      target: { value: "" },
    });
    const button = screen.getByTestId("pos-import-button");
    expect(button).toBeDisabled();
    expect(
      screen.getByText("Map at least one sale to a menu item to import."),
    ).toBeInTheDocument();
  });

  it("shows an empty state when the provider returns no sales", async () => {
    mockedGetPosProvider.mockReturnValue({
      id: "stub",
      label: "Demo POS",
      description: "demo",
      fetchSales: vi.fn().mockResolvedValue([]),
    });
    renderDialog();
    fireEvent.click(screen.getByTestId("pos-fetch-button"));
    await waitFor(() =>
      expect(screen.getByText("No sales in this range.")).toBeInTheDocument(),
    );
  });

  it("validates the date range before fetching", async () => {
    renderDialog();
    const from = screen.getByLabelText("Sales from") as HTMLInputElement;
    const to = screen.getByLabelText("Sales to") as HTMLInputElement;
    fireEvent.change(from, { target: { value: "2026-10-10" } });
    fireEvent.change(to, { target: { value: "2026-10-05" } });
    fireEvent.click(screen.getByTestId("pos-fetch-button"));
    expect(
      await screen.findByText(
        "The start date must be on or before the end date.",
      ),
    ).toBeInTheDocument();
    expect(mockedGetPosProvider).not.toHaveBeenCalled();
  });
});
