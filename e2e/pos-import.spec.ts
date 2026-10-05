import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * POS import spec (V2-06).
 *
 * Deterministic specs run everywhere with the stubbed backend — they
 * exercise the REAL import UI (provider picker, date range, fetch, preview
 * with fuzzy matching + manual mapping, over-sale confirmation, dedupe) with
 * zero backend. The `import_pos_sales` RPC is stubbed dynamically (records
 * external ids in a per-test set so refetch shows "already imported", and
 * echoes the posted lines aggregated per dish). The live flow needs a real
 * Supabase backend + POS credentials, so it only runs when
 * E2E_LIVE_SUPABASE=1.
 */

const LIVE = process.env.E2E_LIVE_SUPABASE === "1";

async function openImportDialog(page: Page) {
  await page.getByTestId("pos-import-open").click();
  await expect(page.getByTestId("pos-import-dialog")).toBeVisible();
}

async function fetchPreview(page: Page) {
  await page.getByTestId("pos-fetch-button").click();
  await expect(page.getByTestId("pos-row-stub-0001")).toBeVisible({
    timeout: 10000,
  });
}

test.describe("POS import", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("dialog opens with the demo provider picker and date range", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await openImportDialog(page);
      const dialog = page.getByTestId("pos-import-dialog");
      // The stub provider is clearly labeled as a demo in the picker.
      const provider = dialog.getByLabel("POS provider");
      await expect(provider).toHaveValue("stub");
      await expect(
        provider.locator("option", { hasText: /demo POS/i }),
      ).toHaveCount(1);
      await expect(page.getByTestId("pos-fetch-button")).toBeVisible();
      await expect(dialog.getByLabel("Sales from")).toBeVisible();
      await expect(dialog.getByLabel("Sales to")).toBeVisible();
    });

    test("preview shows auto-matched, suggested and no-match states", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await openImportDialog(page);
      await fetchPreview(page);

      // Exact + case-insensitive matches are preselected.
      const butter = page.getByTestId("pos-row-stub-0001");
      await expect(butter.getByText("Auto-matched")).toBeVisible();
      await expect(
        butter.getByLabel("Menu item for Butter Chicken"),
      ).toHaveValue("f0000000-0000-0000-0000-000000000001");
      const dal = page.getByTestId("pos-row-stub-0002");
      await expect(
        dal.getByLabel("Menu item for Dal Makhani"),
      ).toHaveValue("f0000000-0000-0000-0000-000000000002");

      // "Paneer Lababdar" matches nothing: flagged, no select value.
      const paneer = page.getByTestId("pos-row-stub-0004");
      await expect(paneer.getByText("No match — map or skip")).toBeVisible();
      await expect(
        paneer.getByLabel("Menu item for Paneer Lababdar"),
      ).toHaveValue("");

      // Import count reflects the three matched rows.
      await expect(page.getByTestId("pos-import-button")).toContainText(
        "Import 3 sales",
      );
    });

    test("manual mapping posts the mapped lines through import_pos_sales", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await openImportDialog(page);
      await fetchPreview(page);

      // Map the unmatched dish to Dal Makhani.
      await page
        .getByTestId("pos-row-stub-0004")
        .getByLabel("Menu item for Paneer Lababdar")
        .selectOption({ label: "Dal Makhani" });
      await expect(page.getByTestId("pos-import-button")).toContainText(
        "Import 4 sales",
      );

      const importRequest = page.waitForRequest(
        (req) =>
          req.url().includes("/rest/v1/rpc/import_pos_sales") &&
          req.method() === "POST",
      );
      await page.getByTestId("pos-import-button").click();
      const body = ((await importRequest).postDataJSON() ?? {}) as {
        p_provider: string;
        p_sales: {
          external_sale_id: string;
          menu_item_id: string;
          dishes: number;
          sold_at: string | null;
        }[];
        p_sale_date: string;
      };
      expect(body.p_provider).toBe("stub");
      expect(body.p_sales).toHaveLength(4);
      expect(
        body.p_sales.map((s) => s.external_sale_id).sort(),
      ).toEqual(["stub-0001", "stub-0002", "stub-0003", "stub-0004"]);
      const paneer = body.p_sales.find(
        (s) => s.external_sale_id === "stub-0004",
      );
      expect(paneer?.menu_item_id).toBe(
        "f0000000-0000-0000-0000-000000000002",
      );
      expect(paneer?.dishes).toBe(3);

      // Done phase: summary of the import.
      await expect(page.getByText("Import complete")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/4 sales imported/)).toBeVisible();
    });

    test("re-importing the same range shows already-imported, never double-posts", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await openImportDialog(page);
      await fetchPreview(page);
      // Import just one line to keep the round fast.
      await page
        .getByTestId("pos-row-stub-0001")
        .getByLabel("Menu item for Butter Chicken")
        .selectOption({ value: "" });
      await page
        .getByTestId("pos-row-stub-0002")
        .getByLabel("Menu item for Dal Makhani")
        .selectOption({ value: "" });
      await page.getByTestId("pos-import-button").click();
      await expect(page.getByText("Import complete")).toBeVisible({
        timeout: 10000,
      });
      await page.getByTestId("pos-import-close").click();

      // Fetch the same range again: stub-0003 is already imported.
      await openImportDialog(page);
      await fetchPreview(page);
      const row = page.getByTestId("pos-row-stub-0003");
      await expect(row.getByText("Already imported")).toBeVisible();
      await expect(
        row.getByLabel("Menu item for butter chicken"),
      ).toHaveCount(0);
      // stub-0001 and stub-0002 auto-match again on the fresh fetch.
      await expect(page.getByText("2 to import")).toBeVisible();
      await expect(page.getByText("1 already imported")).toBeVisible();
    });

    test("all-already-imported range disables import with a clear message", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await openImportDialog(page);
      await fetchPreview(page);
      // Map the unmatched dish too, so every sale in the range imports.
      await page
        .getByTestId("pos-row-stub-0004")
        .getByLabel("Menu item for Paneer Lababdar")
        .selectOption({ label: "Dal Makhani" });
      await page.getByTestId("pos-import-button").click();
      await expect(page.getByText("Import complete")).toBeVisible({
        timeout: 10000,
      });
      await page.getByTestId("pos-import-close").click();

      await openImportDialog(page);
      await fetchPreview(page);
      await expect(page.getByTestId("pos-import-button")).toBeDisabled();
      await expect(
        page.getByText("Every sale in this range was already imported."),
      ).toBeVisible();
    });

    test("over-sale on import requires explicit confirmation", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/sales");
      await openImportDialog(page);
      await fetchPreview(page);

      // Map everything to Butter Chicken: 4 + 6 + 2 + 3 = 15 dishes →
      // 7.5 kg tomato vs 4 kg on hand in the stub preview → over-sale.
      await page
        .getByTestId("pos-row-stub-0002")
        .getByLabel("Menu item for Dal Makhani")
        .selectOption({ label: "Butter Chicken" });
      await page
        .getByTestId("pos-row-stub-0003")
        .getByLabel("Menu item for butter chicken")
        .selectOption({ label: "Butter Chicken" });
      await page
        .getByTestId("pos-row-stub-0004")
        .getByLabel("Menu item for Paneer Lababdar")
        .selectOption({ label: "Butter Chicken" });

      await page.getByTestId("pos-import-button").click();
      // The import must not post yet: an explicit confirmation is required.
      await expect(page.getByText("Insufficient stock")).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText("Tomato")).toBeVisible();
      await page.getByRole("button", { name: /import anyway/i }).click();
      await expect(page.getByText("Import complete")).toBeVisible({
        timeout: 10000,
      });
    });

    test.skip(
      LIVE,
      "live: import against a real backend needs POS credentials",
    );
  });
});
