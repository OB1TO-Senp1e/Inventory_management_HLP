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
  { id: "a0000000-0000-0000-0000-000000000003", restaurant_id: R, name: "gram", symbol: "g", active: true },
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
    barcode: "8901234567890",
    created_at: NOW, updated_at: NOW,
    item_categories: { name: "Vegetables" },
    units: { name: "kilogram", symbol: "kg" },
    storage_locations: { name: "Cold Room" },
  },
  {
    id: "b0000000-0000-0000-0000-000000000002", restaurant_id: R, name: "Milk",
    category_id: CATEGORIES[1].id, unit_id: UNITS[1].id, storage_location_id: LOCATIONS[1].id,
    par_level: 40, reorder_point: 10, active: true, avg_unit_cost: 58,
    barcode: "8901234567891",
    created_at: NOW, updated_at: NOW,
    item_categories: { name: "Dairy" },
    units: { name: "litre", symbol: "L" },
    storage_locations: { name: "Cold Room" },
  },
  {
    id: "b0000000-0000-0000-0000-000000000003", restaurant_id: R, name: "Flour",
    category_id: CATEGORIES[0].id, unit_id: UNITS[0].id, storage_location_id: LOCATIONS[0].id,
    par_level: 100, reorder_point: 20, active: true, avg_unit_cost: 45,
    barcode: null,
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
  {
    id: "f0000000-0000-0000-0000-000000000002", supplier_id: SUPPLIERS[0].id, item_id: ITEMS[1].id,
    unit_price: 55, currency: "INR", is_preferred: true, updated_at: NOW,
    items: { name: "Milk", units: { symbol: "L" } },
    suppliers: { name: "Fresh Farms Produce" },
  },
  // Flour (ITEMS[2]) deliberately has no preferred price → unassigned group.
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
  // P5-03: today's movements for the dashboard card — dynamic "today"
  // timestamps so the IST day-boundary filter keeps them. No batch_no so
  // they stay out of the overview's batch-expiry aggregates.
  {
    id: "a0000000-0000-0000-0000-000000000005", restaurant_id: R, item_id: ITEMS[0].id,
    movement_type: "usage", quantity: -2, batch_no: null, expiry_date: null,
    unit_cost: null, reason_code: "kitchen_use", reference_type: null, notes: null,
    created_by: null, created_at: new Date().toISOString(),
  },
  {
    id: "a0000000-0000-0000-0000-000000000006", restaurant_id: R, item_id: ITEMS[1].id,
    movement_type: "wastage", quantity: -1, batch_no: null, expiry_date: null,
    unit_cost: null, reason_code: "expired", reference_type: null, notes: null,
    created_by: null, created_at: new Date().toISOString(),
  },
  // P5-04: today's sale deduction for the food-cost trend — dynamic
  // "today" timestamp so the IST day-boundary filter keeps it. Notes use
  // the exact `record_sales` format (V2-02 parses dish quantities from
  // it); two dishes share this ingredient, so both appear in the notes —
  // Butter Chicken → Puzzle, Dal Makhani → Plowhorse in menu engineering.
  {
    id: "a0000000-0000-0000-0000-000000000007", restaurant_id: R, item_id: ITEMS[0].id,
    movement_type: "sale_deduction", quantity: -4, batch_no: null, expiry_date: null,
    unit_cost: null, reason_code: null, reference_type: "sale",
    notes: `Sale ${isoDate(0)}: Butter Chicken x4, Dal Makhani x6`,
    created_by: null, created_at: new Date().toISOString(),
  },
];

const RECEIVABLE_ITEMS = ITEMS.map((item) => ({
  item_id: item.id,
  item_name: item.name,
  unit_symbol: item.units.symbol,
}));

// V2-01: canned barcode index for the find_item_by_barcode stub.
const BARCODE_INDEX: Record<string, (typeof RECEIVABLE_ITEMS)[number]> = {
  "8901234567890": RECEIVABLE_ITEMS[0],
  "8901234567891": RECEIVABLE_ITEMS[1],
};

// P5-04: supplier price history for the reports spec — one change today
// (dynamic timestamp) and one on the fixed NOW date, both inside the
// default 30-day report range.
const PRICE_HISTORY = [
  {
    id: "c1000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    supplier_id: SUPPLIERS[0].id,
    item_id: ITEMS[0].id,
    old_price: 30,
    new_price: 32.5,
    changed_by: null,
    changed_at: new Date().toISOString(),
    suppliers: { name: SUPPLIERS[0].name },
    items: { name: ITEMS[0].name },
  },
  {
    id: "c1000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    supplier_id: SUPPLIERS[0].id,
    item_id: ITEMS[0].id,
    old_price: 28,
    new_price: 30,
    changed_by: null,
    changed_at: NOW,
    suppliers: { name: SUPPLIERS[0].name },
    items: { name: ITEMS[0].name },
  },
];

const PURCHASE_ORDERS = [
  {
    id: "d0000000-0000-0000-0000-000000000001",
    supplier_id: SUPPLIERS[0].id,
    status: "draft",
    order_date: "2026-10-05",
    expected_date: "2026-10-12",
    notes: "Weekly order",
    gst_rate: 18,
    created_at: NOW,
    updated_at: NOW,
    sent_at: null,
    sent_via: null,
    suppliers: {
      name: SUPPLIERS[0].name,
      address: SUPPLIERS[0].address,
      phone: SUPPLIERS[0].phone,
      email: SUPPLIERS[0].email,
      gstin: SUPPLIERS[0].gstin,
    },
  },
  {
    id: "d0000000-0000-0000-0000-000000000002",
    supplier_id: SUPPLIERS[0].id,
    status: "sent",
    order_date: "2026-10-04",
    expected_date: "2026-10-11",
    notes: null,
    gst_rate: 0,
    created_at: NOW,
    updated_at: NOW,
    sent_at: NOW,
    sent_via: "whatsapp",
    suppliers: {
      name: SUPPLIERS[0].name,
      address: SUPPLIERS[0].address,
      phone: SUPPLIERS[0].phone,
      email: SUPPLIERS[0].email,
      gstin: SUPPLIERS[0].gstin,
    },
  },
];

const PURCHASE_ORDER_LINES = [
  {
    id: "e0000000-0000-0000-0000-000000000001",
    po_id: PURCHASE_ORDERS[0].id,
    item_id: ITEMS[0].id,
    quantity: 10,
    unit_price: 32.5,
    received_quantity: 0,
    notes: null,
    items: { name: ITEMS[0].name, units: { symbol: "kg" } },
  },
  {
    id: "e0000000-0000-0000-0000-000000000002",
    po_id: PURCHASE_ORDERS[0].id,
    item_id: ITEMS[1].id,
    quantity: 5,
    unit_price: 58,
    received_quantity: 0,
    notes: null,
    items: { name: ITEMS[1].name, units: { symbol: "L" } },
  },
  {
    id: "e0000000-0000-0000-0000-000000000003",
    po_id: PURCHASE_ORDERS[1].id,
    item_id: ITEMS[0].id,
    quantity: 20,
    unit_price: 31,
    received_quantity: 8,
    notes: null,
    items: { name: ITEMS[0].name, units: { symbol: "kg" } },
  },
];

/**
 * Lifecycle RPC stubs. `create` returns a canned PO id; `send`/`cancel`
 * return void (null body); `receive` echoes a canned partially_received
 * result. These let the deterministic specs exercise the PO UI flows without
 * a backend; the real RPC semantics are covered by supabase/tests and
 * the live e2e flow.
 *
 * `record_sales` (P4-03) is dynamic: it echoes the posted lines (resolving
 * dish names from MENU_ITEMS) and the posted sale date, so date-sensitive
 * assertions stay correct without a backend.
 */
/**
 * Outlets (V2-07). Two active outlets so the switcher renders; the profile
 * mock pins the first as current (see e2e/fixtures.ts `ri.mockOutlet`).
 */
const OUTLETS = [
  {
    id: "c0000000-0000-0000-0000-000000000011",
    restaurant_id: R,
    name: "Main outlet",
    address: null,
    is_active: true,
    is_default: true,
    created_at: NOW,
  },
  {
    id: "c0000000-0000-0000-0000-000000000012",
    restaurant_id: R,
    name: "Downtown",
    address: "42 Spice Rd",
    is_active: true,
    is_default: false,
    created_at: NOW,
  },
];

const RPC_STUBS: Record<string, unknown> = {
  "rpc:create_purchase_order": "c0000000-0000-0000-0000-000000000001",
  "rpc:send_purchase_order": null,
  "rpc:log_po_resend": null,
  "rpc:cancel_purchase_order": null,
  "rpc:ensure_current_outlet": OUTLETS[0].id,
  "rpc:receive_purchase_order": {
    po_id: PURCHASE_ORDERS[1].id,
    status: "partially_received",
    lines: [
      {
        po_line_id: "e0000000-0000-0000-0000-000000000003",
        item_id: ITEMS[0].id,
        quantity: 20,
        received_quantity: 20,
      },
    ],
  },
};

const MENU_ITEMS = [
  {
    id: "f0000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    name: "Butter Chicken",
    description: "Creamy tomato curry",
    yield_quantity: 4,
    yield_unit: "servings",
    selling_price: 199,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    recipe_ingredients: [{ count: 2 }],
  },
  {
    id: "f0000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    name: "Dal Makhani",
    description: null,
    yield_quantity: 6,
    yield_unit: "servings",
    selling_price: 149,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    recipe_ingredients: [{ count: 1 }],
  },
];

/**
 * P4-02: live total ingredient cost (full yield) per menu item.
 * Butter Chicken: 2 kg Tomato @ 32.5 = 65 + 1 L Milk @ 58 = 123
 * (yield 4 → ₹30.75/dish; food cost 30.75/199 = 15.45%).
 * Dal Makhani: 48 (yield 6 → ₹8.00/dish; food cost 8/149 = 5.37%).
 */
const MENU_ITEM_COSTS = [
  {
    restaurant_id: R,
    menu_item_id: MENU_ITEMS[0].id,
    ingredient_cost: 123,
  },
  {
    restaurant_id: R,
    menu_item_id: MENU_ITEMS[1].id,
    ingredient_cost: 48,
  },
];

const RECIPE_INGREDIENTS = [
  {
    id: "f0000000-0000-0000-0000-000000000011",
    restaurant_id: R,
    menu_item_id: MENU_ITEMS[0].id,
    item_id: ITEMS[0].id,
    quantity: 2,
    unit_id: UNITS[0].id,
    notes: null,
    items: {
      name: ITEMS[0].name,
      unit_id: UNITS[0].id,
      avg_unit_cost: 32.5,
      units: { symbol: "kg" },
    },
    units: { symbol: "kg" },
  },
  {
    id: "f0000000-0000-0000-0000-000000000012",
    restaurant_id: R,
    menu_item_id: MENU_ITEMS[0].id,
    item_id: ITEMS[1].id,
    quantity: 1,
    unit_id: UNITS[1].id,
    notes: null,
    items: {
      name: ITEMS[1].name,
      unit_id: UNITS[1].id,
      avg_unit_cost: 58,
      units: { symbol: "L" },
    },
    units: { symbol: "L" },
  },
];

const UNIT_CONVERSIONS = [
  {
    id: "f0000000-0000-0000-0000-000000000021",
    restaurant_id: R,
    from_unit_id: "a0000000-0000-0000-0000-000000000003",
    to_unit_id: UNITS[0].id,
    factor: 0.001,
  },
];

// P5-01: stock count sessions. The list select nests
// `stock_count_lines(counted_qty)`; the detail select expands full line rows
// (see the handler below, mirroring the P4-02 menu_items expansion).
const STOCK_COUNTS = [
  {
    id: "90000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    title: "Weekly full count",
    status: "in_progress",
    assigned_to: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    created_at: NOW,
    updated_at: NOW,
    stock_count_lines: [{ counted_qty: 6 }, { counted_qty: null }],
  },
  {
    id: "90000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    title: "October opening count",
    status: "submitted",
    assigned_to: null,
    created_at: NOW,
    updated_at: NOW,
    stock_count_lines: [{ counted_qty: 10 }, { counted_qty: 4 }],
  },
  // P5-02: a submitted session assigned to the staff profile, so the
  // staff-gating specs can exercise the variance review without an
  // approve affordance.
  {
    id: "90000000-0000-0000-0000-000000000003",
    restaurant_id: R,
    title: "Staff night count",
    status: "submitted",
    assigned_to: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    created_at: NOW,
    updated_at: NOW,
    stock_count_lines: [{ counted_qty: 8 }, { counted_qty: 1.5 }],
  },
];

const STOCK_COUNT_LINES = [
  {
    id: "91000000-0000-0000-0000-000000000001",
    count_id: "90000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    item_id: ITEMS[0].id,
    expected_qty: 7.5,
    counted_qty: 6,
    items: { name: ITEMS[0].name, units: { symbol: "kg" } },
  },
  {
    id: "91000000-0000-0000-0000-000000000002",
    count_id: "90000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    item_id: ITEMS[1].id,
    expected_qty: 2,
    counted_qty: null,
    items: { name: ITEMS[1].name, units: { symbol: "L" } },
  },
  // P5-02: lines for the canned submitted sessions. October opening count:
  // Tomato 8 vs 7.5 (+0.5, ~7% — normal), Milk 1.5 vs 2 (−0.5, 25% — large).
  // The staff session reuses the same variances.
  {
    id: "91000000-0000-0000-0000-000000000003",
    count_id: "90000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    item_id: ITEMS[0].id,
    expected_qty: 7.5,
    counted_qty: 8,
    items: { name: ITEMS[0].name, units: { symbol: "kg" } },
  },
  {
    id: "91000000-0000-0000-0000-000000000004",
    count_id: "90000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    item_id: ITEMS[1].id,
    expected_qty: 2,
    counted_qty: 1.5,
    items: { name: ITEMS[1].name, units: { symbol: "L" } },
  },
  {
    id: "91000000-0000-0000-0000-000000000005",
    count_id: "90000000-0000-0000-0000-000000000003",
    restaurant_id: R,
    item_id: ITEMS[0].id,
    expected_qty: 7.5,
    counted_qty: 8,
    items: { name: ITEMS[0].name, units: { symbol: "kg" } },
  },
  {
    id: "91000000-0000-0000-0000-000000000006",
    count_id: "90000000-0000-0000-0000-000000000003",
    restaurant_id: R,
    item_id: ITEMS[1].id,
    expected_qty: 2,
    counted_qty: 1.5,
    items: { name: ITEMS[1].name, units: { symbol: "L" } },
  },
];

// P5-01: profiles for the count assignee picker (v1 has no display names —
// the UI shows role + short id).
const PROFILES = [
  {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    restaurant_id: R,
    role: "staff",
  },
  {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    restaurant_id: R,
    role: "owner",
  },
];

// P5-05: canned audit entries for the owner-only audit log page.
const AUDIT_LOG = [
  {
    id: "e0000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    action: "over_sale",
    entity_type: "stock_movement",
    entity_id: null,
    details: {
      sale_date: "2026-10-05",
      lines: [{ menu_item_id: "m1", name: "Butter Chicken", dishes: 8 }],
      flagged_items: [
        {
          item_id: "i1",
          name: "Tomatoes",
          unit_symbol: "kg",
          current_quantity: 2,
          deduction_quantity: 4,
          projected_quantity: -2,
        },
      ],
    },
    created_by: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    created_at: "2026-10-05T10:00:00+05:30",
  },
  {
    id: "e0000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    action: "stock_count_applied",
    entity_type: "stock_count",
    entity_id: "c0000000-0000-0000-0000-000000000001",
    details: {
      title: "Weekly count",
      total_lines: 3,
      posted_adjustments: 2,
      adjustments: [],
    },
    created_by: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    created_at: "2026-10-03T09:00:00+05:30",
  },
];

// V2-03: smart-alert inbox. The canned conditions EXACTLY match what the
// background alert engine computes from the canned stock data, so the
// engine is a deterministic no-op in e2e (no inserts, no resolutions):
//   - Milk: 3 L on hand ≤ reorder point 10 → low-stock alert (unread);
//   - Flour: 0 kg on hand ≤ reorder point 20 → low-stock alert (read);
//   - Tomato batch B-101: 30 kg remaining, expires in 3 days (window 7)
//     → expiring-soon alert (unread).
// Newest-first: the client's listNotifications orders by created_at desc.
const NOTIFICATIONS: Record<string, unknown>[] = [
  {
    id: "c0000000-0000-0000-0000-000000000003",
    restaurant_id: R,
    // V2-07: the client selects outlet_id and the row schema requires the
    // key — pin the canned rows to the stub's default outlet.
    outlet_id: OUTLETS[0].id,
    type: "expiring_soon",
    title: "Tomato batch B-101 expiring soon",
    body: "30 kg expire soon",
    item_id: ITEMS[0].id,
    batch_no: "B-101",
    read_at: null,
    created_at: "2026-10-05T08:30:00.000Z",
  },
  {
    id: "c0000000-0000-0000-0000-000000000001",
    restaurant_id: R,
    outlet_id: OUTLETS[0].id,
    type: "low_stock",
    title: "Milk is running low",
    body: "3 L left (reorder at 10 L)",
    item_id: ITEMS[1].id,
    batch_no: null,
    read_at: null,
    created_at: "2026-10-05T08:00:00.000Z",
  },
  {
    id: "c0000000-0000-0000-0000-000000000002",
    restaurant_id: R,
    outlet_id: OUTLETS[0].id,
    type: "low_stock",
    title: "Flour is running low",
    body: "0 kg left (reorder at 20 kg)",
    item_id: ITEMS[2].id,
    batch_no: null,
    read_at: "2026-10-05T09:00:00.000Z",
    created_at: "2026-10-05T07:00:00.000Z",
  },
];

const ALERT_PREFERENCES = [
  {
    restaurant_id: R,
    low_stock_enabled: true,
    expiry_enabled: true,
    expiry_days_window: 7,
  },
];

// V2-06: imported POS sale tracking. The import_pos_sales RPC stub records
// each posted external_sale_id here so a refetch (listImportedExternalIds)
// shows "already imported" — the dedupe loop specs assert on it. Reset on
// every stubBackend() call so each spec starts clean.
const POS_IMPORTS: { external_sale_id: string; provider: string }[] = [];

function resetPosStubs(): void {
  POS_IMPORTS.length = 0;
}

// V2-03: the PATCH/POST merge blocks above mutate these arrays in place so
// specs see posted state on refetch. Reset them on every stubBackend()
// call so each spec starts from the same canned inbox.
const INITIAL_NOTIFICATIONS = structuredClone(NOTIFICATIONS);
const INITIAL_ALERT_PREFERENCES = structuredClone(ALERT_PREFERENCES);

function resetAlertStubs(): void {
  NOTIFICATIONS.length = 0;
  NOTIFICATIONS.push(...structuredClone(INITIAL_NOTIFICATIONS));
  ALERT_PREFERENCES.length = 0;
  ALERT_PREFERENCES.push(...structuredClone(INITIAL_ALERT_PREFERENCES));
}

const TABLES: Record<string, Record<string, unknown>[]> = {
  item_categories: CATEGORIES,
  storage_locations: LOCATIONS,
  units: UNITS,
  items: ITEMS,
  outlets: OUTLETS,
  suppliers: SUPPLIERS,
  supplier_prices: SUPPLIER_PRICES,
  supplier_price_history: PRICE_HISTORY,
  current_stock: CURRENT_STOCK,
  stock_movements: STOCK_MOVEMENTS,
  "rpc:list_receivable_items": RECEIVABLE_ITEMS,
  purchase_orders: PURCHASE_ORDERS,
  purchase_order_lines: PURCHASE_ORDER_LINES,
  menu_items: MENU_ITEMS,
  menu_item_costs: MENU_ITEM_COSTS,
  recipe_ingredients: RECIPE_INGREDIENTS,
  unit_conversions: UNIT_CONVERSIONS,
  restaurants: [{ id: R, name: "Testaurant", created_at: NOW, updated_at: NOW }],
  stock_counts: STOCK_COUNTS,
  stock_count_lines: STOCK_COUNT_LINES,
  profiles: PROFILES,
  audit_log: AUDIT_LOG,
  notifications: NOTIFICATIONS,
  alert_preferences: ALERT_PREFERENCES,
  pos_imports: POS_IMPORTS,
};

/** Tiny PostgREST subset: eq/neq/ilike filters, limit/offset, content-range. */
async function handle(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const seg = url.pathname.split("/").filter(Boolean);
  const key = seg[2] === "rpc" ? `rpc:${seg[3]}` : seg[2];

  // Lifecycle RPC stubs return their canned payload directly.
  if (key in RPC_STUBS) {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(RPC_STUBS[key]),
    });
    return;
  }

  // P6-02: the offline queue replays through log_wastage / log_usage /
  // receive_goods. These stubs return valid payloads so the drain specs can
  // assert a real sync with zero backend; a spec can override any of them
  // with a later page.route to simulate a server rejection.
  if (key === "rpc:log_wastage" || key === "rpc:log_usage") {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify("d0000000-0000-0000-0000-000000000001"),
    });
    return;
  }

  if (key === "rpc:receive_goods") {
    const body = (await route.request().postDataJSON()) as {
      p_lines: {
        item_id: string;
        quantity: number;
        unit_cost: number;
      }[];
    };
    const lines = (body.p_lines ?? []).map((line, index) => ({
      movement_id: `e0000000-0000-0000-0000-00000000000${index + 1}`,
      item_id: line.item_id,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      old_avg_cost: line.unit_cost,
      new_avg_cost: line.unit_cost,
    }));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(lines),
    });
    return;
  }

  // V2-07: switch_outlet echoes the chosen outlet row so the switcher spec
  // can assert the UI updates with zero backend.
  if (key === "rpc:switch_outlet") {
    const body = (await route.request().postDataJSON()) as {
      p_outlet_id: string;
    };
    const outlet =
      OUTLETS.find((o) => o.id === body.p_outlet_id) ?? OUTLETS[0];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outlet),
    });
    return;
  }

  // V2-07: transfer_stock echoes a canned transfer result shaped to the
  // TransferResult schema, resolving names from the stub tables.
  if (key === "rpc:transfer_stock") {
    const body = (await route.request().postDataJSON()) as {
      p_to_outlet_id: string;
      p_item_id: string;
      p_quantity: number;
      p_batch_no: string | null;
      p_notes: string | null;
    };
    const toOutlet =
      OUTLETS.find((o) => o.id === body.p_to_outlet_id) ?? OUTLETS[1];
    const item = ITEMS.find((i) => i.id === body.p_item_id) ?? ITEMS[0];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transfer_id: "d0000000-0000-0000-0000-000000000001",
        from_outlet_id: OUTLETS[0].id,
        from_outlet_name: OUTLETS[0].name,
        to_outlet_id: toOutlet.id,
        to_outlet_name: toOutlet.name,
        item_id: item.id,
        item_name: item.name,
        quantity: body.p_quantity,
        unit_symbol: "kg",
        batch_no: body.p_batch_no,
        transfer_out_movement_id: "d0000000-0000-0000-0000-000000000002",
        transfer_in_movement_id: "d0000000-0000-0000-0000-000000000003",
      }),
    });
    return;
  }

  // P4-03: record_sales echoes the posted entry so the sales specs can
  // assert on the real summary (sale date + dish names) with zero backend.
  if (key === "rpc:record_sales") {
    const body = (await route.request().postDataJSON()) as {
      p_lines: { menu_item_id: string; dishes: number }[];
      p_sale_date: string;
    };
    const lines = (body.p_lines ?? []).map((line) => ({
      menu_item_id: line.menu_item_id,
      name:
        MENU_ITEMS.find((m) => m.id === line.menu_item_id)?.name ?? "Unknown",
      dishes: line.dishes,
    }));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sale_date: body.p_sale_date,
        lines,
        ingredients: [
          {
            item_id: ITEMS[0].id,
            name: ITEMS[0].name,
            quantity: 2,
            unit_symbol: "kg",
          },
        ],
      }),
    });
    return;
  }

  // V2-06: import_pos_sales records each posted external_sale_id in the
  // per-test POS_IMPORTS set (so refetch shows "already imported") and
  // echoes the posted lines aggregated per dish in the real RPC's shape —
  // { provider, sale_date, imported, sales: { sale_date, lines,
  // ingredients } } — mirroring record_sales for the inner summary.
  if (key === "rpc:import_pos_sales") {
    const body = (await route.request().postDataJSON()) as {
      p_provider: string;
      p_sales: { external_sale_id: string; menu_item_id: string; dishes: number }[];
      p_sale_date: string;
    };
    const sales = body.p_sales ?? [];
    for (const sale of sales) {
      if (
        !POS_IMPORTS.some(
          (row) =>
            row.external_sale_id === sale.external_sale_id &&
            row.provider === body.p_provider,
        )
      ) {
        POS_IMPORTS.push({
          external_sale_id: sale.external_sale_id,
          provider: body.p_provider,
        });
      }
    }
    const byDish = new Map<string, number>();
    for (const sale of sales) {
      byDish.set(
        sale.menu_item_id,
        (byDish.get(sale.menu_item_id) ?? 0) + sale.dishes,
      );
    }
    const lines = [...byDish.entries()].map(([menu_item_id, dishes]) => ({
      menu_item_id,
      name: MENU_ITEMS.find((m) => m.id === menu_item_id)?.name ?? "Unknown",
      dishes,
    }));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: body.p_provider,
        sale_date: body.p_sale_date,
        imported: sales.length,
        sales: {
          sale_date: body.p_sale_date,
          lines,
          ingredients: [
            {
              item_id: ITEMS[0].id,
              name: ITEMS[0].name,
              quantity: 2,
              unit_symbol: "kg",
            },
          ],
        },
      }),
    });
    return;
  }

  // P4-04: preview_sales_deductions computes deductions from the canned
  // recipes against canned current stock, so the over-sale specs can assert
  // the real warning dialog with zero backend. Tomato: 4 kg on hand, Milk:
  // 2 L on hand. Butter Chicken (yield 4) deducts 2 kg Tomato + 1 L Milk
  // per 4 dishes — 12 dishes flags both (Tomato projects to -2 kg);
  // 6 dishes (the aggregation spec) stays within stock.
  if (key === "rpc:preview_sales_deductions") {
    const body = (await route.request().postDataJSON()) as {
      p_lines: { menu_item_id: string; dishes: number }[];
    };
    const PREVIEW_STOCK: Record<string, number> = {
      [ITEMS[0].id]: 4,
      [ITEMS[1].id]: 2,
    };
    const byItem = new Map<
      string,
      { name: string; unit: string; deduction: number }
    >();
    for (const line of body.p_lines ?? []) {
      const dish = MENU_ITEMS.find((m) => m.id === line.menu_item_id);
      if (!dish) {
        continue;
      }
      for (const ing of RECIPE_INGREDIENTS.filter(
        (r) => r.menu_item_id === dish.id,
      )) {
        // The canned recipes use base units only (factor 1), same as the
        // one-hop conversion the real RPC applies.
        const deduction = (line.dishes * ing.quantity) / dish.yield_quantity;
        const prev = byItem.get(ing.item_id);
        if (prev) {
          prev.deduction += deduction;
        } else {
          byItem.set(ing.item_id, {
            name: ing.items.name,
            unit: ing.units.symbol,
            deduction,
          });
        }
      }
    }
    const rows = [...byItem.entries()].map(([item_id, v]) => {
      const current = PREVIEW_STOCK[item_id] ?? 0;
      return {
        item_id,
        item_name: v.name,
        unit_symbol: v.unit,
        current_quantity: current,
        deduction_quantity: v.deduction,
        projected_quantity: current - v.deduction,
        would_go_negative: current - v.deduction < 0,
      };
    });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rows),
    });
    return;
  }

  // P5-02: apply_stock_count computes adjustments from the canned lines
  // for the posted session (variance = counted − expected, zero-variance
  // lines post nothing), mirroring the real RPC's summary shape.
  if (key === "rpc:apply_stock_count") {
    const body = (await route.request().postDataJSON()) as {
      p_count_id: string;
    };
    const session = STOCK_COUNTS.find((s) => s.id === body.p_count_id);
    const lines = STOCK_COUNT_LINES.filter(
      (line) => line.count_id === body.p_count_id,
    );
    const adjustments = lines
      .map((line) => ({
        item_id: line.item_id,
        name: line.items.name,
        unit_symbol: line.items.units.symbol,
        expected_qty: line.expected_qty,
        counted_qty: line.counted_qty ?? 0,
        variance:
          Math.round((Number(line.counted_qty ?? 0) - line.expected_qty) * 1e6) /
          1e6,
      }))
      .filter((a) => a.variance !== 0);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        count_id: body.p_count_id,
        title: session?.title ?? "Unknown",
        status: "applied",
        total_lines: lines.length,
        posted_adjustments: adjustments.length,
        adjustments,
      }),
    });
    return;
  }

  // V2-01: find_item_by_barcode resolves canned barcodes to receivable
  // rows; unknown codes return [] so the client maps them to null
  // ("not found", not an error). Mirrors the generic object-accept branch
  // below because the client calls .maybeSingle().
  if (key === "rpc:find_item_by_barcode") {
    const body = (await route.request().postDataJSON()) as {
      p_barcode: string;
    };
    const match = BARCODE_INDEX[(body.p_barcode ?? "").trim()];
    const found = match ? [match] : [];
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const accept = route.request().headers()["accept"] ?? "";
    if (accept.includes("vnd.pgrst.object")) {
      if (found.length === 0) {
        await route.fulfill({ status: 406, headers, body: "{}" });
      } else {
        await route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify(found[0]),
        });
      }
      return;
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify(found) });
    return;
  }

  // V2-03: DELETE removes the canned notification in place so dismiss
  // specs see it gone after the UI refetches.
  if (route.request().method() === "DELETE" && key === "notifications") {
    const idMatch = /^eq\.(.*)$/.exec(url.searchParams.get("id") ?? "");
    if (idMatch) {
      const idx = NOTIFICATIONS.findIndex(
        (row) => String(row["id"]) === idMatch[1],
      );
      if (idx >= 0) {
        NOTIFICATIONS.splice(idx, 1);
      }
    }
  }

  // V2-03: upsert_alert_preferences merges the posted fields into the
  // canned preference row in place (so the settings specs see the saved
  // state after the UI refetches) and echoes the row back, mirroring the
  // real RPC's single-row return shape.
  if (key === "rpc:upsert_alert_preferences") {
    const body = (await route.request().postDataJSON()) as {
      p_low_stock_enabled: boolean;
      p_expiry_enabled: boolean;
      p_expiry_days_window: number;
    };
    Object.assign(ALERT_PREFERENCES[0], {
      low_stock_enabled: body.p_low_stock_enabled,
      expiry_enabled: body.p_expiry_enabled,
      expiry_days_window: body.p_expiry_days_window,
    });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ALERT_PREFERENCES[0]),
    });
    return;
  }

  let rows = [...(TABLES[key] ?? [])];

  // P5-01: create_stock_count echoes the posted title/assignee as a new
  // draft session row, so the create-dialog specs can assert the real
  // success path (toast + "open the count sheet") with zero backend.
  if (key === "rpc:create_stock_count") {
    const body = (await route.request().postDataJSON()) as {
      p_title: string;
      p_assigned_to: string | null;
    };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "90000000-0000-0000-0000-000000000003",
        restaurant_id: R,
        title: body.p_title,
        status: "draft",
        assigned_to: body.p_assigned_to,
        created_at: NOW,
        updated_at: NOW,
      }),
    });
    return;
  }

  // P5-01: the count detail select asks for full line rows while the list
  // select asks for `stock_count_lines(counted_qty)`. The canned sessions
  // carry the count shape, so expand the nested rows for detail-shaped
  // selects — otherwise the detail Zod schema rejects the response.
  if (key === "stock_counts") {
    const select = url.searchParams.get("select") ?? "";
    if (select.includes("stock_count_lines(id,")) {
      rows = rows.map((row) => ({
        ...row,
        stock_count_lines: STOCK_COUNT_LINES.filter(
          (line) => line.count_id === row["id"],
        ),
      }));
    }
  }

  // P5-01: merge PATCH bodies into the returned rows (scoped to the counts
  // tables) so save-progress and submit specs see the state they posted —
  // the UI refetches after both mutations.
  if (
    route.request().method() === "PATCH" &&
    (key === "stock_counts" || key === "stock_count_lines")
  ) {
    let patchBody: Record<string, unknown> = {};
    try {
      patchBody =
        ((await route.request().postDataJSON()) as Record<
          string,
          unknown
        >) ?? {};
    } catch {
      // No JSON body — return the rows unchanged.
    }
    rows = rows.map((row) => ({ ...row, ...patchBody }));
  }

  // V2-03: merge PATCH bodies into the CANNED notifications in place (not
  // just the per-request copy) so mark-read / mark-all-read specs see the
  // posted state after the UI refetches. Scoped by the optional id=eq.X
  // filter; without it (mark-all-read) every row is patched.
  if (route.request().method() === "PATCH" && key === "notifications") {
    let patchBody: Record<string, unknown> = {};
    try {
      patchBody =
        ((await route.request().postDataJSON()) as Record<
          string,
          unknown
        >) ?? {};
    } catch {
      // No JSON body — return the rows unchanged.
    }
    const idMatch = /^eq\.(.*)$/.exec(url.searchParams.get("id") ?? "");
    for (const row of NOTIFICATIONS) {
      if (idMatch && String(row["id"]) !== idMatch[1]) {
        continue;
      }
      Object.assign(row, patchBody);
    }
  }

  // V2-07: outlets POST creates a canned row (echoing the posted name /
  // address) and PATCH merges into the canned rows in place, so the
  // management specs see the state they posted after the UI refetches.
  if (key === "outlets" && route.request().method() === "POST") {
    let postBody: Record<string, unknown> = {};
    try {
      postBody =
        ((await route.request().postDataJSON()) as Record<string, unknown>) ??
        {};
    } catch {
      // No JSON body — fall through to the canned rows.
    }
    if (typeof postBody["name"] === "string" && postBody["name"]) {
      const created = {
        id: "c0000000-0000-0000-0000-000000000013",
        restaurant_id: R,
        name: postBody["name"] as string,
        address:
          typeof postBody["address"] === "string"
            ? (postBody["address"] as string)
            : null,
        is_active: true,
        is_default: false,
        created_at: NOW,
      };
      OUTLETS.push(created);
      await route.fulfill({
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(created),
      });
      return;
    }
  }
  if (key === "outlets" && route.request().method() === "PATCH") {
    let patchBody: Record<string, unknown> = {};
    try {
      patchBody =
        ((await route.request().postDataJSON()) as Record<
          string,
          unknown
        >) ?? {};
    } catch {
      // No JSON body — return the rows unchanged.
    }
    const idMatch = /^eq\.(.*)$/.exec(url.searchParams.get("id") ?? "");
    for (const row of OUTLETS) {
      if (idMatch && String(row["id"]) !== idMatch[1]) {
        continue;
      }
      Object.assign(row, patchBody);
    }
  }

  // P4-02: the recipe detail select asks for full ingredient rows while the
  // list select asks for `recipe_ingredients(count)`. The canned menu_items
  // rows carry the count shape, so expand the nested rows for detail-shaped
  // selects — otherwise the detail Zod schema rejects the response.
  if (key === "menu_items") {
    const select = url.searchParams.get("select") ?? "";
    if (
      select.includes("recipe_ingredients(") &&
      !select.includes("recipe_ingredients(count)")
    ) {
      rows = rows.map((row) => ({
        ...row,
        recipe_ingredients: RECIPE_INGREDIENTS.filter(
          (ing) => ing.menu_item_id === row["id"],
        ),
      }));
    }
  }

  // P5-04: the reports queries select `items(name, avg_unit_cost,
  // units(symbol))` on stock_movements — expand the nested item the same
  // way the menu_items block above expands recipe ingredients.
  if (key === "stock_movements") {
    const select = url.searchParams.get("select") ?? "";
    if (select.includes("items(name")) {
      rows = rows.map((row) => {
        const item = ITEMS.find((i) => i.id === row["item_id"]);
        return {
          ...row,
          items: item
            ? {
                name: item.name,
                avg_unit_cost: item.avg_unit_cost,
                units: { symbol: item.units.symbol },
              }
            : null,
        };
      });
    }
  }

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
    const inMatch = /^in\.\((.*)\)$/.exec(value);
    if (inMatch) {
      const values = inMatch[1].split(",");
      rows = rows.filter((row) => values.includes(String(row[param])));
      continue;
    }
    const m = /^(eq|neq|ilike|gte|lte|gt|lt)\.(.*)$/.exec(value);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((row) => {
      const v = row[param];
      const s = v === null || v === undefined ? "" : String(v);
      if (op === "eq") return s === raw;
      if (op === "neq") return s !== raw;
      // Range ops compare as strings — correct for ISO timestamps and
      // numeric strings PostgREST returns.
      if (op === "gte") return s >= raw;
      if (op === "lte") return s <= raw;
      if (op === "gt") return s > raw;
      if (op === "lt") return s < raw;
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
  resetAlertStubs();
  resetPosStubs();
  await page.route("**/rest/v1/**", handle);
}
