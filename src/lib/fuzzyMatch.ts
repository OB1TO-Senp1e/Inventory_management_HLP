/**
 * Fuzzy name matching (shared). Extracted from the V2-04 invoice parser so
 * POS dish-name matching (V2-06) and invoice line matching share one
 * implementation. Pure, no I/O, fully unit-testable.
 */

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
 * Rank items against a raw name. Returns at most `limit` candidates, best
 * first. Empty when nothing scores above zero.
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
