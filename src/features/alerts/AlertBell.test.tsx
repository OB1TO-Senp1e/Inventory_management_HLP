import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AlertBell } from "./AlertBell";
import { listNotifications } from "@/api/notifications";
import type { Notification } from "@/schemas/notifications";

vi.mock("@/api/notifications", () => ({
  listNotifications: vi.fn(),
}));

const mockedList = vi.mocked(listNotifications);

const mockUseAuth = vi.fn();
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function setRole(role: string) {
  mockUseAuth.mockReturnValue({
    profile: { id: "user-1", restaurantId: "r-1", role },
  });
}

function notif(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "c0000000-0000-0000-0000-000000000001",
    type: "low_stock",
    title: "Milk is running low",
    body: "3 L left",
    itemId: "b0000000-0000-0000-0000-000000000002",
    batchNo: null,
    readAt: null,
    createdAt: "2026-10-05T08:00:00.000Z",
    ...overrides,
  };
}

describe("AlertBell", () => {
  it("shows the unread count badge for owner", async () => {
    setRole("owner");
    mockedList.mockResolvedValue([
      notif(),
      notif({
        id: "c0000000-0000-0000-0000-000000000002",
        readAt: "2026-10-05T09:00:00.000Z",
      }),
      notif({
        id: "c0000000-0000-0000-0000-000000000003",
        type: "expiring_soon",
      }),
    ]);
    render(<AlertBell />, { wrapper });
    expect(await screen.findByTestId("alert-bell-badge")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("alert-bell")).toHaveAttribute(
      "aria-label",
      "Notifications, 2 unread",
    );
  });

  it("caps the badge at 99+", async () => {
    setRole("manager");
    mockedList.mockResolvedValue(
      Array.from({ length: 120 }, (_, i) =>
        notif({ id: `c0000000-0000-0000-0000-${String(i).padStart(12, "0")}` }),
      ),
    );
    render(<AlertBell />, { wrapper });
    expect(await screen.findByTestId("alert-bell-badge")).toHaveTextContent(
      "99+",
    );
  });

  it("renders the bell without a badge when nothing is unread", async () => {
    setRole("owner");
    mockedList.mockResolvedValue([
      notif({ readAt: "2026-10-05T09:00:00.000Z" }),
    ]);
    render(<AlertBell />, { wrapper });
    expect(await screen.findByTestId("alert-bell")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-bell-badge")).not.toBeInTheDocument();
  });

  it("renders nothing for staff", () => {
    setRole("staff");
    mockedList.mockResolvedValue([notif()]);
    render(<AlertBell />, { wrapper });
    expect(screen.queryByTestId("alert-bell")).not.toBeInTheDocument();
  });

  it("links to the notifications page", async () => {
    setRole("owner");
    mockedList.mockResolvedValue([]);
    render(<AlertBell />, { wrapper });
    expect(await screen.findByTestId("alert-bell")).toHaveAttribute(
      "href",
      "/notifications",
    );
  });
});
