import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { AlertPreferencesSection } from "./AlertPreferencesSection";
import {
  getAlertPreferences,
  updateAlertPreferences,
} from "@/api/notifications";

vi.mock("@/api/notifications", () => ({
  getAlertPreferences: vi.fn(),
  updateAlertPreferences: vi.fn(),
}));

const mockedGet = vi.mocked(getAlertPreferences);
const mockedUpdate = vi.mocked(updateAlertPreferences);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const PREFS = {
  lowStockEnabled: true,
  expiryEnabled: true,
  expiryDaysWindow: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AlertPreferencesSection", () => {
  it("loads and reflects the saved preferences", async () => {
    mockedGet.mockResolvedValue({
      lowStockEnabled: false,
      expiryEnabled: true,
      expiryDaysWindow: 14,
    });
    render(<AlertPreferencesSection />, { wrapper });
    expect(
      await screen.findByRole("switch", { name: "Low-stock alerts" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", { name: "Expiring-soon alerts" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Expiry alert window (days)")).toHaveValue(14);
  });

  it("saves changed preferences", async () => {
    mockedGet.mockResolvedValue(PREFS);
    mockedUpdate.mockResolvedValue({
      ...PREFS,
      lowStockEnabled: false,
      expiryDaysWindow: 14,
    });
    render(<AlertPreferencesSection />, { wrapper });
    fireEvent.click(
      await screen.findByRole("switch", { name: "Low-stock alerts" }),
    );
    const input = screen.getByLabelText("Expiry alert window (days)");
    fireEvent.change(input, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith({
        lowStockEnabled: false,
        expiryEnabled: true,
        expiryDaysWindow: 14,
      });
    });
  });

  it("keeps the save button disabled until something changes", async () => {
    mockedGet.mockResolvedValue(PREFS);
    render(<AlertPreferencesSection />, { wrapper });
    const save = await screen.findByRole("button", {
      name: "Save preferences",
    });
    expect(save).toBeDisabled();
  });

  it("rejects an out-of-range window without calling the API", async () => {
    mockedGet.mockResolvedValue(PREFS);
    render(<AlertPreferencesSection />, { wrapper });
    const input = await screen.findByLabelText("Expiry alert window (days)");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(
      await screen.findByText(
        "Enter a whole number of days between 1 and 90.",
      ),
    ).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("shows an error state with retry", async () => {
    mockedGet.mockRejectedValueOnce(new Error("offline"));
    mockedGet.mockResolvedValueOnce(PREFS);
    render(<AlertPreferencesSection />, { wrapper });
    expect(
      await screen.findByText("Couldn't load alert preferences."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Low-stock alerts" }),
      ).toBeInTheDocument();
    });
  });
});
