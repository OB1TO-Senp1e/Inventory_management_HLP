import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Transfers spec (V2-07).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL transfers UI (outlet pickers, item/quantity form,
 * confirmation dialog, success toast) with zero backend. The
 * `transfer_stock` RPC is stubbed dynamically (echoes a canned result).
 * The outlet switcher spec asserts the header switcher lists outlets and
 * switching updates the UI.
 */

test.describe("transfers", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("transfers page renders with the current outlet as source", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/transfers");
      await expect(
        page.getByRole("heading", { name: /transfers/i }),
      ).toBeVisible();
      await expect(page.getByText(/from:/i)).toContainText("Main outlet");
      await expect(page.getByLabel(/to outlet/i)).toBeVisible();
      await expect(page.getByLabel(/^item$/i)).toBeVisible();
      await expect(page.getByLabel(/quantity/i)).toBeVisible();
    });

    test("completing a transfer shows the confirmation and success toast", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/transfers");

      await page.getByLabel(/to outlet/i).selectOption({ label: "Downtown" });
      await page.getByLabel(/^item$/i).selectOption({ label: "Tomato" });
      await page.getByLabel(/quantity/i).fill("5");
      await page.getByRole("button", { name: /review transfer/i }).click();

      // Confirmation dialog summarizes the transfer.
      await expect(
        page.getByRole("alertdialog", { name: /confirm transfer/i }),
      ).toBeVisible();
      await expect(page.getByRole("alertdialog")).toContainText("Main outlet");
      await expect(page.getByRole("alertdialog")).toContainText("Downtown");
      await expect(page.getByRole("alertdialog")).toContainText("Tomato");

      await page.getByRole("button", { name: /transfer stock/i }).click();
      await expect(page.getByText(/transferred 5 kg tomato/i)).toBeVisible();
    });

    test("transfer nav item is visible", async ({ page, isMobile }) => {
      await stubBackend(page);
      await page.goto("/");
      if (isMobile) {
        await page.getByRole("button", { name: "Open navigation" }).click();
      }
      await expect(
        page
          .getByRole("navigation", { name: "Primary" })
          .getByRole("link", { name: /transfers/i }),
      ).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager can open the transfers page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/transfers");
      await expect(
        page.getByRole("heading", { name: /transfers/i }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff cannot access transfers (redirected home)", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/transfers");
      // RoleGuard redirects to "/" — the transfers heading never renders.
      await expect(page).toHaveURL("/");
      await expect(
        page.getByRole("heading", { name: /transfers/i }),
      ).toHaveCount(0);
    });
  });
});

test.describe("outlet switcher", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("header shows the current outlet and switching works", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/dashboard");
      const switcher = page.getByRole("button", {
        name: /current outlet/i,
      });
      await expect(switcher).toBeVisible();
      await expect(switcher).toContainText("Main outlet");

      await switcher.click();
      await expect(page.getByRole("listbox", { name: /outlets/i })).toBeVisible();
      await page.getByRole("option", { name: /downtown/i }).click();

      await expect(page.getByText(/switched to downtown/i)).toBeVisible();
    });
  });
});

test.describe("outlet management", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("settings outlets tab lists outlets and creates one", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/settings");
      await page.getByRole("tab", { name: /outlets/i }).click();
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByText("Main outlet")).toBeVisible();
      await expect(panel.getByText("Downtown")).toBeVisible();

      await page.getByRole("button", { name: /new outlet/i }).click();
      await page.getByLabel(/^name$/i).fill("Airport");
      await page.getByLabel(/address/i).fill("Terminal 2");
      // Dismiss the mobile keyboard (blur the input) so it doesn't cover the button.
      await page.getByRole("heading", { name: /new outlet/i }).click();
      await page.getByRole("button", { name: /create outlet/i }).click();

      await expect(page.getByText(/outlet "airport" created/i)).toBeVisible();
      await expect(panel.getByText("Airport")).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager does not see the outlets tab", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/settings");
      await expect(page.getByRole("tab", { name: /outlets/i })).toHaveCount(0);
    });
  });
});
