import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmount the rendered tree after each test so queries never see
// elements from a previous test.
afterEach(() => {
  cleanup();
});
