import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePurchaseOrder, useRestaurantName } from "./hooks";
import { formatDate, formatINR } from "@/lib/format";

/**
 * Print-friendly purchase order (P3-04). Owner/manager only — POs carry costs.
 *
 * Renders the PO as a clean document: buyer (restaurant), supplier (+GSTIN),
 * PO meta, line items with snapshotted prices, subtotal, GST, grand total.
 * `@media print` CSS (see src/index.css) hides the app chrome so
 * window.print() produces a clean single document.
 *
 * GST is the rate snapshotted on the PO at creation (purchase_orders.gst_rate);
 * the print view never invents a rate.
 */
export function PurchaseOrderPrintPage() {
  const { id } = useParams<{ id: string }>();
  const poQuery = usePurchaseOrder(id ?? null);
  const restaurantQuery = useRestaurantName();
  const po = poQuery.data ?? null;

  // Auto-open the print dialog when the document is ready. Guarded so the
  // back button still works if the user cancels printing.
  useEffect(() => {
    if (po && restaurantQuery.data) {
      const timer = window.setTimeout(() => window.print(), 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [po, restaurantQuery.data]);

  if (poQuery.isLoading || restaurantQuery.isLoading) {
    return (
      <div className="print:hidden">
        <div className="space-y-2" aria-label="Loading purchase order" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (poQuery.isError || !po) {
    return (
      <div className="print:hidden">
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            {poQuery.isError ? "Could not load this purchase order." : "Purchase order not found."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {poQuery.isError && (
              <Button variant="outline" onClick={() => poQuery.refetch()}>
                Retry
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/purchase-orders">Back to list</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const restaurantName = restaurantQuery.data ?? "Restaurant";
  const poNumber = po.id.slice(0, 8).toUpperCase();

  return (
    <div>
      {/* Screen-only toolbar — hidden in print. */}
      <div className="mb-6 flex items-center gap-2 print:hidden">
        <Button variant="outline" asChild className="min-h-[44px]">
          <Link to={`/purchase-orders/${po.id}`}>
            <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
            Back to order
          </Link>
        </Button>
        <Button onClick={() => window.print()} className="min-h-[44px]">
          <Printer className="mr-1 size-4" aria-hidden="true" />
          Print / Save PDF
        </Button>
      </div>

      {/* The document. `po-document` scopes the print stylesheet. */}
      <article
        aria-label={`Purchase order ${poNumber}`}
        className="po-document mx-auto max-w-3xl rounded-lg border bg-white p-8 text-sm text-neutral-900 print:max-w-none print:rounded-none print:border-0 print:p-0"
      >
        <header className="po-avoid-break border-b-2 border-neutral-900 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                Purchase order
              </p>
              <h1 className="mt-1 text-2xl font-bold">{restaurantName}</h1>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">#{poNumber}</p>
              <p className="mt-1 inline-block rounded-full bg-neutral-100 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide">
                {po.status.replace("_", " ")}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-neutral-500">Order date</dt>
              <dd className="font-medium">{formatDate(po.orderDate)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Expected delivery</dt>
              <dd className="font-medium">
                {po.expectedDate ? formatDate(po.expectedDate) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">Created</dt>
              <dd className="font-medium">{formatDate(po.createdAt.slice(0, 10))}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Lines</dt>
              <dd className="font-medium">{po.lineCount}</dd>
            </div>
          </dl>
        </header>

        <section aria-label="Supplier" className="po-avoid-break mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Supplier
          </h2>
          <p className="mt-1 text-base font-bold">{po.supplierName}</p>
          {po.supplierAddress && <p className="mt-0.5">{po.supplierAddress}</p>}
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5">
            {po.supplierPhone && <p>Phone: {po.supplierPhone}</p>}
            {po.supplierEmail && <p>Email: {po.supplierEmail}</p>}
            {po.supplierGstin && <p>GSTIN: {po.supplierGstin}</p>}
          </div>
        </section>

        <section aria-label="Line items" className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Items
          </h2>
          <table className="po-lines mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th scope="col" className="py-2 pr-2 font-semibold">#</th>
                <th scope="col" className="py-2 pr-2 font-semibold">Item</th>
                <th scope="col" className="py-2 pr-2 text-right font-semibold">Qty</th>
                <th scope="col" className="py-2 pr-2 text-right font-semibold">Unit price</th>
                <th scope="col" className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((line, i) => (
                <tr key={line.id} className="po-avoid-break border-b border-neutral-200">
                  <td className="py-2 pr-2 text-neutral-500">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <span className="font-medium">{line.itemName}</span>
                    {line.notes && (
                      <span className="block text-xs text-neutral-500">{line.notes}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {line.quantity} {line.unitSymbol}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatINR(line.unitPrice)}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatINR(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section
          aria-label="Totals"
          className="po-avoid-break mt-6 flex justify-end"
        >
          <dl className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Subtotal</dt>
              <dd className="font-medium tabular-nums">{formatINR(po.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">GST ({po.gstRate}%)</dt>
              <dd className="font-medium tabular-nums">{formatINR(po.gstAmount)}</dd>
            </div>
            <div className="flex justify-between border-t-2 border-neutral-900 pt-2 text-base">
              <dt className="font-bold">Grand total</dt>
              <dd className="font-bold tabular-nums">{formatINR(po.grandTotal)}</dd>
            </div>
          </dl>
        </section>

        {po.notes && (
          <section aria-label="Notes" className="po-avoid-break mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Notes
            </h2>
            <p className="mt-1">{po.notes}</p>
          </section>
        )}

        <footer className="po-avoid-break mt-8 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
          <p>
            Prices are snapshotted at order time. GST is calculated on the
            subtotal at the rate recorded on this order ({po.gstRate}%).
          </p>
        </footer>
      </article>
    </div>
  );
}
