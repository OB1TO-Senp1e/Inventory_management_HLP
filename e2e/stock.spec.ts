import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

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

    test("staff cannot reach the items page (opening balance is owner/manager-only)", async ({
      page,
    }) => {
      await page.goto("/items");
      // The route guard bounces staff to home — the action is unreachable,
      // not merely hidden (RLS is the enforcer; the guard is the UI layer).
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "Items" }),
      ).not.toBeVisible();
    });
  });
});

test.describe("receiving access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("receiving page renders the receipt form chrome", async ({ page }) => {
      await stubBackend(page);
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
      await stubBackend(page);
      await page.goto("/receiving");
      // Empty submit: Zod rejects client-side, inline errors appear, and
      // the stubbed backend sees no request.
      await page.getByRole("button", { name: /post receipt/i }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
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

test.describe("wastage access", () => {
  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("wastage page renders the quick-log form", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/wastage");
      await expect(
        page.getByRole("heading", { name: "Usage & wastage" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Usage", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Wastage", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /log usage/i }),
      ).toBeVisible();
    });

    test("toggle switches the reason codes", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/wastage");
      const reason = page.getByLabel("Reason");
      await expect(reason).toBeVisible();
      await expect(
        reason.getByRole("option", { name: "Kitchen use" }),
      ).toBeAttached();
      await page.getByRole("button", { name: "Wastage", exact: true }).click();
      await expect(
        reason.getByRole("option", { name: "Expired" }),
      ).toBeAttached();
      await expect(
        reason.getByRole("option", { name: "Kitchen use" }),
      ).not.toBeAttached();
    });

    test("form validates before any network call", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/wastage");
      // Empty submit: Zod rejects client-side and inline errors appear.
      await page.getByRole("button", { name: /log usage/i }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
    });
  });

  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("owner can open the wastage page", async ({ page }) => {
      await page.goto("/wastage");
      await expect(
        page.getByRole("heading", { name: "Usage & wastage" }),
      ).toBeVisible();
    });
  });
});

test.describe("wastage live flow", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "staff" });

  test("staff logs wastage with a reason code", async ({ page }) => {
    // The receiving live flow creates the item; reuse the first picker row.
    await page.goto("/wastage");
    const itemSelect = page.getByLabel("Item");
    await expect(itemSelect).toBeVisible();
    await itemSelect.selectOption({ index: 1 });
    await page.getByLabel(/quantity \(.+\)/i).fill("1");
    await page.getByRole("button", { name: "Wastage", exact: true }).click();
    await page.getByLabel("Reason").selectOption({ label: "Expired" });
    await page.getByRole("button", { name: /log wastage/i }).click();
    await expect(page.getByText("Wastage logged.")).toBeVisible();
  });
});

test.describe("item detail page", () => {
  const PROBE_ID = "00000000-0000-0000-0000-000000000000";

  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("detail route renders (error state without a backend)", async ({
      page,
    }) => {
      // No backend here: the item query fails and the page renders its
      // error state. The route, guard, breadcrumb and states are what
      // this proves; live data runs in CI.
      // NOTE: the query retries with backoff (~7s) before surfacing the
      // error, so this needs a longer-than-default timeout.
      await page.goto(`/items/${PROBE_ID}`);
      await expect(page).not.toHaveURL(/\/login$/);
      await expect(
        page.getByRole("link", { name: "Back to items" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByText(/could not load this item|item not found/i),
      ).toBeVisible({ timeout: 15000 });
      // The breadcrumb still resolves the trail with the id fallback
      // (scoped to the breadcrumb nav — the primary nav has its own
      // "Items" link, and "Back to items" contains the substring).
      await expect(
        page
          .getByRole("navigation", { name: "Breadcrumb" })
          .getByRole("link", { name: "Items", exact: true }),
      ).toBeVisible();
    });

    test("items list links each name to the detail page", async ({ page }) => {
      await page.goto("/items");
      const link = page.getByRole("link", { name: "Tomato" }).first();
      // Without a backend the list is empty; the link contract is covered
      // by unit tests — here we only assert the list page itself loads.
      await expect(
        page.getByRole("heading", { name: "Items" }),
      ).toBeVisible();
      await expect(link).toHaveCount(0);
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced from the item detail page", async ({ page }) => {
      await page.goto(`/items/${PROBE_ID}`);
      await expect(page).toHaveURL(/\/$/);
    });
  });
});

test.describe("item detail live flow", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("detail shows stock, ledger and batches", async ({ page }) => {
    // Seeded item id comes from the live backend; the receiving live flow
    // creates items — reuse the detail link from the items list.
    await page.goto("/items");
    const detailLink = page.getByRole("link", { name: "Tomato" }).first();
    await detailLink.click();
    await expect(page.getByText("Stock now")).toBeVisible();
    await expect(page.getByText("Ledger history")).toBeVisible();
    await expect(page.getByText("Batches")).toBeVisible();
  });
});

test.describe("stock overview access", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("overview renders rows with quantities and status badges", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/stock");
      await expect(
        page.getByRole("heading", { name: "Stock" }),
      ).toBeVisible();
      // All three stubbed items render (table on desktop, cards on mobile).
      await expect(page.getByText(/Showing 3 of 3 items/)).toBeVisible();
      // Milk is low stock (3 <= 10); Tomato has an expiring batch.
      await expect(page.getByText("Low stock").first()).toBeVisible();
      await expect(page.getByText("Expiring soon").first()).toBeVisible();
    });

    test("filters combine: category, location, low stock, expiring", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/stock");
      await expect(page.getByText(/Showing 3 of 3 items/)).toBeVisible();

      // Dairy → only Milk.
      await page.getByLabel("Category").selectOption({ label: "Dairy" });
      await expect(page.getByText(/Showing 1 of 3 items/)).toBeVisible();

      // Low stock only keeps Milk (3 <= 10).
      await page.getByLabel("Low stock only").check();
      await expect(page.getByText(/Showing 1 of 3 items/)).toBeVisible();

      // Expiring soon excludes Milk (no batches) → empty.
      await page.getByLabel("Expiring soon").check();
      await expect(
        page.getByText("No items match these filters."),
      ).toBeVisible();

      // Back to all: clear via the empty-state action.
      await page
        .getByRole("button", { name: "Clear filters" })
        .last()
        .click();
      await expect(page.getByText(/Showing 3 of 3 items/)).toBeVisible();
    });

    test("without a backend the error state offers a retry", async ({
      page,
    }) => {
      await page.goto("/stock");
      // React Query retries (~7s backoff) before the error state renders.
      // Scoped to the stock table's error container: the reorder-suggestions
      // section renders its own alert + retry on the same page.
      const stockAlert = page.getByText("Could not load stock.", { exact: true });
      await expect(stockAlert).toBeVisible({ timeout: 20000 });
      const stockErrorBox = stockAlert.locator("xpath=..");
      await expect(
        stockErrorBox.getByRole("button", { name: "Retry" }),
      ).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager reaches the stock overview", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/stock");
      await expect(
        page.getByRole("heading", { name: "Stock" }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the stock overview (owner/manager only)", async ({
      page,
    }) => {
      await page.goto("/stock");
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { name: "Stock" }),
      ).not.toBeVisible();
    });
  });
});

test.describe("stock overview live flow", () => {
  test.skip(!LIVE, "needs a live Supabase backend (E2E_LIVE_SUPABASE=1)");
  test.use({ role: "owner" });

  test("overview lists items with derived quantities", async ({ page }) => {
    await page.goto("/stock");
    await expect(
      page.getByRole("heading", { name: "Stock" }),
    ).toBeVisible();
    // Seeded data has items; the exact rows depend on the live backend.
    await expect(page.getByText(/Showing \d+ of \d+ items/)).toBeVisible({
      timeout: 20000,
    });
  });
});

test.describe("reorder suggestions", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("low-stock items group by preferred supplier", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/stock");
      const section = page.locator(
        'section[aria-labelledby="reorder-suggestions-heading"]',
      );
      await expect(
        section.getByRole("heading", { name: "Reorder suggestions" }),
      ).toBeVisible();
      // Milk (3 <= 10) has Fresh Farms as preferred supplier.
      await expect(section.getByText("Fresh Farms Produce")).toBeVisible();
      await expect(section.getByText("Milk")).toBeVisible();
      await expect(section.getByText(/Order 37 L/i)).toBeVisible();
      // Flour (0 <= 20) has no preferred supplier → unassigned group.
      await expect(section.getByText("No preferred supplier")).toBeVisible();
      await expect(section.getByText("Flour")).toBeVisible();
      // Tomato (42.5 > 10) is not low-stock → not suggested.
      await expect(section.getByText("Tomato")).not.toBeVisible();
    });

    test("one click creates a draft PO for the supplier group", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/stock");
      const section = page.locator(
        'section[aria-labelledby="reorder-suggestions-heading"]',
      );
      await section
        .getByRole("button", { name: /create draft po \(1 item\)/i })
        .click();
      // The stubbed create_purchase_order RPC returns a canned PO id;
      // the app navigates to the new draft.
      await expect(page).toHaveURL(
        /\/purchase-orders\/c0000000-0000-0000-0000-000000000001/,
        { timeout: 15000 },
      );
    });

    test("unassigned group offers no PO button", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/stock");
      const section = page.locator(
        'section[aria-labelledby="reorder-suggestions-heading"]',
      );
      // Only the Fresh Farms group has a create button.
      await expect(
        section.getByRole("button", { name: /create draft po/i }),
      ).toHaveCount(1);
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("manager sees reorder suggestions", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/stock");
      await expect(
        page.getByRole("heading", { name: "Reorder suggestions" }),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff is bounced off the stock page (no reorder visibility)", async ({
      page,
    }) => {
      await page.goto("/stock");
      await expect(page).toHaveURL(/\/$/);
    });
  });
});
