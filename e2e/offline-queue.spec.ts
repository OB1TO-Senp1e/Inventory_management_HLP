import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";
import type { Page } from "@playwright/test";

/**
 * Offline queue spec (P6-02).
 *
 * Deterministic specs run everywhere with the stubbed backend. They use
 * Playwright's offline emulation (`context.setOffline`), which flips
 * `navigator.onLine` in Chromium exactly like a real connectivity drop —
 * the queue wrapper enqueues without attempting the RPC, so no route
 * interception is needed while offline. Going back online fires the
 * `online` event, the engine drains, and the stub fulfills the RPCs.
 */

const visibleBadge = (page: Page) =>
  page.locator('[data-testid="sync-status"]:visible');

test.describe("offline queue", () => {
  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("usage submitted offline is queued, then syncs on reconnect", async ({
      page,
      context,
    }) => {
      await stubBackend(page);
      await page.goto("/wastage");
      await page.getByLabel("Item").selectOption({ index: 1 });
      await page.getByLabel(/Quantity/).fill("2");
      await page.getByLabel("Reason").selectOption("kitchen_use");

      await context.setOffline(true);
      try {
        await page.getByRole("button", { name: "Log usage" }).click();
        // Queued, not posted: the toast, the header badge, and the card.
        await expect(page.getByText(/usage queued/i)).toBeVisible();
        await expect(visibleBadge(page)).toContainText("1 queued");
        await expect(
          page.getByRole("region", { name: "Queued offline entries" }),
        ).toBeVisible();
        await expect(page.getByText("Pending sync (1)")).toBeVisible();
      } finally {
        await context.setOffline(false);
      }

      // Back online: the engine drains through the stubbed RPC.
      await expect(page.getByText(/1 queued entry synced/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(visibleBadge(page)).toHaveCount(0, { timeout: 15000 });
      await expect(
        page.getByRole("region", { name: "Queued offline entries" }),
      ).toHaveCount(0);
    });

    test("a failed replay keeps the entry with its error (no silent drop)", async ({
      page,
      context,
    }) => {
      await stubBackend(page);
      // Override AFTER stubBackend: the later route wins, so the replay
      // gets a server rejection (a conflict, not a network error).
      await page.route("**/rest/v1/rpc/log_usage", (route) =>
        route.fulfill({
          status: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Item is archived" }),
        }),
      );
      await page.goto("/wastage");
      await page.getByLabel("Item").selectOption({ index: 1 });
      await page.getByLabel(/Quantity/).fill("1");
      await page.getByLabel("Reason").selectOption("tasting");

      await context.setOffline(true);
      try {
        await page.getByRole("button", { name: "Log usage" }).click();
        await expect(visibleBadge(page)).toContainText("1 queued");
      } finally {
        await context.setOffline(false);
      }

      // The replay fails server-side: the badge flips to failed and the
      // entry stays in the queue with the server's message.
      await expect(visibleBadge(page)).toContainText("1 failed", {
        timeout: 15000,
      });
      await expect(page.getByRole("alert")).toContainText("Item is archived");
      await expect(page.getByText("Pending sync (1)")).toBeVisible();
    });
  });

  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("a receipt submitted offline is queued and syncs on reconnect", async ({
      page,
      context,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving");
      await page.getByLabel("Item").selectOption({ index: 1 });
      await page.getByLabel(/Quantity/).fill("5");
      await page.getByLabel(/Unit cost/).fill("40");

      await context.setOffline(true);
      try {
        await page.getByRole("button", { name: "Post receipt" }).click();
        await expect(page.getByText("Receipt queued for sync.")).toBeVisible();
        await expect(visibleBadge(page)).toContainText("1 queued");
      } finally {
        await context.setOffline(false);
      }

      await expect(page.getByText(/1 queued entry synced/i)).toBeVisible({
        timeout: 15000,
      });
      await expect(visibleBadge(page)).toHaveCount(0, { timeout: 15000 });
    });

    test("a network abort while online queues the submission", async ({
      page,
    }) => {
      await stubBackend(page);
      // The device reports online but the request dies in flight.
      await page.route("**/rest/v1/rpc/log_wastage", (route) =>
        route.abort("failed"),
      );
      await page.goto("/wastage");
      await page
        .getByRole("button", { name: "Wastage", exact: true })
        .click();
      await page.getByLabel("Item").selectOption({ index: 1 });
      await page.getByLabel(/Quantity/).fill("3");
      await page.getByLabel("Reason").selectOption("spoiled");
      await page.getByRole("button", { name: "Log wastage" }).click();
      await expect(page.getByText(/wastage queued/i)).toBeVisible();
      await expect(visibleBadge(page)).toContainText("1 queued");
    });
  });
});
