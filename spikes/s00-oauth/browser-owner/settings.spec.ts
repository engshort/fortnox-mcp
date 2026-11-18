import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";
import { Memberships } from "../../../packages/core/src/memberships.js";
import { sqliteState } from "../../../apps/node/src/product-storage.js";
import { createProductAuth, type Owner } from "../../../apps/shared/product-auth.js";

const root = resolve(import.meta.dirname, "../../..");
let directory: string;
let child: ChildProcess;
let origin: string;
async function start() {
  child = spawn(process.execPath, ["dist/product-node.js"], { cwd: root, stdio: "ignore", env: {
    ...process.env, PUBLIC_ORIGIN: origin, HOST: "127.0.0.1", PORT: new URL(origin).port,
    DATA_DIR: directory, PRODUCT_DATABASE: join(directory, "product.sqlite"), NODE_PROXY_MODE: "none",
    AUTH_SECRET_FILE: "", AUTH_SECRET: "synthetic-settings-browser-secret-at-least-32-characters",
    CREDENTIAL_KEYS_FILE: "", CREDENTIAL_KEYS: JSON.stringify({ a: Buffer.alloc(32, 5).toString("base64") }), CREDENTIAL_ACTIVE_KEY: "a",
    MCP_REDIRECT_URIS: '["https://client.example.invalid/callback"]', FORTNOX_CLIENT_ID: "", FORTNOX_CLIENT_SECRET: "", FORTNOX_CLIENT_SECRET_FILE: "",
    MULTI_USER_ENABLED: "false", MEMBERSHIP_PROVISIONING_ENABLED: "false", RESEND_ENABLED: "false", RESEND_API_KEY: "", RESEND_API_KEY_FILE: "", RESEND_FROM: "",
    REST_API_ENABLED: "false", REST_BRIDGE_ENABLED: "false", REST_SYNC_ENABLED: "false", FORTNOX_EVENTS_ENABLED: "false",
    FINANCIAL_ANALYSIS_CONTEXTS_ENABLED: "false", FINANCIAL_LARGE_READS_ENABLED: "false", FORTNOX_TEST_MODE: "false", FINANCIAL_READ_MODULES: "",
    EXTERNAL_APP_ONBOARDING_ENABLED: "false", EXTERNAL_APP_ONBOARDING_CLIENT_IDS: "[]", MCP_OFFLINE_CLIENT_IDS: "[]",
    RECEIPT_FILE_TRANSPORT: "none", RECEIPT_FILE_ORIGINS: "", RECEIPT_FILE_RELAY_TOKEN: "",
  } });
  for (let n = 0; n < 150; n++) {
    if (child.exitCode !== null) throw new Error("Synthetic settings fixture exited");
    try { if ((await fetch(`${origin}/health`)).ok) return; } catch {}
    await delay(50);
  }
  throw new Error("Synthetic settings fixture unavailable");
}
async function stop() {
  if (child?.exitCode === null) { const stopped = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGTERM"); await stopped; }
}
test.beforeAll(async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback port");
  origin = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  directory = await mkdtemp(join(tmpdir(), "fortnox-settings-browser-"));
  await start();
});
test.afterAll(async () => { await stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

test("owner changes persisted features without restart, handles conflicts, and restores server defaults", async ({ page, context }, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("409 (Conflict)")) errors.push(message.text()); });
  await page.goto(`${origin}/setup`);
  await page.getByLabel("Engångskod").fill(await readFile(join(directory, "bootstrap-code.txt"), "utf8"));
  await page.getByLabel("E-post").fill("settings-browser-owner@example.invalid");
  await page.getByLabel("Lösenord", { exact: true }).fill("Synthetic-browser-password");
  await page.getByRole("button", { name: "Skapa ägare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dina företag" })).toBeVisible();
  await page.getByRole("link", { name: "Inställningar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inställningar", exact: true })).toBeVisible();
  expect(await page.title()).toBe("Fortnox MCP");
  await expect(page.getByRole("heading", { name: "E-post", exact: true })).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), `settings-overview-${info.project.name}.png`), fullPage: false });

  const users = page.getByRole("region", { name: "Användare", exact: true });
  await users.getByLabel("Fleranvändarstöd", { exact: true }).check();
  await users.getByLabel("Medlemssynkronisering via API", { exact: true }).check();
  await users.getByRole("button", { name: "Spara användare", exact: true }).click();
  await expect(users.getByRole("status")).toContainText("Ändringarna gäller direkt");
  await expect(page.getByRole("link", { name: "Medlemmar", exact: true })).toBeVisible();

  const email = page.getByRole("region", { name: "E-post", exact: true });
  await email.getByLabel("Avsändaradress", { exact: true }).fill("sender@example.invalid");
  await email.getByLabel("Resend API-nyckel", { exact: true }).fill("re_browser_synthetic_secret");
  await email.getByRole("button", { name: "Spara e-post", exact: true }).click();
  await expect(email.getByRole("status")).toContainText("Sparat");
  await expect(email.getByLabel("Resend API-nyckel", { exact: true })).toHaveValue("");
  await expect(email.getByText("API-nyckel konfigurerad.", { exact: false })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("re_browser_synthetic_secret");

  const registration = await fetch(`${origin}/auth/oauth2/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Synthetic settings backend", redirect_uris: ["https://client.example.invalid/callback"], token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "mcp:read offline_access" }) });
  expect(registration.status).toBe(201);
  await page.reload();
  const integrations = page.getByRole("region", { name: "Integrationer", exact: true });
  await integrations.getByLabel("REST-API", { exact: true }).check();
  await integrations.getByLabel("REST-brygga", { exact: true }).check();
  await integrations.getByLabel("Företagssynk", { exact: true }).check();
  await integrations.getByLabel("Realtidshändelser från Fortnox", { exact: true }).check();
  await integrations.getByLabel("Företagsanslutning från externa appar", { exact: true }).check();
  await integrations.getByRole("group", { name: "Tillåtna appar för företagsanslutning" }).getByRole("checkbox").check();
  await integrations.getByRole("group", { name: "Backendklienter med 30 dagars åtkomst" }).getByRole("checkbox").check();
  await integrations.getByRole("button", { name: "Spara integrationer", exact: true }).click();
  await expect(integrations.getByRole("status")).toContainText("Sparat");
  await expect(integrations.getByText("Aktiverad – En granskad REST-katalog saknas.").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await integrations.screenshot({ path: join(tmpdir(), `settings-integrations-${info.project.name}.png`) });

  const specification = JSON.stringify({ openapi: "3.0.3", info: { title: "Synthetic settings catalogue", version: "1" }, paths: { "/3/customers": { get: { operationId: "syntheticCustomers", responses: { "200": { description: "Synthetic result" } } } } } });
  const catalogue = page.getByRole("region", { name: "Granskad REST-katalog", exact: true });
  await catalogue.getByLabel("Granskat katalogpaket", { exact: true }).setInputFiles({ name: "synthetic-reviewed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ version: "fortnox-bridge-catalog-v1", specification, source_sha256: createHash("sha256").update(specification).digest("hex"), operations: [{ operation_id: "syntheticCustomers", method: "GET", path: "/3/customers", scopes: ["customer"], effect: "read", reconciliation: "none", finance: false, manual_vouchers: false, files: false, credentials: "company_oauth", unavailable: null }] })) });
  await catalogue.getByRole("button", { name: "Installera katalog", exact: true }).click();
  await expect(catalogue.getByRole("status")).toHaveText("Katalogen är installerad.");
  await expect(catalogue.getByText("Installerad revision", { exact: false })).toBeVisible();

  // UI-only Worker projection; real Node/D1 dependency enforcement is covered
  // by the shared settings contract. A configured unsupported flag must be
  // possible to turn off, while enabling it remains unavailable.
  await page.route(`${origin}/admin/settings`, async (route) => {
    if (route.request().isNavigationRequest() || route.request().method() !== "GET") { await route.continue(); return; }
    const response = await route.fetch();
    const settings = await response.json();
    settings.runtime.kind = "worker";
    settings.availability.fortnoxEvents = "node_required";
    await route.fulfill({ response, json: settings });
  });
  await page.reload();
  const inheritedRealtime = integrations.getByLabel("Realtidshändelser från Fortnox", { exact: true });
  await expect(inheritedRealtime).toBeChecked();
  await expect(inheritedRealtime).toBeEnabled();
  await inheritedRealtime.uncheck();
  await expect(inheritedRealtime).toBeDisabled();
  await page.unroute(`${origin}/admin/settings`);
  await page.reload();

  const second = await context.newPage();
  try {
    await second.goto(`${origin}/admin/settings`);
    const analysis = second.getByRole("region", { name: "Analys", exact: true });
    await analysis.getByLabel("Större analysinläsningar", { exact: true }).check();
    await analysis.getByRole("button", { name: "Spara analys", exact: true }).click();
    await expect(analysis.getByRole("status")).toContainText("Sparat");
    await email.getByLabel("Avsändaradress", { exact: true }).fill("changed@example.invalid");
    await email.getByRole("button", { name: "Spara e-post", exact: true }).click();
    await expect(email.getByRole("status")).toContainText("annan session");
    await email.getByRole("button", { name: "Hämta aktuella värden", exact: true }).click();
    await expect(email.getByLabel("Avsändaradress", { exact: true })).toHaveValue("sender@example.invalid");
  } finally { await second.close(); }

  // The actual Node process closes and reopens SQLite with unchanged ENV.
  await stop(); await start(); await page.reload();
  await expect(page.getByLabel("Större analysinläsningar", { exact: true })).toBeChecked();
  await expect(integrations.getByLabel("REST-API", { exact: true })).toBeChecked();
  await expect(email.getByText("API-nyckel konfigurerad.", { exact: false })).toBeVisible();
  const rest = integrations.locator(".settings-field").filter({ has: page.getByRole("checkbox", { name: "REST-API", exact: true }) });
  // Remove dependent app values in the same atomic save before returning REST
  // itself to its false server default.
  await integrations.getByLabel("REST-brygga", { exact: true }).uncheck();
  await integrations.getByLabel("Företagssynk", { exact: true }).uncheck();
  await integrations.getByLabel("Realtidshändelser från Fortnox", { exact: true }).uncheck();
  await rest.getByRole("button", { name: "Återställ till servervärde vid sparning", exact: true }).click();
  await integrations.getByRole("button", { name: "Spara integrationer", exact: true }).click();
  await expect(integrations.getByRole("status")).toContainText("Sparat");
  await expect(integrations.getByLabel("REST-API", { exact: true })).not.toBeChecked();
  await expect(rest.getByText("Serverkonfiguration", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Operations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Server configuration", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const db = new DatabaseSync(join(directory, "product.sqlite"));
  try {
    const state = sqliteState(db);
    const owner = (await state.get<Owner>("installation", "owner"))?.value.ownerId;
    if (!owner) throw new Error("Synthetic owner missing");
    const auth = createProductAuth({ state, database: db, origin, secret: "synthetic-settings-browser-secret-at-least-32-characters", multiUser: true });
    const memberships = new Memberships(state, true);
    for (const role of ["admin", "member"] as const) {
      const account = await auth.api.signUpEmail({ body: { email: `settings-browser-${role}@example.invalid`, name: `Synthetic ${role}`, password: "Synthetic-browser-password" } });
      const membership = await memberships.save(owner, null, { email: account.user.email, name: account.user.name, role, active: true, companies: {} }, null);
      await memberships.link(owner, membership.id, membership.revision, account.user.id, "local", membership.externalId);
    }
  } finally { db.close(); }
  const adminContext = await context.browser()!.newContext({ viewport: page.viewportSize() ?? { width: 390, height: 844 } });
  const memberContext = await context.browser()!.newContext({ viewport: page.viewportSize() ?? { width: 390, height: 844 } });
  try {
    const admin = await adminContext.newPage();
    const member = await memberContext.newPage();
    for (const [actor, role] of [[admin, "admin"], [member, "member"]] as const) {
      actor.on("pageerror", (error) => errors.push(error.message));
      await actor.goto(`${origin}/sign-in`);
      await actor.getByLabel("E-post", { exact: true }).fill(`settings-browser-${role}@example.invalid`);
      await actor.getByLabel("Lösenord", { exact: true }).fill("Synthetic-browser-password");
      await actor.getByRole("button", { name: "Logga in", exact: true }).click();
    }
    await expect(member.getByRole("heading", { name: "Min åtkomst", exact: true })).toBeVisible();
    await expect(member.getByRole("link", { name: "Inställningar", exact: true })).toHaveCount(0);
    expect((await member.request.get(`${origin}/admin/settings`)).status()).toBe(401);
    await admin.getByRole("link", { name: "Inställningar", exact: true }).click();
    await expect(admin.getByText("Endast installationsägaren kan installera katalogen.", { exact: true })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Installera katalog", exact: true })).toHaveCount(0);
    const adminEmail = admin.getByRole("region", { name: "E-post", exact: true });
    await adminEmail.getByLabel("Skicka kontomejl", { exact: true }).check();
    await adminEmail.getByLabel("Resend API-nyckel", { exact: true }).fill("re_browser_admin_key");
    await adminEmail.getByRole("button", { name: "Spara e-post", exact: true }).click();
    await expect(adminEmail.getByRole("status")).toContainText("Sparat");
    await expect(adminEmail.getByText("Ägarens återställningsmejl är avstängda för denna nyckel.", { exact: false })).toBeVisible();
    const adminAnalysis = admin.getByRole("region", { name: "Analys", exact: true });
    await adminAnalysis.getByLabel("Återanvändbara analysunderlag", { exact: true }).check();
    await adminAnalysis.getByRole("button", { name: "Spara analys", exact: true }).click();
    await expect(adminAnalysis.getByRole("status")).toContainText("Sparat");
    const adminUsers = admin.getByRole("region", { name: "Användare", exact: true });
    await adminUsers.getByLabel("Fleranvändarstöd", { exact: true }).uncheck();
    await adminUsers.getByLabel("Medlemssynkronisering via API", { exact: true }).uncheck();
    await adminUsers.getByRole("button", { name: "Spara användare", exact: true }).click();
    await expect(adminUsers.getByRole("status")).toContainText("Inställningarna sparades.");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Multiple users", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Reusable analysis contexts", { exact: true })).toBeChecked();
    const ownerEmail = page.getByRole("region", { name: "Email", exact: true });
    await expect(ownerEmail.getByText("Owner recovery emails are disabled for this key.", { exact: false })).toBeVisible();
    await ownerEmail.getByLabel("Resend API key", { exact: true }).fill("re_browser_owner_replacement");
    await ownerEmail.getByRole("button", { name: "Save email", exact: true }).click();
    await expect(ownerEmail.getByRole("status")).toContainText("Saved");
    await expect(ownerEmail.getByText("Owner recovery emails are disabled for this key.", { exact: false })).toHaveCount(0);
  } finally { await adminContext.close(); await memberContext.close(); }
  expect(errors).toEqual([]);
});
