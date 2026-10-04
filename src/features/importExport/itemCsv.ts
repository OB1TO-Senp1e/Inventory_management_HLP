import type { Item, LookupOption } from "@/api/items";
import {
  createItemSchema,
  type CreateItemInput,
} from "@/schemas/item";
import type { CsvColumnDef, ResolvedRow } from "./csvTypes";

/**
 * Item CSV mapping (P1-05). Columns are human-friendly: category, unit and
 * storage location are matched by NAME (unit also by symbol), case-
 * insensitively. Unresolvable names are row errors shown in the import
 * preview — never silently dropped or auto-created.
 */

export const ITEM_CSV_HEADERS = [
  "name",
  "category",
  "unit",
  "storage_location",
  "par_level",
  "reorder_point",
] as const;

export const ITEM_CSV_COLUMNS: CsvColumnDef[] = [
  {
    header: "name",
    required: true,
    description: "Item name — must be unique.",
  },
  {
    header: "category",
    required: false,
    description: "Category name, e.g. Vegetables. Must already exist under Settings.",
  },
  {
    header: "unit",
    required: true,
    description: "Unit name or symbol, e.g. kg or kilogram.",
  },
  {
    header: "storage_location",
    required: false,
    description: "Storage location name, e.g. Dry Store. Must already exist under Settings.",
  },
  {
    header: "par_level",
    required: false,
    description: "Par level number. Defaults to 0.",
  },
  {
    header: "reorder_point",
    required: false,
    description: "Reorder point number. Defaults to 0.",
  },
];

export interface ItemLookups {
  categories: LookupOption[];
  locations: LookupOption[];
  units: LookupOption[];
}

function findByName(
  options: LookupOption[],
  name: string,
): LookupOption | undefined {
  const needle = name.trim().toLowerCase();
  return options.find((o) => o.name.trim().toLowerCase() === needle);
}

function findUnit(
  units: LookupOption[],
  name: string,
): LookupOption | undefined {
  const needle = name.trim().toLowerCase();
  return units.find(
    (u) =>
      u.name.trim().toLowerCase() === needle ||
      (u.symbol ?? "").trim().toLowerCase() === needle,
  );
}

export type ItemCsvInput = Omit<CreateItemInput, "restaurantId">;

/**
 * Resolve one CSV record (header-keyed) to a validated create-item input.
 * Name lookups are resolved first; Zod validates the rest. Lookup failures
 * produce their own message and suppress the duplicate Zod complaint for
 * the same field.
 */
export function resolveItemRow(
  record: Record<string, string>,
  lookups: ItemLookups,
): ResolvedRow<ItemCsvInput> {
  const errors: string[] = [];
  /** Zod fields whose failure is already explained by a lookup error. */
  const explained = new Set<string>();
  const get = (key: string): string => (record[key] ?? "").trim();

  let categoryId: string | null = null;
  const categoryName = get("category");
  if (categoryName !== "") {
    const found = findByName(lookups.categories, categoryName);
    if (!found) {
      errors.push(
        `Unknown category "${categoryName}". Add it under Settings → Categories first.`,
      );
    } else {
      categoryId = found.id;
    }
  }

  let unitId = "";
  const unitName = get("unit");
  if (unitName !== "") {
    const found = findUnit(lookups.units, unitName);
    if (!found) {
      errors.push(`Unknown unit "${unitName}".`);
      explained.add("unitId");
    } else {
      unitId = found.id;
    }
  }

  let storageLocationId: string | null = null;
  const locationName = get("storage_location");
  if (locationName !== "") {
    const found = findByName(lookups.locations, locationName);
    if (!found) {
      errors.push(
        `Unknown storage location "${locationName}". Add it under Settings → Storage locations first.`,
      );
    } else {
      storageLocationId = found.id;
    }
  }

  const candidate = {
    name: get("name"),
    categoryId,
    unitId,
    storageLocationId,
    parLevel: get("par_level") === "" ? 0 : get("par_level"),
    reorderPoint: get("reorder_point") === "" ? 0 : get("reorder_point"),
  };

  const parsed = createItemSchema.omit({ restaurantId: true }).safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && explained.has(field)) {
        continue;
      }
      errors.push(issue.message);
    }
    return { ok: false, errors };
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, input: parsed.data };
}

/** One export row per item, matching ITEM_CSV_HEADERS order. */
export function itemToCsvRow(item: Item): string[] {
  return [
    item.name,
    item.categoryName ?? "",
    item.unitSymbol || item.unitName,
    item.storageLocationName ?? "",
    String(item.parLevel),
    String(item.reorderPoint),
  ];
}
