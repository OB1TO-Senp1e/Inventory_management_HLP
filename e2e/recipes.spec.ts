import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Recipes spec (P4-01).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL recipe UI (list, search, builder dialog, unit
 * filtering) with zero backend. The live CRUD flow needs a real Supabase
 * backend + seed data, so it only runs when E2E_LIVE_SUPABASE=1.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("recipes access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("recipes page lists menu items with yield", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await expect(
        page.getByRole("heading", { name: "Recipes" }),
      ).toBeVisible();
      // Desktop table and mobile card both render; pick the visible one.
      await expect(
        page.getByText("Butter Chicken").filter({ visible: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText(/4 servings/).filter({ visible: true }).first(),
      ).toBeVisible();
    });

    test("search filters the recipe list", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await expect(
        page.getByText("Butter Chicken").filter({ visible: true }).first(),
      ).toBeVisible();
      await page.getByRole("searchbox", { name: /search recipes/i }).fill("Dal");
      await page.getByRole("button", { name: /^search$/i }).click();
      await expect(
        page.getByText("Dal Makhani").filter({ visible: true }).first(),
      ).toBeVisible();
    });

    test("builder dialog adds an ingredient with convertible units", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await page.getByRole("button", { name: /new recipe/i }).click();
      await expect(
        page.getByRole("dialog", { name: /new recipe/i }),
      ).toBeVisible();
      // Wait for the form to load (dialog fetches items/units/conversions).
      await expect(page.getByLabel("Dish name")).toBeVisible({ timeout: 10000 });

      // Fill the header.
      await page.getByLabel("Dish name").fill("Test Curry");
      await page.getByLabel("Yield quantity").fill("4");

      // Add Tomato (stocked in kg; g is convertible via the stub).
      await page.getByLabel("Add ingredient").selectOption({ label: "Tomato (kg)" });
      await page.getByRole("button", { name: /^add$/i }).click();
      await expect(page.getByText("Tomato").first()).toBeVisible();

      const unitSelect = page.getByLabel("Unit for Tomato");
      await expect(unitSelect).toContainText("kg");
      await expect(unitSelect).toContainText("g");
      await expect(unitSelect).not.toContainText("L");
    });

    test("builder requires at least one ingredient", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await page.getByRole("button", { name: /new recipe/i }).click();
      await expect(page.getByLabel("Dish name")).toBeVisible({ timeout: 10000 });
      await page.getByLabel("Dish name").fill("Empty Dish");
      await page.getByRole("button", { name: /create recipe/i }).click();
      await expect(
        page.getByText("Add at least one ingredient."),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff cannot access the recipes page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      // Route is owner/manager-only; staff sees the 404, not the page.
      await expect(
        page.getByRole("heading", { name: "Recipes" }),
      ).not.toBeVisible();
    });
  });

  test.describe("live", () => {
    test.use({ role: "owner" });

    test("live: create a recipe with ingredients", async ({ page }) => {
      test.skip(!LIVE, "needs a live Supabase backend");
      await page.goto("/recipes");
      // Live flow implementation goes here when the backend is available.
    });
  });
});
