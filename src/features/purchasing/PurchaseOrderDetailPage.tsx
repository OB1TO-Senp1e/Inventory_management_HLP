import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PackageCheck, Pencil, Plus, Send, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/toast/useToast";
import {
  useAddPurchaseOrderLine,
  useCancelPurchaseOrder,
  usePurchaseOrder,
  useReceivePurchaseOrder,
  useRemovePurchaseOrderLine,
  useSendPurchaseOrder,
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
 * Purchase order detail (P3-01, lifecycle in P3-02). Owner/manager only.
 * Draft POs can be edited here; sent/partially_received POs support the
 * receive flow; draft/sent POs can be cancelled.
 */
export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useToast();
  const poQuery = usePurchaseOrder(id ?? null);
  const po = poQuery.data ?? null;
  const isDraft = po?.status === "draft";
  const isReceivable =
    po?.status === "sent" || po?.status === "partially_received";
  const isCancellable = po?.status === "draft" || po?.status === "sent";

  const [editingHeader, setEditingHeader] = useState(false);
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineToRemove, setLineToRemove] = useState<{ id: string; name: string } | null>(null);
  const [itemToAdd, setItemToAdd] = useState("");
  const [qtyToAdd, setQtyToAdd] = useState("1");
  const [priceToAdd, setPriceToAdd] = useState("");
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveInputs, setReceiveInputs] = useState<
    Record<string, { qty: string; batchNo: string; expiryDate: string; notes: string }>
  >({});

  const updateMutation = useUpdatePurchaseOrder();
  const addLineMutation = useAddPurchaseOrderLine();
  const removeLineMutation = useRemovePurchaseOrderLine();
  const sendMutation = useSendPurchaseOrder();
  const cancelMutation = useCancelPurchaseOrder();
  const receiveMutation = useReceivePurchaseOrder();

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

  const openReceiveForm = () => {
    const initial: Record<
      string,
      { qty: string; batchNo: string; expiryDate: string; notes: string }
    > = {};
    for (const line of po.lines) {
      const remaining = line.quantity - line.receivedQuantity;
      if (remaining > 0) {
        initial[line.id] = {
          qty: String(remaining),
          batchNo: "",
          expiryDate: "",
          notes: "",
        };
      }
    }
    setReceiveInputs(initial);
    setReceiving(true);
  };

  const setReceiveInput = (
    lineId: string,
    patch: Partial<{ qty: string; batchNo: string; expiryDate: string; notes: string }>,
  ) => {
    setReceiveInputs((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  };

  const submitReceive = () => {
    const remainingByLine = new Map(po.lines.map((l) => [l.id, l.quantity - l.receivedQuantity]));
    const lines = Object.entries(receiveInputs)
      .map(([poLineId, input]) => ({ poLineId, ...input }))
      .filter((l) => Number(l.qty) > 0)
      .map((l) => ({
        poLineId: l.poLineId,
        quantity: Number(l.qty),
        batchNo: l.batchNo.trim() === "" ? undefined : l.batchNo.trim(),
        expiryDate: l.expiryDate === "" ? undefined : l.expiryDate,
        notes: l.notes.trim() === "" ? undefined : l.notes.trim(),
      }));
    if (lines.length === 0) {
      return;
    }
    // Client-side guard (the RPC enforces this too): never post more than
    // the remaining quantity on a line.
    const overReceive = lines.find(
      (l) => l.quantity > (remainingByLine.get(l.poLineId) ?? 0),
    );
    if (overReceive) {
      const line = po.lines.find((l) => l.id === overReceive.poLineId);
      notify(
        "error",
        `Cannot receive ${overReceive.quantity} ${line?.unitSymbol ?? ""} of ${line?.itemName ?? "this item"}: only ${remainingByLine.get(overReceive.poLineId)} remaining.`,
      );
      return;
    }
    receiveMutation.mutate(
      { id: po.id, lines },
      {
        onSuccess: () => {
          setReceiving(false);
          setReceiveInputs({});
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
            {isDraft && (
              <Button
                onClick={() => setConfirmingSend(true)}
                className="min-h-[44px]"
                disabled={sendMutation.isPending}
              >
                <Send className="mr-1 size-4" aria-hidden="true" />
                {sendMutation.isPending ? "Sending…" : "Send"}
              </Button>
            )}
            {isReceivable && !receiving && (
              <Button onClick={openReceiveForm} className="min-h-[44px]">
                <PackageCheck className="mr-1 size-4" aria-hidden="true" />
                Receive
              </Button>
            )}
            {isCancellable && (
              <Button
                variant="outline"
                onClick={() => setConfirmingCancel(true)}
                className="min-h-[44px] text-destructive"
                disabled={cancelMutation.isPending}
              >
                <XCircle className="mr-1 size-4" aria-hidden="true" />
                Cancel order
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
              <th className="px-4 py-3 text-right font-medium">Ordered</th>
              {!isDraft && <th className="px-4 py-3 text-right font-medium">Received</th>}
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
                {!isDraft && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    {line.receivedQuantity} {line.unitSymbol}
                    {line.receivedQuantity < line.quantity && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({line.quantity - line.receivedQuantity} pending)
                      </span>
                    )}
                  </td>
                )}
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
              <td className="px-4 py-3" colSpan={isDraft ? 3 : 4}>
                Total
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatINR(po.total)}</td>
              {isDraft && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {receiving && isReceivable && (
        <div className="mt-6 rounded-lg border p-4" aria-label="Receive against this order">
          <h2 className="mb-1 text-base font-semibold">Receive stock</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Enter the quantity arriving now for each line. Posting creates
            receipt movements in the stock ledger at the order&apos;s
            agreed unit prices.
          </p>
          <div className="space-y-4">
            {po.lines
              .filter((line) => line.quantity - line.receivedQuantity > 0)
              .map((line) => {
                const remaining = line.quantity - line.receivedQuantity;
                const input = receiveInputs[line.id] ?? {
                  qty: "",
                  batchNo: "",
                  expiryDate: "",
                  notes: "",
                };
                return (
                  <fieldset
                    key={line.id}
                    className="rounded-md border p-4"
                    aria-label={`Receive ${line.itemName}`}
                  >
                    <legend className="px-1 text-sm font-semibold">
                      {line.itemName} — {remaining} {line.unitSymbol} pending
                    </legend>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label htmlFor={`recv-qty-${line.id}`} className={labelClass}>
                          Qty receiving ({line.unitSymbol})
                        </label>
                        <input
                          id={`recv-qty-${line.id}`}
                          type="number"
                          min="0"
                          max={remaining}
                          step="any"
                          className={inputClass}
                          value={input.qty}
                          onChange={(e) => setReceiveInput(line.id, { qty: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`recv-batch-${line.id}`} className={labelClass}>
                          Batch no. <span className="text-muted-foreground">(optional)</span>
                        </label>
                        <input
                          id={`recv-batch-${line.id}`}
                          type="text"
                          className={inputClass}
                          value={input.batchNo}
                          onChange={(e) => setReceiveInput(line.id, { batchNo: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`recv-expiry-${line.id}`} className={labelClass}>
                          Expiry <span className="text-muted-foreground">(optional)</span>
                        </label>
                        <input
                          id={`recv-expiry-${line.id}`}
                          type="date"
                          className={inputClass}
                          value={input.expiryDate}
                          onChange={(e) => setReceiveInput(line.id, { expiryDate: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`recv-notes-${line.id}`} className={labelClass}>
                          Notes <span className="text-muted-foreground">(optional)</span>
                        </label>
                        <input
                          id={`recv-notes-${line.id}`}
                          type="text"
                          className={inputClass}
                          value={input.notes}
                          onChange={(e) => setReceiveInput(line.id, { notes: e.target.value })}
                        />
                      </div>
                    </div>
                  </fieldset>
                );
              })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setReceiving(false);
                setReceiveInputs({});
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={submitReceive}
              disabled={receiveMutation.isPending}
              className="min-h-[44px]"
            >
              {receiveMutation.isPending ? "Posting…" : "Post receipt"}
            </Button>
          </div>
        </div>
      )}

      {po.status === "cancelled" && (
        <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          This order was cancelled. Cancelled orders cannot be changed.
        </p>
      )}
      {po.status === "received" && (
        <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          This order is fully received and closed.
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

      {confirmingSend && (
        <ConfirmDialog
          open
          title="Send this purchase order?"
          description={`The order will be marked sent to ${po.supplierName}. Sent orders can no longer be edited, but stock can be received against them.`}
          confirmLabel="Send order"
          onConfirm={() => {
            sendMutation.mutate(po.id, {
              onSuccess: () => setConfirmingSend(false),
            });
          }}
          onCancel={() => setConfirmingSend(false)}
        />
      )}

      {confirmingCancel && (
        <ConfirmDialog
          open
          title="Cancel this purchase order?"
          description="Cancelled orders are terminal and cannot be changed or received against."
          confirmLabel="Cancel order"
          onConfirm={() => {
            cancelMutation.mutate(po.id, {
              onSuccess: () => setConfirmingCancel(false),
            });
          }}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </div>
  );
}
