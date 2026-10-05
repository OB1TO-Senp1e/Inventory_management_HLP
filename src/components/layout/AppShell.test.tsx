import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/features/auth/AuthContext";
import { ToastProvider } from "@/components/toast/ToastProvider";
import type { UserRole } from "@/schemas/role";
import { AppShell } from "./AppShell";

// Breadcrumb detail-name lookups are irrelevant to shell nav tests and need
// no providers here.
vi.mock("@/features/items/hooks", () => ({
  useItem: () => ({ data: undefined }),
}));
vi.mock("@/features/suppliers/hooks", () => ({
  useSupplier: () => ({ data: undefined }),
}));
vi.mock("@/features/counts/hooks", () => ({
  useStockCount: () => ({ data: undefined }),
}));

function signedInValue(role: UserRole): AuthContextValue {
  return {
    status: "signed-in",
    session: { userId: "u1", email: "u@example.com" },
    profile: { id: "u1", restaurantId: "r1", role },
    error: null,
    signOut: async () => {},
  };
}

function renderShell(role: UserRole) {
  // AppShell now hosts the offline sync engine (needs a query client) and
  // the sync-status badge (needs the toast provider for queued-count clicks).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthContext.Provider value={signedInValue(role)}>
        <Routes>
          <Route path="/" element={<AppShell />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
    { wrapper: providers },
  );
}

/** The primary nav (sidebar) when the drawer is closed. */
function primaryNav() {
  return screen.getByRole("navigation", { name: "Primary" });
}

describe("AppShell navigation per role", () => {
  it("owner sees every section including audit log and users", () => {
    renderShell("owner");
    const nav = primaryNav();
    expect(within(nav).getByRole("link", { name: "Audit Log" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Receiving" })).toBeInTheDocument();
  });

  it("manager sees reports but no user management", () => {
    renderShell("manager");
    const nav = primaryNav();
    expect(within(nav).getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Items" })).toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Users" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Audit Log" }),
    ).not.toBeInTheDocument();
  });

  it("staff sees only receiving, usage & wastage and stock counts", () => {
    renderShell("staff");
    const nav = primaryNav();
    expect(within(nav).getByRole("link", { name: "Receiving" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Usage & wastage" })).toBeInTheDocument();
    expect(
      within(nav).getByRole("link", { name: "Stock Counts" }),
    ).toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Items" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Reports" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("link", { name: "Dashboard" }),
    ).not.toBeInTheDocument();
  });

  it("shows the signed-in user's email and role", () => {
    renderShell("manager");
    expect(screen.getAllByText("u@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("manager").length).toBeGreaterThan(0);
  });
});

describe("AppShell mobile drawer", () => {
  it("opens and closes the navigation drawer", () => {
    renderShell("staff");
    expect(
      screen.queryByRole("dialog", { name: "Navigation" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();

    // Backdrop is the first "Close navigation" button; the panel X is second.
    const closers = screen.getAllByRole("button", { name: "Close navigation" });
    fireEvent.click(closers[0]!);
    expect(
      screen.queryByRole("dialog", { name: "Navigation" }),
    ).not.toBeInTheDocument();
  });

  it("closes the drawer on Escape", () => {
    renderShell("staff");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Navigation" }),
    ).not.toBeInTheDocument();
  });
});

describe("AppShell responsive structure", () => {
  it("hides the sidebar below lg and the mobile bar at lg+", () => {
    const { container } = renderShell("owner");
    const sidebar = container.querySelector("aside");
    expect(sidebar?.className).toContain("hidden");
    expect(sidebar?.className).toContain("lg:flex");

    const openButton = screen.getByRole("button", { name: "Open navigation" });
    expect(openButton.closest("div")?.className).toContain("lg:hidden");
  });

  it("constrains the drawer width to the viewport", () => {
    renderShell("owner");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog.className).toContain("max-w-[85vw]");
  });
});
