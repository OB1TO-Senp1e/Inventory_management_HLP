import { describe, expect, it } from "vitest";
import {
  SUPPLIER_CSV_HEADERS,
  resolveSupplierRow,
  supplierToCsvRow,
} from "./supplierCsv";
import type { Supplier } from "@/api/suppliers";

function record(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: "Fresh Farms",
    contact_person: "Ravi Kumar",
    phone: "+91 98200 12345",
    email: "ravi@freshfarms.in",
    address: "12 Market Road, Mumbai",
    gstin: "27ABCDE1234F1Z5",
    notes: "Vegetable supplier",
    ...overrides,
  };
}

describe("resolveSupplierRow", () => {
  it("resolves a fully valid row", () => {
    const result = resolveSupplierRow(record());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      name: "Fresh Farms",
      contactPerson: "Ravi Kumar",
      phone: "+91 98200 12345",
      email: "ravi@freshfarms.in",
      gstin: "27ABCDE1234F1Z5",
    });
  });

  it("turns blank optionals into null (clearing semantics)", () => {
    const result = resolveSupplierRow(
      record({
        contact_person: "",
        phone: "   ",
        email: "",
        address: "",
        gstin: "",
        notes: "",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.contactPerson).toBeNull();
    expect(result.input.phone).toBeNull();
    expect(result.input.email).toBeNull();
    expect(result.input.gstin).toBeNull();
  });

  it("uppercases the GSTIN before validation", () => {
    const result = resolveSupplierRow(record({ gstin: "27abcde1234f1z5" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.gstin).toBe("27ABCDE1234F1Z5");
  });

  it("rejects a malformed GSTIN", () => {
    const result = resolveSupplierRow(record({ gstin: "NOT-A-GSTIN" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.toLowerCase().includes("gstin"))).toBe(
      true,
    );
  });

  it("rejects a malformed email and phone", () => {
    const badEmail = resolveSupplierRow(record({ email: "not-an-email" }));
    expect(badEmail.ok).toBe(false);
    const badPhone = resolveSupplierRow(record({ phone: "abc" }));
    expect(badPhone.ok).toBe(false);
  });

  it("requires a name", () => {
    const result = resolveSupplierRow(record({ name: "  " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("Enter a supplier name.");
  });
});

describe("supplierToCsvRow", () => {
  it("emits cells in SUPPLIER_CSV_HEADERS order, round-trippable", () => {
    const supplier = {
      id: "x",
      name: "Fresh Farms",
      contactPerson: "Ravi Kumar",
      phone: "+91 98200 12345",
      email: "ravi@freshfarms.in",
      address: "12 Market Road, Mumbai",
      gstin: "27ABCDE1234F1Z5",
      notes: "Vegetable supplier",
      active: true,
      createdAt: "",
      updatedAt: "",
    } satisfies Supplier;
    const row = supplierToCsvRow(supplier);
    expect(row).toHaveLength(SUPPLIER_CSV_HEADERS.length);
    expect(row[0]).toBe("Fresh Farms");
    expect(row[5]).toBe("27ABCDE1234F1Z5");

    const back = resolveSupplierRow(
      Object.fromEntries(SUPPLIER_CSV_HEADERS.map((h, i) => [h, row[i] ?? ""])),
    );
    expect(back.ok).toBe(true);
  });

  it("emits empty strings for null optionals", () => {
    const supplier = {
      id: "x",
      name: "Local Vendor",
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      gstin: null,
      notes: null,
      active: true,
      createdAt: "",
      updatedAt: "",
    } satisfies Supplier;
    const row = supplierToCsvRow(supplier);
    expect(row.slice(1).every((c) => c === "")).toBe(true);
  });
});
