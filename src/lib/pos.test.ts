import { describe, expect, it } from "vitest";
import {
  getPosProvider,
  normalizePosPayload,
  POS_PROVIDERS,
  stubPosProvider,
} from "./pos";

describe("normalizePosPayload", () => {
  it("normalizes valid rows", () => {
    const { lines, skipped } = normalizePosPayload([
      {
        externalSaleId: " s-1 ",
        soldAt: "2026-10-05T12:00:00+05:30",
        dishName: " Butter Chicken ",
        quantity: 4,
      },
    ]);
    expect(skipped).toBe(0);
    expect(lines).toEqual([
      {
        externalSaleId: "s-1",
        soldAt: "2026-10-05T12:00:00+05:30",
        dishName: "Butter Chicken",
        quantity: 4,
      },
    ]);
  });

  it("rejects zero and negative quantities", () => {
    const { lines, skipped } = normalizePosPayload([
      { externalSaleId: "a", soldAt: "2026-10-05T12:00:00Z", dishName: "X", quantity: 0 },
      { externalSaleId: "b", soldAt: "2026-10-05T12:00:00Z", dishName: "Y", quantity: -2 },
      { externalSaleId: "c", soldAt: "2026-10-05T12:00:00Z", dishName: "Z", quantity: 1 },
    ]);
    expect(lines.map((l) => l.externalSaleId)).toEqual(["c"]);
    expect(skipped).toBe(2);
  });

  it("rejects blank ids, blank names and bad timestamps", () => {
    const { lines, skipped } = normalizePosPayload([
      { externalSaleId: "  ", soldAt: "2026-10-05T12:00:00Z", dishName: "X", quantity: 1 },
      { externalSaleId: "a", soldAt: "not-a-date", dishName: "X", quantity: 1 },
      { externalSaleId: "b", soldAt: "2026-10-05T12:00:00Z", dishName: "  ", quantity: 1 },
      { externalSaleId: "c", soldAt: "2026-10-05T12:00:00Z", dishName: "X", quantity: "3" },
    ]);
    expect(lines.map((l) => l.externalSaleId)).toEqual(["c"]);
    expect(lines[0].quantity).toBe(3);
    expect(skipped).toBe(3);
  });

  it("rejects non-array payloads", () => {
    expect(() => normalizePosPayload({ nope: true })).toThrow();
  });
});

describe("stubPosProvider", () => {
  it("is registered and clearly labeled as a demo", () => {
    expect(POS_PROVIDERS.map((p) => p.id)).toContain("stub");
    expect(stubPosProvider.description).toMatch(/demo/i);
  });

  it("returns sales within the requested range only", async () => {
    const lines = await stubPosProvider.fetchSales({
      from: "2000-01-01",
      to: "2000-01-02",
    });
    expect(lines).toEqual([]);

    const wide = await stubPosProvider.fetchSales({
      from: "2000-01-01",
      to: "2999-01-01",
    });
    expect(wide.length).toBeGreaterThan(0);
    for (const line of wide) {
      expect(line.externalSaleId).toMatch(/^stub-/);
      expect(line.quantity).toBeGreaterThan(0);
      expect(new Date(line.soldAt).toString()).not.toBe("Invalid Date");
    }
  });

  it("includes an unmatched dish and a case-variant dish for the preview flows", async () => {
    const wide = await stubPosProvider.fetchSales({
      from: "2000-01-01",
      to: "2999-01-01",
    });
    const names = wide.map((l) => l.dishName);
    expect(names).toContain("Paneer Lababdar");
    expect(names).toContain("butter chicken");
  });
});

describe("getPosProvider", () => {
  it("resolves known ids and null for unknown ids", () => {
    expect(getPosProvider("stub")).toBe(stubPosProvider);
    expect(getPosProvider("petpooja")).toBeNull();
  });
});
