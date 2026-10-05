import { test, expect } from "./fixtures";
import { stubBackend } from "./stub-backend";

/**
 * Invoice scan spec (V2-04).
 *
 * Deterministic specs run everywhere with the stubbed backend via the
 * `?simulateOcr=1` test seam (canned OCR text: Tomato, Milk, Paneer,
 * Coriander + bill furniture). The real tesseract.js OCR path is genuinely
 * implemented — the seam only makes the specs deterministic.
 * Posting goes through the stubbed `receive_goods` RPC, the same path as
 * manual receiving.
 */

const TOMATO_ID = "b0000000-0000-0000-0000-000000000001";
const MILK_ID = "b0000000-0000-0000-0000-000000000002";
const SUPPLIER_ID = "e0000000-0000-0000-0000-000000000001";

test.describe("invoice scanning", () => {
  test.describe("as owner", () => {
    test.use({ role: "owner" });

    test("receiving page links to the invoice scanner", async ({ page }) => {
      await stubBackend(page);
      await page.goto("/receiving");
      await page.getByRole("link", { name: "Scan invoice" }).click();
      await expect(page).toHaveURL(/\/receiving\/invoice/);
      await expect(
        page.getByText("Photograph the supplier bill"),
      ).toBeVisible();
    });

    test("simulate seam builds a reviewable draft with auto-matches", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving/invoice?simulateOcr=1");
      await page.getByRole("button", { name: "Simulate scan" }).click();

      await expect(
        page.getByText("Review the draft — 5 lines from the bill"),
      ).toBeVisible();
      // Tomato and Milk auto-match the stub's items; the rest need a pick.
      await expect(page.getByText("Auto-matched")).toHaveCount(2);
      await expect(page.getByText("Pick an item")).toHaveCount(3);
      const tomatoLine = page.locator(
        'fieldset[aria-label="Draft line 2"]',
      );
      await expect(tomatoLine.getByLabel("Item")).toHaveValue(TOMATO_ID);
      await expect(tomatoLine.getByLabel(/Quantity/)).toHaveValue("10");
      await expect(tomatoLine.getByLabel("Unit cost (₹)")).toHaveValue("40");
      // Raw OCR text is shown for transparency.
      await expect(page.getByText(/What the scanner saw/)).toBeVisible();
    });

    test("completing and posting the draft calls receive_goods with the supplier in notes", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving/invoice?simulateOcr=1");
      await page.getByRole("button", { name: "Simulate scan" }).click();
      await expect(
        page.getByText("Review the draft — 5 lines from the bill"),
      ).toBeVisible();

      // Line 1 (Fresh Farms Produce): pick Tomato, fill qty + cost.
      const line1 = page.locator('fieldset[aria-label="Draft line 1"]');
      await line1.getByLabel("Item").selectOption(TOMATO_ID);
      await line1.getByLabel(/Quantity/).fill("5");
      await line1.getByLabel("Unit cost (₹)").fill("10");
      // Line 4 (Paneer): pick Milk; qty/cost came from the bill.
      const line4 = page.locator('fieldset[aria-label="Draft line 4"]');
      await line4.getByLabel("Item").selectOption(MILK_ID);
      // Line 5 (Coriander): pick Tomato, fill qty + cost.
      const line5 = page.locator('fieldset[aria-label="Draft line 5"]');
      await line5.getByLabel("Item").selectOption(TOMATO_ID);
      await line5.getByLabel(/Quantity/).fill("3");
      await line5.getByLabel("Unit cost (₹)").fill("15");

      await page.getByLabel(/Bill supplier/).selectOption(SUPPLIER_ID);

      const requestPromise = page.waitForRequest(/\/rpc\/receive_goods/);
      await page.getByRole("button", { name: /Post receipt/ }).click();
      const request = await requestPromise;
      const body = request.postDataJSON() as {
        p_lines: {
          item_id: string;
          quantity: number;
          unit_cost: number;
          notes: string | null;
        }[];
      };
      expect(body.p_lines).toHaveLength(5);
      expect(body.p_lines[1]).toMatchObject({
        item_id: TOMATO_ID,
        quantity: 10,
        unit_cost: 40,
        notes: "Supplier: Fresh Farms Produce",
      });
      expect(body.p_lines[3]).toMatchObject({
        item_id: MILK_ID,
        quantity: 2,
        unit_cost: 320,
        notes: "Supplier: Fresh Farms Produce",
      });

      await expect(
        page.getByText("Receipt posted to the stock ledger."),
      ).toBeVisible();
      // Movement ids from the stubbed RPC echo render in the report.
      await expect(page.getByText("e0000000").first()).toBeVisible();
    });

    test("posting is blocked until every line is complete", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving/invoice?simulateOcr=1");
      await page.getByRole("button", { name: "Simulate scan" }).click();
      await page.getByRole("button", { name: /Post receipt/ }).click();
      await expect(
        page.getByText("Pick an item for this line.").first(),
      ).toBeVisible();
      // Still on the review step — nothing posted.
      await expect(
        page.getByText("Review the draft — 5 lines from the bill"),
      ).toBeVisible();
    });
  });

  test.describe("as staff", () => {
    test.use({ role: "staff" });

    test("staff can scan invoices (operational flow, no cost reveal)", async ({
      page,
    }) => {
      await stubBackend(page);
      await page.goto("/receiving/invoice?simulateOcr=1");
      await page.getByRole("button", { name: "Simulate scan" }).click();
      await expect(
        page.getByText("Review the draft — 5 lines from the bill"),
      ).toBeVisible();
    });
  });
});
