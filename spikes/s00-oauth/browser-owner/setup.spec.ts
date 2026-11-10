import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { Connections, CredentialVault } from "../../../packages/core/src/index.js";
import { sqliteState } from "../../../apps/node/src/product-storage.js";
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
      FORTNOX_TEST_MODE: "true",
      FORTNOX_TEST_TENANTS: "100001,100002",
      ACCOUNTING_REFERENCES_ENABLED: "true",
      FORTNOX_RECEIPT_CONSENT: "true",
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
  const consoleMessages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) consoleMessages.push(message.text()); });
  await page.goto(`${origin}/setup`);
  await page.getByLabel("Engångskod").fill(await readFile(join(directory, "bootstrap-code.txt"), "utf8"));
  await page.getByLabel("E-post").fill("browser-owner@example.invalid");
  await page.getByLabel("Lösenord", { exact: true }).fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Skapa ägare", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dina företag" })).toBeVisible();
  await page.getByRole("button", { name: "Lägg till företag", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Lägg till företag" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fortsätt till Fortnox", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Inställningar", exact: true }).click();
  await page.screenshot({ path: join(tmpdir(), `s11-settings-${info.project.name}.png`), fullPage: true });
  await expect(page.getByLabel("Client ID", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Ange Fortnox API uppgifter", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/admin/fortnox/api-credentials`);
  await expect(page.getByRole("heading", { name: "Dina Fortnox-uppgifter" })).toBeVisible();
  await page.getByLabel("Client ID", { exact: true }).fill("synthetic-browser-client");
  await page.getByLabel("Client Secret", { exact: true }).fill("synthetic-browser-client-secret");
  await page.getByRole("button", { name: "Spara uppgifter" }).click();
  await expect(page).toHaveURL(`${origin}/admin/settings`);
  await expect(page.getByLabel("Client Secret", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sparade uppgifter – väntar på godkänd anslutning", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ange Fortnox API uppgifter", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Uppgifter finns sparade. De återläses inte i formuläret.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Client Secret", { exact: true })).toHaveValue("");
  await page.getByRole("link", { name: "Inställningar", exact: true }).click();
  // Synthetic UI-only approval. Actual matching credential/connection status is
  // tested separately in both Node/SQLite and workerd/D1 owner contracts.
  await page.route("**/admin/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    state.integration.verified = state.integration.configured;
    await route.fulfill({ response, json: state });
  });
  await page.reload();
  await expect(page.getByText("Godkänd", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Glöm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Glöm", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ange Fortnox API uppgifter", exact: true })).toBeVisible();
  await expect(page.getByText("API-uppgifter saknas", { exact: true })).toBeVisible();
  await page.unroute("**/admin/state");
  await page.getByRole("link", { name: "AI-klienter", exact: true }).click();
  await expect(page.getByText(`${origin}/mcp`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI clients" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Email").fill("browser-owner@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Sign-in failed. Check your email and password.", { exact:true })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("browser-owner@example.invalid");
  await expect(page.getByLabel("Password", { exact:true })).toHaveValue("");
  await page.screenshot({path:join(tmpdir(),`owner-login-retry-${info.project.name}.png`),fullPage:true});
  await page.getByLabel("Password", { exact: true }).fill("synthetic-browser-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your companies" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(consoleMessages.filter((message) => !message.includes("status of 409") && !message.includes("status of 401"))).toEqual([]);
});


test("company context, program drawer, deep links, keyboard and local disable", async ({ page }, info) => {
  const errors: string[] = [];
  const consoleMessages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) consoleMessages.push(message.text()); });
  const db = new DatabaseSync(join(directory, "product.sqlite"));
  const state = sqliteState(db);
  const owner = await state.get<{ ownerId: string }>("installation", "owner");
  if (!owner) throw new Error("Synthetic owner missing");
  const connections = new Connections(state, new CredentialVault({ a: Buffer.alloc(32, 7).toString("base64") }, "a"));
  const credentials = { clientId: "synthetic-client", clientSecret: "synthetic-client-secret", accessToken: "synthetic-access-token", expiresAt: Date.now() + 3600000 };
  const a = await connections.add(owner.value.ownerId, { tenant: "100001", name: "Exempelbolaget AB", organizationNumber: "000000-0000", mode: "service", scopes: ["companyinformation", "profile", "bookkeeping", "settings", "costcenter", "project"] }, credentials);
  const b = await connections.add(owner.value.ownerId, { tenant: "100002", name: "Exempelföretaget B", organizationNumber: "000000-0001", mode: "service", scopes: ["companyinformation", "profile"] }, credentials);
  db.close();
  const login = await page.request.post(`${origin}/auth/sign-in/email`, { headers: { origin }, data: { email: "browser-owner@example.invalid", password: "synthetic-browser-password" } });
  expect(login.ok()).toBe(true);
  await page.goto(`${origin}/admin/companies`);
  await expect(page.getByRole("heading", { name: "Dina företag" })).toBeVisible();
  await page.getByLabel("Sök företag").fill("Exempelbolaget");
  await expect(page.locator(".company-list-row")).toHaveCount(1);
  await page.getByRole("link", { name: /Exempelbolaget AB/ }).click();
  await expect(page.getByRole("heading", { name: "Exempelbolaget AB", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Företagsvyer" })).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), `s11-overview-${info.project.name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("Byt företag").selectOption(b.id);
  await expect(page).toHaveURL(`${origin}/admin/companies/${b.id}`);
  await expect(page.getByRole("heading", { name: "Exempelföretaget B", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Företagsvyer" }).getByRole("link", { name: "Bokföring", exact: true }).click();
  await page.reload();
  await expect(page).toHaveURL(`${origin}/admin/companies/${b.id}/bookkeeping`);
  await page.getByRole("button", { name: "Anslut program", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Anslut Bokföring", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Exempelföretaget B", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Fortsätt till Fortnox", exact: true })).toBeEnabled();
  await page.screenshot({ path: join(tmpdir(), `s11-dialog-${info.project.name}.png`), fullPage: false });
  const focusInDialog = () => page.evaluate(() => !!document.querySelector("dialog")?.contains(document.activeElement));
  await page.keyboard.press("Shift+Tab"); expect(await focusInDialog()).toBe(true);
  await page.keyboard.press("Tab"); expect(await focusInDialog()).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Anslut program", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Anslut program", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Fortsätt till Fortnox", exact: true })).toBeEnabled();
  await page.route(`**/admin/companies/${b.id}/programs/start`, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ program: "bookkeeping", features: ["references"], expected_revision: 0 });
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "CONNECTION_CONFLICT" }) });
  });
  await dialog.getByRole("button", { name: "Fortsätt till Fortnox", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Anslutningen kunde inte startas");
  await page.keyboard.press("Escape");
  await page.getByLabel("Byt företag").selectOption(a.id);
  await page.getByRole("button", { name: "Inaktivera program lokalt", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("Uppdaterat");
  await page.getByRole("navigation", { name: "Företagsvyer" }).getByRole("link", { name: "Översikt", exact: true }).click();
  const row = page.locator(".program-row").filter({ hasText: "Bokföring" });
  await expect(row).toContainText("Inte anslutet");
  await page.goBack(); await expect(page).toHaveURL(`${origin}/admin/companies/${a.id}/bookkeeping`);
  await page.getByRole("navigation", { name: "Företagsvyer" }).getByRole("link", { name: "Lön", exact: true }).click();
  await expect(page.getByText("Stöd planeras", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Anslut program", exact: true })).toHaveCount(0);
  const recoveryDb = new DatabaseSync(join(directory, "product.sqlite"));
  const recoveryConnections = new Connections(sqliteState(recoveryDb), new CredentialVault({ a: Buffer.alloc(32, 7).toString("base64") }, "a"));
  const execution = crypto.randomUUID();
  await recoveryConnections.mutate(owner.value.ownerId, a.id, (c) => { c.business = { proposals: [], executions: [{ id: execution, hash: "0".repeat(64), operation: "customer.create", client: "synthetic-browser-client", generation: c.generation, created: Date.now(), state: "outcome_unknown" }] }; });
  await recoveryConnections.disconnect(owner.value.ownerId, a.id);
  recoveryDb.close();
  await page.getByRole("link", { name: "Drift", exact: true }).click();
  await expect(page.getByText("Register eller dokument", { exact: true })).toBeVisible();
  await expect(page.getByText(execution, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(consoleMessages.filter((message) => !message.includes("status of 409") && !message.includes("status of 401"))).toEqual([]);
});

test("payroll consent excludes existing receipt access and refreshes stale program revision", async ({page}) => {
  const login=await page.request.post(`${origin}/auth/sign-in/email`,{headers:{origin},data:{email:"browser-owner@example.invalid",password:"synthetic-browser-password"}});
  expect(login.ok()).toBe(true);
  const state=await (await page.request.get(`${origin}/admin/state`)).json();
  const company=state.companies.find((c:{state:string})=>c.state==="active");
  if(!company)throw new Error("Synthetic active company missing");
  const freshRevision=company.programs.revision+5;
  const payrollFeature={id:"payroll-input",sv:"Löneunderlag och verifierade referenser",en:"Payroll input and verified references"};
  const exposePayroll=(programs:any)=>{
    programs.features=[...new Set([...programs.features,"receipt-files"])];
    const payroll=programs.programs.find((p:{id:string})=>p.id==="payroll");
    payroll.can_connect=true;payroll.connect_features=["payroll-input"];payroll.connection_features=[payrollFeature];
  };
  await page.route("**/admin/state",async(route)=>{
    const response=await route.fetch(), current=await response.json();
    const selected=current.companies.find((c:{company_id:string})=>c.company_id===company.company_id);
    exposePayroll(selected.programs);
    await route.fulfill({response,json:current});
  });
  await page.route(`**/admin/companies/${company.company_id}/programs`,async(route)=>{
    const response=await route.fetch(), current=await response.json();
    exposePayroll(current);current.revision=freshRevision;
    await route.fulfill({response,json:current});
  });
  let previews=0;
  await page.route(`**/admin/companies/${company.company_id}/programs/preview`,async(route)=>{
    previews++;
    expect(route.request().postDataJSON()).toEqual({program:"payroll",features:["payroll-input"],expected_revision:freshRevision});
    await route.fulfill({status:400,contentType:"application/json",json:{error:"CONNECTION_REQUEST_FAILED",reason:"OUTCOME_UNKNOWN",stage:"program_connection"}});
  });
  await page.goto(`${origin}/admin/companies/${company.company_id}/payroll`);
  await page.getByRole("button",{name:"Anslut program",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Anslut Lön",exact:true});
  await expect(dialog.getByRole("status")).toContainText("En tidigare skrivning har okänt resultat");
  await expect(dialog.getByRole("button",{name:"Fortsätt till Fortnox",exact:true})).toBeDisabled();
  expect(previews).toBe(1);
});
