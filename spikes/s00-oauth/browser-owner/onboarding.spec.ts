import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  Connections,
  CredentialVault,
} from "../../../packages/core/src/index.js";
import { sqliteState } from "../../../apps/node/src/product-storage.js";
import { join, resolve } from "node:path";
import { test, expect } from "@playwright/test";
const root = resolve(import.meta.dirname, "../../..");
let child: ChildProcess;
let directory: string;
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "company-onboarding-browser-"));
  child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/onboarding-fixture.ts", directory],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Fixture did not start")),
      20_000,
    );
    child.stdout?.on("data", (data) => {
      if (String(data).includes("fixture ready:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Fixture exited before ready"));
    });
  });
});
test.afterEach(async () => {
  if (child?.exitCode === null) {
    const stopped = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await stopped;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function changeFixture(
  change: (connections: Connections, owner: string) => Promise<void>,
) {
  const db = new DatabaseSync(join(directory, "product.sqlite"));
  try {
    const state = sqliteState(db);
    const owner = (
      await state.get<{ ownerId: string }>("installation", "owner")
    )?.value.ownerId;
    if (!owner) throw new Error("Synthetic owner missing");
    await change(
      new Connections(
        state,
        new CredentialVault({ a: Buffer.alloc(32, 7).toString("base64") }, "a"),
      ),
      owner,
    );
  } finally {
    db.close();
  }
}
async function checkLayout(page: import("@playwright/test").Page) {
  await expect(
    page.getByRole("link", {
      name: "Fortnox MCP, administration",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}
async function signIn(page: import("@playwright/test").Page) {
  await page.getByLabel("E-post").fill("owner@example.invalid");
  await page
    .getByLabel("Lösenord", { exact: true })
    .fill("Synthetic-password-123456");
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
}
async function begin(page: import("@playwright/test").Page) {
  await page.goto("http://localhost:8802/");
  await page
    .getByRole("button", { name: "Anslut företag", exact: true })
    .click();
}
test("separate consumer and owner cookies complete A then B through actual HTTP OAuth and MCP", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400)
      errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
  });
  await page.goto("http://localhost:8802/");
  await expect(page).toHaveTitle("Syntetisk konsument");
  await page
    .getByRole("button", { name: "Anslut företag", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Logga in", exact: true }))
    .toBeVisible()
    .catch(async () => {
      throw new Error(
        "Login did not render: " +
          JSON.stringify({
            errors,
            path: new URL(page.url()).pathname,
            text: await page.locator("body").innerText(),
          }),
      );
    });
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-login-${info.project.name}.png`),
    fullPage: true,
  });
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Anslut företag", exact: true }),
  ).toBeVisible();
  await checkLayout(page);
  await expect(
    page.getByText(
      "Inga befintliga företag finns att välja för detta försök.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: join(tmpdir(), `connect-empty-${info.project.name}.png`),
    fullPage: true,
  });
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "consumer_session")?.domain).toBe(
    "localhost",
  );
  expect(
    cookies.some(
      (c) => c.domain === "127.0.0.1" && c.name.includes("session_token"),
    ),
  ).toBe(true);
  async function connect(company: "A" | "B") {
    await page.getByLabel("Anslutningstyp").selectOption("user");
    await page
      .getByRole("button", { name: "Fortsätt till Fortnox", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Godkänn Synthetic ${company}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Godkänn klient", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic consumer", { exact: true }),
    ).toBeVisible();
    await checkLayout(page);
    await expect(page.locator(".consent-access")).toContainText(
      `Företaget i detta försök: Synthetic ${company}`,
    );
    await expect(page.locator(".consent-company input").last()).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(
        tmpdir(),
        `onboarding-${company}-consent-${info.project.name}.png`,
      ),
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "Godkänn begärda behörigheter till valda företag",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(
      /http:\/\/localhost:8802\/companies\/[a-f0-9-]+/,
    );
    await expect(
      page.getByRole("heading", { name: "Verifierat kundkort", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Synthetic ${company}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Anslutningsstatus: active", { exact: true }),
    ).toBeVisible();
  }
  await connect("A");
  await page.getByRole("link", { name: "Anslut ytterligare företag" }).click();
  await page
    .getByRole("button", { name: "Anslut företag", exact: true })
    .click();
  await connect("B");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(tmpdir(), `onboarding-result-${info.project.name}.png`),
    fullPage: true,
  });
  await begin(page);
  await expect(page.locator(".onboarding-company")).toHaveCount(2);
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-companies-${info.project.name}.png`),
    fullPage: true,
  });
  const longName =
    "Synthetic företag med ett mycket långt namn för internationell verksamhet och administration <img src=x onerror=alert(1)>";
  await changeFixture(async (connections, owner) => {
    await connections.updateSet(owner, (set) => {
      set.connections[0].name = longName;
    });
  });
  await page.reload();
  await expect(page.getByText(longName, { exact: true })).toBeVisible();
  await expect(page.locator(".onboarding-company img")).toHaveCount(0);
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-long-name-${info.project.name}.png`),
    fullPage: true,
  });
  // Delay the real request to verify competing submissions cannot leave this page.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route("**/connect/company/*/choose", async (route) => {
    submissions++;
    await gate;
    await route.continue();
  });
  const choose = page.getByRole("button", {
    name: `Välj ${longName}`,
    exact: true,
  });
  await choose.focus();
  const choosing = choose.press("Enter");
  await expect(choose).toBeDisabled();
  await page
    .locator(".onboarding-company")
    .last()
    .evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await expect.poll(() => submissions).toBe(1);
  await expect(
    page.getByRole("button", { name: "Fortsätt till Fortnox", exact: true }),
  ).toBeDisabled();
  release();
  await choosing;
  await expect(
    page.getByRole("heading", { name: "Godkänn klient", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".consent-access")).toContainText(longName);
  await page.unroute("**/connect/company/*/choose");
  await page
    .getByRole("link", { name: "Tillbaka eller avbryt", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Valt företag", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Välj ${longName}`, exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: join(tmpdir(), `connect-selected-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Avbryt och återgå till applikationen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Anslutningen avbröts", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("lost response, pending consent and expired session retain a branded recovery flow", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await begin(page);
  await signIn(page);
  const attemptUrl = page.url();
  let providerSubmissions = 0;
  // Dispatch to the actual local fixture, then lose only its response.
  await page.route("**/connect/company/*/provider", async (route) => {
    providerSubmissions++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByLabel("Anslutningstyp").selectOption("user");
  await page
    .getByRole("button", { name: "Fortsätt till Fortnox", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Svaret saknas.");
  await expect(
    page.getByRole("button", {
      name: "Avbryt och återgå till applikationen",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toBeFocused();
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-lost-response-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Kontrollera sparat läge", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fortnox-godkännande pågår",
      exact: true,
    }),
  ).toBeVisible();
  expect(providerSubmissions).toBe(1);
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-pending-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Avbryt oanvänt medgivande", exact: true })
    .click();
  await expect(
    page.getByText("Anslutningen kunde inte slutföras.", { exact: false }),
  ).toBeVisible();
  // Seed the retained uncertainty for UI acceptance; actual unknown exchanges
  // and session fencing are independently covered in Node and workerd contracts.
  await changeFixture(async (connections, owner) => {
    await connections.updateSet(owner, (set) => {
      const attempt = set.onboarding?.[0];
      if (!attempt) throw new Error("Synthetic attempt missing");
      attempt.phase = "provider_outcome_unknown";
    });
  });
  await page.request.post("http://127.0.0.1:8801/auth/sign-out", {
    headers: { origin: "http://127.0.0.1:8801" },
    data: {},
  });
  await page.goto(attemptUrl);
  await signIn(page);
  await expect(
    page.getByRole("heading", {
      name: "Återuppta ägargranskning",
      exact: true,
    }),
  ).toBeVisible();
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-session-recovery-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Fortsätt granska med denna ägarsession",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Utfallet behöver kontrolleras",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fortsätt till Fortnox", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Avbryt och återgå till applikationen",
      exact: true,
    }),
  ).toHaveCount(0);
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-unknown-${info.project.name}.png`),
    fullPage: true,
  });
  expect(providerSubmissions).toBe(1);
  expect(errors).toEqual([]);
});

test("expired and missing browser attempts use bounded error pages", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      consoleErrors.push(message.text());
  });
  await begin(page);
  await signIn(page);
  const attemptUrl = page.url();
  await changeFixture(async (connections, owner) => {
    await connections.updateSet(owner, (set) => {
      if (set.onboarding?.[0]) set.onboarding[0].expiresAt = Date.now() - 1;
    });
  });
  const expired = await page.goto(attemptUrl);
  expect(expired?.status()).toBe(410);
  await expect(
    page.getByRole("heading", {
      name: "Anslutningsförsöket har gått ut",
      exact: true,
    }),
  ).toBeVisible();
  await checkLayout(page);
  await page.screenshot({
    path: join(tmpdir(), `connect-expired-${info.project.name}.png`),
    fullPage: true,
  });
  const missing = await page.goto(
    `http://127.0.0.1:8801/connect/company/${crypto.randomUUID()}?revision=1`,
  );
  expect(missing?.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      name: "Anslutningsförsöket hittades inte",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic consumer", { exact: true }),
  ).toHaveCount(0);
  await checkLayout(page);
  expect(errors).toEqual([]);
  expect(
    consoleErrors.filter((message) => !/status of (404|410)/.test(message)),
  ).toEqual([]);
});

for (const verified of [false, true]) {
  test(`expired ${verified ? "verified attempt during" : "link before"} login returns through the consumer with fresh bindings`, async ({page, context}, info) => {
    const errors: string[]=[];
    const warnings: string[]=[];
    let providerCallbacks=0;
    page.on("pageerror",e=>errors.push(e.message));
    page.on("console",m=>{if(["error","warning"].includes(m.type()))warnings.push(m.text());});
    page.on("request",r=>{if(new URL(r.url()).pathname==="/admin/fortnox/callback")providerCallbacks++;});
    await begin(page);
    await expect(page).toHaveURL(/\/sign-in\?/);
    let attemptId=new URL(page.url()).searchParams.get("company_onboarding")!;
    let companyId: string | undefined;
    if (verified) {
      await signIn(page);
      await page.getByLabel("Anslutningstyp").selectOption("user");
      await page.getByRole("button",{name:"Fortsätt till Fortnox",exact:true}).click();
      await page.getByRole("button",{name:"Godkänn Synthetic A",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Godkänn klient",exact:true})).toBeVisible();
      attemptId=new URL(page.url()).searchParams.get("onboarding_attempt")!;
      await changeFixture(async(connections,owner)=>{companyId=(await connections.list(owner))[0]!.id;});
      const logout=await context.request.post("http://127.0.0.1:8801/auth/sign-out",{headers:{origin:"http://127.0.0.1:8801"},data:{}});
      expect(logout.ok()).toBe(true);
      // The consent URL returns through the local guide, retaining only id/revision.
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?company_onboarding=${attemptId}&revision=1`));
    }
    await changeFixture(async(connections,owner)=>{
      await connections.updateSet(owner,set=>{set.onboarding!.find(a=>a.id===attemptId)!.expiresAt=Date.now()-1;});
    });
    if(!verified) {
      await page.goto(`http://127.0.0.1:8801/connect/company/${attemptId}?revision=1`);
      await expect(page).toHaveURL(/\/sign-in\?/);
    }
    await signIn(page);
    await expect(page).toHaveTitle("Anslutningsförsöket har gått ut · Fortnox MCP");
    await expect(page.getByRole("heading",{name:"Anslutningsförsöket har gått ut",exact:true})).toBeVisible();
    await checkLayout(page);
    await page.screenshot({path:join(tmpdir(),`continuity-expired-${verified}-${info.project.name}.png`),fullPage:true});
    const returned=page.waitForRequest(r=>new URL(r.url()).origin==="http://localhost:8802"&&new URL(r.url()).pathname==="/callback");
    await page.getByRole("button",{name:"Fortsätt i Synthetic consumer",exact:true}).click();
    const callback=new URL((await returned).url());
    expect(callback.searchParams.get("error")).toBe("interaction_required");
    expect(callback.searchParams.get("iss")).toBe("http://127.0.0.1:8801/auth");
    expect(callback.searchParams.has("code")).toBe(false);
    if (!verified) {
      await expect(page).toHaveURL(new RegExp(`/connect/company/${attemptId}\\?revision=2`));
      await page.getByLabel("Anslutningstyp").selectOption("user");
      await page.getByRole("button",{name:"Fortsätt till Fortnox",exact:true}).click();
      await page.getByRole("button",{name:"Godkänn Synthetic A",exact:true}).click();
    }
    await expect(page.getByRole("heading",{name:"Godkänn klient",exact:true})).toBeVisible();
    expect(new URL(page.url()).searchParams.get("onboarding_revision")).toBe("2");
    await expect(page.locator(".consent-access")).toContainText("Företaget i detta försök: Synthetic A");
    await checkLayout(page);
    await page.screenshot({path:join(tmpdir(),`continuity-resumed-${verified}-${info.project.name}.png`),fullPage:true});
    await page.getByRole("button",{name:"Godkänn begärda behörigheter till valda företag",exact:true}).click();
    await expect(page).toHaveURL(/http:\/\/localhost:8802\/companies\/[a-f0-9-]+/);
    if(companyId)expect(new URL(page.url()).pathname).toBe(`/companies/${companyId}`);
    await expect(page.getByRole("heading",{name:"Verifierat kundkort",exact:true})).toBeVisible();
    expect(providerCallbacks).toBe(1);
    expect(errors).toEqual([]);
    expect(warnings.filter(m=>!/status of (410)/.test(m))).toEqual([]);
  });
}
