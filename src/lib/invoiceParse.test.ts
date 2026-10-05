import { describe, expect, it } from "vitest";
import {
  bestItemMatch,
  matchItemsByName,
  parseInvoiceText,
  type MatchableItem,
} from "./invoiceParse";

const ITEMS: MatchableItem[] = [
  { id: "1", name: "Tomato", unitSymbol: "kg" },
  { id: "2", name: "Milk", unitSymbol: "L" },
  { id: "3", name: "All-Purpose Flour", unitSymbol: "kg" },
  { id: "4", name: "Red Onions", unitSymbol: "kg" },
];

describe("parseInvoiceText", () => {
  it("parses a typical supplier bill into draft lines", () => {
    const text = [
      "FRESH FARMS PRODUCE",
      "Bill No: 4821 Date: 05/10/2026",
      "Tomato 10 kg 400.00",
      "Milk 5 L 290.00",
      "Paneer 2 kg 640.00",
      "Subtotal: 1330.00",
      "GST 5%: 66.50",
      "Total: 1396.50",
      "Thank you visit again",
    ].join("\n");
    const lines = parseInvoiceText(text);
    // "FRESH FARMS PRODUCE" is a name-only partial line; bill furniture is skipped.
    expect(lines.map((l) => l.name)).toEqual([
      "Fresh Farms Produce",
      "Tomato",
      "Milk",
      "Paneer",
    ]);
    const tomato = lines[1];
    expect(tomato.quantity).toBe(10);
    expect(tomato.amount).toBe(400);
    expect(tomato.unitCost).toBe(40);
    expect(tomato.status).toBe("parsed");
    const freshFarms = lines[0];
    expect(freshFarms.status).toBe("partial");
    expect(freshFarms.quantity).toBeNull();
  });

  it("handles qty/rate/amount columns by taking first qty and last amount", () => {
    const [line] = parseInvoiceText("Tomato 10 kg 40.00 400.00");
    expect(line.quantity).toBe(10);
    expect(line.amount).toBe(400);
    expect(line.unitCost).toBe(40);
  });

  it("handles comma-formatted amounts", () => {
    const [line] = parseInvoiceText("Basmati Rice 25 kg 1,875.00");
    expect(line.quantity).toBe(25);
    expect(line.amount).toBe(1875);
    expect(line.unitCost).toBe(75);
  });

  it("marks name-only lines partial and keeps them editable", () => {
    const [line] = parseInvoiceText("Coriander leaves");
    expect(line.name).toBe("Coriander Leaves");
    expect(line.status).toBe("partial");
    expect(line.quantity).toBeNull();
    expect(line.amount).toBeNull();
  });

  it("treats a lone number with a unit as a quantity suggestion", () => {
    const [line] = parseInvoiceText("Onion 20 kg");
    expect(line.quantity).toBe(20);
    expect(line.amount).toBeNull();
    expect(line.status).toBe("partial");
  });

  it("keeps lines with no extractable name as unparsed, never drops them", () => {
    const lines = parseInvoiceText("--- 400 ---");
    expect(lines).toHaveLength(0); // separator: bill furniture, skipped
    // Has letters ("kg") but the name strips down to nothing — kept for
    // manual entry rather than dropped.
    const kept = parseInvoiceText("kg 10");
    expect(kept).toHaveLength(1);
    expect(kept[0].status).toBe("unparsed");
    expect(kept[0].rawText).toBe("kg 10");
  });

  it("skips header rows, totals, taxes and contact lines", () => {
    const text = [
      "S.No Particulars Qty Rate Amount",
      "GSTIN: 27ABCDE1234F1Z5",
      "Phone: 9820012345",
      "Discount: 50.00",
      "Round off: 0.50",
      "Tomato 10 kg 400.00",
    ].join("\n");
    const lines = parseInvoiceText(text);
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe("Tomato");
  });

  it("returns an empty list when OCR found no usable text", () => {
    expect(parseInvoiceText("")).toEqual([]);
    expect(parseInvoiceText("   \n---\n***\n")).toEqual([]);
  });

  it("avoids division by zero on zero quantities", () => {
    const [line] = parseInvoiceText("Tomato 0 kg 0.00");
    expect(line.quantity).toBe(0);
    expect(line.unitCost).toBeNull();
    expect(line.status).toBe("parsed");
  });
});

describe("matchItemsByName", () => {
  it("matches exact names case-insensitively", () => {
    expect(bestItemMatch("tomato", ITEMS)?.id).toBe("1");
    expect(bestItemMatch("TOMATO", ITEMS)?.id).toBe("1");
  });

  it("matches on prefix and substring", () => {
    const prefix = matchItemsByName("toma", ITEMS);
    expect(prefix[0].item.id).toBe("1");
    expect(prefix[0].score).toBe(80);
    const sub = matchItemsByName("purpose flour", ITEMS);
    expect(sub[0].item.id).toBe("3");
  });

  it("matches across pluralization and token overlap", () => {
    expect(bestItemMatch("Tomatoes", ITEMS)?.id).toBe("1");
    expect(bestItemMatch("Red Onion", ITEMS)?.id).toBe("4");
  });

  it("returns no match for unknown items", () => {
    expect(bestItemMatch("Paneer", ITEMS)).toBeNull();
    expect(matchItemsByName("Paneer", ITEMS)).toEqual([]);
  });

  it("returns empty for blank names", () => {
    expect(matchItemsByName("   ", ITEMS)).toEqual([]);
  });

  it("ranks best candidates first and caps the list", () => {
    const many: MatchableItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      name: `Tomato variant ${i}`,
      unitSymbol: "kg",
    }));
    const matches = matchItemsByName("tomato", many, 5);
    expect(matches).toHaveLength(5);
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[4].score);
  });
});
