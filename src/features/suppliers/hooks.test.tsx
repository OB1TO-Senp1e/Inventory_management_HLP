import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  archiveSupplier,
  createSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from "@/api/suppliers";
import {
  useArchiveSupplier,
  useCreateSupplier,
  useSupplier,
  useSuppliers,
  useUpdateSupplier,
} from "./hooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// restaurant-id injection, invalidation, toasts) with zero network.
vi.mock("@/api/suppliers", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  archiveSupplier: vi.fn(),
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    profile: {
      id: "user-1",
      restaurantId: "restaurant-1",
      role: "owner",
    } as { id: string; restaurantId: string; role: "owner" } | null,
  },
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ profile: authState.profile }),
}));

const mockedListSuppliers = vi.mocked(listSuppliers);
const mockedGetSupplier = vi.mocked(getSupplier);
const mockedCreateSupplier = vi.mocked(createSupplier);
const mockedUpdateSupplier = vi.mocked(updateSupplier);
const mockedArchiveSupplier = vi.mocked(archiveSupplier);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("useSuppliers", () => {
  it("delegates to listSuppliers and returns the result", async () => {
    mockedListSuppliers.mockResolvedValue({ suppliers: [], total: 0 });
    const { result } = renderHook(
      () => useSuppliers({ search: "fresh", page: 1, pageSize: 20 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListSuppliers).toHaveBeenCalledWith({
      search: "fresh",
      page: 1,
      pageSize: 20,
    });
    expect(result.current.data?.total).toBe(0);
  });

  it("stays disabled until the profile loads", () => {
    authState.profile = null;
    const { result } = renderHook(() => useSuppliers({}), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedListSuppliers).not.toHaveBeenCalled();
  });
});

describe("useSupplier", () => {
  it("delegates to getSupplier for a non-null id", async () => {
    mockedGetSupplier.mockResolvedValue({
      id: "sup-1",
      name: "Fresh Farms",
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
      active: true,
      createdAt: "2026-10-04T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    });
    const { result } = renderHook(() => useSupplier("sup-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGetSupplier).toHaveBeenCalledWith("sup-1");
  });

  it("stays disabled for a null id", () => {
    const { result } = renderHook(() => useSupplier(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedGetSupplier).not.toHaveBeenCalled();
  });
});

describe("useCreateSupplier", () => {
  it("injects the restaurant id from the profile and toasts on success", async () => {
    mockedCreateSupplier.mockResolvedValue({
      id: "sup-1",
      name: "Fresh Farms",
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
      active: true,
      createdAt: "2026-10-04T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    });
    const { result } = renderHook(() => useCreateSupplier(), { wrapper });
    result.current.mutate({ name: "Fresh Farms" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedCreateSupplier).toHaveBeenCalledWith({
      name: "Fresh Farms",
      restaurantId: "restaurant-1",
    });
    expect(await screen.findByText("Supplier created.")).toBeTruthy();
  });

  it("refuses to create before the profile loads", async () => {
    authState.profile = null;
    const { result } = renderHook(() => useCreateSupplier(), { wrapper });
    result.current.mutate({ name: "Fresh Farms" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedCreateSupplier).not.toHaveBeenCalled();
  });

  it("toasts the API error message on failure", async () => {
    mockedCreateSupplier.mockRejectedValue(
      new Error("A supplier with this name already exists."),
    );
    const { result } = renderHook(() => useCreateSupplier(), { wrapper });
    result.current.mutate({ name: "Fresh Farms" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      await screen.findByText("A supplier with this name already exists."),
    ).toBeTruthy();
  });
});

describe("useUpdateSupplier", () => {
  it("delegates to updateSupplier and toasts on success", async () => {
    mockedUpdateSupplier.mockResolvedValue({
      id: "sup-1",
      name: "Fresh Farms Ltd",
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
      active: true,
      createdAt: "2026-10-04T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    });
    const { result } = renderHook(() => useUpdateSupplier(), { wrapper });
    result.current.mutate({
      id: "sup-1",
      input: { name: "Fresh Farms Ltd" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedUpdateSupplier).toHaveBeenCalledWith("sup-1", {
      name: "Fresh Farms Ltd",
    });
    expect(await screen.findByText("Supplier updated.")).toBeTruthy();
  });
});

describe("useArchiveSupplier", () => {
  it("delegates to archiveSupplier and toasts on success", async () => {
    mockedArchiveSupplier.mockResolvedValue({
      id: "sup-1",
      name: "Fresh Farms",
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
      active: false,
      createdAt: "2026-10-04T00:00:00Z",
      updatedAt: "2026-10-04T00:00:00Z",
    });
    const { result } = renderHook(() => useArchiveSupplier(), { wrapper });
    result.current.mutate("sup-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedArchiveSupplier).toHaveBeenCalledWith("sup-1");
    expect(await screen.findByText("Supplier archived.")).toBeTruthy();
  });
});
