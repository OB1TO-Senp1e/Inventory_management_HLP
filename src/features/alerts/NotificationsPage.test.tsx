import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { NotificationsPage } from "./NotificationsPage";
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/api/notifications";
import type { Notification } from "@/schemas/notifications";

vi.mock("@/api/notifications", () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

const mockedList = vi.mocked(listNotifications);
const mockedMarkRead = vi.mocked(markNotificationRead);
const mockedMarkAll = vi.mocked(markAllNotificationsRead);
const mockedDelete = vi.mocked(deleteNotification);

function notif(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "c0000000-0000-0000-0000-000000000001",
    type: "low_stock",
    title: "Milk is running low",
    body: "3 L left (reorder at 10 L)",
    itemId: "b0000000-0000-0000-0000-000000000002",
    batchNo: null,
    readAt: null,
    createdAt: "2026-10-05T08:00:00.000Z",
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationsPage", () => {
  it("lists notifications newest-first with type badges", async () => {
    mockedList.mockResolvedValue([
      notif(),
      notif({
        id: "c0000000-0000-0000-0000-000000000002",
        type: "expiring_soon",
        title: "Tomato batch B-101 expiring soon",
        batchNo: "B-101",
        readAt: "2026-10-05T09:00:00.000Z",
      }),
    ]);
    render(<NotificationsPage />, { wrapper });
    const items = await screen.findAllByTestId("notification-item");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Low stock")).toBeInTheDocument();
    expect(screen.getByText("Expiring soon")).toBeInTheDocument();
    // Unread item carries the New pill; read item does not.
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("data-unread", "true");
    expect(items[1]).toHaveAttribute("data-unread", "false");
  });

  it("shows the empty state when there are no alerts", async () => {
    mockedList.mockResolvedValue([]);
    render(<NotificationsPage />, { wrapper });
    expect(await screen.findByText("No alerts right now")).toBeInTheDocument();
    expect(
      screen.queryByTestId("notification-item"),
    ).not.toBeInTheDocument();
  });

  it("shows an error state with retry", async () => {
    mockedList.mockRejectedValueOnce(new Error("offline"));
    mockedList.mockResolvedValueOnce([]);
    render(<NotificationsPage />, { wrapper });
    expect(
      await screen.findByText("Couldn't load notifications."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("No alerts right now")).toBeInTheDocument();
    });
  });

  it("marks a notification as read", async () => {
    mockedList.mockResolvedValue([notif()]);
    mockedMarkRead.mockResolvedValue(undefined);
    render(<NotificationsPage />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark as read" }),
    );
    await waitFor(() => {
      expect(mockedMarkRead.mock.calls[0][0]).toBe(
        "c0000000-0000-0000-0000-000000000001",
      );
    });
  });

  it("marks all as read from the header action", async () => {
    mockedList.mockResolvedValue([notif(), notif({ id: "c0000000-0000-0000-0000-000000000002" })]);
    mockedMarkAll.mockResolvedValue(undefined);
    render(<NotificationsPage />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" }),
    );
    await waitFor(() => {
      expect(mockedMarkAll).toHaveBeenCalled();
    });
  });

  it("hides the mark-all-read action when nothing is unread", async () => {
    mockedList.mockResolvedValue([
      notif({ readAt: "2026-10-05T09:00:00.000Z" }),
    ]);
    render(<NotificationsPage />, { wrapper });
    await screen.findByTestId("notification-item");
    expect(
      screen.queryByRole("button", { name: "Mark all read" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses a notification", async () => {
    mockedList.mockResolvedValue([notif()]);
    mockedDelete.mockResolvedValue(undefined);
    render(<NotificationsPage />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Dismiss alert: Milk is running low",
      }),
    );
    await waitFor(() => {
      expect(mockedDelete.mock.calls[0][0]).toBe(
        "c0000000-0000-0000-0000-000000000001",
      );
    });
  });

  it("links each alert to its item", async () => {
    mockedList.mockResolvedValue([notif()]);
    render(<NotificationsPage />, { wrapper });
    const link = await screen.findByRole("link", { name: "View item" });
    expect(link).toHaveAttribute(
      "href",
      "/items/b0000000-0000-0000-0000-000000000002",
    );
  });
});
