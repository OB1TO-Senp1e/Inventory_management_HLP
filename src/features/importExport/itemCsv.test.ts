import { describe, expect, it } from "vitest";
import {
  ITEM_CSV_HEADERS,
  itemToCsvRow,
  resolveItemRow,
  type ItemLookups,
} from "./itemCsv";
import type { Item } from "@/api/items";

const lookups: ItemLookups = {
  categories: [
    { id: "11111111-1111-1111-1111-111111111111", name: "Vegetables" },
  ],
  locations: [{ id: "22222222-2222-2222-2222-222222222222", name: "Dry Store" }],
  units: [
    {
      id: "33333333-3333-3333-3333-333333333333",
      name: "kilogram",
      symbol: "kg",
    },
  ],
};

const CAT_ID = "11111111-1111-1111-1111-111111111111";
const LOC_ID = "22222222-2222-2222-2222-222222222222";
const UNIT_ID = "33333333-3333-3333-3333-333333333333";

function record(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: "Tomato",
    category: "Vegetables",
    unit: "kg",
    storage_location: "Dry Store",
    par_level: "10",
    reorder_point: "4",
    ...overrides,
  };
}

describe("resolveItemRow", () => {
  it("resolves a fully valid row to a create input", () => {
    const result = resolveItemRow(record(), lookups);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      name: "Tomato",
      categoryId: CAT_ID,
      unitId: UNIT_ID,
      storageLocationId: LOC_ID,
      parLevel: 10,
      reorderPoint: 4,
    });
  });

  it("matches units by name or symbol, case-insensitively", () => {
    for (const unit of ["kg", "KG", "kilogram", "Kilogram", " kg "]) {
      const result = resolveItemRow(record({ unit }), lookups);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.input.unitId).toBe(UNIT_ID);
      }
    }
  });

  it("treats optional lookups as empty when blank", () => {
    const result = resolveItemRow(
      record({ category: "", storage_location: "", par_level: "", reorder_point: "" }),
      lookups,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.categoryId).toBeNull();
    expect(result.input.storageLocationId).toBeNull();
    expect(result.input.parLevel).toBe(0);
    expect(result.input.reorderPoint).toBe(0);
  });

  it("reports an unknown category with a pointer to Settings", () => {
    const result = resolveItemRow(record({ category: "Spices" }), lookups);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/unknown category "Spices"/i);
    expect(result.errors[0]).toMatch(/settings/i);
  });

  it("reports an unknown unit once, without duplicate Zod noise", () => {
    const result = resolveItemRow(record({ unit: "litre" }), lookups);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['Unknown unit "litre".']);
  });

  it("reports an unknown storage location", () => {
    const result = resolveItemRow(record({ storage_location: "Attic" }), lookups);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/unknown storage location "Attic"/i);
  });

  it("surfaces Zod errors for missing name and missing unit", () => {
    const result = resolveItemRow(record({ name: "", unit: "" }), lookups);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("Enter an item name.");
    expect(result.errors).toContain("Choose a unit.");
  });

  it("surfaces Zod errors for non-numeric levels", () => {
    const result = resolveItemRow(record({ par_level: "abc" }), lookups);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects negative levels", () => {
    const result = resolveItemRow(record({ par_level: "-5" }), lookups);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("Cannot be negative.");
  });
});

describe("itemToCsvRow", () => {
  it("emits cells in ITEM_CSV_HEADERS order, round-trippable", () => {
    const item = {
      id: "x",
      name: "Tomato",
      categoryId: "cat-1",
      categoryName: "Vegetables",
      unitId: "unit-1",
      unitName: "kilogram",
      unitSymbol: "kg",
      storageLocationId: "loc-1",
      storageLocationName: "Dry Store",
      parLevel: 10,
      reorderPoint: 4,
      active: true,
      avgUnitCost: 0,
      barcode: null,
      createdAt: "",
      updatedAt: "",
    } satisfies Item;
    const row = itemToCsvRow(item);
    expect(row).toHaveLength(ITEM_CSV_HEADERS.length);
    expect(row).toEqual(["Tomato", "Vegetables", "kg", "Dry Store", "10", "4"]);

    // The exported row re-imports cleanly (symbol resolves back to the unit).
    const back = resolveItemRow(
      Object.fromEntries(ITEM_CSV_HEADERS.map((h, i) => [h, row[i] ?? ""])),
      lookups,
    );
    expect(back.ok).toBe(true);
  });

  it("emits empty strings for missing optionals", () => {
    const item = {
      id: "x",
      name: "Salt",
      categoryId: null,
      categoryName: null,
      unitId: "unit-1",
      unitName: "kilogram",
      unitSymbol: "kg",
      storageLocationId: null,
      storageLocationName: null,
      parLevel: 0,
      reorderPoint: 0,
      active: true,
      avgUnitCost: 0,
      barcode: null,
      createdAt: "",
      updatedAt: "",
    } satisfies Item;
    expect(itemToCsvRow(item)).toEqual(["Salt", "", "kg", "", "0", "0"]);
  });
});
