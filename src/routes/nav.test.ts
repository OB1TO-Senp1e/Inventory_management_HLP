import { describe, expect, it } from "vitest";
import { getNavItems, navLabelForPath } from "./nav";

describe("getNavItems", () => {
  it("owner sees every section including audit log and users", () => {
    const labels = getNavItems("owner").map((i) => i.label);
    expect(labels).toContain("Audit Log");
    expect(labels).toContain("Users");
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Transfers");
    expect(labels).toHaveLength(16);
  });

  it("manager sees everything except user management", () => {
    const labels = getNavItems("manager").map((i) => i.label);
    expect(labels).not.toContain("Users");
    expect(labels).not.toContain("Audit Log");
    expect(labels).toContain("Reports");
    expect(labels).toContain("Items");
    expect(labels).toContain("Transfers");
    expect(labels).toHaveLength(14);
  });

  it("staff sees only the operational sections", () => {
    const labels = getNavItems("staff").map((i) => i.label);
    expect(labels).toEqual(["Home", "Receiving", "Usage & wastage", "Stock Counts"]);
  });

  it("always starts with Home", () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      expect(getNavItems(role)[0]?.path).toBe("/");
    }
  });
});

describe("navLabelForPath", () => {
  it("labels known paths", () => {
    expect(navLabelForPath("/")).toBe("Home");
    expect(navLabelForPath("/purchase-orders")).toBe("Purchase Orders");
    expect(navLabelForPath("/audit-log")).toBe("Audit Log");
  });

  it("title-cases unknown segments", () => {
    expect(navLabelForPath("/items/abc-123")).toBe("Abc 123");
  });
});
