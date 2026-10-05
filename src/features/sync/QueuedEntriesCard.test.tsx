import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logWastage } from "@/api/stock";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  clearSyncQueue,
  enqueueSyncEntry,
  getSyncEntries,
  markSyncEntryFailed,
} from "./queue";
import { QueuedEntriesCard } from "./QueuedEntriesCard";

vi.mock("@/api/stock", () => ({
  logWastage: vi.fn(),
  logUsage: vi.fn(),
  receiveGoods: vi.fn(),
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "staff" },
  }),
}));

const mockedLogWastage = vi.mocked(logWastage);
const ITEM_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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

const itemName = (itemId: string) =>
  itemId === ITEM_ID ? "Tomatoes" : undefined;

beforeEach(() => {
  clearSyncQueue();
  vi.clearAllMocks();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mockedLogWastage.mockResolvedValue({ movementId: "m1" });
});

describe("QueuedEntriesCard", () => {
  it("renders nothing when there are no entries", () => {
    render(<QueuedEntriesCard entries={[]} />, { wrapper });
    expect(
      screen.queryByRole("region", { name: "Queued offline entries" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/pending sync/i),
    ).not.toBeInTheDocument();
  });

  it("lists queued entries with a human-readable summary", () => {
    const entries = [
      enqueueSyncEntry({
        type: "wastage",
        restaurantId: "restaurant-1",
        payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
      }),
    ];
    render(<QueuedEntriesCard entries={entries} itemName={itemName} />, {
      wrapper,
    });
    expect(screen.getByText("Pending sync (1)")).toBeVisible();
    expect(screen.getByText("2 × Tomatoes — Spoiled")).toBeVisible();
    expect(screen.getByText("Queued")).toBeVisible();
  });

  it("summarizes receipt entries by line count", () => {
    const entries = [
      enqueueSyncEntry({
        type: "receiving",
        restaurantId: "restaurant-1",
        payload: {
          lines: [
            { itemId: ITEM_ID, quantity: 5, unitCost: 10 },
            { itemId: ITEM_ID, quantity: 3, unitCost: 12 },
          ],
        },
      }),
    ];
    render(<QueuedEntriesCard entries={entries} itemName={itemName} />, {
      wrapper,
    });
    expect(screen.getByText("2 lines, 8 total units")).toBeVisible();
  });

  it("shows the server error on failed entries with retry and discard", async () => {
    const entry = enqueueSyncEntry({
      type: "wastage",
      restaurantId: "restaurant-1",
      payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
    });
    markSyncEntryFailed(entry.id, "Item is archived");
    const entries = getSyncEntries();
    render(<QueuedEntriesCard entries={entries} itemName={itemName} />, {
      wrapper,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Item is archived");
    // Retry replays the entry and removes it on success.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockedLogWastage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getSyncEntries()).toHaveLength(0));
  });

  it("discards an entry without posting it", async () => {
    const entries = [
      enqueueSyncEntry({
        type: "wastage",
        restaurantId: "restaurant-1",
        payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
      }),
    ];
    render(<QueuedEntriesCard entries={entries} itemName={itemName} />, {
      wrapper,
    });
    fireEvent.click(
      screen.getByRole("button", { name: /discard queued wastage entry/i }),
    );
    expect(getSyncEntries()).toHaveLength(0);
    expect(mockedLogWastage).not.toHaveBeenCalled();
  });
});
