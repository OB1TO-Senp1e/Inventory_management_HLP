/**
 * Unit conversion math (P4-01). Pure functions over the explicit
 * `unit_conversions` rows: qty_in_to_unit = qty_in_from_unit * factor.
 *
 * Only DIRECT (one-hop) conversions are supported in v1 — the same rule
 * the database trigger enforces. The recipe builder offers an item's base
 * unit plus directly-convertible units, so a missing conversion is a
 * validation error, never silent.
 */

export interface UnitConversion {
  fromUnitId: string;
  toUnitId: string;
  factor: number;
}

/**
 * Convert a quantity from one unit to another. Returns null when no
 * conversion path exists (same unit always converts 1:1).
 */
export function convertQuantity(
  quantity: number,
  fromUnitId: string,
  toUnitId: string,
  conversions: UnitConversion[],
): number | null {
  if (fromUnitId === toUnitId) {
    return quantity;
  }
  const conversion = conversions.find(
    (c) => c.fromUnitId === fromUnitId && c.toUnitId === toUnitId,
  );
  if (!conversion) {
    return null;
  }
  return quantity * conversion.factor;
}

/**
 * True when `unitId` may be used for an ingredient of an item whose base
 * unit is `baseUnitId`: same unit or a direct conversion exists.
 */
export function isConvertibleUnit(
  unitId: string,
  baseUnitId: string,
  conversions: UnitConversion[],
): boolean {
  return convertQuantity(1, unitId, baseUnitId, conversions) !== null;
}

/**
 * Units an ingredient may use for an item: its base unit first, then every
 * directly-convertible unit. `allUnits` are `{id, symbol}` pairs.
 */
export function convertibleUnits(
  baseUnitId: string,
  allUnits: { id: string; symbol: string }[],
  conversions: UnitConversion[],
): { id: string; symbol: string }[] {
  const base = allUnits.find((u) => u.id === baseUnitId);
  const others = allUnits.filter(
    (u) =>
      u.id !== baseUnitId &&
      conversions.some(
        (c) => c.fromUnitId === u.id && c.toUnitId === baseUnitId,
      ),
  );
  return [...(base ? [base] : []), ...others];
}
