import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test } from "@playwright/test";

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
    INSTALLATION_ACCESS_ENABLED: "true", REST_API_ENABLED: "true", REST_BRIDGE_ENABLED: "true", REST_SYNC_ENABLED: "false", FORTNOX_EVENTS_ENABLED: "false",
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

test("owner explicitly approves backend writes and revokes machine access", async ({page}, info) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => {if(m.type()==="error") errors.push(m.text());});
  await page.goto(`${origin}/setup`);
  await page.getByLabel("Engångskod").fill(await readFile(join(directory,"bootstrap-code.txt"),"utf8"));
  await page.getByLabel("E-post").fill("installation-browser-owner@example.invalid");
  await page.getByLabel("Lösenord",{exact:true}).fill("Synthetic-browser-password");
  await page.getByRole("button",{name:"Skapa ägare",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Dina företag"})).toBeVisible();
  await page.getByRole("link",{name:"AI-klienter",exact:true}).click();
  await page.getByRole("link",{name:"Hantera serverintegrationer"}).click();
  await expect(page).toHaveURL(`${origin}/admin/integrations`);
  expect(await page.title()).toBe("Fortnox MCP");
  await expect(page.getByRole("heading",{name:"Serverintegrationer",exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByLabel("Applikationens namn").fill("Synthetic Office");
  const posted = page.waitForResponse(r => r.url().endsWith("/admin/integrations/data") && r.request().method()==="POST");
  await page.getByRole("button",{name:"Godkänn beständig åtkomst",exact:true}).click();
  const created = await posted; expect(created.status(),await created.text()).toBe(201);
  await expect(page.getByRole("heading",{name:"Spara uppgifterna nu"})).toBeVisible();
  const client = await page.getByLabel("Client ID",{exact:true}).inputValue();
  const secret = await page.getByLabel("Client secret",{exact:true}).inputValue();
  const token = async () => {
    const r = await fetch(`${origin}/auth/oauth2/token`,{method:"POST",headers:{authorization:`Basic ${Buffer.from(`${encodeURIComponent(client)}:${encodeURIComponent(secret)}`).toString("base64")}`,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",resource:`${origin}/api/v1`})});
    expect(r.status).toBe(200); return await r.json() as {access_token:string;scope:string};
  };
  const first = await token(); expect(first.scope).not.toContain("api:write");
  await page.getByRole("button",{name:"Jag har sparat uppgifterna"}).click();
  await expect(page.getByLabel("Client secret",{exact:true})).toHaveCount(0);
  await page.screenshot({path:join(tmpdir(),`installation-read-${info.project.name}.png`),fullPage:false});
  await page.getByRole("button",{name:"Godkänn skrivning för nuvarande och framtida företag",exact:true}).click();
  await expect(page.getByRole("button",{name:"Återkalla skrivning",exact:true})).toBeVisible();
  expect((await token()).scope).toContain("api:write");
  expect((await fetch(`${origin}/api/v1/companies`,{headers:{authorization:`Bearer ${first.access_token}`}})).status).toBe(401);
  const approved = await token();
  await page.getByRole("button",{name:"Återkalla all åtkomst",exact:true}).click();
  await expect(page.getByText("Återkallad",{exact:true})).toBeVisible();
  expect((await fetch(`${origin}/api/v1/companies`,{headers:{authorization:`Bearer ${approved.access_token}`}})).status).toBe(401);
  await page.reload();
  await expect(page.getByText("Återkallad",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(tmpdir(),`installation-revoked-${info.project.name}.png`),fullPage:false});
  expect(errors).toEqual([]);
});
