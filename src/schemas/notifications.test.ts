import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALERT_PREFERENCES,
  createNotificationSchema,
  notificationKey,
  notificationTypeLabels,
  updateAlertPreferencesSchema,
} from "./notifications";

describe("notificationKey", () => {
  it("builds a stable dedupe key per (type, item, batch)", () => {
    expect(
      notificationKey("low_stock", "item-1", null),
    ).toBe("low_stock|item-1|");
    expect(
      notificationKey("expiring_soon", "item-1", "B-1"),
    ).toBe("expiring_soon|item-1|B-1");
    // Type and batch both participate in the key.
    expect(
      notificationKey("low_stock", "item-1", null),
    ).not.toBe(notificationKey("expiring_soon", "item-1", null));
    expect(
      notificationKey("expiring_soon", "item-1", "B-1"),
    ).not.toBe(notificationKey("expiring_soon", "item-1", "B-2"));
  });
});

describe("notificationTypeLabels", () => {
  it("labels both types", () => {
    expect(notificationTypeLabels.low_stock).toBe("Low stock");
    expect(notificationTypeLabels.expiring_soon).toBe("Expiring soon");
  });
});

describe("DEFAULT_ALERT_PREFERENCES", () => {
  it("enables both types with a 7-day window", () => {
    expect(DEFAULT_ALERT_PREFERENCES).toEqual({
      lowStockEnabled: true,
      expiryEnabled: true,
      expiryDaysWindow: 7,
    });
  });
});

describe("createNotificationSchema", () => {
  const valid = {
    type: "low_stock",
    title: "Milk is running low",
    itemId: "b0000000-0000-0000-0000-000000000002",
    batchNo: null,
  };

  it("accepts a valid payload and trims the title", () => {
    const parsed = createNotificationSchema.parse({
      ...valid,
      title: "  Milk is running low  ",
    });
    expect(parsed.title).toBe("Milk is running low");
    expect(parsed.body).toBe("");
  });

  it("rejects blank titles and unknown types", () => {
    expect(() =>
      createNotificationSchema.parse({ ...valid, title: "  " }),
    ).toThrow();
    expect(() =>
      createNotificationSchema.parse({ ...valid, type: "overstock" }),
    ).toThrow();
  });

  it("rejects an over-long batch code", () => {
    expect(() =>
      createNotificationSchema.parse({ ...valid, batchNo: "x".repeat(65) }),
    ).toThrow();
  });
});

describe("updateAlertPreferencesSchema", () => {
  it("accepts partial patches and bounds the window", () => {
    expect(
      updateAlertPreferencesSchema.parse({ expiryDaysWindow: 14 }),
    ).toEqual({ expiryDaysWindow: 14 });
    expect(() =>
      updateAlertPreferencesSchema.parse({ expiryDaysWindow: 0 }),
    ).toThrow();
    expect(() =>
      updateAlertPreferencesSchema.parse({ expiryDaysWindow: 91 }),
    ).toThrow();
    expect(() =>
      updateAlertPreferencesSchema.parse({ expiryDaysWindow: 1.5 }),
    ).toThrow();
  });
});
