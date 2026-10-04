import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  convertibleUnits,
  isConvertibleUnit,
  type UnitConversion,
} from "./units";

const KG = "unit-kg";
const G = "unit-g";
const L = "unit-l";
const PCS = "unit-pcs";

const CONVERSIONS: UnitConversion[] = [
  { fromUnitId: G, toUnitId: KG, factor: 0.001 },
  { fromUnitId: KG, toUnitId: G, factor: 1000 },
  { fromUnitId: "unit-ml", toUnitId: L, factor: 0.001 },
];

const UNITS = [
  { id: KG, symbol: "kg" },
  { id: G, symbol: "g" },
  { id: L, symbol: "L" },
  { id: PCS, symbol: "pcs" },
];

describe("convertQuantity", () => {
  it("converts grams to kilograms", () => {
    expect(convertQuantity(500, G, KG, CONVERSIONS)).toBe(0.5);
  });

  it("converts kilograms to grams", () => {
    expect(convertQuantity(2, KG, G, CONVERSIONS)).toBe(2000);
  });

  it("returns the quantity unchanged for the same unit", () => {
    expect(convertQuantity(7, PCS, PCS, CONVERSIONS)).toBe(7);
  });

  it("returns null when no conversion exists", () => {
    expect(convertQuantity(1, PCS, KG, CONVERSIONS)).toBeNull();
  });

  it("does not follow transitive paths (v1 supports one hop only)", () => {
    // g -> kg exists and kg -> g exists, but g -> L does not.
    expect(convertQuantity(1, G, L, CONVERSIONS)).toBeNull();
  });
});

describe("isConvertibleUnit", () => {
  it("accepts the base unit itself", () => {
    expect(isConvertibleUnit(KG, KG, CONVERSIONS)).toBe(true);
  });

  it("accepts a directly convertible unit", () => {
    expect(isConvertibleUnit(G, KG, CONVERSIONS)).toBe(true);
  });

  it("rejects an unrelated unit", () => {
    expect(isConvertibleUnit(PCS, KG, CONVERSIONS)).toBe(false);
  });

  it("is directional: kg->g exists but ml->kg does not", () => {
    expect(isConvertibleUnit(KG, G, CONVERSIONS)).toBe(true);
    expect(isConvertibleUnit("unit-ml", KG, CONVERSIONS)).toBe(false);
  });
});

describe("convertibleUnits", () => {
  it("lists the base unit first, then convertible units", () => {
    const result = convertibleUnits(KG, UNITS, CONVERSIONS);
    expect(result.map((u) => u.symbol)).toEqual(["kg", "g"]);
  });

  it("excludes units with no conversion path", () => {
    const result = convertibleUnits(KG, UNITS, CONVERSIONS);
    expect(result.some((u) => u.symbol === "pcs")).toBe(false);
    expect(result.some((u) => u.symbol === "L")).toBe(false);
  });

  it("returns only the base unit when nothing converts", () => {
    const result = convertibleUnits(PCS, UNITS, CONVERSIONS);
    expect(result.map((u) => u.symbol)).toEqual(["pcs"]);
  });
});
