import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceScanPage } from "./InvoiceScanPage";
import { recognizeInvoiceImage } from "./ocr";
import { useReceivableItems, useReceiveGoods } from "@/features/stock/hooks";
import { useSuppliers } from "@/features/suppliers/hooks";

vi.mock("./ocr", () => ({
  recognizeInvoiceImage: vi.fn(),
  ocrStatusCopy: (status: string) => status,
}));

vi.mock("@/features/stock/hooks", () => ({
  useReceivableItems: vi.fn(),
  useReceiveGoods: vi.fn(),
}));

vi.mock("@/features/suppliers/hooks", () => ({
  useSuppliers: vi.fn(),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ profile: { role: "owner" } }),
}));

const mockedRecognize = vi.mocked(recognizeInvoiceImage);
const mockedUseReceivableItems = vi.mocked(useReceivableItems);
const mockedUseReceiveGoods = vi.mocked(useReceiveGoods);
const mockedUseSuppliers = vi.mocked(useSuppliers);

const TOMATO_ID = "11111111-1111-1111-1111-111111111111";
const MILK_ID = "22222222-2222-2222-2222-222222222222";
const SUPPLIER_ID = "33333333-3333-3333-3333-333333333333";

const ITEMS = [
  { id: TOMATO_ID, name: "Tomato", unitSymbol: "kg" },
  { id: MILK_ID, name: "Milk", unitSymbol: "L" },
];

const mutate = vi.fn();

function renderPage(search = "") {
  window.history.pushState({}, "", `/receiving/invoice${search}`);
  return render(
    <MemoryRouter initialEntries={[`/receiving/invoice${search}`]}>
      <InvoiceScanPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/receiving/invoice");
  window.URL.createObjectURL = vi.fn(() => "blob:mock-photo");
  window.URL.revokeObjectURL = vi.fn();
  mockedUseReceivableItems.mockReturnValue({
    items: ITEMS,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mockedUseReceiveGoods.mockReturnValue({ mutate, isPending: false } as never);
  mockedUseSuppliers.mockReturnValue({
    data: {
      suppliers: [{ id: SUPPLIER_ID, name: "Fresh Farms" }],
      total: 1,
    },
    isLoading: false,
  } as never);
});

describe("InvoiceScanPage", () => {
  it("renders the capture step with a photo picker", () => {
    renderPage();
    expect(
      screen.getByText("Photograph the supplier bill"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bill photo")).toBeInTheDocument();
    // No test seam without the query param.
    expect(
      screen.queryByRole("button", { name: "Simulate scan" }),
    ).not.toBeInTheDocument();
  });

  it("simulate seam builds a reviewable draft with auto-matches", () => {
    renderPage("?simulateOcr=1");
    fireEvent.click(screen.getByRole("button", { name: "Simulate scan" }));

    expect(
      screen.getByText("Review the draft — 5 lines from the bill"),
    ).toBeInTheDocument();
    // Tomato + Milk auto-matched; the rest need an item pick.
    expect(screen.getAllByText("Auto-matched")).toHaveLength(2);
    expect(screen.getAllByText("Pick an item")).toHaveLength(3);

    const itemSelects = screen.getAllByLabelText("Item") as HTMLSelectElement[];
    // Line order: Fresh Farms Produce, Tomato, Milk, Paneer, Coriander.
    expect(itemSelects[1].value).toBe(TOMATO_ID);
    expect(itemSelects[2].value).toBe(MILK_ID);
    expect(itemSelects[3].value).toBe("");

    // Parsed quantities/costs prefill the inputs.
    const qtyInputs = screen.getAllByLabelText(/Quantity/) as HTMLInputElement[];
    expect(qtyInputs[1].value).toBe("10");
    const costInputs = screen.getAllByLabelText(
      "Unit cost (₹)",
    ) as HTMLInputElement[];
    expect(costInputs[1].value).toBe("40");

    // Raw OCR text is visible for transparency.
    expect(screen.getByText(/What the scanner saw/)).toBeInTheDocument();
  });

  it("blocks posting until every line is complete", () => {
    renderPage("?simulateOcr=1");
    fireEvent.click(screen.getByRole("button", { name: "Simulate scan" }));
    fireEvent.click(screen.getByRole("button", { name: /Post receipt/ }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getAllByText("Pick an item for this line.")).toHaveLength(3);
    // Fresh Farms Produce and Coriander have no parsed quantity; Paneer does.
    expect(screen.getAllByText("Enter the quantity.")).toHaveLength(2);
  });

  it("posts the confirmed draft through receive_goods with the supplier in notes", () => {
    renderPage("?simulateOcr=1");
    fireEvent.click(screen.getByRole("button", { name: "Simulate scan" }));

    // Complete every line: first item for unmatched, qty 5 / cost 10 where blank.
    const itemSelects = screen.getAllByLabelText("Item") as HTMLSelectElement[];
    itemSelects.forEach((select) => {
      if (!select.value) {
        fireEvent.change(select, { target: { value: TOMATO_ID } });
      }
    });
    (screen.getAllByLabelText(/Quantity/) as HTMLInputElement[]).forEach(
      (input) => {
        if (!input.value) {
          fireEvent.change(input, { target: { value: "5" } });
        }
      },
    );
    (screen.getAllByLabelText("Unit cost (₹)") as HTMLInputElement[]).forEach(
      (input) => {
        if (!input.value) {
          fireEvent.change(input, { target: { value: "10" } });
        }
      },
    );
    fireEvent.change(screen.getByLabelText(/Bill supplier/), {
      target: { value: SUPPLIER_ID },
    });

    fireEvent.click(screen.getByRole("button", { name: /Post receipt/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [input] = mockedUseReceiveGoods.mock.results[0]
      ? [mutate.mock.calls[0][0]]
      : [];
    expect(input.lines).toHaveLength(5);
    // Tomato line keeps its parsed qty/cost.
    expect(input.lines[1]).toMatchObject({
      itemId: TOMATO_ID,
      quantity: 10,
      unitCost: 40,
      notes: "Supplier: Fresh Farms",
    });
    // Paneer line was completed manually.
    expect(input.lines[3]).toMatchObject({
      itemId: TOMATO_ID,
      quantity: 2,
      unitCost: 320,
      notes: "Supplier: Fresh Farms",
    });
  });

  it("removes draft lines", () => {
    renderPage("?simulateOcr=1");
    fireEvent.click(screen.getByRole("button", { name: "Simulate scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove draft line 1" }));
    expect(
      screen.getByText("Review the draft — 4 lines from the bill"),
    ).toBeInTheDocument();
  });

  it("shows a retryable error when items fail to load during review", () => {
    mockedUseReceivableItems.mockReturnValue({
      items: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderPage("?simulateOcr=1");
    fireEvent.click(screen.getByRole("button", { name: "Simulate scan" }));
    expect(screen.getByText("Couldn't load items.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockedUseReceivableItems().refetch).toHaveBeenCalled();
  });

  it("shows a friendly error when OCR fails", async () => {
    mockedRecognize.mockRejectedValueOnce(
      new Error("Couldn't read the bill photo."),
    );
    renderPage();
    const file = new File(["fake-image"], "bill.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Bill photo"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scan bill" }));

    await waitFor(() => {
      expect(screen.getByText("Couldn't scan that photo.")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Photograph the supplier bill"),
    ).toBeInTheDocument();
  });

  it("runs OCR on a chosen photo and discards it afterwards", async () => {
    mockedRecognize.mockResolvedValueOnce("Tomato 10 kg 400.00");
    renderPage();
    const file = new File(["fake-image"], "bill.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Bill photo"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Scan bill" }));

    await waitFor(() => {
      expect(
        screen.getByText("Review the draft — 1 line from the bill"),
      ).toBeInTheDocument();
    });
    expect(mockedRecognize).toHaveBeenCalledWith(
      "blob:mock-photo",
      expect.any(Function),
    );
    // Session-only: the object URL is revoked once the photo has been read.
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-photo");
  });
});
