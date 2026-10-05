import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry } from "@/api/admin";
import { AuditLogPage } from "./AuditLogPage";
import { useAuditLog } from "./hooks";

vi.mock("./hooks", () => ({ useAuditLog: vi.fn() }));

const mockedUseAuditLog = vi.mocked(useAuditLog);

const ENTRY: AuditLogEntry = {
  id: "e0000000-0000-0000-0000-000000000001",
  action: "over_sale",
  actionLabel: "Over sale",
  entityType: "stock_movement",
  entityId: null,
  details: {},
  summary: "Sale 2026-10-05 — 1 dish sold; below-zero items: Tomatoes (2 → -2 kg)",
  createdBy: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  createdByRole: "owner",
  createdAt: "2026-10-05T10:00:00+05:30",
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<AuditLogPage />, { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditLogPage", () => {
  it("renders entries with action, actor and time", () => {
    mockedUseAuditLog.mockReturnValue({
      data: { entries: [ENTRY], total: 1 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuditLog>);
    renderPage();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Over sale")).toBeInTheDocument();
    expect(screen.getByText(/owner/)).toBeInTheDocument();
    expect(screen.getByText(/Sale 2026-10-05/)).toBeInTheDocument();
    expect(screen.getByText(/Showing 1–1 of 1 entries/)).toBeInTheDocument();
  });

  it("renders an empty state when nothing matches", () => {
    mockedUseAuditLog.mockReturnValue({
      data: { entries: [], total: 0 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuditLog>);
    renderPage();
    expect(
      screen.getByText("No audit entries match these filters."),
    ).toBeInTheDocument();
  });

  it("renders an error state when the query fails", () => {
    mockedUseAuditLog.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useAuditLog>);
    renderPage();
    expect(
      screen.getByText("Could not load the audit log. Try again."),
    ).toBeInTheDocument();
  });

  it("changing the action filter resets to page 1 with the new filter", () => {
    mockedUseAuditLog.mockReturnValue({
      data: { entries: [ENTRY], total: 51 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuditLog>);
    renderPage();
    fireEvent.change(screen.getByLabelText("Action"), {
      target: { value: "stock_count_applied" },
    });
    const lastCall = mockedUseAuditLog.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ action: "stock_count_applied", page: 1 });
  });

  it("disables pagination buttons at the bounds", () => {
    mockedUseAuditLog.mockReturnValue({
      data: { entries: [ENTRY], total: 1 },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useAuditLog>);
    renderPage();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
