import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { findItemByBarcode } from "@/api/stock";
import { useBarcodeLookup } from "./hooks";

// The API module is mocked: this test verifies hook wiring (delegation,
// result and error propagation) with zero network.
vi.mock("@/api/stock", () => ({
  findItemByBarcode: vi.fn(),
}));

const mockedFindItemByBarcode = vi.mocked(findItemByBarcode);

const ITEM = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  name: "Rice",
  unitSymbol: "kg",
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useBarcodeLookup", () => {
  it("delegates to findItemByBarcode and returns the item", async () => {
    mockedFindItemByBarcode.mockResolvedValue(ITEM);
    const { result } = renderHook(() => useBarcodeLookup(), { wrapper });
    result.current.mutate("8901234567890");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedFindItemByBarcode).toHaveBeenCalledWith({
      barcode: "8901234567890",
    });
    expect(result.current.data).toEqual(ITEM);
  });

  it("propagates null for unknown barcodes", async () => {
    mockedFindItemByBarcode.mockResolvedValue(null);
    const { result } = renderHook(() => useBarcodeLookup(), { wrapper });
    result.current.mutate("0000000000000");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("propagates lookup errors", async () => {
    mockedFindItemByBarcode.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useBarcodeLookup(), { wrapper });
    result.current.mutate("123");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("boom");
  });
});
