import { describe, expect, it } from "vitest";
import {
  auditActionLabels,
  auditActionSchema,
  listAuditLogInputSchema,
} from "./auditLog";

describe("auditActionSchema", () => {
  it("accepts the known actions", () => {
    expect(auditActionSchema.parse("over_sale")).toBe("over_sale");
    expect(auditActionSchema.parse("stock_count_applied")).toBe(
      "stock_count_applied",
    );
  });

  it("rejects unknown actions", () => {
    expect(() => auditActionSchema.parse("tampered")).toThrow();
  });

  it("has a label for every known action", () => {
    for (const action of auditActionSchema.options) {
      expect(auditActionLabels[action]).toBeTruthy();
    }
  });
});

describe("listAuditLogInputSchema", () => {
  it("applies pagination defaults", () => {
    expect(listAuditLogInputSchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
    });
  });

  it("accepts an action filter and a date range", () => {
    const parsed = listAuditLogInputSchema.parse({
      page: 2,
      action: "over_sale",
      range: { from: "2026-10-01", to: "2026-10-05" },
    });
    expect(parsed.action).toBe("over_sale");
    expect(parsed.range).toEqual({ from: "2026-10-01", to: "2026-10-05" });
  });

  it("rejects an inverted date range", () => {
    expect(() =>
      listAuditLogInputSchema.parse({
        range: { from: "2026-10-05", to: "2026-10-01" },
      }),
    ).toThrow();
  });
});
