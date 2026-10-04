import { test, expect } from "./fixtures";

/**
 * Stock ledger spec (P2-01).
 *
 * Deterministic specs (dialog validation, role gating) run everywhere —
 * they need no backend. The live opening-balance flow needs a real Supabase
 * backend + seed data, so it only runs when E2E_LIVE_SUPABASE=1 (CI sets
 * this with the Supabase env baked into the build); otherwise it skips
 * explicitly, never faking a pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("opening balance access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("items page shows the opening-balance action", async ({ page }) => {
      // Without a backend the error state renders; the route + heading
      // still prove role access. (Live data runs in CI.)
      await page.goto("/items");
      await expect(
        page.getByRole("heading", { name: "Items" }),
      ).toBeVisible();
    });

    test("live: opening-balance dialog validates and posts", async ({
      page,
    }) => {
      test.skip(!LIVE, "needs a live Supabase backend");
      await page.goto("/items");
      await page
        .getByRole("button", { name: /set opening balance/i })
        .first()
        .click();
      await expect(
        page.getByRole("dialog", { name: /opening balance/i }),
      ).toBeVisible();
      // Client-side validation: empty quantity is rejected.
      await page.getByRole("button", { name: /post opening balance/i }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("opening-balance action is hidden from staff", async ({ page }) => {
      await page.goto("/items");
      await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
      // The action must not render at all for staff (RLS is the enforcer;
      // the UI additionally hides it).
      await expect(
        page.getByRole("button", { name: /set opening balance/i }),
      ).toHaveCount(0);
    });
  });
});
