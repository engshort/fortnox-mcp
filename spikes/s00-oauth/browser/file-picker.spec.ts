import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

interface FileHost {
  stats(): { stages: number; reads: number };
  state(): unknown;
  control(mode: string): void;
  remount(): void;
}
test("explicit host selection, separate staging, original-byte download and saved-reference remount", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/file-picker");
  await expect(page).toHaveTitle("Synthetic file picker host");
  const view = page.frameLocator("iframe");
  await expect(
    view.getByRole("heading", {
      name: "Välj kvittofiler för tillfällig lagring",
    }),
  ).toBeVisible();
  await view.getByRole("button", { name: "Välj uppladdade filer" }).click();
  await expect(
    view.getByRole("button", { name: "Lagra tillfälligt" }),
  ).toBeEnabled();
  const stats = () =>
    page.evaluate(() =>
      (window as unknown as { fileHarness: FileHost }).fileHarness.stats(),
    );
  expect(await stats()).toMatchObject({ stages: 0, reads: 0 });
  await view.locator("summary").click();
  await expect(view.locator("#sources")).toHaveText(
    "https://files.example.comhttps://files.example.com",
  );
  await view.getByRole("button", { name: "Lagra tillfälligt" }).click();
  await expect(
    view.getByRole("button", { name: "Lagra tillfälligt" }),
  ).toBeDisabled();
  await expect(
    view.getByRole("button", { name: "Hämta och kontrollera original" }),
  ).toHaveCount(2);
  await view
    .getByRole("button", { name: "Hämta och kontrollera original" })
    .nth(1)
    .click();
  const download = page.waitForEvent("download");
  await view
    .getByRole("link", { name: "Ladda ner kontrollerat original" })
    .click();
  const file = await download;
  const stream = await file.createReadStream();
  if (!stream) throw Error("Missing synthetic download");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("synthetic pdf original");
  const state = await page.evaluate(() =>
    JSON.stringify(
      (window as unknown as { fileHarness: FileHost }).fileHarness.state(),
    ),
  );
  expect(state).not.toContain("private-signature");
  expect(state).not.toContain("download_url");
  await page.evaluate(() =>
    (window as unknown as { fileHarness: FileHost }).fileHarness.remount(),
  );
  await expect(
    view.getByRole("button", { name: "Hämta och kontrollera original" }),
  ).toHaveCount(2);
  expect(await stats()).toMatchObject({ stages: 1, reads: 1 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: join(tmpdir(), `fortnox-file-picker-${info.project.name}.png`),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("host upload fallback and corrupt readback fail without a download link", async ({
  page,
}) => {
  await page.goto("/file-picker");
  await page.evaluate(() => {
    const h = (window as unknown as { fileHarness: FileHost }).fileHarness;
    h.control("no-library");
    h.remount();
  });
  const view = page.frameLocator("iframe");
  await expect(
    view.getByRole("button", { name: "Välj uppladdade filer" }),
  ).toBeDisabled();
  await view.locator("input[type=file]").setInputFiles([
    {
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from("synthetic png original"),
    },
    {
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic pdf original"),
    },
  ]);
  await expect(
    view.getByRole("button", { name: "Lagra tillfälligt" }),
  ).toBeEnabled();
  await view.getByRole("button", { name: "Lagra tillfälligt" }).click();
  await expect(
    view.getByRole("button", { name: "Hämta och kontrollera original" }),
  ).toHaveCount(2);
  await page.evaluate(() =>
    (window as unknown as { fileHarness: FileHost }).fileHarness.control(
      "corrupt",
    ),
  );
  await view
    .getByRole("button", { name: "Hämta och kontrollera original" })
    .first()
    .click();
  await expect(
    view.getByText(
      "Originalet kunde inte verifieras. Ingen nedladdningslänk skapades.",
    ),
  ).toBeVisible();
  await expect(view.getByRole("link")).toHaveCount(0);
});

test("missing optional file API leaves all file actions disabled", async ({
  page,
}) => {
  await page.goto("/file-picker");
  await page.evaluate(() => {
    const h = (window as unknown as { fileHarness: FileHost }).fileHarness;
    h.control("missing");
    h.remount();
  });
  const view = page.frameLocator("iframe");
  await expect(view.locator("#company")).toContainText("Syntetiskt filföretag");
  await expect(
    view.getByRole("button", { name: "Välj uppladdade filer" }),
  ).toBeDisabled();
  await expect(view.locator("input[type=file]")).toBeDisabled();
  await expect(
    view.getByRole("button", { name: "Lagra tillfälligt" }),
  ).toBeDisabled();
});

test("a lost staging answer is not resubmitted on timeout or remount", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/file-picker");
  const view = page.frameLocator("iframe");
  await view.getByRole("button", { name: "Välj uppladdade filer" }).click();
  await page.evaluate(() =>
    (window as unknown as { fileHarness: FileHost }).fileHarness.control(
      "lost",
    ),
  );
  await view.getByRole("button", { name: "Lagra tillfälligt" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { fileHarness: FileHost }).fileHarness.stats()
            .stages,
      ),
    )
    .toBe(1);
  await page.clock.fastForward(21000);
  await expect(view.locator("#status")).toContainText(
    "Lagringssvaret kunde inte verifieras",
  );
  await expect(
    view.getByRole("button", { name: "Lagra tillfälligt" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as unknown as { fileHarness: FileHost }).fileHarness.remount(),
  );
  await expect(view.locator("#company")).toContainText("Syntetiskt filföretag");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fileHarness: FileHost }).fileHarness.stats()
          .stages,
    ),
  ).toBe(1);
});
