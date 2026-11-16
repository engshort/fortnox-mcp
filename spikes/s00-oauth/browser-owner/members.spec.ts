import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { Connections, CredentialVault } from "../../../packages/core/src/index.js";
import { sqliteState } from "../../../apps/node/src/product-storage.js";

const root = resolve(import.meta.dirname, "../../..");
let origin: string;
let directory: string;
let child: ChildProcess;
const key = Buffer.alloc(32, 7).toString("base64");
test.beforeAll(async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback port");
  origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  directory = await mkdtemp(join(tmpdir(), "fortnox-members-browser-"));
  child = spawn(process.execPath, ["dist/product-node.js"], { cwd: root, stdio: "ignore", env: {
    ...process.env, PRODUCT_ENABLED: "true", PUBLIC_ORIGIN: origin, HOST: "127.0.0.1", PORT: new URL(origin).port,
    DATA_DIR: directory, PRODUCT_DATABASE: join(directory, "product.sqlite"), NODE_PROXY_MODE: "none",
    AUTH_SECRET_FILE: "", AUTH_SECRET: "synthetic-members-browser-secret-at-least-32-characters",
    CREDENTIAL_KEYS_FILE: "", CREDENTIAL_KEYS: JSON.stringify({ a: key }), CREDENTIAL_ACTIVE_KEY: "a",
    MCP_REDIRECT_URIS: '["https://client.example.invalid/callback"]', FORTNOX_CLIENT_ID: "", FORTNOX_CLIENT_SECRET: "",
    FORTNOX_CLIENT_SECRET_FILE: "", MULTI_USER_ENABLED: "true", MEMBERSHIP_PROVISIONING_ENABLED: "true", RESEND_ENABLED: "false",
  } });
  for (let n = 0; n < 150; n++) {
    if (child.exitCode !== null) throw new Error("Synthetic membership fixture exited");
    try { if ((await fetch(`${origin}/health`)).ok) return; } catch {}
    await delay(50);
  }
  throw new Error("Synthetic membership fixture unavailable");
});
test.afterAll(async () => {
  if (child?.exitCode === null) { const stopped = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGTERM"); await stopped; }
  if (directory) await rm(directory, { recursive: true, force: true });
});
test("owner invites a member, delegates a generic integration and the member sees only assigned access", async ({ page, browser }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/setup`);
  await page.getByLabel("Engångskod").fill(await readFile(join(directory, "bootstrap-code.txt"), "utf8"));
  await page.getByLabel("E-post").fill("browser-owner@example.invalid");
  await page.getByLabel("Lösenord", { exact: true }).fill("Synthetic-browser-password");
  await page.getByRole("button", { name: "Skapa ägare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dina företag" })).toBeVisible();
  const db = new DatabaseSync(join(directory, "product.sqlite"));
  let companyId: string;
  try {
    const state = sqliteState(db);
    const owner = (await state.get<{ ownerId: string }>("installation", "owner"))?.value.ownerId;
    if (!owner) throw new Error("Missing synthetic owner");
    const connections = new Connections(state, new CredentialVault({ a: key }, "a"));
    const a = await connections.add(owner, { tenant: "100001", mode: "user", name: "Synthetic A", organizationNumber: "000000-0000", scopes: ["companyinformation", "profile"] }, { clientId: "synthetic-client", clientSecret: "synthetic-secret", accessToken: "synthetic-token", expiresAt: Date.now() + 3600000 });
    companyId = a.id;
    await connections.add(owner, { tenant: "100002", mode: "user", name: "Synthetic B", organizationNumber: "000000-0000", scopes: ["companyinformation", "profile"] }, { clientId: "synthetic-client", clientSecret: "synthetic-secret", accessToken: "synthetic-token", expiresAt: Date.now() + 3600000 });
  } finally { db.close(); }
  await page.reload();
  await page.getByRole("link", { name: "Medlemmar", exact: true }).click();
  await page.getByLabel("E-post", { exact: true }).fill("browser-member@example.invalid");
  await page.getByLabel("Namn", { exact: true }).fill("Synthetic member");
  await page.getByLabel("Synthetic A", { exact: true }).selectOption("read");
  await page.getByRole("button", { name: "Spara medlemskap", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic member", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skapa inbjudningslänk" }).click();
  const invitation = await page.getByLabel("Privat uppgift").inputValue();
  await page.getByRole("button", { name: "Dölj", exact: true }).click();
  await page.screenshot({ path: join(tmpdir(), `membership-admin-${info.project.name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Medlemsintegrationer", exact: true }).click();
  await page.getByLabel("Namn", { exact: true }).fill("Generic provisioning client");
  await page.getByLabel("Synthetic A", { exact: true }).check();
  await page.getByRole("button", { name: "Skapa integration", exact: true }).click();
  const token = await page.getByLabel("Privat uppgift").inputValue();
  expect(token).toMatch(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/);
  await page.getByRole("button", { name: "Dölj", exact: true }).click();
  const response = await fetch(`${origin}/api/membership-provisioning/v1/users/synthetic-external`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "if-none-match": "*" }, body: JSON.stringify({ email: "external-member@example.invalid", name: "Synthetic external", active: true, role: "member", companies: { [companyId]: "read" } }) });
  expect(response.status).toBe(201);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Membership integrations", exact: true })).toBeVisible();
  const context = await browser.newContext({ viewport: page.viewportSize() ?? { width: 390, height: 844 } });
  try {
    const employee = await context.newPage();
    employee.on("pageerror", (error) => errors.push(error.message));
    employee.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await employee.goto(invitation);
    await employee.getByLabel("Lösenord", { exact: true }).fill("Synthetic-member-password");
    await employee.getByRole("button", { name: "Aktivera konto", exact: true }).click();
    await expect(employee.getByRole("heading", { name: "Min åtkomst", exact: true })).toBeVisible();
    await expect(employee.getByRole("heading", { name: "Synthetic A", exact: true })).toBeVisible();
    await expect(employee.getByText("Synthetic B", { exact: true })).toHaveCount(0);
    await expect(employee.getByText(`${origin}/mcp`, { exact: true })).toBeVisible();
    expect(await employee.title()).toBe("Fortnox MCP");
    expect(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await employee.screenshot({ path: join(tmpdir(), `membership-employee-${info.project.name}.png`), fullPage: true });
    await employee.getByRole("button", { name: "English", exact: true }).click();
    await expect(employee.getByRole("heading", { name: "My access", exact: true })).toBeVisible();
    await employee.getByLabel("Current password", { exact: true }).fill("Synthetic-member-password");
    await employee.getByLabel("New password", { exact: true }).fill("Synthetic-member-replacement");
    await employee.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(employee.getByText("Password changed.", { exact: true })).toBeVisible();
    await employee.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(employee.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await employee.getByLabel("Email", { exact: true }).fill("browser-member@example.invalid");
    await employee.getByLabel("Password", { exact: true }).fill("Synthetic-member-replacement");
    await employee.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(employee.getByRole("heading", { name: "My access", exact: true })).toBeVisible();
  } finally { await context.close(); }
  expect(errors).toEqual([]);
});
