import { describe, expect, it } from "vitest";
import {
  buildMenuEngineeringReport,
  classifyDish,
  parseSaleNotes,
  type MenuEngineeringMenuItem,
} from "./menuEngineering";

describe("parseSaleNotes", () => {
  it("parses the record_sales format with a single dish", () => {
    expect(parseSaleNotes("Sale 2026-10-05: Butter Chicken x4")).toEqual([
      { name: "Butter Chicken", qty: 4 },
    ]);
  });

  it("parses multiple dishes and decimal quantities", () => {
    expect(
      parseSaleNotes("Sale 2026-10-05: Butter Chicken x4, Dal Makhani x2.5"),
    ).toEqual([
      { name: "Butter Chicken", qty: 4 },
      { name: "Dal Makhani", qty: 2.5 },
    ]);
  });

  it("accepts the legacy stub format with a non-date sale label", () => {
    expect(parseSaleNotes("Sale today: Butter Chicken x4")).toEqual([
      { name: "Butter Chicken", qty: 4 },
    ]);
  });

  it("returns [] for null, blank, or non-sale notes", () => {
    expect(parseSaleNotes(null)).toEqual([]);
    expect(parseSaleNotes("")).toEqual([]);
    expect(parseSaleNotes("hand-written note")).toEqual([]);
    expect(parseSaleNotes("Sale 2026-10-05")).toEqual([]);
  });

  it("skips segments without a trailing x<qty> instead of misattributing", () => {
    expect(parseSaleNotes("Sale 2026-10-05: Butter Chicken, Dal Makhani x2")).toEqual([
      { name: "Dal Makhani", qty: 2 },
    ]);
  });

  it("matches the qty at the end of the segment (dish names may contain x)", () => {
    expect(parseSaleNotes("Sale 2026-10-05: Chicken x4 Special x2")).toEqual([
      { name: "Chicken x4 Special", qty: 2 },
    ]);
  });

  it("ignores non-positive quantities", () => {
    expect(parseSaleNotes("Sale 2026-10-05: Free Sample x0")).toEqual([]);
  });
});

describe("classifyDish", () => {
  it("classifies the four quadrants", () => {
    expect(classifyDish(10, 5, 100, 50)).toBe("star");
    expect(classifyDish(10, 5, 20, 50)).toBe("plowhorse");
    expect(classifyDish(2, 5, 100, 50)).toBe("puzzle");
    expect(classifyDish(2, 5, 20, 50)).toBe("dog");
  });

  it("is inclusive on the high side: exactly average is a Star", () => {
    expect(classifyDish(5, 5, 50, 50)).toBe("star");
  });

  it("handles negative margins (dish sold below cost)", () => {
    expect(classifyDish(10, 5, -10, 50)).toBe("plowhorse");
    expect(classifyDish(2, 5, -10, 50)).toBe("dog");
  });
});

function menuItem(
  overrides: Partial<MenuEngineeringMenuItem> & { name: string },
): MenuEngineeringMenuItem {
  return {
    id: `id-${overrides.name}`,
    active: true,
    sellingPrice: 199,
    costPerDish: 30.75,
    ingredientCount: 2,
    ...overrides,
  };
}

describe("buildMenuEngineeringReport", () => {
  it("classifies dishes against the mean popularity and margin", () => {
    const report = buildMenuEngineeringReport(
      new Map([
        ["Butter Chicken", 4],
        ["Dal Makhani", 6],
      ]),
      [
        menuItem({ name: "Butter Chicken", sellingPrice: 199, costPerDish: 30.75 }),
        menuItem({ name: "Dal Makhani", sellingPrice: 149, costPerDish: 8 }),
      ],
    );
    // avg popularity = 5, avg margin = (168.25 + 141) / 2 = 154.625
    expect(report.classifiedCount).toBe(2);
    expect(report.avgPopularity).toBe(5);
    expect(report.avgMargin).toBeCloseTo(154.625, 5);
    const byName = new Map(report.dishes.map((d) => [d.name, d]));
    expect(byName.get("Butter Chicken")?.classification).toBe("puzzle");
    expect(byName.get("Dal Makhani")?.classification).toBe("plowhorse");
    expect(byName.get("Butter Chicken")?.contributionMargin).toBeCloseTo(168.25, 5);
    expect(byName.get("Butter Chicken")?.totalContribution).toBeCloseTo(673, 5);
    expect(byName.get("Butter Chicken")?.foodCostPct).toBeCloseTo(15.452, 2);
    // Classified rows come first, sorted by total contribution desc.
    expect(report.dishes[0].name).toBe("Dal Makhani");
    expect(report.dishes[1].name).toBe("Butter Chicken");
    expect(report.totalDishesSold).toBe(10);
    expect(report.totalContribution).toBeCloseTo(1519, 5);
  });

  it("a single dish is a Star (it is its own average)", () => {
    const report = buildMenuEngineeringReport(
      new Map([["Butter Chicken", 4]]),
      [menuItem({ name: "Butter Chicken" })],
    );
    expect(report.dishes[0].classification).toBe("star");
  });

  it("marks recipe-less dishes as cost-unknown, never ₹0", () => {
    const report = buildMenuEngineeringReport(
      new Map([["Mystery Thali", 8]]),
      [
        menuItem({
          name: "Mystery Thali",
          sellingPrice: 299,
          costPerDish: 0,
          ingredientCount: 0,
        }),
      ],
    );
    const row = report.dishes[0];
    expect(row.costPerDish).toBeNull();
    expect(row.contributionMargin).toBeNull();
    expect(row.classification).toBeNull();
    expect(row.unclassifiedReason).toBe("no-recipe");
    expect(report.classifiedCount).toBe(0);
  });

  it("marks dishes without a selling price as unclassifiable", () => {
    const report = buildMenuEngineeringReport(
      new Map([["Unpriced Dish", 8]]),
      [menuItem({ name: "Unpriced Dish", sellingPrice: null })],
    );
    const row = report.dishes[0];
    expect(row.classification).toBeNull();
    expect(row.unclassifiedReason).toBe("price-not-set");
    expect(row.foodCostPct).toBeNull();
  });

  it("marks renamed/removed dishes as unknown with their quantities kept", () => {
    const report = buildMenuEngineeringReport(
      new Map([["Old Name", 3]]),
      [menuItem({ name: "New Name" })],
    );
    const row = report.dishes[0];
    expect(row.menuItemId).toBeNull();
    expect(row.qtySold).toBe(3);
    expect(row.classification).toBeNull();
    expect(row.unclassifiedReason).toBe("unknown-dish");
    // Unclassified rows sort after classified ones.
    expect(report.totalDishesSold).toBe(3);
  });

  it("aggregates duplicate dish names from multiple movements", () => {
    const sales = new Map<string, number>();
    for (const sale of parseSaleNotes("Sale 2026-10-05: Butter Chicken x4")) {
      sales.set(sale.name, (sales.get(sale.name) ?? 0) + sale.qty);
    }
    for (const sale of parseSaleNotes("Sale 2026-10-06: Butter Chicken x2")) {
      sales.set(sale.name, (sales.get(sale.name) ?? 0) + sale.qty);
    }
    const report = buildMenuEngineeringReport(sales, [
      menuItem({ name: "Butter Chicken" }),
    ]);
    expect(report.dishes[0].qtySold).toBe(6);
  });

  it("returns an empty report when nothing was sold", () => {
    const report = buildMenuEngineeringReport(new Map(), [
      menuItem({ name: "Butter Chicken" }),
    ]);
    expect(report.dishes).toEqual([]);
    expect(report.classifiedCount).toBe(0);
    expect(report.avgPopularity).toBe(0);
    expect(report.avgMargin).toBe(0);
    expect(report.totalDishesSold).toBe(0);
    expect(report.totalContribution).toBe(0);
  });
});
