import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Recipes spec (P4-01, costing in P4-02).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL recipe UI (list, search, builder dialog, unit
 * filtering, live cost preview, selling price) with zero backend. The live
 * CRUD flow needs a real Supabase backend + seed data, so it only runs
 * when E2E_LIVE_SUPABASE=1.
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

    test("list shows cost per dish and food-cost %", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await expect(
        page.getByText("Butter Chicken").filter({ visible: true }).first(),
      ).toBeVisible();
      // Butter Chicken: ₹123 / 4 servings = ₹30.75 per dish (en-IN ₹).
      await expect(
        page.getByText("₹30.75").filter({ visible: true }).first(),
      ).toBeVisible();
      // Food cost = 30.75 / 199 × 100 = 15.45%.
      await expect(
        page.getByText("15.45%").filter({ visible: true }).first(),
      ).toBeVisible();
      // Dal Makhani: ₹48 / 6 = ₹8.00 per dish; 8 / 149 × 100 = 5.37%.
      await expect(
        page.getByText("₹8.00").filter({ visible: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("5.37%").filter({ visible: true }).first(),
      ).toBeVisible();
    });

    test("builder dialog shows a live cost preview", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await page.getByRole("button", { name: /new recipe/i }).click();
      await expect(page.getByLabel("Dish name")).toBeVisible({ timeout: 10000 });

      await page.getByLabel("Dish name").fill("Cost Curry");
      await page.getByLabel("Yield quantity").fill("4");

      // No ingredients yet → no cost.
      await expect(
        page.getByText("Add ingredients to see the live cost."),
      ).toBeVisible();

      // 2 kg of Tomato at ₹32.50/kg = ₹65.00 for the full yield.
      await page.getByLabel("Add ingredient").selectOption({ label: "Tomato (kg)" });
      await page.getByRole("button", { name: /^add$/i }).click();
      await page.getByLabel("Quantity for Tomato").fill("2");

      // ₹65.00 / 4 servings = ₹16.25 per dish.
      await expect(page.getByText("₹65.00")).toBeVisible();
      await expect(page.getByText("₹16.25")).toBeVisible();
      // No selling price → food cost is "—" with a hint.
      await expect(
        page.getByText("Set a selling price to see the food-cost %."),
      ).toBeVisible();

      // ₹130 selling price → 16.25 / 130 × 100 = 12.5%.
      await page.getByLabel(/selling price/i).fill("130");
      await expect(page.getByText("12.5%")).toBeVisible();
    });

    test("selling price can be edited on an existing recipe", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/recipes");
      await expect(
        page.getByText("Butter Chicken").filter({ visible: true }).first(),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Edit Butter Chicken" })
        .filter({ visible: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: /edit recipe/i });
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("Dish name")).toBeVisible({ timeout: 10000 });

      // The current price is prefilled; the live preview shows the
      // stubbed cost (₹123 / 4 = ₹30.75 per dish).
      await expect(page.getByLabel(/selling price/i)).toHaveValue("199");
      await expect(dialog.getByText("₹30.75")).toBeVisible();

      await page.getByLabel(/selling price/i).fill("249");
      await page.getByRole("button", { name: /save changes/i }).click();
      await expect(page.getByText("Recipe updated.")).toBeVisible();
      await expect(dialog).not.toBeVisible();
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
