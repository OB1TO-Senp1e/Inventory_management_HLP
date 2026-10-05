import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/features/auth/AuthContext";
import type { UserRole } from "@/schemas/role";
import { HomePage } from "./HomePage";

function signedInValue(role: UserRole): AuthContextValue {
  return {
    status: "signed-in",
    session: { userId: "u1", email: "u@example.com" },
    profile: { id: "u1", restaurantId: "r1", role, currentOutletId: null },
    error: null,
    signOut: async () => {},
    refreshProfile: async () => {},
  };
}

function renderHome(role: UserRole) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={signedInValue(role)}>
        <HomePage />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("links every section the owner's role may access", () => {
    renderHome("owner");
    const list = screen.getByRole("list");
    expect(within(list).getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/users",
    );
    expect(within(list).getByRole("link", { name: "Audit Log" })).toHaveAttribute(
      "href",
      "/audit-log",
    );
  });

  it("shows staff only their operational sections", () => {
    renderHome("staff");
    const list = screen.getByRole("list");
    const links = within(list)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/receiving", "/wastage", "/stock-counts"]);
  });
});
