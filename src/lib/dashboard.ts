/**
 * Pure dashboard math (P5-03). The API layer fetches raw rows; everything
 * below is unit-testable aggregation with no I/O.
 */

export interface MovementForSummary {
  itemId: string;
  movementType: string;
  /** Signed ledger quantity (negative for usage/wastage deductions). */
  quantity: number;
}

export interface MovementSummary {
  lines: number;
  /** Total absolute quantity, in base units. */
  quantity: number;
  /** ₹ value lost = Σ |qty| × avg_unit_cost (items without a cost count 0). */
  value: number;
}

export interface StockForValue {
  itemId: string;
  quantity: number;
}

/**
 * Summarize one movement type (usage or wastage): line count, absolute
 * quantity, and ₹ value lost using each item's average unit cost.
 */
export function summarizeMovements(
  movements: MovementForSummary[],
  costsByItem: Map<string, number | null>,
  movementType: string,
): MovementSummary {
  let lines = 0;
  let quantity = 0;
  let value = 0;
  for (const m of movements) {
    if (m.movementType !== movementType) {
      continue;
    }
    const qty = Math.abs(m.quantity);
    lines += 1;
    quantity += qty;
    value += qty * (costsByItem.get(m.itemId) ?? 0);
  }
  return { lines, quantity, value };
}

/**
 * Total stock value = Σ current quantity × avg_unit_cost over the given
 * items. Items without a recorded cost contribute 0.
 */
export function computeStockValue(
  stock: StockForValue[],
  costsByItem: Map<string, number | null>,
): number {
  let total = 0;
  for (const row of stock) {
    total += row.quantity * (costsByItem.get(row.itemId) ?? 0);
  }
  return total;
}
