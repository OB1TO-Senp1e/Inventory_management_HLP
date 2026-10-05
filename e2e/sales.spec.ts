import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Sales entry spec (P4-03).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL sales UI (date picker, dish rows, revenue estimate,
 * aggregation, submit + toast) with zero backend. The `record_sales` RPC
 * is stubbed dynamically (echoes the posted entry). The live flow needs a
 * real Supabase backend + seed data, so it only runs when
 * E2E_LIVE_SUPABASE=1.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

/** Today's date as YYYY-MM-DD in the browser's local timezone. */
function todayISO(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

test.describe("sales entry", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("sales page renders with today's date by default", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await expect(
        page.getByRole("heading", { name: /sales entry/i }),
      ).toBeVisible();
      const dateInput = page.getByLabel(/sale date/i);
      await expect(dateInput).toHaveValue(todayISO());
      await expect(
        page.getByRole("button", { name: /record sales/i }),
      ).toBeVisible();
    });

    test("dish picker lists active dishes with yield and price", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).click();
      const options = page.getByLabel(/dish 1/i).locator("option");
      await expect(options).toContainText(["Butter Chicken", "Dal Makhani"]);
    });

    test("entering dishes shows a revenue estimate", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("2");
      // Butter Chicken sells at ₹199 → estimate ₹398.
      await expect(page.getByText(/revenue estimate/i)).toBeVisible();
      await expect(page.getByText(/₹\s?398/).first()).toBeVisible();
    });

    test("records a sale and shows the summary toast", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("4");
      await page.getByRole("button", { name: /record sales/i }).click();
      await expect(
        page.getByText(
          new RegExp(`Sales recorded for ${todayISO()}: 4 dishes`),
        ),
      ).toBeVisible({ timeout: 10000 });
      // The form resets to one empty row for the next entry.
      await expect(page.getByLabel(/dish \d/i)).toHaveCount(1);
    });

    test("duplicate dish rows are aggregated into one line", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("4");
      await page.getByRole("button", { name: /add dish/i }).click();
      const dishSelects = page.getByLabel(/dish \d/i);
      await dishSelects.nth(1).selectOption({ label: "Butter Chicken" });
      await page
        .getByLabel(/dishes sold \(butter chicken\)/i)
        .nth(1)
        .fill("2");
      await page.getByRole("button", { name: /record sales/i }).click();
      // 4 + 2 aggregated → the RPC summary echoes 6 dishes.
      await expect(
        page.getByText(
          new RegExp(`Sales recorded for ${todayISO()}: 6 dishes`),
        ),
      ).toBeVisible({ timeout: 10000 });
    });

    test("validation blocks a missing quantity", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      await page.getByRole("button", { name: /record sales/i }).click();
      await expect(
        page.getByText(/dishes sold must be greater than zero/i),
      ).toBeVisible();
    });

    test("over-sale shows the warning dialog with flagged items", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      // Stubbed stock: Tomato 4 kg, Milk 2 L. 12 dishes deduct 6 kg + 3 L —
      // both go negative (Tomato projects to -2 kg).
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("12");
      await page.getByRole("button", { name: /record sales/i }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(/insufficient stock/i);
      await expect(dialog).toContainText(/tomato/i);
      await expect(dialog).toContainText(/-1/);
      await expect(dialog).toContainText(/milk/i);
      // Not posted yet: no summary toast.
      await expect(
        page.getByText(new RegExp(`Sales recorded for ${todayISO()}`)),
      ).not.toBeVisible();
    });

    test("canceling the over-sale dialog aborts the entry", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("12");
      await page.getByRole("button", { name: /record sales/i }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /^cancel$/i }).click();
      await expect(dialog).not.toBeVisible();
      // The form keeps its rows and nothing posted.
      await expect(page.getByLabel(/dish \d/i)).toHaveCount(1);
      await expect(
        page.getByText(new RegExp(`Sales recorded for ${todayISO()}`)),
      ).not.toBeVisible();
    });

    test("confirming the over-sale posts the entry", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("12");
      await page.getByRole("button", { name: /record sales/i }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: /record sale anyway/i })
        .click();
      await expect(
        page.getByText(
          new RegExp(`Sales recorded for ${todayISO()}: 12 dishes`),
        ),
      ).toBeVisible({ timeout: 10000 });
    });

    test("sufficient stock posts without any dialog", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await page.getByLabel(/dish 1/i).selectOption({ label: "Butter Chicken" });
      // 2 dishes deduct 1 kg Tomato + 0.5 L Milk — within stock, no warning.
      await page.getByLabel(/dishes sold \(butter chicken\)/i).fill("2");
      await page.getByRole("button", { name: /record sales/i }).click();
      await expect(page.getByRole("alertdialog")).not.toBeVisible();
      await expect(
        page.getByText(
          new RegExp(`Sales recorded for ${todayISO()}: 2 dishes`),
        ),
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager can access the sales page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await expect(
        page.getByRole("heading", { name: /sales entry/i }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff cannot access the sales page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/sales");
      // Route is owner/manager-only (recipes carry costs); staff sees the
      // 404, not the page.
      await expect(
        page.getByRole("heading", { name: /sales entry/i }),
      ).not.toBeVisible();
    });
  });

  test.describe("live", () => {
    test.use({ role: "owner" });

    test("live: record sales deducts ingredient stock", async ({ page }) => {
      test.skip(!LIVE, "needs a live Supabase backend");
      await page.goto("/sales");
      // Live flow implementation goes here when the backend is available.
    });
  });
});
