import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Dashboard spec (P5-03).
 *
 * Deterministic specs run everywhere with the stubbed backend. The canned
 * data: Milk is low stock (3 ≤ 10), Flour has no stock (0 ≤ 20) so it is
 * low too; Tomato has a batch expiring in 3 days. Stock value =
 * 42.5×32.5 + 3×58 = ₹1,555.25. Today's movements: Tomato usage 2 kg
 * (₹65.00 lost), Milk wastage 1 L (₹58.00 lost).
 * The live flow needs a real Supabase backend + seed data, so it only
 * runs when E2E_LIVE_SUPABASE=1.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("dashboard", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("cards render with counts, values and filtered links", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/dashboard");
      await expect(
        page.getByRole("heading", { name: "Dashboard" }),
      ).toBeVisible();

      // Low stock: Milk + Flour → 2, links to the filtered stock page.
      const lowCard = page
        .getByRole("heading", { name: "Low stock" })
        .locator("xpath=ancestor::section[1]");
      await expect(lowCard.getByText("2", { exact: true })).toBeVisible();
      await expect(
        lowCard.getByRole("link", { name: "View low stock" }),
      ).toHaveAttribute("href", "/stock?low=1");

      // Expiring soon: Tomato → 1.
      const expCard = page
        .getByRole("heading", { name: "Expiring soon" })
        .locator("xpath=ancestor::section[1]");
      await expect(expCard.getByText("1", { exact: true })).toBeVisible();
      await expect(
        expCard.getByRole("link", { name: "View expiring" }),
      ).toHaveAttribute("href", "/stock?expiring=1");

      // Today's usage & wastage: lines, quantities, ₹ value lost.
      const todayCard = page
        .getByRole("heading", { name: "Today's usage & wastage" })
        .locator("xpath=ancestor::section[1]");
      await expect(todayCard.getByText("₹65.00")).toBeVisible();
      await expect(todayCard.getByText("₹58.00")).toBeVisible();

      // Stock value.
      await expect(page.getByText("₹1,555.25")).toBeVisible();
    });

    test("low-stock link opens the stock page pre-filtered", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/dashboard");
      await page.getByRole("link", { name: "View low stock" }).click();
      await expect(page).toHaveURL(/\/stock\?low=1/);
      // The pre-checked "Low stock only" filter hides Tomato.
      await expect(page.getByText(/Showing 2 of 3 items/)).toBeVisible();
      await expect(page.getByLabel("Low stock only")).toBeChecked();
    });

    test("without a backend the error state offers a retry", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      // React Query retries (~7s backoff) before the error state renders.
      await expect(
        page.getByText("Could not load the dashboard.", { exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.getByRole("button", { name: "Retry" }),
      ).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager reaches the dashboard", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/dashboard");
      await expect(
        page.getByRole("heading", { name: "Dashboard" }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the dashboard (owner/manager only)", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "Dashboard" }),
      ).not.toBeVisible();
    });
  });
});

test.describe("dashboard live flow", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("dashboard loads with live data", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("heading", { name: "Stock value" }),
    ).toBeVisible({ timeout: 20000 });
  });
});
