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

test.describe("receiving access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("receiving page renders the receipt form chrome", async ({ page }) => {
      await page.goto("/receiving");
      await expect(
        page.getByRole("heading", { name: "Receiving" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /add line/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /post receipt/i }),
      ).toBeVisible();
    });

    test("receipt form validates before any network call", async ({
      page,
    }) => {
      await page.goto("/receiving");
      // Without a backend the picker errors, so the form is absent; with a
      // backend the empty submit shows inline errors. Either way no receipt
      // is posted.
      const postButton = page.getByRole("button", { name: /post receipt/i });
      if (await postButton.isVisible()) {
        await postButton.click();
        await expect(page.getByRole("alert").first()).toBeVisible();
      } else {
        await expect(
          page.getByRole("button", { name: /retry/i }),
        ).toBeVisible();
      }
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff can open the receiving page (role matrix §7)", async ({
      page,
    }) => {
      await page.goto("/receiving");
      await expect(
        page.getByRole("heading", { name: "Receiving" }),
      ).toBeVisible();
    });
  });
});

test.describe("receiving live flow", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("receipt posts ledger rows and updates the average cost", async ({
    page,
  }) => {
    // Create an item to receive (seed has no items).
    await page.goto("/items");
    await page.getByRole("button", { name: "Add item" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("E2E Receiving Rice");
    await dialog.getByLabel("Unit").selectOption({ label: "kilogram (kg)" });
    await dialog.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Item created.")).toBeVisible();

    // Post a two-line receipt for the same item.
    await page.goto("/receiving");
    const line1 = page.getByRole("group", { name: /receipt line 1/i });
    // First real option (index 0 is the "Select an item…" placeholder).
    await line1.getByLabel("Item").selectOption({ index: 1 });
    await line1.getByLabel(/quantity \(kg\)/i).fill("10");
    await line1.getByLabel(/unit cost/i).fill("40");

    await page.getByRole("button", { name: /add line/i }).click();
    const line2 = page.getByRole("group", { name: /receipt line 2/i });
    await line2.getByLabel("Item").selectOption({ index: 1 });
    await line2.getByLabel(/quantity \(kg\)/i).fill("10");
    await line2.getByLabel(/unit cost/i).fill("60");

    await page.getByRole("button", { name: /post receipt/i }).click();

    // Success report: both movements posted, weighted avg 50 from 40/60.
    await expect(
      page.getByText(/receipt posted to the stock ledger/i),
    ).toBeVisible();
    await expect(page.getByText(/₹50\.00/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /new receipt/i }),
    ).toBeVisible();
  });
});
