import type { Page, Route } from "@playwright/test";

/**
 * Deterministic backend stub for e2e specs.
 *
 * `stubBackend(page)` intercepts Supabase REST calls (`**\/rest/v1/**`) and
 * serves minimal canned rows, so specs exercise the REAL UI (forms, tables,
 * pickers) with zero backend. Requires the e2e build to contain a Supabase
 * URL — `pnpm test:e2e` builds with a dummy one (see playwright.config.ts);
 * without a URL the client throws before any request and there is nothing
 * to intercept.
 * Responses are shaped to satisfy the Zod row schemas in `src/api/*` — if an API select changes shape, the stubbed specs
 * fail loudly instead of silently rendering nothing.
 *
 * This does NOT replace the `E2E_LIVE_SUPABASE=1` live specs (real backend,
 * run in CI); it replaces the old "backend-aware branch" pattern where
 * specs asserted error states instead of the feature UI. Specs that
 * specifically test the no-backend error path must NOT call this helper.
 *
 * Auth still comes from the `role` fixture (`ri.mockRole`); RLS remains the
 * real enforcement and is covered by `supabase/tests/*.sql`.
 */

const R = "11111111-1111-1111-1111-111111111111";
const NOW = "2026-10-04T08:30:00.000Z";

const UNITS = [
  { id: "a0000000-0000-0000-0000-000000000001", restaurant_id: R, name: "kilogram", symbol: "kg", active: true },
  { id: "a0000000-0000-0000-0000-000000000002", restaurant_id: R, name: "litre", symbol: "L", active: true },
];

const CATEGORIES = [
  { id: "c0000000-0000-0000-0000-000000000001", restaurant_id: R, name: "Vegetables", active: true, created_at: NOW, updated_at: NOW },
  { id: "c0000000-0000-0000-0000-000000000002", restaurant_id: R, name: "Dairy", active: true, created_at: NOW, updated_at: NOW },
];

const LOCATIONS = [
  { id: "d0000000-0000-0000-0000-000000000001", restaurant_id: R, name: "Dry Store", active: true, created_at: NOW, updated_at: NOW },
  { id: "d0000000-0000-0000-0000-000000000002", restaurant_id: R, name: "Cold Room", active: true, created_at: NOW, updated_at: NOW },
];

const ITEMS = [
  {
    id: "b0000000-0000-0000-0000-000000000001", restaurant_id: R, name: "Tomato",
    category_id: CATEGORIES[0].id, unit_id: UNITS[0].id, storage_location_id: LOCATIONS[1].id,
    par_level: 50, reorder_point: 10, active: true, avg_unit_cost: 32.5,
    created_at: NOW, updated_at: NOW,
    item_categories: { name: "Vegetables" },
    units: { name: "kilogram", symbol: "kg" },
    storage_locations: { name: "Cold Room" },
  },
  {
    id: "b0000000-0000-0000-0000-000000000002", restaurant_id: R, name: "Milk",
    category_id: CATEGORIES[1].id, unit_id: UNITS[1].id, storage_location_id: LOCATIONS[1].id,
    par_level: 40, reorder_point: 10, active: true, avg_unit_cost: 58,
    created_at: NOW, updated_at: NOW,
    item_categories: { name: "Dairy" },
    units: { name: "litre", symbol: "L" },
    storage_locations: { name: "Cold Room" },
  },
  {
    id: "b0000000-0000-0000-0000-000000000003", restaurant_id: R, name: "Flour",
    category_id: CATEGORIES[0].id, unit_id: UNITS[0].id, storage_location_id: LOCATIONS[0].id,
    par_level: 100, reorder_point: 20, active: true, avg_unit_cost: 45,
    created_at: NOW, updated_at: NOW,
    item_categories: { name: "Vegetables" },
    units: { name: "kilogram", symbol: "kg" },
    storage_locations: { name: "Dry Store" },
  },
];

/** ISO date relative to today — keeps expiry-based specs deterministic. */
function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const SUPPLIERS = [
  {
    id: "e0000000-0000-0000-0000-000000000001", restaurant_id: R, name: "Fresh Farms Produce",
    contact_person: "Ramesh Kumar", phone: "+91 98200 12345", email: "ramesh@freshfarms.example",
    address: "APMC Market, Vashi", gstin: "27ABCDE1234F1Z5", notes: null,
    active: true, created_at: NOW, updated_at: NOW,
  },
];

const SUPPLIER_PRICES = [
  {
    id: "f0000000-0000-0000-0000-000000000001", supplier_id: SUPPLIERS[0].id, item_id: ITEMS[0].id,
    unit_price: 30, currency: "INR", is_preferred: true, updated_at: NOW,
    items: { name: "Tomato", units: { symbol: "kg" } },
    suppliers: { name: "Fresh Farms Produce" },
  },
];

const CURRENT_STOCK = [
  {
    restaurant_id: R,
    item_id: ITEMS[0].id,
    quantity: 42.5,
    last_movement_at: NOW,
  },
  {
    restaurant_id: R,
    item_id: ITEMS[1].id,
    quantity: 3, // low stock (reorder point 10)
    last_movement_at: NOW,
  },
  // Flour (ITEMS[2]) has no movements → quantity 0 in the overview.
];

const STOCK_MOVEMENTS = [
  // Tomato batch B-101: 50 in, 20 used → 30 remaining, expires in 3 days.
  {
    id: "a0000000-0000-0000-0000-000000000001", restaurant_id: R, item_id: ITEMS[0].id,
    movement_type: "receipt", quantity: 50, batch_no: "B-101", expiry_date: isoDate(3),
    unit_cost: 30, reason_code: null, reference_type: "ad_hoc", notes: null,
    created_by: null, created_at: NOW,
  },
  {
    id: "a0000000-0000-0000-0000-000000000002", restaurant_id: R, item_id: ITEMS[0].id,
    movement_type: "usage", quantity: -20, batch_no: "B-101", expiry_date: isoDate(3),
    unit_cost: null, reason_code: "kitchen_use", reference_type: null, notes: null,
    created_by: null, created_at: NOW,
  },
  // Tomato batch B-100: fully consumed → must not count as expiring.
  {
    id: "a0000000-0000-0000-0000-000000000003", restaurant_id: R, item_id: ITEMS[0].id,
    movement_type: "receipt", quantity: 10, batch_no: "B-100", expiry_date: isoDate(1),
    unit_cost: 28, reason_code: null, reference_type: "ad_hoc", notes: null,
    created_by: null, created_at: NOW,
  },
  {
    id: "a0000000-0000-0000-0000-000000000004", restaurant_id: R, item_id: ITEMS[0].id,
    movement_type: "usage", quantity: -10, batch_no: "B-100", expiry_date: isoDate(1),
    unit_cost: null, reason_code: "kitchen_use", reference_type: null, notes: null,
    created_by: null, created_at: NOW,
  },
];

const RECEIVABLE_ITEMS = ITEMS.map((item) => ({
  item_id: item.id,
  item_name: item.name,
  unit_symbol: item.units.symbol,
}));

const TABLES: Record<string, Record<string, unknown>[]> = {
  item_categories: CATEGORIES,
  storage_locations: LOCATIONS,
  units: UNITS,
  items: ITEMS,
  suppliers: SUPPLIERS,
  supplier_prices: SUPPLIER_PRICES,
  supplier_price_history: [],
  current_stock: CURRENT_STOCK,
  stock_movements: STOCK_MOVEMENTS,
  "rpc:list_receivable_items": RECEIVABLE_ITEMS,
};

/** Tiny PostgREST subset: eq/neq/ilike filters, limit/offset, content-range. */
async function handle(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const seg = url.pathname.split("/").filter(Boolean);
  const key = seg[2] === "rpc" ? `rpc:${seg[3]}` : seg[2];
  let rows = [...(TABLES[key] ?? [])];

  for (const [param, value] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(param)) continue;
    if (value === "not.is.null") {
      rows = rows.filter((row) => row[param] !== null && row[param] !== undefined);
      continue;
    }
    if (value === "is.null") {
      rows = rows.filter((row) => row[param] === null || row[param] === undefined);
      continue;
    }
    const m = /^(eq|neq|ilike)\.(.*)$/.exec(value);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((row) => {
      const v = row[param];
      const s = v === null || v === undefined ? "" : String(v);
      if (op === "eq") return s === raw;
      if (op === "neq") return s !== raw;
      // ilike: treat % as wildcard on both sides
      return s.toLowerCase().includes(raw.replace(/%/g, "").toLowerCase());
    });
  }

  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : rows.length;
  const offset = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : 0;
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-range": `${offset}-${offset + page.length - 1}/${total}`,
  };
  const accept = route.request().headers()["accept"] ?? "";
  if (accept.includes("vnd.pgrst.object")) {
    if (page.length === 0) {
      await route.fulfill({ status: 406, headers, body: "{}" });
    } else {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(page[0]) });
    }
    return;
  }
  await route.fulfill({ status: 200, headers, body: JSON.stringify(page) });
}

/**
 * Install the stub on the page. Call before `page.goto()`.
 * Auth endpoints are left alone (the `role` fixture handles sessions).
 */
export async function stubBackend(page: Page): Promise<void> {
  await page.route("**/rest/v1/**", handle);
}
