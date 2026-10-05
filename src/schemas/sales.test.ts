import { describe, expect, it } from "vitest";
import {
  aggregateSalesLines,
  recordSalesSchema,
  saleDateSchema,
  salesLineSchema,
  todayISODate,
} from "./sales";

const DISH_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DISH_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("saleDateSchema", () => {
  it("accepts a real date", () => {
    expect(saleDateSchema.parse("2026-10-05")).toBe("2026-10-05");
  });

  it("rejects the wrong shape", () => {
    expect(() => saleDateSchema.parse("05/10/2026")).toThrow();
    expect(() => saleDateSchema.parse("2026-13-01")).toThrow();
  });

  it("rejects a non-existent date", () => {
    expect(() => saleDateSchema.parse("2026-02-30")).toThrow(
      /not a real date/,
    );
  });
});

describe("salesLineSchema", () => {
  it("accepts a valid line and coerces string quantities", () => {
    expect(salesLineSchema.parse({ menuItemId: DISH_A, dishes: "4" })).toEqual({
      menuItemId: DISH_A,
      dishes: 4,
    });
  });

  it("rejects non-positive dish counts", () => {
    expect(() =>
      salesLineSchema.parse({ menuItemId: DISH_A, dishes: 0 }),
    ).toThrow(/greater than zero/);
    expect(() =>
      salesLineSchema.parse({ menuItemId: DISH_A, dishes: -2 }),
    ).toThrow(/greater than zero/);
  });

  it("rejects a non-uuid dish id", () => {
    expect(() =>
      salesLineSchema.parse({ menuItemId: "not-a-uuid", dishes: 2 }),
    ).toThrow(/Invalid identifier/);
  });
});

describe("recordSalesSchema", () => {
  it("accepts a valid entry", () => {
    const input = recordSalesSchema.parse({
      saleDate: "2026-10-05",
      lines: [
        { menuItemId: DISH_A, dishes: 4 },
        { menuItemId: DISH_B, dishes: 2 },
      ],
    });
    expect(input.lines).toHaveLength(2);
  });

  it("rejects an empty entry", () => {
    expect(() =>
      recordSalesSchema.parse({ saleDate: "2026-10-05", lines: [] }),
    ).toThrow(/at least one dish/);
  });

  it("rejects duplicate dishes in one entry", () => {
    expect(() =>
      recordSalesSchema.parse({
        saleDate: "2026-10-05",
        lines: [
          { menuItemId: DISH_A, dishes: 4 },
          { menuItemId: DISH_A, dishes: 2 },
        ],
      }),
    ).toThrow(/only once/);
  });
});

describe("aggregateSalesLines", () => {
  it("sums duplicate dishes into one line", () => {
    expect(
      aggregateSalesLines([
        { menuItemId: DISH_A, dishes: 4 },
        { menuItemId: DISH_B, dishes: 2 },
        { menuItemId: DISH_A, dishes: 1.5 },
      ]),
    ).toEqual([
      { menuItemId: DISH_A, dishes: 5.5 },
      { menuItemId: DISH_B, dishes: 2 },
    ]);
  });

  it("leaves unique lines untouched", () => {
    const lines = [{ menuItemId: DISH_A, dishes: 4 }];
    expect(aggregateSalesLines(lines)).toEqual(lines);
  });
});

describe("todayISODate", () => {
  it("returns today's date as YYYY-MM-DD", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(todayISODate()).toBe(expected);
    expect(saleDateSchema.safeParse(todayISODate()).success).toBe(true);
  });
});
