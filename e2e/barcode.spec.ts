import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Barcode scanning spec (V2-01).
 *
 * Deterministic specs run everywhere with the stubbed backend: the
 * `find_item_by_barcode` RPC is stubbed dynamically (Tomato =
 * 8901234567890, Milk = 8901234567891, anything else = unknown), so the
 * specs exercise the REAL entry UI (manual typed codes, the not-found
 * state, the camera overlay's ?simulateScan=1 test seam) with zero backend.
 * The real camera path is genuinely implemented with @zxing/browser — the
 * seam only makes the e2e deterministic where the fake camera is flaky.
 * A live flow against a real backend is covered by the stub-independent
 * DB tests (supabase/tests/v2_01_barcode_test.sql).
 */

const TOMATO_ID = "b0000000-0000-0000-0000-000000000001";
const SHEET_ID = "90000000-0000-0000-0000-000000000001";
const TOMATO_LINE_ID = "91000000-0000-0000-0000-000000000001";

test.describe("barcode scanning", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("receiving: typed barcode resolves and fills the first line", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving");
      await page.getByLabel("Barcode").fill("8901234567890");
      await page.getByRole("button", { name: "Find" }).click();
      await expect(page.getByText("Found: Tomato (kg)")).toBeVisible();
      await expect(page.getByLabel("Item")).toHaveValue(TOMATO_ID);
    });

    test("receiving: unknown barcode shows the not-found state with an Items link", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving");
      await page.getByLabel("Barcode").fill("0000000000000");
      await page.getByRole("button", { name: "Find" }).click();
      await expect(
        page.getByText(/No item found for barcode/),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "go to Items" }),
      ).toBeVisible();
    });

    test("receiving: camera scan resolves via the simulate seam", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving?simulateScan=1");
      await page.getByRole("button", { name: "Scan with camera" }).click();
      await expect(
        page.getByRole("dialog", { name: "Scan item barcode" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Simulate scan" }).click();
      await expect(page.getByText("Found: Tomato (kg)")).toBeVisible();
      await expect(page.getByLabel("Item")).toHaveValue(TOMATO_ID);
    });

    test("items dialog exposes the barcode field (edit shows the saved code)", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/items");
      await page.getByRole("button", { name: "Edit Tomato" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Barcode")).toHaveValue(
        "8901234567890",
      );
    });

    test("count sheet: barcode scan jumps to the item's row", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto(`/stock-counts/${SHEET_ID}`);
      await page.getByLabel("Barcode").fill("8901234567890");
      await page.getByRole("button", { name: "Find" }).click();
      const row = page.locator(`#count-line-${TOMATO_LINE_ID}`);
      await expect(row).toHaveClass(/ring-primary/);
      await expect(
        page.getByLabel("Counted quantity for Tomato"),
      ).toBeFocused();
    });

    test("count sheet: known barcode outside the count shows a notice", async ({
      page,
    }) => {
      await stubBackend(page);
      // The canned session only has Tomato + Milk lines; Flour's barcode
      // is null, so use an unknown code to hit the not-found path instead.
      await page.goto(`/stock-counts/${SHEET_ID}`);
      await page.getByLabel("Barcode").fill("0000000000000");
      await page.getByRole("button", { name: "Find" }).click();
      await expect(
        page.getByText(/No item found for barcode/),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff can resolve a barcode on receiving (cost-free lookup)", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving");
      await page.getByLabel("Barcode").fill("8901234567890");
      await page.getByRole("button", { name: "Find" }).click();
      await expect(page.getByText("Found: Tomato (kg)")).toBeVisible();
      await expect(page.getByLabel("Item")).toHaveValue(TOMATO_ID);
    });

    test("staff not-found state has guidance but no Items link", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving");
      await page.getByLabel("Barcode").fill("0000000000000");
      await page.getByRole("button", { name: "Find" }).click();
      await expect(page.getByText(/Ask an owner or manager/)).toBeVisible();
      await expect(
        page.getByRole("link", { name: "go to Items" }),
      ).not.toBeVisible();
    });

    test("staff can scan on the count sheet", async ({ page }) => {
      await stubBackend(page);
      await page.goto(`/stock-counts/${SHEET_ID}`);
      await page.getByLabel("Barcode").fill("8901234567891");
      await page.getByRole("button", { name: "Find" }).click();
      await expect(page.getByText("Found: Milk (L)")).toBeVisible();
    });
  });
});
