import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import {
  archiveCategory,
  archiveLocation,
  countCategoryItems,
  countLocationItems,
  createCategory,
  createLocation,
  deleteCategory,
  deleteLocation,
  listCategories,
  listLocations,
  updateCategory,
  updateLocation,
} from "@/api/taxonomy";
import {
  useArchiveCategory,
  useArchiveLocation,
  useCategories,
  useCategoryUsage,
  useCreateCategory,
  useCreateLocation,
  useDeleteCategory,
  useDeleteLocation,
  useLocations,
  useLocationUsage,
  useUpdateCategory,
  useUpdateLocation,
} from "./hooks";

// The API module is mocked: these tests verify hook wiring (delegation,
// restaurant-id injection, invalidation, toasts) with zero network.
vi.mock("@/api/taxonomy", () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn(),
  deleteCategory: vi.fn(),
  countCategoryItems: vi.fn(),
  listLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  archiveLocation: vi.fn(),
  deleteLocation: vi.fn(),
  countLocationItems: vi.fn(),
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

const mockedListCategories = vi.mocked(listCategories);
const mockedCreateCategory = vi.mocked(createCategory);
const mockedUpdateCategory = vi.mocked(updateCategory);
const mockedArchiveCategory = vi.mocked(archiveCategory);
const mockedDeleteCategory = vi.mocked(deleteCategory);
const mockedCountCategoryItems = vi.mocked(countCategoryItems);
const mockedListLocations = vi.mocked(listLocations);
const mockedCreateLocation = vi.mocked(createLocation);
const mockedUpdateLocation = vi.mocked(updateLocation);

/** Fresh client per test plus a spy on invalidateQueries. */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

const sampleEntry = {
  id: "c1",
  name: "Vegetables",
  active: true,
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.profile = {
    id: "user-1",
    restaurantId: "restaurant-1",
    role: "owner",
  };
});

describe("useCategories / useLocations", () => {
  it("delegates to listCategories and returns the result", async () => {
    mockedListCategories.mockResolvedValue([sampleEntry]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListCategories).toHaveBeenCalledWith(true);
    expect(result.current.data).toEqual([sampleEntry]);
  });

  it("delegates to listLocations", async () => {
    mockedListLocations.mockResolvedValue([sampleEntry]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useLocations(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedListLocations).toHaveBeenCalledWith(true);
  });

  it("stays disabled until the profile loads", () => {
    authState.profile = null;
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedListCategories).not.toHaveBeenCalled();
  });
});

describe("useCategoryUsage / useLocationUsage", () => {
  it("fetches the usage count for a category", async () => {
    mockedCountCategoryItems.mockResolvedValue(2);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCategoryUsage("c1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedCountCategoryItems).toHaveBeenCalledWith("c1");
    expect(result.current.data).toBe(2);
  });

  it("stays idle without an id", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useLocationUsage(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(countLocationItems).not.toHaveBeenCalled();
  });
});

describe("mutations", () => {
  it("useCreateCategory injects the restaurant id", async () => {
    mockedCreateCategory.mockResolvedValue(sampleEntry);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateCategory(), { wrapper });
    result.current.mutate({ name: "Herbs" });
    await waitFor(() => expect(mockedCreateCategory).toHaveBeenCalled());
    expect(mockedCreateCategory).toHaveBeenCalledWith({
      name: "Herbs",
      restaurantId: "restaurant-1",
    });
  });

  it("useCreateLocation injects the restaurant id", async () => {
    mockedCreateLocation.mockResolvedValue(sampleEntry);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateLocation(), { wrapper });
    result.current.mutate({ name: "Pantry" });
    await waitFor(() => expect(mockedCreateLocation).toHaveBeenCalled());
    expect(mockedCreateLocation).toHaveBeenCalledWith({
      name: "Pantry",
      restaurantId: "restaurant-1",
    });
  });

  it("create refuses when the profile is still loading", async () => {
    authState.profile = null;
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateCategory(), { wrapper });
    result.current.mutate({ name: "Herbs" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedCreateCategory).not.toHaveBeenCalled();
  });

  it("update/archive/delete delegate with the id", async () => {
    mockedUpdateCategory.mockResolvedValue(sampleEntry);
    mockedArchiveCategory.mockResolvedValue({ ...sampleEntry, active: false });
    mockedDeleteCategory.mockResolvedValue(undefined);
    const { wrapper } = makeWrapper();
    const { result: update } = renderHook(() => useUpdateCategory(), {
      wrapper,
    });
    const { result: archive } = renderHook(() => useArchiveCategory(), {
      wrapper,
    });
    const { result: remove } = renderHook(() => useDeleteCategory(), {
      wrapper,
    });
    update.current.mutate({ id: "c1", input: { name: "Fresh Herbs" } });
    archive.current.mutate("c1");
    remove.current.mutate("c1");
    await waitFor(() => expect(mockedDeleteCategory).toHaveBeenCalled());
    expect(mockedUpdateCategory).toHaveBeenCalledWith("c1", {
      name: "Fresh Herbs",
    });
    expect(mockedArchiveCategory).toHaveBeenCalledWith("c1");
    expect(mockedDeleteCategory).toHaveBeenCalledWith("c1");
  });

  it("invalidates taxonomy, item lookups and items on success", async () => {
    mockedUpdateLocation.mockResolvedValue(sampleEntry);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUpdateLocation(), { wrapper });
    result.current.mutate({ id: "l1", input: { name: "Pantry" } });
    await waitFor(() =>
      expect(updateLocation).toHaveBeenCalledWith("l1", { name: "Pantry" }),
    );
    const keys = invalidateSpy.mock.calls.map(
      (call) => (call[0] as { queryKey: readonly string[] }).queryKey,
    );
    expect(keys).toContainEqual(["taxonomy"]);
    expect(keys).toContainEqual(["item-categories"]);
    expect(keys).toContainEqual(["storage-locations"]);
    expect(keys).toContainEqual(["items"]);
  });

  it("location mutations delegate with the id", async () => {
    const mockedArchive = vi.mocked(archiveLocation);
    const mockedDelete = vi.mocked(deleteLocation);
    mockedArchive.mockResolvedValue({ ...sampleEntry, active: false });
    mockedDelete.mockResolvedValue(undefined);
    const { wrapper } = makeWrapper();
    const { result: archive } = renderHook(() => useArchiveLocation(), {
      wrapper,
    });
    const { result: remove } = renderHook(() => useDeleteLocation(), {
      wrapper,
    });
    archive.current.mutate("l1");
    remove.current.mutate("l1");
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("l1"));
    expect(mockedArchive).toHaveBeenCalledWith("l1");
  });
});
