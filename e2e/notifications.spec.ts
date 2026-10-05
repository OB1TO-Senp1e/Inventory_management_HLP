import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";
import type { Page } from "@playwright/test";

/**
 * Smart alerts spec (V2-03).
 *
 * Deterministic specs run everywhere with the stubbed backend. The canned
 * inbox matches the engine's computation exactly (Milk low-stock unread,
 * Flour low-stock read, Tomato B-101 expiring-soon unread), so the
 * background engine is a no-op and the badge/page are stable:
 * unread count = 2.
 *
 * The bell lives in both AppShell headers (mobile top bar + desktop
 * header), so specs scope to the `:visible` one like the sync badge does.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

const visibleBell = (page: Page) =>
  page.locator('[data-testid="alert-bell"]:visible');
const visibleBellBadge = (page: Page) =>
  page.locator('[data-testid="alert-bell-badge"]:visible');

test.describe("notifications", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("header bell shows the unread count and links to the inbox", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/");
      const bell = visibleBell(page);
      await expect(bell).toBeVisible();
      await expect(bell).toHaveAttribute("href", "/notifications");
      await expect(visibleBellBadge(page)).toContainText("2");
      await expect(bell).toHaveAttribute(
        "aria-label",
        "Notifications, 2 unread",
      );
    });

    test("inbox lists alerts newest-first with type badges", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/notifications");
      await expect(
        page.getByRole("heading", { name: "Notifications" }),
      ).toBeVisible();
      const items = page.getByTestId("notification-item");
      await expect(items).toHaveCount(3);
      // Newest first: Tomato expiry (08:30), Milk low (08:00), Flour low (07:00).
      await expect(items.nth(0)).toContainText("Tomato batch B-101");
      await expect(items.nth(1)).toContainText("Milk is running low");
      await expect(items.nth(2)).toContainText("Flour is running low");
      await expect(items.nth(0)).toContainText("Expiring soon");
      await expect(items.nth(1)).toContainText("Low stock");
      // Unread items carry the New pill; the read one does not.
      await expect(items.nth(0).getByText("New")).toBeVisible();
      await expect(items.nth(1).getByText("New")).toBeVisible();
      await expect(items.nth(2).getByText("New")).toHaveCount(0);
    });

    test("mark as read clears the New pill and drops the badge count", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/notifications");
      const items = page.getByTestId("notification-item");
      await expect(items).toHaveCount(3);
      await items
        .nth(1)
        .getByRole("button", { name: "Mark as read" })
        .click();
      await expect(items.nth(1).getByText("New")).toHaveCount(0);
      await expect(visibleBellBadge(page)).toContainText("1");
    });

    test("mark all read clears every New pill and the badge", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/notifications");
      await expect(page.getByTestId("notification-item")).toHaveCount(3);
      await page.getByRole("button", { name: "Mark all read" }).click();
      await expect(page.getByText("New")).toHaveCount(0);
      await expect(visibleBellBadge(page)).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Mark all read" }),
      ).toHaveCount(0);
    });

    test("dismiss removes the alert", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/notifications");
      const items = page.getByTestId("notification-item");
      await expect(items).toHaveCount(3);
      await items
        .nth(0)
        .getByRole("button", { name: /Dismiss alert/ })
        .click();
      await expect(page.getByTestId("notification-item")).toHaveCount(2);
      await expect(page.getByText("Tomato batch B-101")).toHaveCount(0);
    });

    test("empty inbox shows the empty state", async ({ page }) => {
      await stubBackend(page);
      // Override the inbox with zero rows; the engine's inserts fail
      // against the empty stub and are swallowed (best-effort).
      await page.route("**/rest/v1/notifications*", async (route) => {
        await route.fulfill({
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": "*/0",
          },
          body: "[]",
        });
      });
      await page.goto("/notifications");
      await expect(page.getByText("No alerts right now")).toBeVisible();
    });

    test("alert links open the item page", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/notifications");
      const items = page.getByTestId("notification-item");
      await expect(items).toHaveCount(3);
      await expect(
        items.nth(1).getByRole("link", { name: "View item" }),
      ).toHaveAttribute("href", expect.stringContaining("/items/"));
    });

    test("settings alerts tab saves preferences", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Alerts" }).click();
      const lowSwitch = page.getByRole("switch", {
        name: "Low-stock alerts",
      });
      await expect(lowSwitch).toHaveAttribute("aria-checked", "true");
      const windowInput = page.getByLabel("Expiry alert window (days)");
      await expect(windowInput).toHaveValue("7");
      await lowSwitch.click();
      await windowInput.fill("14");
      await page.getByRole("button", { name: "Save preferences" }).click();
      await expect(page.getByText("Alert preferences saved.")).toBeVisible();
      // The saved state survives the post-save refetch.
      await expect(lowSwitch).toHaveAttribute("aria-checked", "false");
      await expect(windowInput).toHaveValue("14");
    });

    test("settings alerts tab rejects an out-of-range window", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Alerts" }).click();
      const windowInput = page.getByLabel("Expiry alert window (days)");
      await windowInput.fill("0");
      await page.getByRole("button", { name: "Save preferences" }).click();
      await expect(
        page.getByText("Enter a whole number of days between 1 and 90."),
      ).toBeVisible();
    });
  });

  test.describe("as manager", () => {
    test.use({ role: "manager" });

    test("bell and inbox are visible", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/");
      await expect(visibleBell(page)).toBeVisible();
      await page.goto("/notifications");
      await expect(
        page.getByRole("heading", { name: "Notifications" }),
      ).toBeVisible();
      await expect(page.getByTestId("notification-item")).toHaveCount(3);
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("no bell and the inbox route bounces to home", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/");
      await expect(page.getByTestId("alert-bell")).toHaveCount(0);
      await page.goto("/notifications");
      await expect(page).toHaveURL(/\/$/);
    });
  });

  test.describe("live", () => {
    test.skip(
      !LIVE,
      "needs a real Supabase backend with seed data (E2E_LIVE_SUPABASE=1)",
    );
    test.use({ role: "owner" });

    test("engine generates a low-stock alert end to end", async ({
      page,
    }) => {
      // Placeholder for the live-backend flow: covered by the DB tests
      // and the deterministic engine specs until live runs are wired.
      await page.goto("/notifications");
      await expect(
        page.getByRole("heading", { name: "Notifications" }),
      ).toBeVisible();
    });
  });
});
