import { describe, expect, it } from "vitest";
import { formatINR } from "./format";

describe("formatINR", () => {
  it("formats an amount in en-IN rupee style", () => {
    expect(formatINR(1234.5)).toBe("₹1,234.50");
  });

  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0.00");
  });

  it("groups large amounts Indian-style", () => {
    expect(formatINR(12345678)).toBe("₹1,23,45,678.00");
  });
});
