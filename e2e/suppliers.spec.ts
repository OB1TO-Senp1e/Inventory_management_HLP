import { test, expect } from "./fixtures";

/**
 * Suppliers spec (P1-03).
 *
 * Deterministic specs (role gating, empty/error states, client-side
 * validation) run everywhere — they need no backend. The live CRUD flow
 * needs a real Supabase backend + seed data, so it only runs when
 * E2E_LIVE_SUPABASE=1 (CI sets this with the Supabase env baked into the
 * build); otherwise it skips explicitly, never faking a pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("suppliers access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("suppliers page renders the list chrome", async ({ page }) => {
      await page.goto("/suppliers");
      await expect(
        page.getByRole("heading", { name: "Suppliers" }),
      ).toBeVisible();
      await expect(page.getByLabel("Search suppliers")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add supplier" }).first(),
      ).toBeVisible();
    });

    test("without a backend the error state offers a retry", async ({
      page,
    }) => {
      await page.goto("/suppliers");
      // React Query retries (~7s backoff) before the error state renders.
      await expect(page.getByRole("alert")).toHaveText(/could not load suppliers/i, {
        timeout: 20000,
      });
      await expect(
        page.getByRole("button", { name: "Retry" }),
      ).toBeVisible();
    });

    test("add-supplier dialog validates before any network call", async ({
      page,
    }) => {
      await page.goto("/suppliers");
      await page
        .getByRole("button", { name: "Add supplier" })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Name")).toBeVisible();
      await expect(dialog.getByLabel(/phone/i)).toBeVisible();
      // Submit empty: client-side validation must fire, no request sent.
      await dialog.getByRole("button", { name: "Add supplier" }).click();
      await expect(
        dialog.getByText("Enter a supplier name."),
      ).toBeVisible();
      // Bad phone + bad GSTIN are rejected client-side too.
      await dialog.getByLabel("Name").fill("E2E Supplier");
      await dialog.getByLabel(/phone/i).fill("abc");
      await dialog.getByLabel("GSTIN").fill("SHORT");
      await dialog.getByRole("button", { name: "Add supplier" }).click();
      await expect(
        dialog.getByText("Enter a valid phone number."),
      ).toBeVisible();
      await expect(dialog.getByText(/GSTIN/i).first()).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager reaches the suppliers page", async ({ page }) => {
      await page.goto("/suppliers");
      await expect(
        page.getByRole("heading", { name: "Suppliers" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add supplier" }).first(),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the suppliers page", async ({ page }) => {
      await page.goto("/suppliers");
      await expect(page).toHaveURL(/\/$/);
    });
  });
});

test.describe("suppliers live CRUD", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("create, edit and archive a supplier", async ({ page }) => {
    await page.goto("/suppliers");

    // Create
    await page.getByRole("button", { name: "Add supplier" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("E2E Veg Supply");
    await dialog.getByLabel("Contact person").fill("E2E Contact");
    await dialog.getByLabel(/phone/i).fill("+919876543210");
    await dialog.getByLabel("GSTIN").fill("27ABCDE1234F1Z5");
    await dialog.getByRole("button", { name: "Add supplier" }).click();
    await expect(page.getByText("Supplier created.")).toBeVisible();
    await expect(page.getByText("E2E Veg Supply")).toBeVisible();

    // Edit
    await page
      .getByRole("button", { name: "Edit E2E Veg Supply" })
      .click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Name").fill("E2E Veg Supply Ltd");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Supplier updated.")).toBeVisible();
    await expect(page.getByText("E2E Veg Supply Ltd")).toBeVisible();

    // Archive
    await page
      .getByRole("button", { name: "Archive E2E Veg Supply Ltd" })
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Archive supplier" }).click();
    await expect(page.getByText("Supplier archived.")).toBeVisible();
    await expect(page.getByText("E2E Veg Supply Ltd")).not.toBeVisible();

    // Archived filter shows it again
    await page.getByLabel("Filter by status").selectOption("archived");
    await expect(page.getByText("E2E Veg Supply Ltd")).toBeVisible();
  });
});
