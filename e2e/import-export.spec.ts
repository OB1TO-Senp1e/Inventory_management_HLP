import { test, expect } from "./fixtures";

/**
 * CSV import/export spec (P1-05).
 *
 * Deterministic specs run everywhere (no backend needed): the Export/Import
 * actions render for owner/manager, the import dialog documents its columns
 * and offers a template, and a malformed file shows a useful error instead
 * of crashing. The live import flow needs a real Supabase backend + seed
 * data, so it only runs when E2E_LIVE_SUPABASE=1; otherwise it skips
 * explicitly, never faking a pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("csv import/export access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("items page shows Export and Import actions", async ({ page }) => {
      await page.goto("/items");
      await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
    });

    test("suppliers page shows Export and Import actions", async ({ page }) => {
      await page.goto("/suppliers");
      await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
    });

    test("import dialog documents columns and offers a template", async ({
      page,
    }) => {
      await page.goto("/items");
      await page.getByRole("button", { name: "Import" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: /download template/i }),
      ).toBeVisible();
      await expect(dialog.getByText("Expected columns")).toBeVisible();
    });

    test("a non-csv file shows a useful error, never a crash", async ({
      page,
    }) => {
      await page.goto("/items");
      await page.getByRole("button", { name: "Import" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "items.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("name,unit\nTomato,kg\n"),
      });
      await expect(
        dialog.getByText(/couldn't read this file/i),
      ).toBeVisible();
      await expect(dialog.getByText(/not a \.csv file/i)).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the items page (no import/export surface)", async ({
      page,
    }) => {
      await page.goto("/items");
      await expect(page).toHaveURL(/\/$/);
    });
  });
});

test.describe("csv live import", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("imports a valid items csv end to end", async ({ page }) => {
    await page.goto("/items");
    await page.getByRole("button", { name: "Import" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "items.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,category,unit\nE2E Tomato,Vegetables,kg\n"),
    });
    await expect(dialog.getByText(/1 rows:/)).toBeVisible();
    await dialog.getByRole("button", { name: /import 1 valid row/i }).click();
    await expect(dialog.getByText(/imported 1 row\./i)).toBeVisible();
  });
});
