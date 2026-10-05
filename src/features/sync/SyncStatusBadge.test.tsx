import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  clearSyncQueue,
  enqueueSyncEntry,
  markSyncEntryFailed,
} from "./queue";
import { SyncStatusBadge } from "./SyncStatusBadge";

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "user-1", restaurantId: "restaurant-1", role: "staff" },
  }),
}));

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

beforeEach(() => {
  clearSyncQueue();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

describe("SyncStatusBadge", () => {
  it("renders nothing when the queue is empty and online", () => {
    render(<SyncStatusBadge />, { wrapper });
    expect(screen.queryByTestId("sync-status")).not.toBeInTheDocument();
  });

  it("shows the offline pill when offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<SyncStatusBadge />, { wrapper });
    expect(screen.getByText("Offline")).toBeVisible();
  });

  it("shows the queued count alongside the offline pill", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    enqueueSyncEntry({
      type: "wastage",
      restaurantId: "restaurant-1",
      payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
    });
    render(<SyncStatusBadge />, { wrapper });
    expect(screen.getByText(/offline · 1 queued/i)).toBeVisible();
  });

  it("shows the queued count", () => {
    enqueueSyncEntry({
      type: "wastage",
      restaurantId: "restaurant-1",
      payload: { itemId: ITEM_ID, quantity: 2, reason: "spoiled" },
    });
    render(<SyncStatusBadge />, { wrapper });
    expect(screen.getByRole("button", { name: /1 entry queued/i })).toBeVisible();
  });

  it("shows the failed count", () => {
    const entry = enqueueSyncEntry({
      type: "usage",
      restaurantId: "restaurant-1",
      payload: { itemId: ITEM_ID, quantity: 1, reason: "kitchen_use" },
    });
    markSyncEntryFailed(entry.id, "Item is archived");
    render(<SyncStatusBadge />, { wrapper });
    expect(
      screen.getByRole("button", { name: /1 queued entry failed/i }),
    ).toBeVisible();
  });
});
