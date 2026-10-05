import { test as base, expect } from "@playwright/test";
import type { UserRole } from "../src/schemas/role";

/**
 * Shared Playwright fixtures (P0-06).
 *
 * `role` is an option fixture: `null` (default) means an unauthenticated
 * public visitor; otherwise the fixture seeds `localStorage["ri.mockRole"]`
 * via `addInitScript` before any page script runs. `src/api/auth.ts` honors
 * that key (test-only hook) and synthesizes a session + profile with zero
 * network access, so role-gated pages can be exercised without a live
 * GoTrue. RLS remains the real enforcement — this only changes which UI
 * the router renders.
 *
 * Usage:
 *   test("owner sees users nav", async ({ page }) => { ... });
 *   // with: test.use({ role: "owner" });
 */

export const MOCK_ROLE_STORAGE_KEY = "ri.mockRole";
export const MOCK_OUTLET_STORAGE_KEY = "ri.mockOutlet";
/** The stub backend's default outlet (first entry of OUTLETS). */
export const MOCK_OUTLET_ID = "c0000000-0000-0000-0000-000000000011";

type RoleFixtures = {
  role: UserRole | null;
};

export const test = base.extend<RoleFixtures>({
  role: [null, { option: true }],
  page: async ({ page, role }, use) => {
    if (role) {
      await page.addInitScript(
        ({ key, value }: { key: string; value: string }) => {
          window.localStorage.setItem(key, value);
        },
        { key: MOCK_ROLE_STORAGE_KEY, value: role },
      );
      // V2-07: pin the mocked profile to the stub backend's default outlet
      // so outlet-scoped UI (switcher, transfers) renders with zero backend.
      await page.addInitScript(
        ({ key, value }: { key: string; value: string }) => {
          window.localStorage.setItem(key, value);
        },
        { key: MOCK_OUTLET_STORAGE_KEY, value: MOCK_OUTLET_ID },
      );
    }
    await use(page);
  },
});

export { expect };
