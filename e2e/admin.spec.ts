import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Audit log spec (P5-05).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL audit log UI (filters, table, pagination affordances,
 * role bounces) with zero backend. No live flow: the audit log is
 * owner-only and its rows are written by RPCs, so the deterministic
 * coverage plus the RLS DB tests are the contract.
 */

test.describe("audit log", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("lists entries with action, actor and time", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/audit-log");
      await expect(
        page.getByRole("heading", { name: /audit log/i }),
      ).toBeVisible();
      const table = page.getByRole("table");
      await expect(table.getByText("Over sale")).toBeVisible();
      await expect(table.getByText("Stock count applied")).toBeVisible();
      // Actor: role plus a short id fragment of the canned owner profile.
      await expect(table.getByText("owner · dddddddd")).toHaveCount(2);
      await expect(table.getByText(/Sale 2026-10-05/)).toBeVisible();
      await expect(
        table.getByText(/Count "Weekly count"/),
      ).toBeVisible();
    });

    test("action filter narrows the entries", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/audit-log");
      const table = page.getByRole("table");
      await expect(table.getByText("Over sale")).toBeVisible();
      await page.getByLabel("Action").selectOption("over_sale");
      await expect(table.getByText("Over sale")).toBeVisible();
      await expect(table.getByText("Stock count applied")).not.toBeVisible();
    });

    test("date filter narrows the entries", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/audit-log");
      const table = page.getByRole("table");
      await expect(table.getByText("Stock count applied")).toBeVisible();
      // The stock-count entry is dated 2026-10-03; restricting the range
      // to 2026-10-05 leaves only the over_sale entry.
      await page.getByLabel("From").fill("2026-10-05");
      await page.getByLabel("To").fill("2026-10-05");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(table.getByText("Over sale")).toBeVisible();
      await expect(table.getByText("Stock count applied")).not.toBeVisible();
    });

    test("inverted date range shows a validation error", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/audit-log");
      await page.getByLabel("From").fill("2026-10-05");
      await page.getByLabel("To").fill("2026-10-01");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager cannot access the audit log page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/audit-log");
      // Route is owner-only; the manager sees the 404, not the page.
      await expect(
        page.getByRole("heading", { name: /audit log/i }),
      ).not.toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff cannot access the audit log page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/audit-log");
      // Route is owner-only; staff sees the 404, not the page.
      await expect(
        page.getByRole("heading", { name: /audit log/i }),
      ).not.toBeVisible();
    });
  });
});
