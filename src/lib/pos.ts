import { z } from "zod";

/**
 * POS integration (V2-06) — provider interface.
 *
 * `PosProvider.fetchSales` returns normalized sale lines for a date range.
 * Real POS providers (Petpooja/UrbanPiper-style APIs) plug in here later;
 * they need API credentials, which must live server-side (vault/env at
 * deployment) — never in plaintext client code. The only implementation
 * shipped in v1 is the stub below, clearly labeled as a demo.
 */

export interface PosSaleLine {
  /** POS-side sale identifier (order/bill id). Dedupe key per provider. */
  externalSaleId: string;
  /** ISO 8601 timestamp of the original sale. */
  soldAt: string;
  /** Dish name as the POS reports it (fuzzy-matched to a menu item). */
  dishName: string;
  /** Dishes sold. Always positive after normalization. */
  quantity: number;
}

export interface PosFetchRange {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive, YYYY-MM-DD. */
  to: string;
}

export interface PosProvider {
  /** Stable id, namespaced into pos_imports.provider (e.g. 'stub'). */
  id: string;
  /** Display label. */
  label: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Fetch normalized sales for the range. Implementations filter by range. */
  fetchSales(range: PosFetchRange): Promise<PosSaleLine[]>;
}

const rawRowSchema = z.object({
  externalSaleId: z.string().trim().min(1),
  soldAt: z.string().datetime({ offset: true }),
  dishName: z.string().trim().min(1),
  quantity: z.coerce.number(),
});

export interface NormalizedPosPayload {
  lines: PosSaleLine[];
  /** Rows dropped as invalid (blank ids/names, bad timestamps, qty <= 0). */
  skipped: number;
}

/**
 * Validate raw provider rows into normalized lines. Zero/negative
 * quantities, blank identifiers and unparseable timestamps are rejected
 * (counted in `skipped`, never silently kept).
 */
export function normalizePosPayload(raw: unknown): NormalizedPosPayload {
  const rows = z.array(z.unknown()).parse(raw);
  const lines: PosSaleLine[] = [];
  let skipped = 0;
  for (const row of rows) {
    const parsed = rawRowSchema.safeParse(row);
    if (!parsed.success || !(parsed.data.quantity > 0)) {
      skipped += 1;
      continue;
    }
    lines.push(parsed.data);
  }
  return { lines, skipped };
}

/** ISO date (YYYY-MM-DD) of a timestamp, in the device's local timezone. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local timestamp `daysAgo` days back at the given wall-clock time, as ISO. */
function stubSoldAt(daysAgo: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const STUB_SALES: PosSaleLine[] = [
  {
    externalSaleId: "stub-0001",
    soldAt: stubSoldAt(1, 13, 5),
    dishName: "Butter Chicken",
    quantity: 4,
  },
  {
    externalSaleId: "stub-0002",
    soldAt: stubSoldAt(1, 19, 42),
    dishName: "Dal Makhani",
    quantity: 6,
  },
  {
    externalSaleId: "stub-0003",
    soldAt: stubSoldAt(2, 12, 20),
    dishName: "butter chicken",
    quantity: 2,
  },
  {
    externalSaleId: "stub-0004",
    soldAt: stubSoldAt(2, 20, 15),
    dishName: "Paneer Lababdar",
    quantity: 3,
  },
];

/**
 * Demo provider with canned sales. "Paneer Lababdar" deliberately matches
 * no menu item so the unmatched-dish flow is exercisable; "butter chicken"
 * (lowercase) exercises fuzzy matching.
 */
export const stubPosProvider: PosProvider = {
  id: "stub",
  label: "Demo POS",
  description: "Demo provider: canned sales for trying the import flow — not a live POS.",
  async fetchSales(range: PosFetchRange): Promise<PosSaleLine[]> {
    // Small artificial delay so the loading state is real in demos.
    await new Promise((resolve) => setTimeout(resolve, 250));
    return STUB_SALES.filter((line) => {
      const day = localDateOf(line.soldAt);
      return day >= range.from && day <= range.to;
    });
  },
};

/** All providers available in the import picker. */
export const POS_PROVIDERS: PosProvider[] = [stubPosProvider];

export function getPosProvider(id: string): PosProvider | null {
  return POS_PROVIDERS.find((p) => p.id === id) ?? null;
}
