import { describe, expect, it } from "vitest";
import type { PurchaseOrderDetail } from "@/api/purchasing";
import {
  PO_SEND_PROVIDERS,
  buildMailtoUrl,
  buildPoEmailSubject,
  buildPoTextMessage,
  buildWhatsAppUrl,
  isPlausibleEmail,
  normalizePhoneForWhatsApp,
  poShortId,
} from "./poSend";

function samplePO(): PurchaseOrderDetail {
  return {
    id: "abcdef12-0000-0000-0000-000000000001",
    supplierId: "sup-1",
    supplierName: "Fresh Farms",
    supplierAddress: "APMC Market, Vashi",
    supplierPhone: "+91 98200 12345",
    supplierEmail: "ramesh@freshfarms.example",
    supplierGstin: "27ABCDE1234F1Z5",
    status: "draft",
    orderDate: "2026-10-05",
    expectedDate: "2026-10-12",
    notes: "Call on arrival",
    gstRate: 18,
    lineCount: 2,
    total: 605,
    gstAmount: 108.9,
    grandTotal: 713.9,
    createdAt: "2026-10-05T00:00:00Z",
    updatedAt: "2026-10-05T00:00:00Z",
    sentAt: null,
    sentVia: null,
    lines: [
      {
        id: "line-1",
        itemId: "item-1",
        itemName: "Tomato",
        unitSymbol: "kg",
        quantity: 10,
        unitPrice: 32.5,
        receivedQuantity: 0,
        lineTotal: 325,
        notes: null,
      },
      {
        id: "line-2",
        itemId: "item-2",
        itemName: "Milk",
        unitSymbol: "L",
        quantity: 5,
        unitPrice: 56,
        receivedQuantity: 0,
        lineTotal: 280,
        notes: null,
      },
    ],
  };
}

describe("normalizePhoneForWhatsApp", () => {
  it("strips formatting from an international number", () => {
    expect(normalizePhoneForWhatsApp("+91 98200 12345")).toBe("919820012345");
    expect(normalizePhoneForWhatsApp("+91-98200-12345")).toBe("919820012345");
  });

  it("assumes India (91) for a 10-digit national number", () => {
    expect(normalizePhoneForWhatsApp("9820012345")).toBe("919820012345");
  });

  it("keeps other international numbers as-is", () => {
    expect(normalizePhoneForWhatsApp("+1 415 555 0132")).toBe("14155550132");
  });

  it("rejects blank or too-short numbers", () => {
    expect(normalizePhoneForWhatsApp(null)).toBeNull();
    expect(normalizePhoneForWhatsApp("")).toBeNull();
    expect(normalizePhoneForWhatsApp("12345")).toBeNull();
    expect(normalizePhoneForWhatsApp("no digits here")).toBeNull();
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses and rejects junk", () => {
    expect(isPlausibleEmail("ramesh@freshfarms.example")).toBe(true);
    expect(isPlausibleEmail(null)).toBe(false);
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a @b.com")).toBe(false);
  });
});

describe("buildPoTextMessage", () => {
  it("renders the PO number, lines, totals and GST", () => {
    const text = buildPoTextMessage(samplePO(), "Test Restaurant", false);
    expect(text).toContain("#ABCDEF12");
    expect(text).toContain("Test Restaurant");
    expect(text).toContain("Supplier: Fresh Farms");
    expect(text).toContain("1. Tomato — 10 kg");
    expect(text).toContain("2. Milk — 5 L");
    expect(text).toContain("GST (18%)");
    expect(text).toContain("Grand total:");
    expect(text).toContain("Expected delivery:");
    expect(text).toContain("Notes: Call on arrival");
  });

  it("omits optional sections when absent", () => {
    const po = { ...samplePO(), expectedDate: null, notes: null };
    const text = buildPoTextMessage(po, "Test Restaurant", false);
    expect(text).not.toContain("Expected delivery");
    expect(text).not.toContain("Notes:");
  });

  it("uses WhatsApp bold only in the markdown variant", () => {
    const md = buildPoTextMessage(samplePO(), "R", true);
    const plain = buildPoTextMessage(samplePO(), "R", false);
    expect(md).toContain("*Purchase order #ABCDEF12*");
    expect(plain).not.toContain("*");
  });
});

describe("URL builders", () => {
  it("builds a wa.me link with the encoded message", () => {
    const url = buildWhatsAppUrl("919820012345", "Hello & welcome");
    expect(url).toBe("https://wa.me/919820012345?text=Hello%20%26%20welcome");
  });

  it("builds a mailto link with encoded subject and body", () => {
    const url = buildMailtoUrl("a@b.com", "PO #1 & more", "Line 1\nLine 2");
    expect(url).toBe(
      "mailto:a@b.com?subject=PO%20%231%20%26%20more&body=Line%201%0ALine%202",
    );
  });

  it("builds the email subject from the PO id and restaurant", () => {
    expect(buildPoEmailSubject("abcdef12-0000-0000-0000-000000000001", "R")).toBe(
      "Purchase order #ABCDEF12 from R",
    );
  });
});

describe("PO_SEND_PROVIDERS", () => {
  it("exposes whatsapp and email providers", () => {
    expect(PO_SEND_PROVIDERS.map((p) => p.channel)).toEqual(["whatsapp", "email"]);
  });

  it("whatsapp builds a wa.me target from the supplier phone", () => {
    const target = PO_SEND_PROVIDERS[0].buildTarget(samplePO(), "R");
    expect(target?.channel).toBe("whatsapp");
    expect(target?.destination).toBe("+919820012345");
    expect(target?.url.startsWith("https://wa.me/919820012345?text=")).toBe(true);
  });

  it("whatsapp returns null without a usable phone", () => {
    expect(
      PO_SEND_PROVIDERS[0].buildTarget({ ...samplePO(), supplierPhone: null }, "R"),
    ).toBeNull();
    expect(
      PO_SEND_PROVIDERS[0].buildTarget({ ...samplePO(), supplierPhone: "12" }, "R"),
    ).toBeNull();
  });

  it("email builds a mailto target from the supplier email", () => {
    const target = PO_SEND_PROVIDERS[1].buildTarget(samplePO(), "R");
    expect(target?.channel).toBe("email");
    expect(target?.destination).toBe("ramesh@freshfarms.example");
    expect(target?.url.startsWith("mailto:ramesh@freshfarms.example?")).toBe(true);
    expect(target?.url).toContain(encodeURIComponent("Purchase order #ABCDEF12 from R"));
  });

  it("email returns null without a plausible email", () => {
    expect(
      PO_SEND_PROVIDERS[1].buildTarget({ ...samplePO(), supplierEmail: null }, "R"),
    ).toBeNull();
    expect(
      PO_SEND_PROVIDERS[1].buildTarget({ ...samplePO(), supplierEmail: "nope" }, "R"),
    ).toBeNull();
  });
});

describe("poShortId", () => {
  it("uses the first 8 id characters uppercased", () => {
    expect(poShortId("abcdef12-0000-0000-0000-000000000001")).toBe("ABCDEF12");
  });
});
