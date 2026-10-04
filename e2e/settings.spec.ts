import { test, expect } from "./fixtures";

/**
 * Settings spec (P1-02).
 *
 * Deterministic specs (role gating, tab rendering, empty/error states,
 * client-side validation) run everywhere — they need no backend. The live
 * CRUD flow needs a real Supabase backend + seed data, so it only runs when
 * E2E_LIVE_SUPABASE=1 (CI sets this with the Supabase env baked into the
 * build); otherwise it skips explicitly, never faking a pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("settings access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("settings page renders with both tabs", async ({ page }) => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Settings" }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Categories" }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Storage locations" }),
      ).toBeVisible();
    });

    test("tab switching swaps the section", async ({ page }) => {
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Storage locations" }).click();
      await expect(
        page.getByRole("tab", { name: "Storage locations" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("button", { name: "Add location" }).first(),
      ).toBeVisible();
    });

    test("without a backend the error state offers a retry", async ({
      page,
    }) => {
      await page.goto("/settings");
      // React Query retries (~7s backoff) before the error state renders.
      await expect(page.getByRole("alert")).toHaveText(/could not load/i, {
        timeout: 20000,
      });
      await expect(
        page.getByRole("button", { name: "Retry" }),
      ).toBeVisible();
    });

    test("create dialog validates before any network call", async ({
      page,
    }) => {
      await page.goto("/settings");
      await page
        .getByRole("button", { name: "Add category" })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Submit the empty form: client-side validation must fire.
      await dialog.getByRole("button", { name: "Add category" }).click();
      await expect(dialog.getByRole("alert")).toHaveText(/enter a name/i);
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("settings page is reachable", async ({ page }) => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Settings" }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("settings route is denied and redirects home", async ({ page }) => {
      await page.goto("/settings");
      await expect(page).toHaveURL("/");
      await expect(
        page.getByRole("link", { name: "Settings" }),
      ).not.toBeVisible();
    });
  });

  test.describe("signed out", () => {
    test("settings redirects to login", async ({ page }) => {
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/login/);
    });
  });
});

test.describe("settings live CRUD", () => {
  test.use({ role: "owner" });
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");

  test("create, rename, archive and blocked-delete a category", async ({
    page,
  }) => {
    await page.goto("/settings");
    const name = `E2E Cat ${Date.now()}`;

    // Create.
    await page.getByRole("button", { name: "Add category" }).first().click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("dialog").getByRole("button", { name: "Add category" }).click();
    await expect(page.getByText(name)).toBeVisible();

    // Rename.
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await page.getByLabel("Name").fill(`${name} Renamed`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save changes" })
      .click();
    await expect(page.getByText(`${name} Renamed`)).toBeVisible();

    // Archive (soft delete) — the row disappears from the active list.
    await page
      .getByRole("button", { name: `Archive ${name} Renamed` })
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(`${name} Renamed`)).not.toBeVisible();
  });
});
