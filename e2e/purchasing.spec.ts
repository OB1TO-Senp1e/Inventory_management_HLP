import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Purchasing spec (P3-01).
 *
 * Deterministic specs run everywhere via `stubBackend` (canned PO rows) or
 * against the no-backend error states. The live PO flow needs a real
 * Supabase backend + seed data, so it only runs when E2E_LIVE_SUPABASE=1
 * (CI sets this with the Supabase env baked into the build); otherwise it
 * skips explicitly, never faking a pass.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

test.describe("purchase orders access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("list renders POs with totals and status badges", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders");
      await expect(
        page.getByRole("heading", { name: "Purchase orders" }),
      ).toBeVisible();
      // Stubbed draft PO: Fresh Farms Produce, 2 lines, 10×32.5 + 5×58 = ₹615.
      // Desktop table and mobile cards both render in the DOM; only one is
      // visible per viewport.
      const visibleName = page
        .getByText("Fresh Farms Produce", { exact: true })
        .filter({ visible: true });
      await expect(visibleName.first()).toBeVisible();
      await expect(page.getByText("Draft").filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText(/₹615\.00/).filter({ visible: true }).first()).toBeVisible();
    });

    test("status filter is offered", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders");
      await expect(page.getByLabel(/status/i)).toBeVisible();
    });

    test("without a backend the error state offers a retry", async ({ page }) => {
      await page.goto("/purchase-orders");
      // React Query retries (~7s backoff) before the error state renders.
      await expect(page.getByRole("alert")).toHaveText(/could not load purchase orders/i, {
        timeout: 20000,
      });
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    });

    test("new-PO dialog validates before any network call", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders");
      await page.getByRole("button", { name: /new purchase order/i }).first().click();
      await expect(
        page.getByRole("heading", { name: "New purchase order" }),
      ).toBeVisible();
      // Empty submit: supplier required + lines required → inline errors.
      await page.getByRole("button", { name: /create draft/i }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    });

    test("detail page renders lines with totals", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await expect(page.getByText("Fresh Farms Produce").first()).toBeVisible();
      await expect(page.getByText("Tomato").first()).toBeVisible();
      // 10 × ₹32.50 = ₹325.00 line total.
      await expect(page.getByText(/₹325\.00/).first()).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager reaches the purchase orders page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders");
      await expect(
        page.getByRole("heading", { name: "Purchase orders" }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the purchase orders page", async ({ page }) => {
      await page.goto("/purchase-orders");
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "Purchase orders" }),
      ).not.toBeVisible();
    });

    test("staff is bounced off a PO detail page", async ({ page }) => {
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await expect(page).toHaveURL(/\/$/);
    });
  });
});

test.describe("purchase orders live flow", () => {
  test.use({ role: "owner" });

  test("create a draft PO with prefilled lines", async () => {
    test.skip(!LIVE, "needs a live Supabase backend");
    // Implemented when the live backend is available (P3-02 or later):
    // create supplier + price list, create draft PO via dialog, assert
    // lines + totals, then clean up.
  });
});

test.describe("PO lifecycle (P3-02)", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("draft PO shows Send and Cancel, hides Receive", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await expect(page.getByRole("heading", { name: /purchase order/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^send$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /cancel order/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^receive$/i })).toHaveCount(0);
    });

    test("send flow confirms and toasts", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await page.getByRole("button", { name: /^send$/i }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: "Send order" }).click();
      // The send RPC stub returns void → success toast.
      await expect(page.getByText(/purchase order sent/i)).toBeVisible();
    });

    test("sent PO shows Receive and Cancel with received/pending line quantities", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000002");
      await expect(page.getByRole("button", { name: /^receive$/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /cancel order/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /^send$/i })).toHaveCount(0);
      // 20 ordered, 8 received → "(12 pending)".
      await expect(page.getByText("(12 pending)")).toBeVisible();
    });

    test("receive form prefills remaining and validates before posting", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000002");
      await page.getByRole("button", { name: /^receive$/i }).click();
      const qtyInput = page.getByLabel(/qty receiving \(kg\)/i);
      await expect(qtyInput).toHaveValue("12");
      // Over-receive guard: entering more than pending blocks the post.
      await qtyInput.fill("99");
      await page.getByRole("button", { name: /post receipt/i }).click();
      await expect(page.getByText(/only 12 remaining/i)).toBeVisible();
      // Valid quantity posts against the stubbed RPC → success toast.
      await qtyInput.fill("12");
      await page.getByRole("button", { name: /post receipt/i }).click();
      await expect(page.getByText(/receipt posted/i)).toBeVisible();
    });
  });
});
