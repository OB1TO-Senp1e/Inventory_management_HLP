import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { getCurrentProfile, getSession, onAuthStateChange, resetPassword, signIn, signOut } from "./auth";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface MockAuthApi {
  signInWithPassword: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
}

let mockAuth: MockAuthApi;
let mockFrom: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  };
  mockFrom = vi.fn();
  mockedGetSupabaseClient.mockReturnValue({
    auth: mockAuth,
    from: mockFrom,
  } as unknown as SupabaseClient);
});

describe("signIn", () => {
  it("rejects an invalid email without calling the client", async () => {
    await expect(
      signIn({ email: "not-an-email", password: "password123" }),
    ).rejects.toThrow("Enter a valid email address");
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a short password without calling the client", async () => {
    await expect(signIn({ email: "a@b.com", password: "short" })).rejects.toThrow(
      "Password must be at least 8 characters",
    );
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in with normalized credentials and returns the session", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "A@B.com" } } },
      error: null,
    });
    const session = await signIn({ email: "  A@B.com ", password: "password123" });
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "password123",
    });
    expect(session).toEqual({ userId: "u1", email: "A@B.com" });
  });

  it("surfaces the Supabase error message", async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });
    await expect(signIn({ email: "a@b.com", password: "password123" })).rejects.toThrow(
      "Invalid login credentials",
    );
  });
});

describe("signOut", () => {
  it("calls auth.signOut and resolves", async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces sign-out errors", async () => {
    mockAuth.signOut.mockResolvedValue({ error: { message: "boom" } });
    await expect(signOut()).rejects.toThrow("boom");
  });
});

describe("resetPassword", () => {
  it("rejects a bad email without calling the client", async () => {
    await expect(resetPassword({ email: "nope" })).rejects.toThrow(
      "Enter a valid email address",
    );
    expect(mockAuth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the reset email to the normalized address", async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await resetPassword({ email: " User@Example.com " });
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({ redirectTo: expect.stringContaining("/reset-password") }),
    );
  });
});

describe("getSession", () => {
  it("returns null when there is no session", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getSession()).resolves.toBeNull();
  });

  it("maps the persisted session", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u9", email: "u@x.com" } } },
      error: null,
    });
    await expect(getSession()).resolves.toEqual({ userId: "u9", email: "u@x.com" });
  });
});

describe("getCurrentProfile", () => {
  function mockProfileQuery(row: unknown, error: { message: string } | null) {
    const single = vi.fn().mockResolvedValue({ data: row, error });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ select });
  }

  it("returns null when there is no session and never queries profiles", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getCurrentProfile()).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns the typed profile for a valid row", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "u@x.com" } } },
      error: null,
    });
    mockProfileQuery({ id: "u1", restaurant_id: "r1", role: "manager" }, null);
    await expect(getCurrentProfile()).resolves.toEqual({
      id: "u1",
      restaurantId: "r1",
      role: "manager",
    });
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("throws on an unknown role value", async () => {
    mockAuth.getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "u@x.com" } } },
      error: null,
    });
    mockProfileQuery({ id: "u1", restaurant_id: "r1", role: "superadmin" }, null);
    await expect(getCurrentProfile()).rejects.toThrow();
  });
});

describe("mock role (test-only session mock)", () => {
  const KEY = "ri.mockRole";

  afterEach(() => {
    window.localStorage.removeItem(KEY);
  });

  it("synthesizes a session without touching the client", async () => {
    window.localStorage.setItem(KEY, "owner");
    await expect(getSession()).resolves.toEqual({
      userId: "mock-owner-user",
      email: "owner@example.com",
    });
    expect(mockedGetSupabaseClient).not.toHaveBeenCalled();
  });

  it("synthesizes a profile without querying the database", async () => {
    window.localStorage.setItem(KEY, "staff");
    await expect(getCurrentProfile()).resolves.toEqual({
      id: "mock-staff-user",
      restaurantId: "mock-restaurant",
      role: "staff",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("ignores an invalid mock role value", async () => {
    window.localStorage.setItem(KEY, "superadmin");
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getSession()).resolves.toBeNull();
  });

  it("returns a no-op subscription when the mock is active (never touches the client)", () => {
    window.localStorage.setItem(KEY, "manager");
    const callback = vi.fn();
    const unsubscribe = onAuthStateChange(callback);
    expect(mockedGetSupabaseClient).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
