import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext, type AuthContextValue } from "@/features/auth/AuthContext";
import type { UserRole } from "@/schemas/role";
import { ProtectedRoute } from "./ProtectedRoute";
import { RoleGuard } from "./RoleGuard";
import { canAccessPath } from "./access";

function signedOutValue(): AuthContextValue {
  return {
    status: "signed-out",
    session: null,
    profile: null,
    error: null,
    signOut: async () => {},
  };
}

function signedInValue(role: UserRole): AuthContextValue {
  return {
    status: "signed-in",
    session: { userId: "u1", email: "u@example.com" },
    profile: { id: "u1", restaurantId: "r1", role },
    error: null,
    signOut: async () => {},
  };
}

function loadingValue(): AuthContextValue {
  return {
    status: "loading",
    session: null,
    profile: null,
    error: null,
    signOut: async () => {},
  };
}

/** Shows where the redirect came from, to assert destination preservation. */
function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "none";
  return <div>Login page (from: {from})</div>;
}

function renderAt(path: string, auth: AuthContextValue, route: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/login" element={<LoginProbe />} />
          {route}
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  const stockRoute = (
    <Route
      path="/stock"
      element={
        <ProtectedRoute>
          <div>Secret stock page</div>
        </ProtectedRoute>
      }
    />
  );

  it("redirects unauthenticated users to /login preserving the destination", () => {
    renderAt("/stock", signedOutValue(), stockRoute);
    expect(screen.getByText("Login page (from: /stock)")).toBeInTheDocument();
    expect(screen.queryByText("Secret stock page")).not.toBeInTheDocument();
  });

  it("renders the page for a signed-in user", () => {
    renderAt("/stock", signedInValue("manager"), stockRoute);
    expect(screen.getByText("Secret stock page")).toBeInTheDocument();
  });

  it("shows a loading indicator while the session is being restored", () => {
    renderAt("/stock", loadingValue(), stockRoute);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});

describe("RoleGuard", () => {
  const reportsRoute = (allowedRoles: UserRole[]) => (
    <Route
      path="/reports"
      element={
        <ProtectedRoute>
          <RoleGuard allowedRoles={allowedRoles}>
            <div>Secret reports page</div>
          </RoleGuard>
        </ProtectedRoute>
      }
    />
  );

  it("allows an owner onto an owner/manager page", () => {
    renderAt("/reports", signedInValue("owner"), reportsRoute(["owner", "manager"]));
    expect(screen.getByText("Secret reports page")).toBeInTheDocument();
  });

  it("denies staff on a reports page and sends them home", () => {
    renderAt("/reports", signedInValue("staff"), reportsRoute(["owner", "manager"]));
    expect(screen.queryByText("Secret reports page")).not.toBeInTheDocument();
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("denies a manager on an owner-only page", () => {
    renderAt("/reports", signedInValue("manager"), reportsRoute(["owner"]));
    expect(screen.queryByText("Secret reports page")).not.toBeInTheDocument();
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("denies unauthenticated users", () => {
    renderAt("/reports", signedOutValue(), reportsRoute(["owner", "manager"]));
    expect(screen.queryByText("Secret reports page")).not.toBeInTheDocument();
  });
});

describe("canAccessPath", () => {
  it("lets staff into operational pages but not reports", () => {
    expect(canAccessPath("/receiving", "staff")).toBe(true);
    expect(canAccessPath("/wastage", "staff")).toBe(true);
    expect(canAccessPath("/stock-counts", "staff")).toBe(true);
    expect(canAccessPath("/reports", "staff")).toBe(false);
    expect(canAccessPath("/dashboard", "staff")).toBe(false);
  });

  it("lets managers into everything except owner-only pages", () => {
    expect(canAccessPath("/reports", "manager")).toBe(true);
    expect(canAccessPath("/items", "manager")).toBe(true);
    expect(canAccessPath("/users", "manager")).toBe(false);
    expect(canAccessPath("/audit-log", "manager")).toBe(false);
  });

  it("lets owners everywhere in the map", () => {
    expect(canAccessPath("/users", "owner")).toBe(true);
    expect(canAccessPath("/audit-log", "owner")).toBe(true);
    expect(canAccessPath("/settings", "owner")).toBe(true);
  });

  it("denies unknown paths and missing roles by default", () => {
    expect(canAccessPath("/nope", "owner")).toBe(false);
    expect(canAccessPath("/login", "owner")).toBe(false);
    expect(canAccessPath("/stock", null)).toBe(false);
  });
});
