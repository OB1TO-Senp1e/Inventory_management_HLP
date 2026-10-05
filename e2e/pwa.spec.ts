import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * PWA spec (P6-01).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL service worker (registered from the production build),
 * the manifest wiring, and the install-prompt button with zero backend.
 * The SW install precaches the shell from the preview server; the stub
 * only intercepts /rest/v1/**, so navigation and asset requests hit the
 * real preview server and the worker.
 */
test.describe("pwa", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("links the manifest and theme color", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/");
      const manifest = page.locator('link[rel="manifest"]');
      await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");
      const theme = page.locator('meta[name="theme-color"]');
      await expect(theme).toHaveAttribute("content", "#171717");
    });

    test("registers the service worker", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/");
      // `ready` resolves as soon as the worker starts activating; poll
      // until activation (install + activate handlers) has completed.
      await page.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.active?.state === "activated";
      });
    });

    test("offline reload serves the cached app shell", async ({ page, context }) => {
      await stubBackend(page);
      await page.goto("/");
      // Wait until the worker is truly ready to serve offline. Merely
      // observing `active.state === "activated"` is racy — Chromium
      // propagates the state change optimistically, so the page can see
      // "activated" while the browser process is still finishing
      // activation (P6-03). We wait for the controller plus the cached
      // shell, then let the worker settle before cutting the network:
      // going offline immediately after activation races the worker's
      // startup and the offline navigation fails with
      // ERR_INTERNET_DISCONNECTED.
      await page.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active?.state !== "activated") return false;
        if (navigator.serviceWorker.controller?.state !== "activated")
          return false;
        const keys = await caches.keys();
        const shell = keys.find((k) => k.startsWith("ri-shell"));
        if (!shell) return false;
        const cache = await caches.open(shell);
        return (await cache.match("/index.html")) !== undefined;
      });
      await page.waitForTimeout(2000);
      await context.setOffline(true);
      try {
        await page.reload();
        // The app shell (brand + nav) renders from the cache even though
        // every API request fails offline.
        await expect(
          page.getByRole("link", { name: /restaurant inventory/i }).first(),
        ).toBeVisible({ timeout: 15000 });
        const controller = await page.evaluate(
          () => navigator.serviceWorker.controller?.state ?? "none",
        );
        expect(controller).toBe("activated");
      } finally {
        await context.setOffline(false);
      }
    });

    test("install button appears on beforeinstallprompt and prompts", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/");
      const installButton = page.getByRole("button", { name: "Install app" });
      await expect(installButton).toHaveCount(0);
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt");
        (event as unknown as { prompt: () => Promise<void> }).prompt =
          () => {
            (window as unknown as { __pwaPrompted: boolean }).__pwaPrompted =
              true;
            return Promise.resolve();
          };
        window.dispatchEvent(event);
      });
      await expect(installButton).toBeVisible();
      await installButton.click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __pwaPrompted?: boolean })
                .__pwaPrompted === true,
          ),
        )
        .toBe(true);
      // After prompting, the button hides itself.
      await expect(installButton).toHaveCount(0);
    });
  });
});
