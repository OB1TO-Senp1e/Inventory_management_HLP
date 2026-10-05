import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceivableItem } from "@/api/stock";
import { BarcodeEntry } from "./BarcodeEntry";

const { lookupState, authState } = vi.hoisted(() => ({
  lookupState: {
    mutate: vi.fn() as unknown as (
      code: string,
      opts?: { onSuccess: (item: ReceivableItem | null) => void },
    ) => void,
    isPending: false,
    isError: false,
  },
  authState: { role: "owner" },
}));

vi.mock("./hooks", () => ({
  useBarcodeLookup: () => lookupState,
}));

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    profile: { id: "u-1", restaurantId: "r-1", role: authState.role },
  }),
}));

// The real camera overlay is covered by BarcodeScanner.test.tsx; here a
// stub reports a canned scan so the entry flow stays deterministic.
vi.mock("./BarcodeScanner", () => ({
  BarcodeScanner: ({
    onResult,
    onClose,
  }: {
    onResult: (code: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="scanner-stub">
      <button type="button" onClick={() => onResult("8901234567890")}>
        stub scan
      </button>
      <button type="button" onClick={onClose}>
        stub close
      </button>
    </div>
  ),
}));

const RICE: ReceivableItem = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  name: "Rice",
  unitSymbol: "kg",
};

function mockResolve(item: ReceivableItem | null) {
  lookupState.mutate = vi.fn(
    (
      _code: string,
      opts?: { onSuccess: (item: ReceivableItem | null) => void },
    ) => {
      opts?.onSuccess(item);
    },
  ) as typeof lookupState.mutate;
}

beforeEach(() => {
  vi.clearAllMocks();
  lookupState.isPending = false;
  lookupState.isError = false;
  authState.role = "owner";
  mockResolve(RICE);
});

function renderEntry(onResolved: (item: ReceivableItem) => void = vi.fn()) {
  const onResolvedMock = vi.fn(onResolved);
  render(
    <MemoryRouter>
      <BarcodeEntry onResolved={onResolvedMock} idPrefix="test" />
    </MemoryRouter>,
  );
  return { onResolvedMock };
}

describe("BarcodeEntry", () => {
  it("typed code resolves and notifies the parent", async () => {
    const { onResolvedMock } = renderEntry();
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "8901234567890" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(onResolvedMock).toHaveBeenCalledWith(RICE));
    expect(screen.getByText("Found: Rice (kg)")).toBeInTheDocument();
    // The input clears after a successful resolve.
    expect(screen.getByLabelText("Barcode")).toHaveValue("");
  });

  it("unknown barcode shows the not-found state with an Items link for owner/manager", async () => {
    mockResolve(null);
    renderEntry();
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "0000000000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() =>
      expect(
        screen.getByText(/No item found for barcode/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "go to Items" })).toHaveAttribute(
      "href",
      "/items",
    );
  });

  it("staff sees guidance without the Items link", async () => {
    authState.role = "staff";
    mockResolve(null);
    renderEntry();
    fireEvent.change(screen.getByLabelText("Barcode"), {
      target: { value: "0000000000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() =>
      expect(
        screen.getByText(/Ask an owner or manager/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: "go to Items" }),
    ).not.toBeInTheDocument();
  });

  it("scan button opens the scanner and a scan resolves", async () => {
    const { onResolvedMock } = renderEntry();
    fireEvent.click(screen.getByRole("button", { name: "Scan with camera" }));
    // The scanner chunk lazy-loads on demand.
    expect(await screen.findByTestId("scanner-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "stub scan" }));
    await waitFor(() => expect(onResolvedMock).toHaveBeenCalledWith(RICE));
    expect(screen.queryByTestId("scanner-stub")).not.toBeInTheDocument();
  });

  it("Find is disabled for a blank code", () => {
    renderEntry();
    expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
  });

  it("lookup errors show a retry affordance", async () => {
    lookupState.isError = true;
    renderEntry();
    expect(screen.getByText(/Couldn't look up the barcode/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "try again" }),
    ).toBeInTheDocument();
  });
});
