import { test, expect } from "./fixtures";

/**
 * Items spec (P1-01).
 *
 * Deterministic specs (role gating, empty/error states, client-side
 * validation) run everywhere — they need no backend. The live CRUD flow
 * needs a real Supabase backend + seed data, so it only runs when
 * E2E_LIVE_SUPABASE=1 (CI sets this with the Supabase env baked into the
 * build); otherwise it skips explicitly, never faking a pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("items access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("items page renders the list chrome", async ({ page }) => {
      await page.goto("/items");
      await expect(
        page.getByRole("heading", { name: "Items" }),
      ).toBeVisible();
      await expect(page.getByLabel("Search items")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add item" }).first(),
      ).toBeVisible();
    });

    test("without a backend the error state offers a retry", async ({
      page,
    }) => {
      await page.goto("/items");
      await expect(page.getByRole("alert")).toHaveText(
        /could not load items/i,
      );
      await expect(
        page.getByRole("button", { name: "Retry" }),
      ).toBeVisible();
    });

    test("add-item dialog validates before any network call", async ({
      page,
    }) => {
      await page.goto("/items");
      await page
        .getByRole("button", { name: "Add item" })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Name")).toBeVisible();
      await expect(dialog.getByLabel("Unit")).toBeVisible();
      // Submit empty: client-side validation must fire, no request sent.
      await dialog.getByRole("button", { name: "Add item" }).click();
      await expect(dialog.getByText("Enter an item name.")).toBeVisible();
      await expect(dialog.getByText("Choose a unit.")).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager reaches the items page", async ({ page }) => {
      await page.goto("/items");
      await expect(
        page.getByRole("heading", { name: "Items" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Add item" }).first(),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the items page", async ({ page }) => {
      await page.goto("/items");
      await expect(page).toHaveURL(/\/$/);
    });
  });
});

test.describe("items live CRUD", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("create, edit and archive an item", async ({ page }) => {
    await page.goto("/items");

    // Create
    await page.getByRole("button", { name: "Add item" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("E2E Roma Tomato");
    await dialog.getByLabel("Category").selectOption({ label: "Vegetables" });
    await dialog.getByLabel("Unit").selectOption({ label: "kilogram (kg)" });
    await dialog.getByLabel(/par level/i).fill("12");
    await dialog.getByLabel(/reorder point/i).fill("5");
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Item created.")).toBeVisible();
    await expect(page.getByText("E2E Roma Tomato")).toBeVisible();

    // Edit
    await page
      .getByRole("button", { name: "Edit E2E Roma Tomato" })
      .click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("Name").fill("E2E Cherry Tomato");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Item updated.")).toBeVisible();
    await expect(page.getByText("E2E Cherry Tomato")).toBeVisible();

    // Archive
    await page
      .getByRole("button", { name: "Archive E2E Cherry Tomato" })
      .click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Archive item" }).click();
    await expect(page.getByText("Item archived.")).toBeVisible();
    await expect(page.getByText("E2E Cherry Tomato")).not.toBeVisible();

    // Archived filter shows it again
    await page.getByLabel("Filter by status").selectOption("archived");
    await expect(page.getByText("E2E Cherry Tomato")).toBeVisible();
  });
});
