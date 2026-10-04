import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useAddPurchaseOrderLine,
  usePurchaseOrder,
  useRemovePurchaseOrderLine,
  useUpdatePurchaseOrder,
} from "./hooks";
import { useReceivableItems } from "@/features/stock/hooks";
import { useSupplierPricesForPrefill } from "./hooks";
import { StatusBadge } from "./PurchaseOrdersPage";
import { formatDate, formatINR } from "@/lib/format";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "mb-1 block text-sm font-medium";

/**
 * Purchase order detail (P3-01). Owner/manager only. Draft POs can be
 * edited here (header fields, add/remove lines); the send/receive/cancel
 * lifecycle lands in P3-02.
 */
export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const poQuery = usePurchaseOrder(id ?? null);
  const po = poQuery.data ?? null;
  const isDraft = po?.status === "draft";

  const [editingHeader, setEditingHeader] = useState(false);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineToRemove, setLineToRemove] = useState<{ id: string; name: string } | null>(null);
  const [itemToAdd, setItemToAdd] = useState("");
  const [qtyToAdd, setQtyToAdd] = useState("1");
  const [priceToAdd, setPriceToAdd] = useState("");

  const updateMutation = useUpdatePurchaseOrder();
  const addLineMutation = useAddPurchaseOrderLine();
  const removeLineMutation = useRemovePurchaseOrderLine();

  const receivable = useReceivableItems();
  const prefill = useSupplierPricesForPrefill(po?.supplierId ?? null);

  if (poQuery.isLoading) {
    return (
      <div>
        <PageHeader title="Purchase order" description="Loading…" />
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
      <div>
        <PageHeader title="Purchase order" description="" />
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

  const inLines = new Set(po.lines.map((l) => l.itemId));
  const addableItems = (receivable.items ?? []).filter((i) => !inLines.has(i.id));

  const startHeaderEdit = () => {
    setExpectedDate(po.expectedDate ?? "");
    setNotes(po.notes ?? "");
    setEditingHeader(true);
  };

  const saveHeader = () => {
    updateMutation.mutate(
      {
        id: po.id,
        expectedDate: expectedDate === "" ? null : expectedDate,
        notes: notes.trim() === "" ? null : notes.trim(),
      },
      { onSuccess: () => setEditingHeader(false) },
    );
  };

  const onItemToAddChange = (itemId: string) => {
    setItemToAdd(itemId);
    // Prefill the price from the supplier's price list when available.
    const priced = (prefill.data ?? []).find((p) => p.itemId === itemId);
    setPriceToAdd(priced ? String(priced.unitPrice) : "");
  };

  const addSelectedLine = () => {
    const item = addableItems.find((i) => i.id === itemToAdd);
    if (!item) {
      return;
    }
    const qty = Number(qtyToAdd);
    const unitPrice = Number(priceToAdd);
    if (!(qty > 0) || !(unitPrice > 0)) {
      return;
    }
    addLineMutation.mutate(
      { poId: po.id, itemId: item.id, quantity: qty, unitPrice },
      {
        onSuccess: () => {
          setItemToAdd("");
          setQtyToAdd("1");
          setPriceToAdd("");
        },
      },
    );
  };

  return (
    <div>
      <PageHeader
        title={`Purchase order`}
        description={`${po.supplierName} · ordered ${formatDate(po.orderDate)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild className="min-h-[44px]">
              <Link to="/purchase-orders">
                <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
                All orders
              </Link>
            </Button>
            {isDraft && !editingHeader && (
              <Button onClick={startHeaderEdit} className="min-h-[44px]">
                <Pencil className="mr-1 size-4" aria-hidden="true" />
                Edit
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={po.status} />
        <span className="text-sm text-muted-foreground">
          {po.lineCount} {po.lineCount === 1 ? "line" : "lines"} · Total{" "}
          <strong className="text-foreground tabular-nums">{formatINR(po.total)}</strong>
        </span>
      </div>

      {editingHeader ? (
        <div className="mb-6 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="po-edit-expected" className={labelClass}>
                Expected delivery
              </label>
              <input
                id="po-edit-expected"
                type="date"
                className={inputClass}
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="po-edit-notes" className={labelClass}>
                Notes
              </label>
              <input
                id="po-edit-notes"
                type="text"
                className={inputClass}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingHeader(false)}>
              Cancel
            </Button>
            <Button onClick={saveHeader} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="mb-6 grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Expected delivery</dt>
            <dd className="font-medium">{po.expectedDate ? formatDate(po.expectedDate) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="font-medium">{po.notes ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-medium">{formatDate(po.createdAt.slice(0, 10))}</dd>
          </div>
        </dl>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Line items</h2>
      </div>

      {isDraft && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="po-add-item" className={labelClass}>
              Add item
            </label>
            <select
              id="po-add-item"
              className={inputClass}
              value={itemToAdd}
              onChange={(e) => onItemToAddChange(e.target.value)}
            >
              <option value="">Select an item…</option>
              {addableItems.map((i) => {
                const priced = (prefill.data ?? []).find((p) => p.itemId === i.id);
                return (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unitSymbol})
                    {priced ? ` · ${formatINR(priced.unitPrice)}` : " · no listed price"}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="w-28">
            <label htmlFor="po-add-qty" className={labelClass}>
              Qty
            </label>
            <input
              id="po-add-qty"
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={qtyToAdd}
              onChange={(e) => setQtyToAdd(e.target.value)}
            />
          </div>
          <div className="w-32">
            <label htmlFor="po-add-price" className={labelClass}>
              Unit price (₹)
            </label>
            <input
              id="po-add-price"
              type="number"
              min="0"
              step="any"
              className={inputClass}
              value={priceToAdd}
              placeholder="0.00"
              onChange={(e) => setPriceToAdd(e.target.value)}
            />
          </div>
          <Button
            onClick={addSelectedLine}
            disabled={!itemToAdd || addLineMutation.isPending}
            className="min-h-[44px]"
          >
            <Plus className="mr-1 size-4" aria-hidden="true" />
            {addLineMutation.isPending ? "Adding…" : "Add line"}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Unit price prefills from the supplier&apos;s price list; adjust as needed.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="px-4 py-3 text-right font-medium">Qty</th>
              <th className="px-4 py-3 text-right font-medium">Unit price</th>
              <th className="px-4 py-3 text-right font-medium">Line total</th>
              {isDraft && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => (
              <tr key={line.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{line.itemName}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {line.quantity} {line.unitSymbol}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatINR(line.unitPrice)}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatINR(line.lineTotal)}
                </td>
                {isDraft && (
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10"
                      aria-label={`Remove ${line.itemName}`}
                      onClick={() => setLineToRemove({ id: line.id, name: line.itemName })}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 font-semibold">
              <td className="px-4 py-3" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatINR(po.total)}</td>
              {isDraft && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {!isDraft && (
        <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          This order is {po.status.replace("_", " ")} and can no longer be edited.
          Send/receive/cancel actions arrive in P3-02.
        </p>
      )}

      {lineToRemove && (
        <ConfirmDialog
          open
          title={`Remove ${lineToRemove.name}?`}
          description="The line will be removed from this draft order."
          confirmLabel="Remove line"
          onConfirm={() => {
            removeLineMutation.mutate(
              { lineId: lineToRemove.id, poId: po.id },
              { onSuccess: () => setLineToRemove(null) },
            );
          }}
          onCancel={() => setLineToRemove(null)}
        />
      )}
    </div>
  );
}
