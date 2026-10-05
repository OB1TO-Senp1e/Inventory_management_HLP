/**
 * Invoice OCR parsing (V2-04). Pure functions: OCR text → draft receipt
 * lines + fuzzy inventory-item matching. No I/O, fully unit-testable.
 *
 * Supplier bills are messy, so this is deliberately best-effort: every
 * parsed line is editable on the review screen and nothing posts without
 * explicit user confirmation. Lines the parser cannot make sense of are
 * kept as `unparsed` (never silently dropped).
 */

export type ParsedLineStatus = "parsed" | "partial" | "unparsed";

export interface ParsedInvoiceLine {
  /** Stable client id (`line-<index>`) for the draft. */
  id: string;
  /** The raw OCR line — shown to the user for transparency. */
  rawText: string;
  /** Best-effort item name with numbers/units stripped. */
  name: string;
  /** Parsed quantity, null when the line carries none. */
  quantity: number | null;
  /** Parsed line amount (₹), null when the line carries none. */
  amount: number | null;
  /** amount / quantity rounded to 2dp when both are present, else null. */
  unitCost: number | null;
  status: ParsedLineStatus;
}

/** Lines that are bill furniture, not items — skipped, not shown. */
const SKIP_PATTERNS: RegExp[] = [
  /^\s*[-=_*#.|\s]*$/, // separators / empty
  /^[^a-zA-Z]*$/, // no letters at all — can't be an item name
  /bill\s*no/i,
  /\binvoice\b/i,
  /\bgstin\b/i,
  /\bdate\b/i,
  /\b(total|sub\s*total|grand\s*total|net\s*(amount|payable)?)\b/i,
  /\b(igst|cgst|sgst|gst|tax|vat)\b/i,
  /\bdiscount\b/i,
  /\bround\s*off\b/i,
  /\bthank/i,
  /visit\s*again/i,
  /\be\s*&\s*oe\b/i,
  /\b(phone|mobile|tel|contact)\b/i,
  // Column header rows: "Item Qty Rate Amount", "S.No Particulars Qty …"
  /\b(item|particulars|s\.?\s*no)\b.*\b(qty|quantity|rate|amount|price)\b/i,
];

/** Unit tokens stripped from names (whole words, case-insensitive). */
const UNIT_TOKENS = new Set([
  "kg",
  "g",
  "gm",
  "gms",
  "gram",
  "grams",
  "ltr",
  "l",
  "lt",
  "litre",
  "litres",
  "liter",
  "liters",
  "ml",
  "pcs",
  "pc",
  "pkt",
  "packet",
  "packets",
  "box",
  "boxes",
  "dozen",
  "bag",
  "bags",
  "nos",
  "plate",
  "plates",
  "cup",
  "cups",
]);

/** Currency tokens stripped from names. */
const CURRENCY_TOKENS = new Set(["rs", "inr", "₹"]);

function extractNumbers(line: string): number[] {
  const matches = line.match(/\d[\d,]*(\.\d{1,2})?/g) ?? [];
  const numbers: number[] = [];
  for (const m of matches) {
    const n = Number(m.replace(/,/g, ""));
    if (Number.isFinite(n)) {
      numbers.push(n);
    }
  }
  return numbers;
}

/**
 * Best-effort item name: strip numbers, currency and unit tokens, and
 * punctuation, then collapse whitespace. Returns "" when nothing remains.
 */
function cleanName(line: string): string {
  const withoutNumbers = line.replace(/\d[\d,]*(\.\d{1,2})?/g, " ");
  const words = withoutNumbers
    .toLowerCase()
    .replace(/[^a-z₹\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 0 && !UNIT_TOKENS.has(w) && !CURRENCY_TOKENS.has(w),
    );
  // Title-case for display; matching normalizes again anyway.
  return words
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseLine(rawText: string, index: number): ParsedInvoiceLine | null {
  const line = rawText.trim();
  if (line.length === 0) {
    return null;
  }
  if (SKIP_PATTERNS.some((re) => re.test(line))) {
    return null;
  }
  const id = `line-${index}`;
  const name = cleanName(line);
  if (name.length === 0) {
    return {
      id,
      rawText: line,
      name: "",
      quantity: null,
      amount: null,
      unitCost: null,
      status: "unparsed",
    };
  }
  const numbers = extractNumbers(line);
  if (numbers.length === 0) {
    // Name only, e.g. "Coriander" — the user fills qty/cost on review.
    return {
      id,
      rawText: line,
      name,
      quantity: null,
      amount: null,
      unitCost: null,
      status: "partial",
    };
  }
  if (numbers.length === 1) {
    // Ambiguous single number: treat as quantity when the line reads like
    // "<name> <qty> <unit>" and as amount otherwise. The review screen lets
    // the user correct either way — this is only a starting suggestion.
    const looksLikeQty = /\b(kg|g|gm|ltr|ml|pcs|pkt|packet|box|dozen|bag|nos)\b/i.test(
      line,
    );
    return {
      id,
      rawText: line,
      name,
      quantity: looksLikeQty ? numbers[0] : null,
      amount: looksLikeQty ? null : numbers[0],
      unitCost: null,
      status: "partial",
    };
  }
  // Two or more numbers: first is the quantity, last is the line amount
  // ("Tomato 10 kg 40.00 400.00" → qty 10, amount 400).
  const quantity = numbers[0];
  const amount = numbers[numbers.length - 1];
  const unitCost = quantity > 0 ? round2(amount / quantity) : null;
  return {
    id,
    rawText: line,
    name,
    quantity,
    amount,
    unitCost,
    status: "parsed",
  };
}

/**
 * Parse OCR text into draft receipt lines. Skipped (bill furniture) lines
 * return null and are dropped; everything else becomes an editable draft
 * line, including `unparsed` ones.
 */
export function parseInvoiceText(text: string): ParsedInvoiceLine[] {
  const lines = text.split(/\r?\n/);
  const parsed: ParsedInvoiceLine[] = [];
  lines.forEach((rawText, index) => {
    const line = parseLine(rawText, index);
    if (line) {
      parsed.push(line);
    }
  });
  return parsed;
}

// -- fuzzy item matching ----------------------------------------------------

export interface MatchableItem {
  id: string;
  name: string;
  unitSymbol: string;
}

export interface ItemMatch {
  item: MatchableItem;
  /** 100 exact, 80 prefix, 60 substring, 50 full token overlap, 30 partial. */
  score: number;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Rank inventory items against a parsed bill name. Returns at most `limit`
 * candidates, best first. Empty when nothing scores above zero.
 */
export function matchItemsByName(
  rawName: string,
  items: MatchableItem[],
  limit = 5,
): ItemMatch[] {
  const norm = normalize(rawName);
  if (!norm) {
    return [];
  }
  const scored: ItemMatch[] = [];
  for (const item of items) {
    const itemNorm = normalize(item.name);
    if (!itemNorm) {
      continue;
    }
    let score = 0;
    if (itemNorm === norm) {
      score = 100;
    } else if (itemNorm.startsWith(norm) || norm.startsWith(itemNorm)) {
      score = 80;
    } else if (itemNorm.includes(norm) || norm.includes(itemNorm)) {
      score = 60;
    } else {
      const nameTokens = new Set(norm.split(" ").map(singularize));
      const itemTokens = new Set(itemNorm.split(" ").map(singularize));
      const overlap = [...nameTokens].filter((t) => itemTokens.has(t)).length;
      if (overlap > 0) {
        score =
          overlap === Math.min(nameTokens.size, itemTokens.size) ? 50 : 30;
      }
    }
    if (score > 0) {
      scored.push({ item, score });
    }
  }
  scored.sort(
    (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name),
  );
  return scored.slice(0, limit);
}

/** The top candidate, or null when nothing matches. */
export function bestItemMatch(
  rawName: string,
  items: MatchableItem[],
): MatchableItem | null {
  const matches = matchItemsByName(rawName, items, 1);
  return matches.length > 0 ? matches[0].item : null;
}
