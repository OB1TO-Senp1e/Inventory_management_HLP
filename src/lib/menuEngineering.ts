/**
 * Menu engineering math (V2-02). Pure functions — no I/O, no Supabase.
 *
 * Sales quantities come from parsing the `notes` of `sale_deduction`
 * ledger movements. The `record_sales` RPC (P4-03) writes those notes in
 * the format:
 *
 *   Sale 2026-10-05: Butter Chicken x4, Dal Makhani x2.5
 *
 * (one `Sale <date>:` prefix, then `<dish name> x<qty>` segments joined
 * with ", "). Dish names are matched to menu items by exact name — names
 * are unique per restaurant, but a renamed dish no longer matches its
 * historical notes and is reported as an unknown dish. Dish names
 * containing ", " are not supported (they would split the segment list);
 * such names are documented as unsupported rather than silently
 * misattributed.
 *
 * Classification follows the standard Kasavana & Smith menu-engineering
 * quadrants, with the MEAN (average) as both axes, exactly as the task
 * specifies:
 *   - popularity axis: average quantity sold across classifiable dishes
 *   - profitability axis: average per-dish contribution margin
 *     (selling price − live recipe cost per dish)
 *   - Star:      qty >= avg popularity AND margin >= avg margin
 *   - Plowhorse: qty >= avg popularity AND margin <  avg margin
 *   - Puzzle:    qty <  avg popularity AND margin >= avg margin
 *   - Dog:       qty <  avg popularity AND margin <  avg margin
 *
 * A dish is classifiable only when it has a selling price AND a known
 * recipe cost. Dishes without a price, without a recipe, or whose name no
 * longer matches a menu item are shown in the table with an explicit
 * reason badge and are excluded from the quadrants — they cannot be
 * classified honestly.
 *
 * Live-data caveat: both the recipe cost and the selling price are the
 * CURRENT values (P4-02 costs are live, never snapshotted). A dish sold
 * before a price change or a recipe edit is evaluated at today's cost
 * and price — the UI states this plainly instead of faking precision.
 */

export type DishClassification = "star" | "plowhorse" | "puzzle" | "dog";

export type UnclassifiedReason = "no-recipe" | "price-not-set" | "unknown-dish";

export interface ParsedDishSale {
  name: string;
  qty: number;
}

/** Minimal menu-item shape the report needs (from `listMenuItems`). */
export interface MenuEngineeringMenuItem {
  id: string;
  name: string;
  active: boolean;
  /** Selling price in INR; null when not set. */
  sellingPrice: number | null;
  /** Live cost per dish in INR (full-yield cost / yield). */
  costPerDish: number;
  /** Number of recipe ingredient lines; 0 means the dish has no recipe. */
  ingredientCount: number;
}

export interface MenuEngineeringDishRow {
  /** Null when the dish name could not be matched to a menu item. */
  menuItemId: string | null;
  name: string;
  /** Null when the dish is unmatched. */
  active: boolean | null;
  qtySold: number;
  /** Null when unmatched or no selling price is set. */
  sellingPrice: number | null;
  /**
   * Null when unmatched, or when the dish has no recipe (a recipe-less
   * dish has UNKNOWN cost — never ₹0, which would fake a huge margin).
   */
  costPerDish: number | null;
  /** sellingPrice − costPerDish; null when either side is unknown. */
  contributionMargin: number | null;
  /** contributionMargin × qtySold; null when the margin is unknown. */
  totalContribution: number | null;
  /** Null when no selling price is set. */
  foodCostPct: number | null;
  /** Null when the dish cannot be classified honestly. */
  classification: DishClassification | null;
  unclassifiedReason: UnclassifiedReason | null;
}

export interface MenuEngineeringReport {
  /**
   * Classified rows first (by total contribution, descending), then
   * unclassified rows (by quantity sold, descending).
   */
  dishes: MenuEngineeringDishRow[];
  /** Mean quantity sold across classifiable dishes; 0 when none. */
  avgPopularity: number;
  /** Mean per-dish contribution margin across classifiable dishes; 0 when none. */
  avgMargin: number;
  /** Number of classifiable dishes. */
  classifiedCount: number;
  /** Σ qtySold over all rows (classified + unclassified). */
  totalDishesSold: number;
  /** Σ totalContribution over classifiable rows; 0 when none. */
  totalContribution: number;
}

const SALE_NOTES_RE = /^Sale\s+([^:]+):\s*(.+)$/;
const DISH_QTY_RE = /^(.*?)\s+x(\d+(?:\.\d+)?)$/;

/**
 * Parse one `sale_deduction` movement's notes into (dish name, quantity)
 * pairs. Returns [] for null/blank notes or notes that do not follow the
 * `record_sales` format (e.g. hand-written notes). Segments that do not
 * end in " x<qty>" are skipped rather than misattributed.
 */
export function parseSaleNotes(notes: string | null): ParsedDishSale[] {
  if (notes === null) {
    return [];
  }
  const match = SALE_NOTES_RE.exec(notes.trim());
  if (match === null) {
    return [];
  }
  const result: ParsedDishSale[] = [];
  for (const segment of match[2].split(/,\s*/)) {
    const dish = DISH_QTY_RE.exec(segment.trim());
    if (dish === null || dish[1].length === 0) {
      continue;
    }
    const qty = Number(dish[2]);
    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    result.push({ name: dish[1], qty });
  }
  return result;
}

/**
 * Classify one dish against the quadrant averages. Boundaries are
 * inclusive on the high side (>=), so a dish exactly on the average is a
 * Star — documented here so the rule cannot drift.
 */
export function classifyDish(
  qtySold: number,
  avgPopularity: number,
  contributionMargin: number,
  avgMargin: number,
): DishClassification {
  const popular = qtySold >= avgPopularity;
  const profitable = contributionMargin >= avgMargin;
  if (popular && profitable) {
    return "star";
  }
  if (popular) {
    return "plowhorse";
  }
  if (profitable) {
    return "puzzle";
  }
  return "dog";
}

function foodCostPct(
  costPerDish: number,
  sellingPrice: number | null,
): number | null {
  if (sellingPrice === null || sellingPrice <= 0) {
    return null;
  }
  return (costPerDish / sellingPrice) * 100;
}

/**
 * Build the menu engineering report from per-dish quantities sold (parsed
 * from ledger notes) and the restaurant's menu items with live costs.
 * Dishes are matched to menu items by exact name.
 */
export function buildMenuEngineeringReport(
  salesByDishName: Map<string, number>,
  menuItems: MenuEngineeringMenuItem[],
): MenuEngineeringReport {
  const byName = new Map<string, MenuEngineeringMenuItem>();
  for (const item of menuItems) {
    if (!byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }

  const rows: MenuEngineeringDishRow[] = [];
  for (const [name, qtySold] of salesByDishName) {
    const item = byName.get(name);
    if (item === undefined) {
      rows.push({
        menuItemId: null,
        name,
        active: null,
        qtySold,
        sellingPrice: null,
        costPerDish: null,
        contributionMargin: null,
        totalContribution: null,
        foodCostPct: null,
        classification: null,
        unclassifiedReason: "unknown-dish",
      });
      continue;
    }
    const hasRecipe = item.ingredientCount > 0;
    const costPerDish = hasRecipe ? item.costPerDish : null;
    const margin =
      item.sellingPrice !== null && costPerDish !== null
        ? item.sellingPrice - costPerDish
        : null;
    const totalContribution = margin !== null ? margin * qtySold : null;
    const unclassifiedReason: UnclassifiedReason | null = !hasRecipe
      ? "no-recipe"
      : item.sellingPrice === null
        ? "price-not-set"
        : null;
    rows.push({
      menuItemId: item.id,
      name,
      active: item.active,
      qtySold,
      sellingPrice: item.sellingPrice,
      costPerDish,
      contributionMargin: margin,
      totalContribution,
      foodCostPct:
        costPerDish !== null
          ? foodCostPct(costPerDish, item.sellingPrice)
          : null,
      // Classification needs the quadrant averages — filled in below.
      classification: null,
      unclassifiedReason,
    });
  }

  const classifiable = rows.filter(
    (row): row is MenuEngineeringDishRow & { contributionMargin: number } =>
      row.unclassifiedReason === null && row.contributionMargin !== null,
  );
  const classifiedCount = classifiable.length;
  const avgPopularity =
    classifiedCount === 0
      ? 0
      : classifiable.reduce((sum, row) => sum + row.qtySold, 0) /
        classifiedCount;
  const avgMargin =
    classifiedCount === 0
      ? 0
      : classifiable.reduce((sum, row) => sum + row.contributionMargin, 0) /
        classifiedCount;

  for (const row of classifiable) {
    row.classification = classifyDish(
      row.qtySold,
      avgPopularity,
      row.contributionMargin,
      avgMargin,
    );
  }

  const classified = rows
    .filter((row) => row.classification !== null)
    .sort(
      (a, b) => (b.totalContribution ?? 0) - (a.totalContribution ?? 0),
    );
  const unclassified = rows
    .filter((row) => row.classification === null)
    .sort((a, b) => b.qtySold - a.qtySold);

  return {
    dishes: [...classified, ...unclassified],
    avgPopularity,
    avgMargin,
    classifiedCount,
    totalDishesSold: rows.reduce((sum, row) => sum + row.qtySold, 0),
    totalContribution: classifiable.reduce(
      (sum, row) => sum + (row.totalContribution ?? 0),
      0,
    ),
  };
}

/** Human labels for the four quadrants, used by the chart and badges. */
export const CLASSIFICATION_LABELS: Record<DishClassification, string> = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog",
};

/** One-line guidance per quadrant for the report UI. */
export const CLASSIFICATION_GUIDANCE: Record<DishClassification, string> = {
  star: "High profit, high sales — protect these dishes.",
  plowhorse: "Low profit, high sales — raise the price or trim the cost.",
  puzzle: "High profit, low sales — promote or reposition.",
  dog: "Low profit, low sales — consider removing from the menu.",
};

export const UNCLASSIFIED_LABELS: Record<UnclassifiedReason, string> = {
  "no-recipe": "No recipe — cost unknown",
  "price-not-set": "Price not set",
  "unknown-dish": "Dish not found (renamed or removed)",
};
