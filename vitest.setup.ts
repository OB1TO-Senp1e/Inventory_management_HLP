import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmount the rendered tree after each test so queries never see
// elements from a previous test.
afterEach(() => {
  cleanup();
});

// Recharts' ResponsiveContainer observes its parent size; jsdom has no
// ResizeObserver, so stub it with a fixed size for chart tests.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
