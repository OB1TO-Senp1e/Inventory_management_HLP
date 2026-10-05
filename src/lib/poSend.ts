import type { PurchaseOrderDetail } from "@/api/purchasing";
import { poSendChannelSchema, type PoSendChannel } from "@/schemas/purchaseOrder";
import { formatDate, formatINR } from "./format";

/**
 * V2-05: purchase-order channel sending.
 *
 * The channel send itself is a client-side deep link — WhatsApp (`wa.me`)
 * or email (`mailto:`) — so it works with no API account and no server.
 * Fully automated sending (no user tap) would need the WhatsApp Business
 * API or an email service; that is a documented deployment follow-up, not
 * something this module fakes.
 *
 * The pluggable seam is `PoSendProvider`: each channel implements
 * `buildTarget` (pure: PO + restaurant name → deep-link URL + destination)
 * and the UI opens the URL. A future automated provider implements the
 * same interface and performs a server-side call instead of opening a URL.
 */

export const PO_SEND_CHANNELS: readonly PoSendChannel[] = poSendChannelSchema.options;

export interface PoSendTarget {
  channel: PoSendChannel;
  /** Deep-link URL to open (wa.me / mailto:). */
  url: string;
  /** Where the message goes (normalized phone / email), shown for confirmation. */
  destination: string;
}

export interface PoSendProvider {
  readonly channel: PoSendChannel;
  readonly label: string;
  /**
   * Build the send target, or null when the supplier cannot receive on
   * this channel (missing/invalid contact). Pure and unit-tested.
   */
  buildTarget(po: PurchaseOrderDetail, restaurantName: string): PoSendTarget | null;
}

/** Short human PO reference, shared with the print view (P3-04). */
export function poShortId(poId: string): string {
  return poId.slice(0, 8).toUpperCase();
}

/**
 * Plain-text PO message, mirroring the P3-04 print document (buyer,
 * supplier, lines with snapshotted prices, subtotal, GST, grand total).
 * `markdown` enables WhatsApp *bold*; email uses the plain variant so no
 * stray asterisks appear in the subject-composed body.
 */
export function buildPoTextMessage(
  po: PurchaseOrderDetail,
  restaurantName: string,
  markdown: boolean,
): string {
  const bold = (s: string) => (markdown ? `*${s}*` : s);
  const lines = po.lines.map(
    (line, i) =>
      `${i + 1}. ${line.itemName} — ${line.quantity} ${line.unitSymbol} × ${formatINR(line.unitPrice)} = ${formatINR(line.lineTotal)}`,
  );
  const parts = [
    `${bold(`Purchase order #${poShortId(po.id)}`)} — ${restaurantName}`,
    `Supplier: ${po.supplierName}`,
    `Order date: ${formatDate(po.orderDate)}`,
    "",
    ...lines,
    "",
    `Subtotal: ${formatINR(po.total)}`,
    `GST (${po.gstRate}%): ${formatINR(po.gstAmount)}`,
    `${bold(`Grand total: ${formatINR(po.grandTotal)}`)}`,
  ];
  if (po.expectedDate) {
    parts.push(`Expected delivery: ${formatDate(po.expectedDate)}`);
  }
  if (po.notes) {
    parts.push(`Notes: ${po.notes}`);
  }
  return parts.join("\n");
}

export function buildPoEmailSubject(poId: string, restaurantName: string): string {
  return `Purchase order #${poShortId(poId)} from ${restaurantName}`;
}

/**
 * Normalize a supplier phone for wa.me: strip every non-digit; a 10-digit
 * number is assumed Indian and gets the 91 country code (the app's locale
 * default is India — see the loop prompt); longer numbers are used as-is.
 * Returns null when the result is too short to be a real number.
 */
export function normalizePhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length >= 7) {
    return digits;
  }
  return null;
}

/** Very small sanity check — the supplier record owns the address; we just avoid building a broken mailto:. */
export function isPlausibleEmail(email: string | null | undefined): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function buildMailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const whatsAppSendProvider: PoSendProvider = {
  channel: "whatsapp",
  label: "WhatsApp",
  buildTarget(po, restaurantName) {
    const phone = normalizePhoneForWhatsApp(po.supplierPhone);
    if (!phone) {
      return null;
    }
    return {
      channel: "whatsapp",
      url: buildWhatsAppUrl(phone, buildPoTextMessage(po, restaurantName, true)),
      destination: `+${phone}`,
    };
  },
};

const emailSendProvider: PoSendProvider = {
  channel: "email",
  label: "Email",
  buildTarget(po, restaurantName) {
    const email = po.supplierEmail?.trim() ?? "";
    if (!isPlausibleEmail(email)) {
      return null;
    }
    return {
      channel: "email",
      url: buildMailtoUrl(
        email,
        buildPoEmailSubject(po.id, restaurantName),
        buildPoTextMessage(po, restaurantName, false),
      ),
      destination: email,
    };
  },
};

/** Channel providers in UI order. Add future automated providers here. */
export const PO_SEND_PROVIDERS: readonly PoSendProvider[] = [
  whatsAppSendProvider,
  emailSendProvider,
];

/**
 * Open a send target in a new tab. Thin wrapper so e2e can stub
 * `window.open` deterministically (the app never depends on the popup).
 */
export function openPoSendTarget(target: PoSendTarget): void {
  window.open(target.url, "_blank", "noopener,noreferrer");
}
