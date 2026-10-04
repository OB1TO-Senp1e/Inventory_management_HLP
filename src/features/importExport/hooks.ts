import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/useToast";
import { useAuth } from "@/features/auth/useAuth";
import { createItem, listItems, type Item } from "@/api/items";
import {
  createSupplier,
  listSuppliers,
  type Supplier,
} from "@/api/suppliers";
import { itemsQueryKey } from "@/features/items/hooks";
import { suppliersQueryKey } from "@/features/suppliers/hooks";
import {
  buildCsvContent,
  csvFilename,
  downloadCSV,
} from "@/lib/csv";
import {
  ITEM_CSV_HEADERS,
  itemToCsvRow,
  type ItemCsvInput,
} from "./itemCsv";
import {
  SUPPLIER_CSV_HEADERS,
  supplierToCsvRow,
  type SupplierCsvInput,
} from "./supplierCsv";

/**
 * CSV import/export hooks (P1-05). Export downloads every active record as
 * CSV; import creates records one by one through the existing create API
 * functions (so Zod validation, friendly errors and RLS all still apply),
 * collecting per-row failures into a result report instead of aborting.
 */

export interface ImportRow<TInput> {
  /** 1-based data-row number (excluding the header), for the report. */
  index: number;
  input: TInput;
}

export interface ImportFailure {
  index: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  failures: ImportFailure[];
}

const EXPORT_PAGE_SIZE = 100;

async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  for (;;) {
    const { rows, total } = await fetchPage(page);
    all.push(...rows);
    if (all.length >= total || rows.length === 0) {
      break;
    }
    page += 1;
  }
  return all;
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Download every active item as CSV. */
export function useExportItems() {
  const { success, error } = useToast();
  return useMutation({
    mutationFn: async (): Promise<Item[]> =>
      fetchAllPages((page) =>
        listItems({
          page,
          pageSize: EXPORT_PAGE_SIZE,
          active: true,
          sortColumn: "name",
          sortDirection: "asc",
        }).then(({ items, total }) => ({ rows: items, total })),
      ),
    onSuccess: (items) => {
      downloadCSV(
        csvFilename("items"),
        buildCsvContent([...ITEM_CSV_HEADERS], items.map(itemToCsvRow)),
      );
      success(`Exported ${pluralize(items.length, "item")}.`);
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : "Could not export items.");
    },
  });
}

/** Download every active supplier as CSV. */
export function useExportSuppliers() {
  const { success, error } = useToast();
  return useMutation({
    mutationFn: async (): Promise<Supplier[]> =>
      fetchAllPages((page) =>
        listSuppliers({
          page,
          pageSize: EXPORT_PAGE_SIZE,
          active: true,
          sortColumn: "name",
          sortDirection: "asc",
        }).then(({ suppliers, total }) => ({ rows: suppliers, total })),
      ),
    onSuccess: (suppliers) => {
      downloadCSV(
        csvFilename("suppliers"),
        buildCsvContent(
          [...SUPPLIER_CSV_HEADERS],
          suppliers.map(supplierToCsvRow),
        ),
      );
      success(`Exported ${pluralize(suppliers.length, "supplier")}.`);
    },
    onError: (err: unknown) => {
      error(
        err instanceof Error ? err.message : "Could not export suppliers.",
      );
    },
  });
}

export interface ImportInput<TInput> {
  rows: ImportRow<TInput>[];
  /** Called after each row — drives the progress indicator. */
  onProgress?: (done: number, total: number) => void;
}

function useImportBase<TInput>(
  queryKey: readonly string[],
  createOne: (restaurantId: string, input: TInput) => Promise<unknown>,
  noun: string,
) {
  const queryClient = useQueryClient();
  const { success, error } = useToast();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({
      rows,
      onProgress,
    }: ImportInput<TInput>): Promise<ImportResult> => {
      const restaurantId = profile?.restaurantId;
      if (!restaurantId) {
        throw new Error("Your profile is still loading. Please try again.");
      }
      const failures: ImportFailure[] = [];
      let imported = 0;
      for (const [i, row] of rows.entries()) {
        try {
          await createOne(restaurantId, row.input);
          imported += 1;
        } catch (err) {
          failures.push({
            index: row.index,
            message:
              err instanceof Error ? err.message : "Could not import this row.",
          });
        }
        onProgress?.(i + 1, rows.length);
      }
      return { imported, failures };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey });
      if (result.failures.length === 0) {
        success(`Imported ${pluralize(result.imported, noun)}.`);
      } else {
        success(
          `Imported ${pluralize(result.imported, noun)} — ` +
            `${pluralize(result.failures.length, "row")} failed. See the report below.`,
        );
      }
    },
    onError: (err: unknown) => {
      error(err instanceof Error ? err.message : `Could not import ${noun}s.`);
    },
  });
}

/** Import validated item rows (restaurantId injected from the profile). */
export function useImportItems() {
  return useImportBase<ItemCsvInput>(
    itemsQueryKey,
    (restaurantId, input) => createItem({ ...input, restaurantId }),
    "item",
  );
}

/** Import validated supplier rows (restaurantId injected from the profile). */
export function useImportSuppliers() {
  return useImportBase<SupplierCsvInput>(
    suppliersQueryKey,
    (restaurantId, input) => createSupplier({ ...input, restaurantId }),
    "supplier",
  );
}
