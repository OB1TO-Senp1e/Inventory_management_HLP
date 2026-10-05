import { describe, expect, it } from "vitest";
import { defaultReportRange, reportRangeSchema } from "./reports";
import { todayISODateIST } from "@/lib/datetime";

describe("reportRangeSchema", () => {
  it("accepts a valid range", () => {
    expect(
      reportRangeSchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
    ).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("rejects an inverted range", () => {
    const parsed = reportRangeSchema.safeParse({
      from: "2026-10-31",
      to: "2026-10-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(
      reportRangeSchema.safeParse({ from: "10/01/2026", to: "2026-10-31" })
        .success,
    ).toBe(false);
  });
});

describe("defaultReportRange", () => {
  it("covers the last 30 days including today", () => {
    const range = defaultReportRange();
    expect(range.to).toBe(todayISODateIST());
    expect(range.from <= range.to).toBe(true);
    const days =
      (new Date(`${range.to}T00:00:00Z`).getTime() -
        new Date(`${range.from}T00:00:00Z`).getTime()) /
      86_400_000;
    expect(days).toBe(29);
  });
});
