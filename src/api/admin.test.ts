import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "@/lib/supabase";
import { listAuditLogEntries, summarizeAuditDetails } from "./admin";

// No network in these tests: the client factory is mocked outright.
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn() }));

const mockedGetSupabaseClient = vi.mocked(getSupabaseClient);

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
}

/**
 * Thenable chainable mock: every builder method returns the builder itself
 * and awaiting it resolves the canned result.
 */
function chainable(result: QueryResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lte", "in", "order", "range"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder["then"] = (resolve: (value: QueryResult) => void) => resolve(result);
  return builder;
}

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const AUDIT_ROW = {
  id: "e0000000-0000-0000-0000-000000000001",
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
  created_by: OWNER_ID,
  created_at: "2026-10-05T10:00:00+05:30",
};

function mockClient(audit: QueryResult, profiles: QueryResult): void {
  const from = vi.fn((table: string) => {
    if (table === "audit_log") return chainable(audit);
    return chainable(profiles);
  });
  mockedGetSupabaseClient.mockReturnValue({ from } as unknown as SupabaseClient);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("summarizeAuditDetails", () => {
  it("summarizes an over_sale entry", () => {
    expect(summarizeAuditDetails("over_sale", AUDIT_ROW.details)).toBe(
      "Sale 2026-10-05 — 1 dish sold; below-zero items: Tomatoes (2 → -2 kg)",
    );
  });

  it("summarizes a stock_count_applied entry", () => {
    expect(
      summarizeAuditDetails("stock_count_applied", {
        title: "Weekly count",
        total_lines: 3,
        posted_adjustments: 2,
        adjustments: [],
      }),
    ).toBe('Count "Weekly count" — 2 of 3 lines adjusted');
  });

  it("falls back to JSON for unknown actions", () => {
    expect(summarizeAuditDetails("mystery", { a: 1 })).toBe('{"a":1}');
  });
});

describe("listAuditLogEntries", () => {
  it("maps rows, enriches the actor role, and returns the total", async () => {
    mockClient(
      { data: [AUDIT_ROW], error: null, count: 1 },
      {
        data: [{ id: OWNER_ID, role: "owner" }],
        error: null,
      },
    );
    const result = await listAuditLogEntries({ page: 1, pageSize: 25 });
    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: AUDIT_ROW.id,
      action: "over_sale",
      actionLabel: "Over sale",
      createdBy: OWNER_ID,
      createdByRole: "owner",
      createdAt: AUDIT_ROW.created_at,
    });
    expect(result.entries[0].summary).toContain("Sale 2026-10-05");
  });

  it("passes action and date filters to the query builder", async () => {
    mockClient(
      { data: [], error: null, count: 0 },
      { data: [], error: null },
    );
    await listAuditLogEntries({
      page: 2,
      pageSize: 10,
      action: "over_sale",
      range: { from: "2026-10-01", to: "2026-10-05" },
    });
    const auditBuilder = (
      mockedGetSupabaseClient.mock.results[0].value as { from: ReturnType<typeof vi.fn> }
    ).from.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(auditBuilder["eq"]).toHaveBeenCalledWith("action", "over_sale");
    expect(auditBuilder["gte"]).toHaveBeenCalledWith(
      "created_at",
      "2026-10-01T00:00:00+05:30",
    );
    expect(auditBuilder["lte"]).toHaveBeenCalledWith(
      "created_at",
      "2026-10-05T23:59:59.999+05:30",
    );
    expect(auditBuilder["range"]).toHaveBeenCalledWith(10, 19);
  });

  it("leaves the actor role null when created_by is missing", async () => {
    mockClient(
      {
        data: [{ ...AUDIT_ROW, created_by: null }],
        error: null,
        count: 1,
      },
      { data: [], error: null },
    );
    const result = await listAuditLogEntries({ page: 1, pageSize: 25 });
    expect(result.entries[0].createdByRole).toBeNull();
  });

  it("throws a friendly error when the query fails", async () => {
    mockClient(
      { data: null, error: { message: "boom" } },
      { data: [], error: null },
    );
    await expect(listAuditLogEntries({ page: 1, pageSize: 25 })).rejects.toThrow(
      "boom",
    );
  });
});
