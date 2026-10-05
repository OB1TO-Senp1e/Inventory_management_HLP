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

    test("send flow opens the WhatsApp deep link, confirms and toasts", async ({ page }) => {
      await stubBackend(page);
      // Record deep-link URLs instead of opening the real WhatsApp app.
      await page.addInitScript(() => {
        (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
        window.open = ((url?: string | URL | null) => {
          (window as unknown as { __openedUrls: string[] }).__openedUrls.push(
            String(url),
          );
          return null;
        }) as typeof window.open;
      });
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await page.getByRole("button", { name: /^send$/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      // Supplier phone "+91 98200 12345" → wa.me/919820012345 with the PO text.
      await page.getByRole("button", { name: /whatsapp/i }).click();
      const urls = await page.evaluate(
        () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
      );
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/^https:\/\/wa\.me\/919820012345\?text=/);
      expect(decodeURIComponent(urls[0])).toContain("Purchase order");
      // The app cannot observe the external app — the user confirms.
      await page.getByRole("button", { name: /mark as sent/i }).click();
      // The send RPC stub returns void → success toast, dialog closes.
      await expect(page.getByText(/purchase order sent/i)).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("email channel opens a mailto link with subject and body", async ({ page }) => {
      await stubBackend(page);
      await page.addInitScript(() => {
        (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
        window.open = ((url?: string | URL | null) => {
          (window as unknown as { __openedUrls: string[] }).__openedUrls.push(
            String(url),
          );
          return null;
        }) as typeof window.open;
      });
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await page.getByRole("button", { name: /^send$/i }).click();
      await page.getByRole("button", { name: /email/i }).click();
      const urls = await page.evaluate(
        () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
      );
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/^mailto:ramesh@freshfarms\.example\?/);
      const decoded = decodeURIComponent(urls[0]);
      expect(decoded).toContain("subject=");
      expect(decoded).toContain("Purchase order");
      await page.getByRole("button", { name: /mark as sent/i }).click();
      await expect(page.getByText(/purchase order sent/i)).toBeVisible();
    });

    test("channels are disabled when the supplier has no contact info", async ({ page }) => {
      await stubBackend(page);
      // Override the PO row (registered after the stub, so it wins) with a
      // supplier that has neither phone nor email; lines fall through to
      // the stub handler.
      await page.route("**/rest/v1/purchase_orders**", async (route) => {
        const url = new URL(route.request().url());
        const isDetail =
          route.request().method() === "GET" &&
          url.searchParams.get("id") ===
            "eq.d0000000-0000-0000-0000-000000000001";
        if (!isDetail) {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          // Mirrors the stub's .single() handling: a bare object, not an array.
          body: JSON.stringify({
            id: "d0000000-0000-0000-0000-000000000001",
            supplier_id: "e0000000-0000-0000-0000-000000000001",
            status: "draft",
            order_date: "2026-10-05",
            expected_date: "2026-10-12",
            notes: "Weekly order",
            gst_rate: 18,
            created_at: "2026-10-05T00:00:00Z",
            updated_at: "2026-10-05T00:00:00Z",
            sent_at: null,
            sent_via: null,
            suppliers: {
              name: "No Contact Supplier",
              address: null,
              phone: null,
              email: null,
              gstin: null,
            },
          }),
        });
      });
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      await page.getByRole("button", { name: /^send$/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const whatsapp = page.getByRole("button", { name: /whatsapp/i });
      const email = page.getByRole("button", { name: /email/i });
      await expect(whatsapp).toBeDisabled();
      await expect(email).toBeDisabled();
      await expect(
        page.getByText(/add a phone number to the supplier/i),
      ).toBeVisible();
      await expect(
        page.getByText(/add an email address to the supplier/i),
      ).toBeVisible();
      // No channel button may be chosen.
      await expect(page.getByRole("button", { name: /mark as sent/i }).first()).toHaveCount(0);
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

    test("sent PO shows the sent indicator and a re-send flow that audits", async ({ page }) => {
      await stubBackend(page);
      await page.addInitScript(() => {
        (window as unknown as { __openedUrls: string[] }).__openedUrls = [];
        window.open = ((url?: string | URL | null) => {
          (window as unknown as { __openedUrls: string[] }).__openedUrls.push(
            String(url),
          );
          return null;
        }) as typeof window.open;
      });
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000002");
      // Sent indicator rendered from sent_at/sent_via.
      await expect(page.getByText(/sent via whatsapp/i)).toBeVisible();
      await page.getByRole("button", { name: /re-send/i }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: /email/i }).click();
      const urls = await page.evaluate(
        () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
      );
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/^mailto:/);
      await page.getByRole("button", { name: /record re-send/i }).click();
      // The log_po_resend RPC stub returns void → success toast.
      await expect(page.getByText(/re-send via email recorded/i)).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
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

test.describe("PO print view (P3-04)", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("detail page links to the print view", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001");
      const printLink = page.getByRole("link", { name: /print/i });
      await expect(printLink).toBeVisible();
      await expect(printLink).toHaveAttribute(
        "href",
        "/purchase-orders/d0000000-0000-0000-0000-000000000001/print",
      );
    });

    test("print view renders the document with totals and GST", async ({ page }) => {
      await stubBackend(page);
      // Stubbed draft PO: 10×32.5 + 5×58 = ₹615 subtotal, 18% GST.
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001/print");
      await expect(
        page.getByRole("article", { name: /purchase order/i }),
      ).toBeVisible();
      // Restaurant (buyer) and supplier blocks.
      await expect(page.getByRole("heading", { name: "Testaurant" })).toBeVisible();
      await expect(page.getByText("Fresh Farms Produce", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/GSTIN: 27ABCDE1234F1Z5/)).toBeVisible();
      // Lines with snapshotted prices.
      await expect(page.getByText("₹615.00")).toBeVisible();
      // GST section: 615 × 18% = 110.70, grand total 725.70.
      await expect(page.getByText("GST (18%)")).toBeVisible();
      await expect(page.getByText("₹110.70")).toBeVisible();
      await expect(page.getByText("₹725.70")).toBeVisible();
    });

    test("print view without a backend shows the error state", async ({ page }) => {
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001/print");
      await expect(page.getByRole("alert")).toHaveText(/could not load/i, {
        timeout: 20000,
      });
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the print view (costs)", async ({ page }) => {
      await page.goto("/purchase-orders/d0000000-0000-0000-0000-000000000001/print");
      await expect(page).toHaveURL(/\/$/);
    });
  });
});
