import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Reports spec (P5-04, V2-02).
 *
 * Deterministic specs run everywhere with the stubbed backend. Canned
 * data (all inside the default 30-day range):
 * - usage: Tomato −32 kg total (kitchen_use, 3 lines)
 * - sale_deduction: Tomato −4 kg today ("Sale <today>: Butter Chicken x4",
 *   food cost 4 × ₹32.50 = ₹130.00) and Milk −2 L today
 *   ("Sale <today>: Dal Makhani x6")
 * - menu engineering: Butter Chicken (4 sold, ₹168.25 margin) → Puzzle;
 *   Dal Makhani (6 sold, ₹141.00 margin) → Plowhorse
 * - wastage: Milk −1 L, reason "expired" (₹58.00 lost)
 * - supplier price history: Tomato 28 → 30 (NOW) and 30 → 32.5 (today)
 *   with Fresh Farms Produce
 * The live flow needs a real Supabase backend + seed data, so it only
 * runs when E2E_LIVE_SUPABASE=1.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("reports", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("usage tab aggregates kitchen use and sale deductions", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await expect(
        page.getByRole("heading", { name: "Reports" }),
      ).toBeVisible();

      const panel = page.getByLabel("Usage report", { exact: true });
      await expect(panel.getByRole("table").getByText("Kitchen use", { exact: true })).toBeVisible();
      await expect(panel.getByRole("table").getByText("Sale deduction", { exact: true })).toBeVisible();
      // Tomato usage: 32 kg × ₹32.50 = ₹1,040.00.
      await expect(panel.getByRole("table").getByText("₹1,040.00", { exact: true })).toBeVisible();
      // Tomato sale deduction: 4 kg × ₹32.50 = ₹130.00.
      await expect(panel.getByRole("table").getByText("₹130.00", { exact: true })).toBeVisible();
    });

    test("wastage tab groups by reason code", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await page.getByRole("tab", { name: "Wastage by reason" }).click();

      const panel = page.getByLabel("Wastage by reason report", { exact: true });
      await expect(panel.getByRole("table").getByText("Expired", { exact: true })).toBeVisible();
      await expect(panel.getByRole("table").getByText("₹58.00", { exact: true })).toBeVisible();
    });

    test("food cost trend shows the daily ₹ cost of dishes sold", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await page.getByRole("tab", { name: "Food cost trend" }).click();

      const panel = page.getByLabel("Food cost trend report", { exact: true });
      await expect(panel.getByText(/Revenue is not captured in v1/)).toBeVisible();
      await expect(panel.getByRole("table").getByText("₹130.00", { exact: true })).toBeVisible();
    });

    test("price changes tab lists events with signed percentages", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await page.getByRole("tab", { name: "Supplier price changes" }).click();

      const panel = page.getByLabel("Supplier price changes report", { exact: true });
      const table = panel.getByRole("table");
      // Both canned changes are from Fresh Farms Produce.
      await expect(
        table.getByText("Fresh Farms Produce", { exact: true }),
      ).toHaveCount(2);
      // 30 → 32.5 = +8.3%; 28 → 30 = +7.1%.
      await expect(table.getByText("+8.3%", { exact: true })).toBeVisible();
      await expect(table.getByText("+7.1%", { exact: true })).toBeVisible();
    });

    test("a range with no data shows empty states on every tab", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await page.getByLabel("From").fill("2030-01-01");
      await page.getByLabel("To").fill("2030-01-31");
      await page.getByRole("button", { name: "Apply" }).click();

      await expect(
        page.getByText("No usage recorded in this date range."),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Wastage by reason" }).click();
      await expect(
        page.getByText("No wastage recorded in this date range."),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Food cost trend" }).click();
      await expect(
        page.getByText("No sales recorded in this date range."),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Supplier price changes" }).click();
      await expect(
        page.getByText("No supplier price changes in this date range."),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Menu engineering" }).click();
      await expect(
        page.getByText("No sales recorded in this date range."),
      ).toBeVisible();
    });

    test("menu engineering tab classifies dishes into quadrants", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await page.getByRole("tab", { name: "Menu engineering" }).click();

      const panel = page.getByLabel("Menu engineering report", { exact: true });
      // Quadrant chart renders with the average reference lines.
      await expect(
        panel.getByLabel(/Popularity vs profitability/),
      ).toBeVisible();
      // Butter Chicken: 4 sold, ₹168.25 margin → below-avg popularity,
      // above-avg margin → Puzzle. Dal Makhani: 6 sold, ₹141.00 margin →
      // Plowhorse.
      const table = panel.getByRole("table");
      await expect(
        table.getByText("Butter Chicken", { exact: true }),
      ).toBeVisible();
      await expect(table.getByText("Puzzle", { exact: true })).toBeVisible();
      await expect(
        table.getByText("Dal Makhani", { exact: true }),
      ).toBeVisible();
      await expect(
        table.getByText("Plowhorse", { exact: true }),
      ).toBeVisible();
      await expect(table.getByText("₹168.25", { exact: true })).toBeVisible();
      await expect(table.getByText("₹141.00", { exact: true })).toBeVisible();
      // The live-costing caveat is stated on the page.
      await expect(
        panel.getByText(/evaluated at today's cost and price/),
      ).toBeVisible();
    });

    test("export CSV downloads the usage report", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/reports");
      await expect(
        page.getByLabel("Usage report", { exact: true }),
      ).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /export csv/i }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(
        /^usage-report-\d{4}-\d{2}-\d{2}\.csv$/,
      );
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off reports (owner/manager only)", async ({
      page,
    }) => {
      await page.goto("/reports");
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "Reports" }),
      ).not.toBeVisible();
    });
  });
});

test.describe("reports live flow", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("reports load with live data", async ({ page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: "Reports" }),
    ).toBeVisible({ timeout: 20000 });
    for (const label of [
      "Usage",
      "Wastage by reason",
      "Food cost trend",
      "Supplier price changes",
      "Menu engineering",
    ]) {
      await expect(page.getByRole("tab", { name: label })).toBeVisible({
        timeout: 20000,
      });
    }
  });
});
