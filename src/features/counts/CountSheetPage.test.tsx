import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockCountDetail } from "@/api/counts";
import { CountSheetPage } from "./CountSheetPage";

// Hooks are mocked: these tests verify sheet states (loading / error /
// rows / debounced save / validation / submit / submitted read-only) with
// zero network.
vi.mock("./hooks", () => ({
  useStockCount: vi.fn(),
  useSaveCountLine: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useSubmitStockCount: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useUpdateStockCountStatus: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

import {
  useSaveCountLine,
  useStockCount,
  useSubmitStockCount,
  useUpdateStockCountStatus,
} from "./hooks";

const mockedUseStockCount = vi.mocked(useStockCount);
const mockedUseSaveCountLine = vi.mocked(useSaveCountLine);
const mockedUseSubmitStockCount = vi.mocked(useSubmitStockCount);
const mockedUseUpdateStockCountStatus = vi.mocked(useUpdateStockCountStatus);

const COUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ITEM_B = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function makeDetail(
  overrides: Partial<StockCountDetail> = {},
): StockCountDetail {
  return {
    id: COUNT_ID,
    title: "Weekly full count",
    status: "draft",
    assignedTo: null,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T01:00:00Z",
    countedLines: 0,
    totalLines: 2,
    lines: [
      {
        id: "d0000000-0000-0000-0000-000000000001",
        itemId: ITEM_A,
        itemName: "Tomatoes",
        unitSymbol: "kg",
        expectedQty: 7.5,
        countedQty: null,
      },
      {
        id: "d0000000-0000-0000-0000-000000000002",
        itemId: ITEM_B,
        itemName: "Milk",
        unitSymbol: "L",
        expectedQty: 2,
        countedQty: null,
      },
    ],
    ...overrides,
  };
}

function successState(detail: StockCountDetail) {
  return {
    data: detail,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockedUseSaveCountLine.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
  mockedUseSubmitStockCount.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
  mockedUseUpdateStockCountStatus.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/stock-counts/${COUNT_ID}`]}>
      <Routes>
        <Route path="/stock-counts/:id" element={<CountSheetPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CountSheetPage", () => {
  it("shows a loading skeleton while fetching", () => {
    mockedUseStockCount.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    } as never);
    renderPage();
    expect(
      screen.getByLabelText("Loading count sheet"),
    ).toBeInTheDocument();
  });

  it("shows an error state with retry and back link", () => {
    const refetch = vi.fn();
    mockedUseStockCount.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      refetch,
    } as never);
    renderPage();
    expect(screen.getByText(/couldn't load this count/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders each line with the expected quantity and an empty counted input", () => {
    mockedUseStockCount.mockReturnValue(
      successState(makeDetail()) as never,
    );
    renderPage();
    expect(screen.getByText("Tomatoes")).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("System: 7.5 kg")).toBeInTheDocument();
    expect(screen.getByText("System: 2 L")).toBeInTheDocument();
    const tomatoInput = screen.getByLabelText(
      "Counted quantity for Tomatoes",
    ) as HTMLInputElement;
    expect(tomatoInput.value).toBe("");
  });

  it("debounces saves: typing does not post immediately, then posts once", async () => {
    vi.useFakeTimers();
    const mutate = vi.fn();
    mockedUseSaveCountLine.mockReturnValue({
      mutate,
      isPending: false,
    } as never);
    mockedUseStockCount.mockReturnValue(
      successState(makeDetail()) as never,
    );
    renderPage();

    const tomatoInput = screen.getByLabelText("Counted quantity for Tomatoes");
    fireEvent.change(tomatoInput, { target: { value: "6.5" } });
    // Nothing posted while typing…
    expect(mutate).not.toHaveBeenCalled();
    // …then one save after the debounce window.
    await vi.advanceTimersByTimeAsync(700);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      {
        countId: COUNT_ID,
        itemId: ITEM_A,
        countedQty: 6.5,
        countIdForKey: COUNT_ID,
      },
      expect.anything(),
    );
  });

  it("rejects negative input locally without posting", async () => {
    vi.useFakeTimers();
    const mutate = vi.fn();
    mockedUseSaveCountLine.mockReturnValue({
      mutate,
      isPending: false,
    } as never);
    mockedUseStockCount.mockReturnValue(
      successState(makeDetail()) as never,
    );
    renderPage();

    fireEvent.change(
      screen.getByLabelText("Counted quantity for Tomatoes"),
      { target: { value: "-3" } },
    );
    await vi.advanceTimersByTimeAsync(700);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Enter 0 or more.")).toBeInTheDocument();
  });

  it("saves null (not counted) when a filled input is cleared", async () => {
    vi.useFakeTimers();
    const mutate = vi.fn();
    mockedUseSaveCountLine.mockReturnValue({
      mutate,
      isPending: false,
    } as never);
    const detail = makeDetail({
      countedLines: 1,
      lines: [
        {
          id: "d0000000-0000-0000-0000-000000000001",
          itemId: ITEM_A,
          itemName: "Tomatoes",
          unitSymbol: "kg",
          expectedQty: 7.5,
          countedQty: 6,
        },
        {
          id: "d0000000-0000-0000-0000-000000000002",
          itemId: ITEM_B,
          itemName: "Milk",
          unitSymbol: "L",
          expectedQty: 2,
          countedQty: null,
        },
      ],
    });
    mockedUseStockCount.mockReturnValue(successState(detail) as never);
    renderPage();

    const tomatoInput = screen.getByLabelText(
      "Counted quantity for Tomatoes",
    ) as HTMLInputElement;
    expect(tomatoInput.value).toBe("6");
    fireEvent.change(tomatoInput, { target: { value: "" } });
    await vi.advanceTimersByTimeAsync(700);
    expect(mutate).toHaveBeenCalledWith(
      {
        countId: COUNT_ID,
        itemId: ITEM_A,
        countedQty: null,
        countIdForKey: COUNT_ID,
      },
      expect.anything(),
    );
  });

  it("advances draft → in_progress on the first successful save", async () => {
    vi.useFakeTimers();
    let capturedOnSuccess: (() => void) | undefined;
    mockedUseSaveCountLine.mockReturnValue({
      mutate: vi.fn((_vars, opts) => {
        capturedOnSuccess = () => opts?.onSuccess?.({} as never, _vars, undefined);
      }),
      isPending: false,
    } as never);
    const advanceMutate = vi.fn();
    mockedUseUpdateStockCountStatus.mockReturnValue({
      mutate: advanceMutate,
      isPending: false,
    } as never);
    mockedUseStockCount.mockReturnValue(
      successState(makeDetail({ status: "draft" })) as never,
    );
    renderPage();

    fireEvent.change(
      screen.getByLabelText("Counted quantity for Tomatoes"),
      { target: { value: "6" } },
    );
    await vi.advanceTimersByTimeAsync(700);
    capturedOnSuccess?.();
    expect(advanceMutate).toHaveBeenCalledWith({
      countId: COUNT_ID,
      status: "in_progress",
    });
  });

  it("only shows Submit for review when every line is counted, and confirms", async () => {
    const submitMutate = vi.fn();
    mockedUseSubmitStockCount.mockReturnValue({
      mutate: submitMutate,
      isPending: false,
    } as never);

    // Partially counted: no submit button.
    mockedUseStockCount.mockReturnValue(
      successState(
        makeDetail({
          countedLines: 1,
          totalLines: 2,
          status: "in_progress",
          lines: [
            {
              id: "d0000000-0000-0000-0000-000000000001",
              itemId: ITEM_A,
              itemName: "Tomatoes",
              unitSymbol: "kg",
              expectedQty: 7.5,
              countedQty: 6,
            },
            {
              id: "d0000000-0000-0000-0000-000000000002",
              itemId: ITEM_B,
              itemName: "Milk",
              unitSymbol: "L",
              expectedQty: 2,
              countedQty: null,
            },
          ],
        }),
      ) as never,
    );
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/stock-counts/${COUNT_ID}`]}>
        <Routes>
          <Route path="/stock-counts/:id" element={<CountSheetPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: /submit for review/i }),
    ).not.toBeInTheDocument();
    unmount();

    // Fully counted: submit button → confirm dialog → mutation.
    mockedUseStockCount.mockReturnValue(
      successState(
        makeDetail({
          countedLines: 2,
          totalLines: 2,
          status: "in_progress",
          lines: [
            {
              id: "d0000000-0000-0000-0000-000000000001",
              itemId: ITEM_A,
              itemName: "Tomatoes",
              unitSymbol: "kg",
              expectedQty: 7.5,
              countedQty: 6,
            },
            {
              id: "d0000000-0000-0000-0000-000000000002",
              itemId: ITEM_B,
              itemName: "Milk",
              unitSymbol: "L",
              expectedQty: 2,
              countedQty: 1.5,
            },
          ],
        }),
      ) as never,
    );
    render(
      <MemoryRouter initialEntries={[`/stock-counts/${COUNT_ID}`]}>
        <Routes>
          <Route path="/stock-counts/:id" element={<CountSheetPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /submit for review/i }),
    );
    expect(
      await screen.findByRole("alertdialog", { name: "Submit for review?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit count" }));
    expect(submitMutate).toHaveBeenCalledWith(COUNT_ID);
  });

  it("renders submitted counts read-only", () => {
    mockedUseStockCount.mockReturnValue(
      successState(
        makeDetail({
          status: "submitted",
          countedLines: 2,
          totalLines: 2,
          lines: [
            {
              id: "d0000000-0000-0000-0000-000000000001",
              itemId: ITEM_A,
              itemName: "Tomatoes",
              unitSymbol: "kg",
              expectedQty: 7.5,
              countedQty: 6,
            },
            {
              id: "d0000000-0000-0000-0000-000000000002",
              itemId: ITEM_B,
              itemName: "Milk",
              unitSymbol: "L",
              expectedQty: 2,
              countedQty: 1.5,
            },
          ],
        }),
      ) as never,
    );
    renderPage();
    expect(
      screen.getByText(/submitted for review and is read-only/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Counted quantity for Tomatoes"),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /submit for review/i }),
    ).not.toBeInTheDocument();
  });

  it("filters lines by search", async () => {
    mockedUseStockCount.mockReturnValue(
      successState(makeDetail()) as never,
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("Search items in this count"), {
      target: { value: "milk" },
    });
    await waitFor(() => {
      expect(screen.queryByText("Tomatoes")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Milk")).toBeInTheDocument();
  });
});
