import { useMutation } from "@tanstack/react-query";
import {
  findItemByBarcode,
  type ReceivableItem,
} from "@/api/stock";

/**
 * Barcode lookup hook (V2-01). Components never call the API module
 * directly. A lookup is user-triggered (scan or typed code), so it is a
 * mutation rather than a query — no cache key to manage, and the caller
 * gets loading/success/error states for free.
 *
 * Returns the resolved item (id + name + unit symbol, cost-free) or null
 * when the barcode is unknown.
 */
export function useBarcodeLookup() {
  return useMutation<ReceivableItem | null, Error, string>({
    mutationFn: (barcode) => findItemByBarcode({ barcode }),
  });
}
