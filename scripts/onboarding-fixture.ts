// Local synthetic acceptance fixture only. Never import this from product entries.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { openProductDatabase } from "../apps/node/src/product-database.js";
import { sqliteState } from "../apps/node/src/product-storage.js";
import { safeResponse } from "../apps/shared/admin.js";
import { createProductApplication } from "../apps/shared/product.js";

const directory = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(tmpdir(), "fortnox-onboarding-"));
await mkdir(directory, { recursive: true, mode: 0o700 });
const origin = "http://127.0.0.1:8801";
const consumerOrigin = "http://localhost:8802";
const providerOrigin = "http://127.0.0.2:8803";
const callback =
  process.env.FIXTURE_CONSUMER_CALLBACK ?? `${consumerOrigin}/callback`;
const cb = new URL(callback);
if (
  cb.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(cb.hostname)
)
  throw new Error("Fixture callback must be HTTPS or loopback");
const db = await openProductDatabase(
  join(directory, "product.sqlite"),
  resolve("apps/worker/migrations"),
);
const state = sqliteState(db);
const clients: string[] = [];
let providerCalls = 0;
const app = createProductApplication(
  {
    origin,
    secret: "synthetic-onboarding-fixture-auth-secret",
    keys: { a: Buffer.alloc(32, 7).toString("base64") },
    activeKey: "a",
    redirects: [callback],
    testMode: true,
    clientId: "synthetic-client",
    clientSecret: "synthetic-provider-secret",
    testTenants: ["100001", "100002"],
    externalAppOnboarding: true,
    onboardingClients: clients,
    offlineClientIds: clients,
  },
  {
    database: db,
    state,
    assets: async (name) =>
      safeResponse(
        await readFile(resolve("dist/admin", name), "utf8"),
        200,
        name.endsWith("js") ? "text/javascript" : "text/css",
      ),
  },
  async (input, init) => {
    providerCalls++;
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/oauth-v1/token") {
      const body = new URLSearchParams(await request.text());
      return Response.json({
        access_token: `synthetic-${body.get("code") ?? "A"}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "synthetic-fixture-refresh",
        scope: "companyinformation profile",
      });
    }
    const b = request.headers.get("authorization")?.endsWith("-B");
    return Response.json({
      CompanyInformation: {
        DatabaseNumber: b ? "100002" : "100001",
        CompanyName: b ? "Synthetic B" : "Synthetic A",
        OrganizationNumber:
          process.env.FIXTURE_VALID_ORGANIZATION_NUMBERS === "true"
            ? b
              ? "559999-0024"
              : "559999-0016"
            : b
              ? "000000-0002"
              : "000000-0001",
      },
    });
  },
);
const owner = (await state.get<{ ownerId: string }>("installation", "owner"))
  ?.value.ownerId;
if (!owner) {
  const u = await app.auth.api.signUpEmail({
    body: {
      email: "owner@example.invalid",
      name: "Synthetic owner",
      password: "Synthetic-password-123456",
    },
  });
  await state.put(
    "installation",
    "owner",
    { phase: "active", ownerId: u.user.id, tokenHash: "", expiresAt: 0 },
    null,
  );
}
const credentialsFile = join(directory, "consumer.json");
let registration: { client_id: string; client_secret: string };
try {
  registration = JSON.parse(await readFile(credentialsFile, "utf8"));
} catch {
  const r = await app.fetch(
    new Request(`${origin}/auth/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic consumer",
        // Explicit local test policy; client authentication remains confidential.
        application_type: cb.protocol === "http:" ? "native" : "web",
        redirect_uris: [callback],
        token_endpoint_auth_method: "client_secret_basic",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "mcp:read offline_access",
      }),
    }),
  );
  if (r.status !== 201) throw new Error("Fixture client registration failed");
  registration = (await r.json()) as typeof registration;
  await writeFile(
    credentialsFile,
    JSON.stringify({
      ...registration,
      installation: origin,
      issuer: `${origin}/auth`,
      redirect_uri: callback,
    }),
    { mode: 0o600, flag: "wx" },
  );
}
clients.push(registration.client_id);
const basic = `Basic ${Buffer.from(`${encodeURIComponent(registration.client_id)}:${encodeURIComponent(registration.client_secret)}`).toString("base64")}`;
const move = (location: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "same-origin",
    },
  });
const html = (body: string) =>
  new Response(
    `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Syntetisk konsument</title><body><main>${body}</main></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "same-origin",
      },
    },
  );
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
db.exec(
  "CREATE TABLE IF NOT EXISTS synthetic_consumer (state TEXT PRIMARY KEY, verifier TEXT, operation TEXT, attempt TEXT, result TEXT)",
);
const servers = [
  serve({
    hostname: "127.0.0.1",
    port: 8801,
    fetch: async (request) => {
      const response = await app.fetch(request);
      if (
        request.method === "POST" &&
        /\/connect\/company\/[^/]+\/provider$/.test(
          new URL(request.url).pathname,
        ) &&
        response.ok
      ) {
        const body = (await response.json()) as { url: string };
        const original = new URL(body.url);
        // Only the synthetic provider's browser origin is changed by this fixture.
        return Response.json({
          url: `${providerOrigin}/authorize${original.search}`,
        });
      }
      return response;
    },
  }),
  serve({
    hostname: "127.0.0.2",
    port: 8803,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/authorize" && request.method === "GET")
        return html(
          `<h1>Syntetiskt Fortnox-medgivande</h1><form method="post" action="/consent"><input type="hidden" name="state" value="${esc(url.searchParams.get("state") ?? "")}"><button name="company" value="A">Godkänn Synthetic A</button><button name="company" value="B">Godkänn Synthetic B</button></form>`,
        );
      if (
        url.pathname === "/consent" &&
        request.method === "POST" &&
        request.headers.get("origin") === providerOrigin
      ) {
        const body = await request.formData();
        const code = body.get("company");
        if (code !== "A" && code !== "B") return html("Ogiltigt testföretag");
        return move(
          `${origin}/admin/fortnox/callback?${new URLSearchParams({ code, state: String(body.get("state")) })}`,
        );
      }
      return new Response(null, { status: 404 });
    },
  }),
  serve({
    hostname: "127.0.0.1",
    port: 8802,
    fetch: async (request) => {
      const url = new URL(request.url);
      try {
        if (url.pathname === "/" && request.method === "GET") {
          const response = html(
            '<h1>Syntetisk konsument</h1><form method="post" action="/start"><button>Anslut företag</button></form>',
          );
          response.headers.set(
            "set-cookie",
            "consumer_session=synthetic-local-admin; HttpOnly; SameSite=Lax; Path=/",
          );
          return response;
        }
        if (
          request.headers.get("cookie") !==
          "consumer_session=synthetic-local-admin"
        )
          return new Response(null, { status: 401 });
        if (
          url.pathname === "/start" &&
          request.method === "POST" &&
          request.headers.get("origin") === consumerOrigin
        ) {
          const state = randomBytes(32).toString("base64url"),
            verifier = randomBytes(32).toString("base64url"),
            key = crypto.randomUUID();
          db.prepare(
            "INSERT INTO synthetic_consumer(state,verifier,operation) VALUES(?,?,?)",
          ).run(state, verifier, key);
          const response = await fetch(
            `${origin}/api/company-onboarding/v1/attempts`,
            {
              method: "POST",
              headers: {
                authorization: basic,
                "content-type": "application/json",
                "idempotency-key": key,
              },
              body: JSON.stringify({
                action: "connect",
                redirect_uri: callback,
                state,
                code_challenge: createHash("sha256")
                  .update(verifier)
                  .digest("base64url"),
                code_challenge_method: "S256",
                scope: "mcp:read offline_access",
              }),
            },
          );
          if (!response.ok) throw new Error("Fixture start failed");
          const attempt = (await response.json()) as {
            attempt_id: string;
            authorization_url: string;
          };
          db.prepare(
            "UPDATE synthetic_consumer SET attempt=? WHERE state=?",
          ).run(JSON.stringify(attempt), state);
          return move(attempt.authorization_url);
        }
        if (url.pathname === "/callback" && request.method === "GET") {
          const row = db
            .prepare("SELECT * FROM synthetic_consumer WHERE state=?")
            .get(url.searchParams.get("state") ?? "");
          if (!row || url.searchParams.get("iss") !== `${origin}/auth`)
            return new Response(null, { status: 400 });
          if (row.result) {
            const result = JSON.parse(String(row.result));
            return move(`${consumerOrigin}/companies/${result.company_id}`);
          }
          if (url.searchParams.get("error") === "interaction_required") {
            const attempt = JSON.parse(String(row.attempt));
            const state = randomBytes(32).toString("base64url");
            const verifier = randomBytes(32).toString("base64url");
            const key = crypto.randomUUID();
            // Persist replacement bindings before the actual resume request.
            db.prepare(
              "UPDATE synthetic_consumer SET state=?,verifier=?,operation=? WHERE state=?",
            ).run(state, verifier, key, row.state);
            const resumed = await fetch(
              `${origin}/api/company-onboarding/v1/attempts/${attempt.attempt_id}/resume`,
              {
                method: "POST",
                headers: {
                  authorization: basic,
                  "content-type": "application/json",
                  "idempotency-key": key,
                },
                body: JSON.stringify({
                  expected_attempt_revision: attempt.attempt_revision,
                  state,
                  code_challenge: createHash("sha256")
                    .update(verifier)
                    .digest("base64url"),
                  code_challenge_method: "S256",
                }),
              },
            );
            if (!resumed.ok) throw new Error("Fixture resume failed");
            const next = (await resumed.json()) as {
              authorization_url: string;
            };
            db.prepare(
              "UPDATE synthetic_consumer SET attempt=? WHERE state=?",
            ).run(JSON.stringify(next), state);
            return move(next.authorization_url);
          }
          if (url.searchParams.has("error"))
            return html("<h1>Anslutningen avbröts</h1>");
          const tokenResponse = await fetch(`${origin}/auth/oauth2/token`, {
            method: "POST",
            headers: {
              authorization: basic,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code: url.searchParams.get("code") ?? "",
              code_verifier: String(row.verifier),
              redirect_uri: callback,
              resource: `${origin}/mcp`,
            }),
          });
          if (!tokenResponse.ok) throw new Error("Fixture exchange failed");
          const tokens = (await tokenResponse.json()) as {
            access_token: string;
            refresh_token: string;
          };
          if (!tokens.refresh_token)
            throw new Error("Missing fixture persistent authorization");
          const attempt = JSON.parse(String(row.attempt));
          const response = await fetch(
            `${origin}/api/company-onboarding/v1/attempts/${attempt.attempt_id}/result`,
            { headers: { authorization: `Bearer ${tokens.access_token}` } },
          );
          if (!response.ok) throw new Error("Fixture result failed");
          const result = (await response.json()) as { company_id: string };
          const client = new Client({
            name: "synthetic-backend",
            version: "1.0.0",
          });
          await client.connect(
            new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
              requestInit: {
                headers: { authorization: `Bearer ${tokens.access_token}` },
              },
            }),
          );
          try {
            const profile = await client.callTool({
              name: "get_company_profile",
              arguments: { company_id: result.company_id },
            });
            const status = await client.callTool({
              name: "get_connection_status",
              arguments: { company_id: result.company_id },
            });
            if (profile.isError || status.isError)
              throw new Error("Fixture MCP read failed");
            db.prepare(
              "UPDATE synthetic_consumer SET result=?,verifier=NULL WHERE state=?",
            ).run(
              JSON.stringify({
                ...result,
                profile: profile.structuredContent,
                status: status.structuredContent,
              }),
              row.state as string,
            );
          } finally {
            await client.close();
          }
          return move(`${consumerOrigin}/companies/${result.company_id}`);
        }
        if (url.pathname.startsWith("/companies/")) {
          const rows = db
            .prepare(
              "SELECT result FROM synthetic_consumer WHERE result IS NOT NULL",
            )
            .all();
          const result = rows
            .map((r) => JSON.parse(String(r.result)))
            .find((r) => url.pathname === `/companies/${r.company_id}`);
          if (!result) return new Response(null, { status: 404 });
          return html(
            `<h1>Verifierat kundkort</h1><p>${esc(result.profile.data.name)}</p><p>${esc(result.profile.data.organization_number)}</p><p>Anslutningsstatus: ${esc(result.status.data.state)}</p><a href="/">Anslut ytterligare företag</a>`,
          );
        }
        return new Response(null, { status: 404 });
      } catch {
        return html(
          "<h1>Testflödet kunde inte slutföras</h1><p>Undersök det sparade syntetiska försöket; skicka inte koden igen.</p>",
        );
      }
    },
  }),
];
console.log(
  `Synthetic onboarding fixture ready: ${consumerOrigin} (installation ${origin}). Private configuration: ${credentialsFile}`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    for (const server of servers) server.close();
    db.close();
    console.log(`Synthetic provider requests: ${providerCalls}`);
    process.exit(0);
  });
