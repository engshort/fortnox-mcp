import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

interface Host {
  stats(): { commits: number; repairs: number; renewals: number };
  control(mode: string): void;
  remount(): void;
  changed(): void;
}
const view = (page: Page) =>
  page.frameLocator('iframe[title="Receipt review"]');
const control = (page: Page, mode: string) =>
  page.evaluate(
    (mode) =>
      (window as unknown as { receiptHarness: Host }).receiptHarness.control(
        mode,
      ),
    mode,
  );
const stats = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { receiptHarness: Host }).receiptHarness.stats(),
  );
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on("pageerror", (e) => captured.push(e.message));
  page.on("console", (m) => {
    if (["warning", "error"].includes(m.type())) captured.push(m.text());
  });
  await page.goto("/receipts");
  await expect(page).toHaveTitle("Synthetic receipt host");
  await expect(
    view(page).locator('button[data-commit="item-1"]'),
  ).toBeEnabled();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
test("separate totals and keyboard execution, then link-only repair and saved-card remount", async ({
  page,
}, info) => {
  const app = view(page);
  await expect(
    app.getByRole("heading", { name: "Granska kvitton var för sig" }),
  ).toBeVisible();
  await expect(
    app.getByText("Debet: 125.00 · Kredit: 125.00 · Differens: 0.00 SEK", {
      exact: true,
    }),
  ).toHaveCount(2);
  await app.locator('button[data-commit="item-1"]').focus();
  await page.keyboard.press("Enter");
  await expect(
    app.getByText("Status: Delvis klart", { exact: true }),
  ).toBeVisible();
  await app
    .locator('button[data-commit="item-1"]')
    .evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
  await expect(app.locator('button[data-commit="item-2"]')).toBeEnabled();
  await app.locator('button[data-repair="item-1"]').click();
  await expect(app.getByText("Status: Klart", { exact: true })).toBeVisible();
  await expect
    .poll(() => stats(page))
    .toEqual({ commits: 1, repairs: 1, renewals: 0 });
  await page.evaluate(() =>
    (window as unknown as { receiptHarness: Host }).receiptHarness.remount(),
  );
  await expect(app.getByText("Status: Klart", { exact: true })).toBeVisible();
  await expect(app.locator('button[data-commit="item-1"]')).toBeDisabled();
  await expect(app.locator('button[data-commit="item-2"]')).toBeDisabled();
  await expect
    .poll(() => stats(page))
    .toEqual({ commits: 1, repairs: 1, renewals: 0 });
  const frame = page.frames().find((f) => f.url().endsWith("/receipt-widget"));
  expect(frame).toBeDefined();
  expect(
    await frame?.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(tmpdir(), `m4-receipt-${info.project.name}.png`),
    fullPage: true,
  });
});
test("remount requires a new explicit review and never approves during capability renewal", async ({
  page,
}) => {
  const app = view(page);
  await page.evaluate(() =>
    (window as unknown as { receiptHarness: Host }).receiptHarness.remount(),
  );
  await expect(app.locator('button[data-commit="item-1"]')).toBeDisabled();
  await app.locator('button[data-renew="item-1"]').click();
  await expect(app.locator('button[data-commit="item-1"]')).toBeEnabled();
  await expect
    .poll(() => stats(page))
    .toEqual({ commits: 0, repairs: 0, renewals: 1 });
  await app.locator('button[data-commit="item-1"]').click();
  await expect(
    app.getByText("Status: Delvis klart", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => stats(page))
    .toEqual({ commits: 1, repairs: 0, renewals: 1 });
});
test("status failure and changed selection disable commit, repair and renewal", async ({
  page,
}) => {
  const app = view(page);
  await control(page, "status-error");
  await app.getByRole("button", { name: "Kontrollera status" }).click();
  await expect(app.getByRole("status")).toContainText(
    "Status kan inte verifieras",
  );
  for (const attribute of ["commit", "repair", "renew"])
    for (const id of ["item-1", "item-2"])
      await expect(
        app.locator(`button[data-${attribute}="${id}"]`),
      ).toBeDisabled();
  await control(page, "normal");
  await page.evaluate(() =>
    (window as unknown as { receiptHarness: Host }).receiptHarness.changed(),
  );
  await expect(app.getByRole("status")).toContainText(
    "Urval eller förslag ändrades",
  );
  await app.getByRole("button", { name: "Kontrollera status" }).click();
  await expect(app.locator('button[data-commit="item-1"]')).toBeDisabled();
  await expect
    .poll(() => stats(page))
    .toEqual({ commits: 0, repairs: 0, renewals: 0 });
});
test("lost commit answer times out without retry and status investigation cannot create another voucher", async ({
  page,
}) => {
  const app = view(page);
  await control(page, "lost");
  await app.locator('button[data-commit="item-1"]').click();
  await expect(app.getByRole("status")).toContainText("Utfallet är okänt", {
    timeout: 18000,
  });
  await app.getByRole("button", { name: "Kontrollera status" }).click();
  await expect(
    app.getByText("Status: Okänt utfall", { exact: true }),
  ).toBeVisible();
  await expect(app.locator('button[data-commit="item-1"]')).toBeDisabled();
  await expect(app.locator('button[data-renew="item-1"]')).toBeDisabled();
  await app.locator('button[data-repair="item-1"]').click();
  await expect(
    app.getByText("Status: Okänt utfall", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => stats(page))
    .toEqual({ commits: 1, repairs: 1, renewals: 0 });
});
