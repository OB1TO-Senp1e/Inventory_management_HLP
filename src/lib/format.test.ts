import { describe, expect, it } from "vitest";
import { formatDate, formatINR, formatNumber } from "./format";

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

describe("formatNumber", () => {
  it("groups digits Indian-style", () => {
    expect(formatNumber(100000)).toBe("1,00,000");
  });

  it("formats zero and small numbers plainly", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
  });

  it("keeps up to two decimal places", () => {
    expect(formatNumber(2.5)).toBe("2.5");
  });
});

describe("formatDate", () => {
  it("formats a date-only string without timezone day-shift", () => {
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("passes through full ISO strings", () => {
    expect(formatDate("2026-01-05T10:00:00Z")).toBe("5 Jan 2026");
  });
});
