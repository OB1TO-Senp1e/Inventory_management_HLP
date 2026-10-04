import { test, expect } from "./fixtures";

/**
 * Smoke spec (P0-06) — proves the Playwright harness works: the app boots,
 * the login page renders for public visitors, unknown routes render the
 * designed 404, and role fixtures drive the nav per the access matrix.
 * Feature tasks add their own `e2e/<module>.spec.ts` flows; the route audit
 * (`pnpm audit:routes`) covers every route × role systematically.
 */

test.describe("smoke", () => {
  test("login page renders for a public visitor", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("protected route redirects a signed-out visitor to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("unknown route redirects a signed-out visitor to /login", async ({ page }) => {
    // ProtectedRoute redirects signed-out visitors before the 404 renders.
    await page.goto("/no-such-page-xyz");
    await expect(page).toHaveURL(/\/login$/);
  });

  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("unknown route renders the 404 page", async ({ page }) => {
      await page.goto("/no-such-page-xyz");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.getByText("404").first()).toBeVisible();
    });

    test("home shows the role-aware landing with nav", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("navigation").first()).toBeVisible();
    });

    test("owner-only section is reachable", async ({ page }) => {
      await page.goto("/users");
      // Unbuilt sections render the designed 404 until their feature task
      // lands — the audit-relevant assertion is that the guard lets the
      // owner through (no bounce to "/") and the page is non-blank.
      await expect(page).not.toHaveURL("/");
      await expect(page.locator("#root")).not.toBeEmpty();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("denied section bounces to home", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/$/);
    });

    test("allowed section renders", async ({ page }) => {
      await page.goto("/receiving");
      await expect(page).not.toHaveURL("/login");
      await expect(page.locator("#root")).not.toBeEmpty();
    });
  });
});
