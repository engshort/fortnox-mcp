import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
const origin = "http://127.0.0.1:8795";
let directory: string;
let child: ChildProcess;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fortnox-owner-browser-"));
  child = spawn(process.execPath, ["dist/product-node.js"], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      PRODUCT_ENABLED: "true",
      PUBLIC_ORIGIN: origin,
      HOST: "127.0.0.1",
      PORT: "8795",
      DATA_DIR: directory,
      PRODUCT_DATABASE: join(directory, "product.sqlite"),
      NODE_PROXY_MODE: "none",
      AUTH_SECRET_FILE: "",
      AUTH_SECRET: "synthetic-browser-auth-secret-at-least-32-characters",
      CREDENTIAL_KEYS_FILE: "",
      CREDENTIAL_KEYS: JSON.stringify({ a: Buffer.alloc(32, 7).toString("base64") }),
      CREDENTIAL_ACTIVE_KEY: "a",
      MCP_REDIRECT_URIS: '["https://chatgpt.com/connector_platform_oauth_redirect"]',
      FORTNOX_TEST_MODE: "false",
      FORTNOX_CLIENT_ID: "",
      FORTNOX_CLIENT_SECRET: "",
      FORTNOX_CLIENT_SECRET_FILE: "",
    },
  });
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error("Browser fixture exited");
    try {
      if ((await fetch(`${origin}/health`)).ok) return;
    } catch {}
    await delay(50);
  }
  throw new Error("Browser fixture unavailable");
});
test.afterAll(async () => {
  if (child?.exitCode === null) {
    const stopped = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await stopped;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
test("owner bootstraps, stores write-only credentials, switches language and signs in again", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/setup`);
  await page.getByLabel("Engångskod").fill(await readFile(join(directory, "bootstrap-code.txt"), "utf8"));
  await page.getByLabel("E-post").fill("browser-owner@example.invalid");
  await page.getByLabel("Lösenord", { exact: true }).fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Skapa ägare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Din installation" })).toBeVisible();
  await page.getByRole("button", { name: "Fortnox", exact: true }).click();
  await expect(page.getByRole("button", { name: "Fortsätt till Fortnox", exact: true })).toBeDisabled();
  await page.screenshot({ path: join(tmpdir(), `m5-owner-${info.project.name}.png`), fullPage: true });
  await page.getByLabel("Client ID", { exact: true }).fill("synthetic-browser-client");
  await page.getByLabel("Client Secret", { exact: true }).fill("synthetic-browser-client-secret");
  await page.getByRole("button", { name: "Spara uppgifter" }).click();
  await expect(page.getByLabel("Client Secret", { exact: true })).toHaveValue("");
  await expect(page.getByText("Uppgifter finns sparade. De återläses inte i formuläret.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Fortnox", exact: true }).click();
  await expect(page.getByText("Uppgifter finns sparade. De återläses inte i formuläret.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Client Secret", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "ChatGPT", exact: true }).click();
  await expect(page.getByText(`${origin}/mcp`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your installation" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Email").fill("browser-owner@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your installation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
