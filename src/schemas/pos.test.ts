import { describe, expect, it } from "vitest";
import {
  aggregateImportLines,
  importPosSalesSchema,
  posImportLineSchema,
} from "./pos";

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DISH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("posImportLineSchema", () => {
  it("accepts a well-formed line", () => {
    expect(
      posImportLineSchema.parse({
        externalSaleId: "pos-1",
        menuItemId: DISH_A,
        dishes: 4,
        soldAt: "2026-10-05T12:00:00+05:30",
      }),
    ).toMatchObject({ externalSaleId: "pos-1", dishes: 4 });
  });

  it("allows a null soldAt (provider may not send timestamps)", () => {
    const line = posImportLineSchema.parse({
      externalSaleId: "pos-1",
      menuItemId: DISH_A,
      dishes: 4,
      soldAt: null,
    });
    expect(line.soldAt).toBeNull();
  });

  it("rejects non-positive dishes and blank external ids", () => {
    expect(() =>
      posImportLineSchema.parse({
        externalSaleId: "pos-1",
        menuItemId: DISH_A,
        dishes: 0,
        soldAt: null,
      }),
    ).toThrow();
    expect(() =>
      posImportLineSchema.parse({
        externalSaleId: "  ",
        menuItemId: DISH_A,
        dishes: 1,
        soldAt: null,
      }),
    ).toThrow();
  });
});

describe("importPosSalesSchema", () => {
  const line = {
    externalSaleId: "pos-1",
    menuItemId: DISH_A,
    dishes: 2,
    soldAt: null,
  };

  it("accepts a valid import", () => {
    const parsed = importPosSalesSchema.parse({
      provider: "stub",
      saleDate: "2026-10-05",
      lines: [line],
    });
    expect(parsed.lines).toHaveLength(1);
  });

  it("rejects empty line arrays and bad dates", () => {
    expect(() =>
      importPosSalesSchema.parse({
        provider: "stub",
        saleDate: "2026-10-05",
        lines: [],
      }),
    ).toThrow("at least one sale");
    expect(() =>
      importPosSalesSchema.parse({
        provider: "stub",
        saleDate: "2026-13-99",
        lines: [line],
      }),
    ).toThrow();
  });
});

describe("aggregateImportLines", () => {
  it("sums dishes per menu item across POS sales", () => {
    expect(
      aggregateImportLines([
        { externalSaleId: "a", menuItemId: DISH_A, dishes: 2, soldAt: null },
        { externalSaleId: "b", menuItemId: DISH_A, dishes: 3, soldAt: null },
        { externalSaleId: "c", menuItemId: DISH_B, dishes: 1, soldAt: null },
      ]),
    ).toEqual([
      { menuItemId: DISH_A, dishes: 5 },
      { menuItemId: DISH_B, dishes: 1 },
    ]);
  });
});
