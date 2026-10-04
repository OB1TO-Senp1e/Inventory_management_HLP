import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { createItem, listItems, type Item } from "@/api/items";
import { createSupplier, listSuppliers, type Supplier } from "@/api/suppliers";
import {
  useExportItems,
  useExportSuppliers,
  useImportItems,
  useImportSuppliers,
} from "./hooks";

// API modules are mocked: these tests verify hook wiring (pagination,
// restaurant-id injection, sequential creates, per-row failures, progress)
// with zero network. downloadCSV is mocked; the rest of lib/csv is real.
vi.mock("@/api/items", () => ({
  listItems: vi.fn(),
  createItem: vi.fn(),
}));
vi.mock("@/api/suppliers", () => ({
  listSuppliers: vi.fn(),
  createSupplier: vi.fn(),
}));
vi.mock("@/lib/csv", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/csv")>();
  return { ...original, downloadCSV: vi.fn() };
});

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

const mockedListItems = vi.mocked(listItems);
const mockedCreateItem = vi.mocked(createItem);
const mockedListSuppliers = vi.mocked(listSuppliers);
const mockedCreateSupplier = vi.mocked(createSupplier);

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

function makeItem(name: string): Item {
  return {
    id: `item-${name}`,
    name,
    categoryId: null,
    categoryName: null,
    unitId: "unit-1",
    unitName: "kilogram",
    unitSymbol: "kg",
    storageLocationId: null,
    storageLocationName: null,
    parLevel: 0,
    reorderPoint: 0,
    active: true,
    avgUnitCost: 0,
    createdAt: "",
    updatedAt: "",
  };
}

function makeSupplier(name: string): Supplier {
  return {
    id: `supplier-${name}`,
    name,
    contactPerson: null,
    phone: null,
    email: null,
    address: null,
    gstin: null,
    notes: null,
    active: true,
    createdAt: "",
    updatedAt: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("useExportItems", () => {
  it("pages through all active items and downloads one CSV", async () => {
    const { downloadCSV } = await import("@/lib/csv");
    mockedListItems
      .mockResolvedValueOnce({
        items: [makeItem("Tomato"), makeItem("Onion")],
        total: 3,
      })
      .mockResolvedValueOnce({ items: [makeItem("Salt")], total: 3 });

    const { result } = renderHook(() => useExportItems(), { wrapper });
    result.current.mutate();

    await waitFor(() => {
      expect(vi.mocked(downloadCSV)).toHaveBeenCalledTimes(1);
    });
    const [filename, content] = vi.mocked(downloadCSV).mock.calls[0] as [
      string,
      string,
    ];
    expect(filename).toMatch(/^items-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain("Tomato");
    expect(content).toContain("Onion");
    expect(content).toContain("Salt");
    expect(content).toContain("name,category,unit,storage_location,par_level,reorder_point");
    // Active-only, name-sorted pages of 100.
    expect(mockedListItems).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ active: true, page: 1, pageSize: 100 }),
    );
    expect(mockedListItems).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 2 }),
    );
  });
});

describe("useExportSuppliers", () => {
  it("exports all active suppliers", async () => {
    const { downloadCSV } = await import("@/lib/csv");
    mockedListSuppliers.mockResolvedValue({
      suppliers: [makeSupplier("Fresh Farms")],
      total: 1,
    });

    const { result } = renderHook(() => useExportSuppliers(), { wrapper });
    result.current.mutate();

    await waitFor(() => {
      expect(vi.mocked(downloadCSV)).toHaveBeenCalledTimes(1);
    });
    const [filename, content] = vi.mocked(downloadCSV).mock.calls[0] as [
      string,
      string,
    ];
    expect(filename).toMatch(/^suppliers-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content).toContain("Fresh Farms");
  });
});

describe("useImportItems", () => {
  it("creates rows sequentially, injects restaurantId, reports per-row failures", async () => {
    mockedCreateItem
      .mockResolvedValueOnce(makeItem("Tomato"))
      .mockRejectedValueOnce(new Error("An item with this name already exists."))
      .mockResolvedValueOnce(makeItem("Salt"));

    const progress: [number, number][] = [];
    const { result } = renderHook(() => useImportItems(), { wrapper });
    const outcome = await result.current.mutateAsync({
      rows: [
        { index: 1, input: { name: "Tomato", categoryId: null, unitId: "u", storageLocationId: null, parLevel: 0, reorderPoint: 0 } },
        { index: 2, input: { name: "Tomato", categoryId: null, unitId: "u", storageLocationId: null, parLevel: 0, reorderPoint: 0 } },
        { index: 5, input: { name: "Salt", categoryId: null, unitId: "u", storageLocationId: null, parLevel: 0, reorderPoint: 0 } },
      ],
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(outcome.imported).toBe(2);
    expect(outcome.failures).toEqual([
      { index: 2, message: "An item with this name already exists." },
    ]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(mockedCreateItem).toHaveBeenCalledTimes(3);
    expect(mockedCreateItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ restaurantId: "restaurant-1", name: "Tomato" }),
    );
  });

  it("rejects when the profile is not loaded", async () => {
    authState.profile = null;
    const { result } = renderHook(() => useImportItems(), { wrapper });
    await expect(
      result.current.mutateAsync({ rows: [] }),
    ).rejects.toThrow(/profile is still loading/i);
  });
});

describe("useImportSuppliers", () => {
  it("creates supplier rows with restaurantId injected", async () => {
    mockedCreateSupplier.mockResolvedValue(makeSupplier("Fresh Farms"));

    const { result } = renderHook(() => useImportSuppliers(), { wrapper });
    const outcome = await result.current.mutateAsync({
      rows: [{ index: 1, input: { name: "Fresh Farms" } }],
    });

    expect(outcome).toEqual({ imported: 1, failures: [] });
    expect(mockedCreateSupplier).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        name: "Fresh Farms",
      }),
    );
  });
});
