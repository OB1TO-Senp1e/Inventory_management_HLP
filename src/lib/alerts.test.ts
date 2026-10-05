import { describe, expect, it } from "vitest";
import type { StockOverviewRow } from "@/api/stock";
import type { ExpiringBatch } from "@/api/notifications";
import { computeAlertConditions, diffAlerts } from "./alerts";
import { DEFAULT_ALERT_PREFERENCES } from "@/schemas/notifications";
import type { Notification } from "@/schemas/notifications";

const BASE_ROW: StockOverviewRow = {
  itemId: "b0000000-0000-0000-0000-000000000001",
  name: "Tomato",
  categoryId: null,
  categoryName: null,
  locationId: null,
  locationName: null,
  unitSymbol: "kg",
  reorderPoint: 10,
  parLevel: 50,
  quantity: 42,
  lastMovementAt: null,
  earliestExpiry: null,
};

function row(overrides: Partial<StockOverviewRow>): StockOverviewRow {
  return { ...BASE_ROW, ...overrides };
}

function batch(overrides: Partial<ExpiringBatch> = {}): ExpiringBatch {
  return {
    itemId: BASE_ROW.itemId,
    itemName: "Tomato",
    batchNo: "B-101",
    quantity: 5,
    expiryDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    ...overrides,
  };
}

function notification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: "n0000000-0000-0000-0000-000000000001",
    type: "low_stock",
    title: "Tomato is running low",
    body: "2 kg left",
    itemId: BASE_ROW.itemId,
    batchNo: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeAlertConditions", () => {
  it("flags items at or below the reorder point", () => {
    const conditions = computeAlertConditions(
      [
        row({ quantity: 10 }), // exactly at the point → alert
        row({ itemId: "b0000000-0000-0000-0000-000000000002", name: "Milk", quantity: 3 }),
        row({ itemId: "b0000000-0000-0000-0000-000000000003", name: "Flour", quantity: 11 }),
      ],
      [],
      DEFAULT_ALERT_PREFERENCES,
    );
    expect(conditions.map((c) => c.itemId).sort()).toEqual([
      "b0000000-0000-0000-0000-000000000001",
      "b0000000-0000-0000-0000-000000000002",
    ]);
    expect(conditions[0].type).toBe("low_stock");
    expect(conditions[0].batchNo).toBeNull();
    expect(conditions[0].title).toContain("Tomato");
  });

  it("skips items with a null reorder point (opted out of alerting)", () => {
    const conditions = computeAlertConditions(
      [row({ quantity: 0, reorderPoint: null as unknown as number })],
      [],
      DEFAULT_ALERT_PREFERENCES,
    );
    expect(conditions).toEqual([]);
  });

  it("produces no low-stock conditions when the type is disabled", () => {
    const conditions = computeAlertConditions(
      [row({ quantity: 1 })],
      [],
      { ...DEFAULT_ALERT_PREFERENCES, lowStockEnabled: false },
    );
    expect(conditions).toEqual([]);
  });

  it("flags expiring batches, distinguishing expired from soon", () => {
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const conditions = computeAlertConditions(
      [],
      [
        batch({ batchNo: "B-101" }),
        batch({ batchNo: "B-102", expiryDate: past }),
      ],
      DEFAULT_ALERT_PREFERENCES,
    );
    expect(conditions).toHaveLength(2);
    expect(conditions[0].type).toBe("expiring_soon");
    expect(conditions[0].title).toContain("expiring soon");
    expect(conditions[0].batchNo).toBe("B-101");
    expect(conditions[1].title).toContain("has expired");
    expect(conditions[1].body).toContain("expired");
  });

  it("produces no expiry conditions when the type is disabled", () => {
    const conditions = computeAlertConditions(
      [],
      [batch()],
      { ...DEFAULT_ALERT_PREFERENCES, expiryEnabled: false },
    );
    expect(conditions).toEqual([]);
  });

  it("returns no conditions for empty inputs", () => {
    expect(computeAlertConditions([], [], DEFAULT_ALERT_PREFERENCES)).toEqual([]);
  });
});

describe("diffAlerts", () => {
  const conditions = [
    {
      type: "low_stock" as const,
      itemId: "b0000000-0000-0000-0000-000000000001",
      batchNo: null,
      title: "Tomato is running low",
      body: "2 kg left",
    },
  ];

  it("creates notifications for conditions with no active alert", () => {
    const { toCreate, toResolve } = diffAlerts(conditions, []);
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].itemId).toBe("b0000000-0000-0000-0000-000000000001");
    expect(toResolve).toEqual([]);
  });

  it("does not re-alert a condition that already has an active notification", () => {
    const active = [notification()];
    const { toCreate, toResolve } = diffAlerts(conditions, active);
    expect(toCreate).toEqual([]);
    expect(toResolve).toEqual([]);
  });

  it("does not re-alert when the existing notification was read but is still active", () => {
    const active = [notification({ readAt: new Date().toISOString() })];
    const { toCreate, toResolve } = diffAlerts(conditions, active);
    expect(toCreate).toEqual([]);
    expect(toResolve).toEqual([]);
  });

  it("resolves notifications whose condition cleared", () => {
    const stale = notification({
      id: "n0000000-0000-0000-0000-000000000002",
      itemId: "b0000000-0000-0000-0000-000000000009",
      title: "Gone item",
    });
    const { toCreate, toResolve } = diffAlerts([], [notification(), stale]);
    expect(toCreate).toEqual([]);
    expect(toResolve.map((n) => n.id).sort()).toEqual([
      "n0000000-0000-0000-0000-000000000001",
      "n0000000-0000-0000-0000-000000000002",
    ]);
  });

  it("treats (type, item, batch) as the dedupe key across types and batches", () => {
    const active = [
      notification({
        type: "expiring_soon",
        batchNo: "B-101",
        title: "expiry",
      }),
    ];
    // Same item but a low-stock condition is a different alert → create it;
    // the expiry alert's condition is gone → resolve it.
    const { toCreate, toResolve } = diffAlerts(conditions, active);
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0].type).toBe("low_stock");
    expect(toResolve).toHaveLength(1);
    expect(toResolve[0].type).toBe("expiring_soon");
  });

  it("a cleared-then-recurring condition generates a fresh notification", () => {
    // Condition cleared (nothing active) then recurs → plain create.
    const { toCreate } = diffAlerts(conditions, []);
    expect(toCreate).toHaveLength(1);
  });
});
