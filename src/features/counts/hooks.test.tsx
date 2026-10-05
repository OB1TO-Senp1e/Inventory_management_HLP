import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  createStockCount,
  getStockCount,
  listStockCounts,
  saveCountLine,
  submitStockCount,
  updateStockCountStatus,
} from "@/api/counts";
import {
  countDetailKey,
  countsQueryKey,
  useAssignees,
  useCreateStockCount,
  useSaveCountLine,
  useStockCount,
  useStockCounts,
  useSubmitStockCount,
  useUpdateStockCountStatus,
} from "./hooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// invalidation, toasts) with zero network.
vi.mock("@/api/counts", () => ({
  createStockCount: vi.fn(),
  getStockCount: vi.fn(),
  listStockCounts: vi.fn(),
  saveCountLine: vi.fn(),
  submitStockCount: vi.fn(),
  updateStockCountStatus: vi.fn(),
}));

vi.mock("@/api/auth", () => ({
  listProfiles: vi.fn(),
}));

const mockedListStockCounts = vi.mocked(listStockCounts);
const mockedGetStockCount = vi.mocked(getStockCount);
const mockedCreateStockCount = vi.mocked(createStockCount);
const mockedSaveCountLine = vi.mocked(saveCountLine);
const mockedSubmitStockCount = vi.mocked(submitStockCount);
const mockedUpdateStockCountStatus = vi.mocked(updateStockCountStatus);

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const COUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const stockCount = {
  id: COUNT_ID,
  title: "Weekly full count",
  status: "draft" as const,
  assignedTo: null,
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
  countedLines: 0,
  totalLines: 2,
};

const stockCountDetail = {
  ...stockCount,
  lines: [
    {
      id: "d0000000-0000-0000-0000-000000000001",
      itemId: ITEM_ID,
      itemName: "Tomatoes",
      unitSymbol: "kg",
      expectedQty: 7.5,
      countedQty: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("countsQueryKey / countDetailKey", () => {
  it("are stable keys", () => {
    expect(countsQueryKey).toEqual(["stock-counts"]);
    expect(countDetailKey(COUNT_ID)).toEqual(["stock-counts", COUNT_ID]);
  });
});

describe("useStockCounts", () => {
  it("delegates to listStockCounts", async () => {
    mockedListStockCounts.mockResolvedValue([stockCount]);
    const { result } = renderHook(() => useStockCounts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([stockCount]);
    expect(mockedListStockCounts).toHaveBeenCalledTimes(1);
  });
});

describe("useStockCount", () => {
  it("is disabled for a null id and loads for a real id", async () => {
    mockedGetStockCount.mockResolvedValue(stockCountDetail);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useStockCount(id),
      { wrapper, initialProps: { id: null as string | null } },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetStockCount).not.toHaveBeenCalled();
    rerender({ id: COUNT_ID });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetStockCount).toHaveBeenCalledWith(COUNT_ID);
  });
});

describe("useCreateStockCount", () => {
  it("delegates, invalidates the list and toasts", async () => {
    mockedCreateStockCount.mockResolvedValue(stockCount);
    const { result } = renderHook(() => useCreateStockCount(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({ title: "Weekly full count" });
    await waitFor(() => {
      expect(mockedCreateStockCount).toHaveBeenCalledWith({
        title: "Weekly full count",
      });
    });
    await waitFor(() => {
      expect(
        screen.getByText(/stock count "weekly full count" created/i),
      ).toBeInTheDocument();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: countsQueryKey,
    });
  });

  it("toasts API errors", async () => {
    mockedCreateStockCount.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useCreateStockCount(), { wrapper });
    result.current.mutate({ title: "Weekly full count" });
    await waitFor(() => {
      expect(screen.getByText("denied")).toBeInTheDocument();
    });
  });
});

describe("useSaveCountLine", () => {
  it("saves the line, patches the cached detail without refetching, and invalidates the list", async () => {
    const savedLine = {
      id: "d0000000-0000-0000-0000-000000000001",
      itemId: ITEM_ID,
      itemName: "Tomatoes",
      unitSymbol: "kg",
      expectedQty: 7.5,
      countedQty: 6,
    };
    mockedSaveCountLine.mockResolvedValue(savedLine);

    const { result } = renderHook(() => useSaveCountLine(), { wrapper });
    // Seed the detail cache AFTER renderHook: the wrapper assigns the
    // module-level queryClient on mount.
    queryClient.setQueryData(countDetailKey(COUNT_ID), stockCountDetail);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    result.current.mutate({
      countId: COUNT_ID,
      itemId: ITEM_ID,
      countedQty: 6,
      countIdForKey: COUNT_ID,
    });

    await waitFor(() => {
      expect(mockedSaveCountLine).toHaveBeenCalledWith({
        countId: COUNT_ID,
        itemId: ITEM_ID,
        countedQty: 6,
      });
    });
    // The detail cache is patched (no full refetch — typing on other rows
    // must not be clobbered); the list (progress %) refreshes.
    expect(setQueryDataSpy).toHaveBeenCalledWith(
      countDetailKey(COUNT_ID),
      expect.any(Function),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: countsQueryKey,
      exact: true,
    });
    const cached = queryClient.getQueryData(countDetailKey(COUNT_ID)) as
      | typeof stockCountDetail
      | undefined;
    expect(cached?.lines[0].countedQty).toBe(6);
  });

  it("toasts API errors", async () => {
    mockedSaveCountLine.mockRejectedValue(new Error("frozen"));
    const { result } = renderHook(() => useSaveCountLine(), { wrapper });
    result.current.mutate({
      countId: COUNT_ID,
      itemId: ITEM_ID,
      countedQty: 1,
      countIdForKey: COUNT_ID,
    });
    await waitFor(() => {
      expect(screen.getByText("frozen")).toBeInTheDocument();
    });
  });
});

describe("useSubmitStockCount", () => {
  it("delegates, invalidates list + detail, and toasts", async () => {
    mockedSubmitStockCount.mockResolvedValue({
      ...stockCount,
      status: "submitted",
    });
    const { result } = renderHook(() => useSubmitStockCount(), { wrapper });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate(COUNT_ID);
    await waitFor(() => {
      expect(mockedSubmitStockCount).toHaveBeenCalledWith(COUNT_ID);
    });
    await waitFor(() => {
      expect(
        screen.getByText(/submitted for review/i),
      ).toBeInTheDocument();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: countsQueryKey,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: countDetailKey(COUNT_ID),
    });
  });
});

describe("useUpdateStockCountStatus", () => {
  it("delegates and invalidates list + detail", async () => {
    mockedUpdateStockCountStatus.mockResolvedValue({
      ...stockCount,
      status: "in_progress",
    });
    const { result } = renderHook(() => useUpdateStockCountStatus(), {
      wrapper,
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    result.current.mutate({ countId: COUNT_ID, status: "in_progress" });
    await waitFor(() => {
      expect(mockedUpdateStockCountStatus).toHaveBeenCalledWith(
        COUNT_ID,
        "in_progress",
      );
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: countsQueryKey,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: countDetailKey(COUNT_ID),
    });
  });
});

describe("useAssignees", () => {
  it("delegates to listProfiles and honors the enabled option", async () => {
    const { listProfiles } = await import("@/api/auth");
    vi.mocked(listProfiles).mockResolvedValue([
      { id: "user-1", role: "staff" as const },
    ]);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAssignees({ enabled }),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(listProfiles).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listProfiles).toHaveBeenCalledTimes(1);
  });
});
