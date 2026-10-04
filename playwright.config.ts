import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config (P0-06). Two projects — mobile 390px and desktop 1280px —
 * per the loop's quality gates. Tests run against `vite preview` (production
 * build); `webServer` starts it automatically when not already running.
 * Role fixtures live in e2e/fixtures.ts and inject mocked sessions via the
 * test-only `ri.mockRole` localStorage hook (see src/api/auth.ts) — no live
 * GoTrue needed.
 *
 * Backend contract: `pnpm test:e2e` builds the app with a dummy Supabase URL
 * (http://127.0.0.1:54321, nothing listens there), so data queries attempt
 * real HTTP requests that fail deterministically with connection-refused.
 * Specs that assert the no-backend UX wait out React Query's retries and
 * check the error state; specs that need the real UI call
 * `stubBackend(page)` (see e2e/stub-backend.ts) to serve canned rows.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: "pnpm preview --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
