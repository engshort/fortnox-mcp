import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getMigrations } from "better-auth/db/migration";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { exportStatements } from "../scripts/export-db.js";
import { mintOperatorLogin } from "../scripts/mint-login.js";
import { createProbeAuth } from "../src/auth.js";
import type { McpRequestDiagnostic } from "../src/diagnostics.js";
import { fileSchema } from "../src/file-sql.js";
import { sqliteFileStore } from "../src/file-sqlite.js";
import { fileValidator } from "../src/file-validation.js";
import {
  createProbeHandler,
  type ProtocolNegotiation,
  type PublicDiscoveryDiagnostic,
} from "../src/http.js";
import { reviewSchema } from "../src/review.js";
import { sqliteReviewStore } from "../src/review-sqlite.js";

const origin = "https://probe.example.invalid";
const callback = "https://client.example.invalid/callback";

interface Payload {
  client_id: string;
  url: string;
  resource: string;
  issuer: string;
  code_challenge_methods_supported: string[];
  authorization_response_iss_parameter_supported: boolean;
  grant_types_supported: string[];
  token_type: string;
  refresh_token: string;
  access_token: string;
  expires_in: number;
  result: { structuredContent: unknown };
}
const data = (r: Response) => r.json() as Promise<Payload>;

function required<T>(value: T | null | undefined): T {
  assert.ok(
    value !== null && value !== undefined,
    "required protocol field is present",
  );
  return value;
}

async function fixture(worker = false, review = false, files = false) {
  const redirectUri = worker
    ? "https://chatgpt.com/connector_platform_oauth_redirect"
    : callback;
  const db = new DatabaseSync(":memory:");
  const secret = randomBytes(48).toString("base64url");
  const bootstrap = createProbeAuth({
    origin,
    secret,
    ownerId: "",
    database: db,
  });
  await (await getMigrations(bootstrap.options)).runMigrations();
  const seeded = await bootstrap.api.signUpEmail({
    body: {
      email: "owner@example.invalid",
      name: "Synthetic owner",
      password: randomBytes(48).toString("base64url"),
    },
    returnHeaders: true,
  });
  const negotiations: ProtocolNegotiation[] = [];
  const discoveryDiagnostics: PublicDiscoveryDiagnostic[] = [];
  const requestDiagnostics: McpRequestDiagnostic[] = [];
  if (review) {
    // Reproduce enabling review on the already deployed read-only resource.
    const previous = createProbeAuth({
      origin,
      secret,
      ownerId: seeded.response.user.id,
      database: db,
    });
    await previous.$context;
    const row = db
      .prepare("SELECT allowedScopes FROM oauthResource WHERE identifier = ?")
      .get(`${origin}/mcp`) as { allowedScopes: string };
    assert.deepEqual(JSON.parse(row.allowedScopes), [
      "mcp:read",
      "offline_access",
    ]);
  }
  if (review) db.exec(reviewSchema);
  if (files) db.exec(fileSchema);
  const app = createProbeHandler({
    origin,
    secret,
    ownerId: seeded.response.user.id,
    database: db,
    ...(review ? { review: sqliteReviewStore(db) } : {}),
    ...(files
      ? {
          files: {
            store: sqliteFileStore(db),
            origins: [],
            validator: fileValidator,
            transport: {
              async open() {
                throw new Error("Synthetic origin not enabled");
              },
            },
          },
        }
      : {}),
    testRedirectUri: callback,
    onProtocolNegotiated: (event) => {
      negotiations.push(event);
    },
    onPublicDiscovery: (event) => {
      discoveryDiagnostics.push(event);
    },
    onMcpRequest: (event) => {
      requestDiagnostics.push(event);
    },
  });
  let mf: Miniflare | undefined;
  if (worker) {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "s00-oauth-test",
        modules: true,
        scriptPath: "dist/worker.js",
        compatibilityDate: "2026-10-18",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["AUTH_DB"],
        bindings: {
          PROBE_ORIGIN: origin,
          AUTH_SECRET: secret,
          OWNER_ID: seeded.response.user.id,
          ...(review ? { PROBE_SYNTHETIC_REVIEW: "true" } : {}),
          ...(files
            ? {
                PROBE_SYNTHETIC_FILES: "true",
                PROBE_FILE_CLEANUP: "scheduled-5m",
              }
            : {}),
        },
      }),
    );
    const d1 = await mf.getD1Database("AUTH_DB");
    if (review) {
      await app.auth.$context;
      db.prepare(
        "UPDATE oauthResource SET allowedScopes = ? WHERE identifier = ?",
      ).run(JSON.stringify(["mcp:read", "offline_access"]), `${origin}/mcp`);
    }
    for (const statement of exportStatements(db))
      await d1.prepare(statement).run();
  }
  async function req(
    path: string,
    body?: object | URLSearchParams,
    cookie?: string,
    extra: Record<string, string> = {},
  ) {
    const headers = new Headers({
      ...(path.startsWith("/auth/oauth2/authorize")
        ? { accept: "text/html", "sec-fetch-mode": "navigate" }
        : {}),
      ...extra,
      ...(cookie ? { cookie } : {}),
    });
    if (body) {
      headers.set(
        "content-type",
        body instanceof URLSearchParams
          ? "application/x-www-form-urlencoded"
          : "application/json",
      );
    }
    const request = new Request(`${origin}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      ...(body
        ? {
            body: body instanceof URLSearchParams ? body : JSON.stringify(body),
          }
        : {}),
    });
    return dispatch(request);
  }
  async function dispatch(request: Request) {
    return mf
      ? ((await mf.dispatchFetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: request.method === "POST" ? await request.text() : undefined,
          redirect: "manual",
        })) as unknown as Response)
      : app.fetch(request);
  }
  const token = seeded.headers.get("set-ott");
  assert.ok(token, "bootstrap token issued");
  const login = await req("/auth/one-time-token/verify", { token }, undefined, {
    origin,
  });
  assert.equal(login.status, 200, "bootstrap login succeeds");
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookie, "session cookie issued");
  async function register() {
    const r = await req("/auth/oauth2/register", {
      client_name: "Synthetic test client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: [
        "mcp:read",
        "offline_access",
        ...(review ? ["mcp:review"] : []),
        ...(files ? ["mcp:files"] : []),
      ].join(" "),
    });
    assert.equal(r.status, 201, "DCR succeeds");
    return (await data(r)).client_id;
  }
  async function authorization(
    clientId: string,
    overrides: Record<string, string> = {},
  ) {
    const verifier = randomBytes(48).toString("base64url");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "mcp:read offline_access",
      state: "synthetic-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: `${origin}/mcp`,
      ...overrides,
    });
    const r = await req(`/auth/oauth2/authorize?${q}`, undefined, cookie);
    return { r, verifier };
  }
  async function grant(
    scopes = "mcp:read offline_access",
    existingClientId?: string,
  ) {
    const clientId = existingClientId ?? (await register());
    const { r, verifier } = await authorization(clientId, { scope: scopes });
    assert.ok(
      [200, 302].includes(r.status),
      "authorization redirects to consent",
    );
    const consent = new URL(
      r.status === 302
        ? required(r.headers.get("location"))
        : (await data(r)).url,
      origin,
    );
    assert.equal(consent.pathname, "/consent");
    const accepted = await req(
      "/auth/oauth2/consent",
      { accept: true, oauth_query: consent.search.slice(1) },
      cookie,
      { origin },
    );
    assert.equal(accepted.status, 200, "consent succeeds");
    const result = await data(accepted);
    const redirect = new URL(result.url);
    assert.equal(
      redirect.origin + redirect.pathname,
      redirectUri,
      "exact callback",
    );
    assert.equal(redirect.searchParams.get("state"), "synthetic-state");
    assert.equal(
      redirect.searchParams.get("iss"),
      `${origin}/auth`,
      "RFC 9207 issuer included",
    );
    const code = required(redirect.searchParams.get("code"));
    const exchangeBody = {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      resource: `${origin}/mcp`,
      code,
      code_verifier: verifier,
    };
    return { clientId, exchangeBody };
  }
  async function exchange(body: Record<string, string>) {
    return req("/auth/oauth2/token", new URLSearchParams(body));
  }
  async function call(accessToken: string) {
    return req(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_synthetic_status", arguments: {} },
      },
      undefined,
      {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
    );
  }
  return {
    operatorConfig: {
      origin,
      secret,
      ownerId: seeded.response.user.id,
      operatorCookie: seeded.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    },
    d1: () => mf?.getD1Database("AUTH_DB"),
    db,
    app,
    req,
    dispatch,
    cookie,
    token,
    register,
    authorization,
    grant,
    exchange,
    call,
    negotiations,
    discoveryDiagnostics,
    requestDiagnostics,
    close: async () => {
      await mf?.dispose();
      db.close();
    },
  };
}

test("file scope requires separate real OAuth consent on Node and workerd/D1; anonymous and revoked requests fail closed", async () => {
  for (const worker of [false, true]) {
    const f = await fixture(worker, false, true);
    try {
      const call = async (token?: string) =>
        f.req(
          "/mcp",
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "probe_synthetic_files",
              arguments: {
                files: [
                  {
                    download_url: "https://files.example.com/receipt",
                    file_id: "synthetic-file",
                  },
                ],
              },
            },
          },
          undefined,
          {
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        );
      assert.equal((await call()).status, 401);
      const readGrant = await f.grant();
      const readToken = await data(await f.exchange(readGrant.exchangeBody));
      const denied = (await (await call(readToken.access_token)).json()) as {
        result: { isError: boolean; content: Array<{ text: string }> };
      };
      assert.equal(denied.result.isError, true);
      assert.equal(denied.result.content[0].text, "FILE_SCOPE_REQUIRED");
      const fileGrant = await f.grant("mcp:read offline_access mcp:files");
      const fileToken = await data(await f.exchange(fileGrant.exchangeBody));
      const allowed = (await (await call(fileToken.access_token)).json()) as {
        result: { isError: boolean; content: Array<{ text: string }> };
      };
      assert.equal(
        allowed.result.content[0].text,
        "FILE_URL_DENIED",
        "scope passes; empty origin allowlist prevents network access",
      );
      await f.req(
        "/auth/oauth2/revoke",
        new URLSearchParams({
          client_id: fileGrant.clientId,
          token: fileToken.access_token,
          token_type_hint: "access_token",
        }),
      );
      assert.equal((await call(fileToken.access_token)).status, 401);
    } finally {
      await f.close();
    }
  }
});

test("local operator renewal recovers an expired session without replacing OAuth or review state on Node and D1", async () => {
  for (const worker of [false, true]) {
    const f = await fixture(worker, true);
    try {
      const { clientId, exchangeBody } = await f.grant();
      const tokens = await data(await f.exchange(exchangeBody));
      for (const state of ["prepared", "consumed"]) {
        f.db
          .prepare("INSERT INTO s00_review VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(
            `preserved-${state}`,
            f.operatorConfig.ownerId,
            "s00-company-a",
            "synthetic-hash",
            "synthetic-capability-hash",
            1,
            Date.now() + 60_000,
            state,
          );
      }
      f.db.prepare("UPDATE session SET expiresAt = 0").run();
      await assert.rejects(
        mintOperatorLogin(f.db, f.operatorConfig),
        (error: { status?: string }) => error.status === "UNAUTHORIZED",
      );
      const operationalState = () =>
        exportStatements(f.db).filter(
          (sql) =>
            !/^INSERT INTO "(?:session|verification|rateLimit)" /.test(sql),
        );
      const previousStatus = (await f.call(tokens.access_token)).status;
      const before = operationalState();
      const fresh = await mintOperatorLogin(f.db, f.operatorConfig, true);
      assert.deepEqual(
        operationalState(),
        before,
        "owner, resources, OAuth grants and review data are preserved",
      );
      assert.equal(fresh.sql.split(";\n").filter(Boolean).length, 2);
      assert.equal(fresh.sql.includes('INSERT INTO "oauth'), false);
      assert.equal(fresh.sql.includes('INSERT INTO "user"'), false);
      const d1 = await f.d1();
      if (d1) {
        for (const sql of fresh.sql.split(";\n").filter(Boolean))
          await d1.prepare(sql).run();
      }
      assert.equal((await f.call(tokens.access_token)).status, previousStatus);
      if (worker) {
        const refreshed = await f.exchange({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: tokens.refresh_token,
          resource: `${origin}/mcp`,
        });
        assert.equal(
          refreshed.status,
          200,
          "remote grants remain renewable after importing only new login rows",
        );
      }
      const login = await f.req(
        "/auth/one-time-token/verify",
        { token: fresh.token },
        undefined,
        { origin },
      );
      assert.equal(
        login.status,
        200,
        "new login is accepted by the existing server",
      );
      assert.ok(
        (
          await f.req(
            "/auth/one-time-token/verify",
            { token: fresh.token },
            undefined,
            { origin },
          )
        ).status >= 400,
        "new login remains single-use",
      );
      const next = await mintOperatorLogin(f.db, {
        ...f.operatorConfig,
        operatorCookie: fresh.operatorCookie,
      });
      assert.equal(next.sql.startsWith('INSERT INTO "verification" '), true);
      assert.equal(next.sql.includes('INSERT INTO "session" '), false);
      assert.equal(
        (
          await f.req("/auth/renew-local-operator-session", {}, undefined, {
            origin,
          })
        ).status,
        404,
      );
    } finally {
      await f.close();
    }
  }
});

test("operator renewal refuses a mismatched secret, forged cookie or missing owner without creating a session", async () => {
  const f = await fixture();
  try {
    const before = exportStatements(f.db);
    for (const config of [
      {
        ...f.operatorConfig,
        secret: "mismatched-secret-with-at-least-32-characters",
      },
      { ...f.operatorConfig, operatorCookie: "forged=credential" },
      { ...f.operatorConfig, ownerId: "missing-owner" },
    ]) {
      await assert.rejects(mintOperatorLogin(f.db, config, true));
      assert.deepEqual(exportStatements(f.db), before);
    }
  } finally {
    await f.close();
  }
});

test("operator CLI explains unauthorized, renews private files and preserves config without printing credentials", async () => {
  const f = await fixture(false, true);
  const directory = await mkdtemp(join(tmpdir(), "s00-login-"));
  let db: DatabaseSync | undefined;
  try {
    await mkdir(join(directory, ".data"));
    const config = {
      ...f.operatorConfig,
      reviewEnabled: true,
      extraSetting: "preserved",
    };
    const configText = JSON.stringify(config);
    const configPath = join(directory, ".data/config.json");
    const codePath = join(directory, ".data/bootstrap-code.txt");
    const databasePath = join(directory, ".data/auth.sqlite");
    await writeFile(configPath, configText);
    await writeFile(codePath, "old-synthetic-code");
    f.db.prepare("UPDATE session SET expiresAt = 0").run();
    db = new DatabaseSync(databasePath);
    db.exec(exportStatements(f.db).join(";\n"));
    db.close();
    db = undefined;
    const run = async (...args: string[]) => {
      const command = [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../scripts/mint-login.ts", import.meta.url)),
        ...args,
      ];
      try {
        const output = await promisify(execFile)(process.execPath, command, {
          cwd: directory,
          windowsHide: true,
          timeout: 30_000,
        });
        return { code: 0, text: output.stdout + output.stderr };
      } catch (error) {
        const failure = error as {
          code: number;
          stdout: string;
          stderr: string;
        };
        return { code: failure.code, text: failure.stdout + failure.stderr };
      }
    };
    const failed = await run();
    assert.equal(failed.code, 1);
    assert.match(
      failed.text,
      /saved operator session is expired, missing or invalid/,
    );
    assert.match(failed.text, /--renew-operator-session/);
    assert.doesNotMatch(failed.text, /APIError|triggerUncaughtException/);
    assert.equal(await readFile(configPath, "utf8"), configText);
    assert.equal(await readFile(codePath, "utf8"), "old-synthetic-code");
    const renewed = await run("--renew-operator-session");
    assert.equal(renewed.code, 0, "explicit CLI renewal succeeds");
    const updated = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(updated.secret, config.secret);
    assert.equal(updated.ownerId, config.ownerId);
    assert.equal(updated.origin, config.origin);
    assert.equal(updated.reviewEnabled, true);
    assert.equal(updated.extraSetting, "preserved");
    assert.ok(updated.operatorCookie !== config.operatorCookie);
    const code = await readFile(codePath, "utf8");
    for (const value of [
      config.secret,
      config.operatorCookie,
      updated.operatorCookie,
      code,
    ]) {
      assert.equal(
        (failed.text + renewed.text).includes(value),
        false,
        "CLI output contains no credentials",
      );
    }
    const sql = await readFile(join(directory, ".data/login.sql"), "utf8");
    assert.equal(sql.split(";\n").filter(Boolean).length, 2);
    db = new DatabaseSync(databasePath);
    const app = createProbeHandler({
      ...updated,
      database: db,
      review: sqliteReviewStore(db),
    });
    const verify = () =>
      app.fetch(
        new Request(`${origin}/auth/one-time-token/verify`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ token: code }),
        }),
      );
    assert.equal((await verify()).status, 200);
    assert.ok((await verify()).status >= 400);
    db.close();
    db = undefined;
    const normal = await run();
    assert.equal(
      normal.code,
      0,
      "the saved replacement cookie supports the normal next mint",
    );
    await rm(databasePath);
    assert.equal((await run("--renew-operator-session")).code, 1);
    await assert.rejects(
      access(databasePath),
      "a missing database is never recreated silently",
    );
  } finally {
    db?.close();
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SDK 2 modern and SDK 1 legacy clients share OAuth, scope and one-time boundaries on Node and D1", async () => {
  for (const worker of [false, true]) {
    const f = await fixture(worker, true);
    const clients: { close(): Promise<void> }[] = [];
    const fetchProbe = (url: string | URL, init?: RequestInit) =>
      f.dispatch(new Request(url, init));
    const modern = async (token?: string) => {
      const client = new Client(
        { name: "synthetic-modern", version: "0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
          fetch: fetchProbe,
          ...(token
            ? { requestInit: { headers: { authorization: `Bearer ${token}` } } }
            : {}),
        }),
      );
      assert.equal(client.getProtocolEra(), "modern");
      return client;
    };
    try {
      const anonymous = await modern();
      const publicTools = await anonymous.listTools();
      assert.ok(
        publicTools.tools.some((tool) => tool.name === "read_synthetic_status"),
      );
      await assert.rejects(
        anonymous.callTool({ name: "read_synthetic_status", arguments: {} }),
      );
      await assert.rejects(
        anonymous.readResource({ uri: "ui://s00/review-v1.html" }),
      );
      await assert.rejects(
        modern("invalid"),
        "bad credentials cannot fall back to public discovery",
      );

      const readGrant = await f.grant();
      const readToken = await data(await f.exchange(readGrant.exchangeBody));
      const reader = await modern(readToken.access_token);
      const denied = await reader.callTool({
        name: "prepare_synthetic_review",
        arguments: {},
      });
      assert.equal(denied.isError, true);
      assert.equal(denied._meta?.s00Review, undefined);
      assert.ok(denied._meta?.["mcp/www_authenticate"]);
      const deniedStatus = await reader.callTool({
        name: "read_synthetic_review_status",
        arguments: {
          proposalId: crypto.randomUUID(),
          proposalHash: "0".repeat(64),
          expires: Date.now() + 60000,
        },
      });
      assert.equal(deniedStatus.isError, true);

      const grant = await f.grant("mcp:read offline_access mcp:review");
      const token = await data(await f.exchange(grant.exchangeBody));
      const reviewer = await modern(token.access_token);
      const legacy = new LegacyClient({ name: "synthetic-sdk1", version: "0" });
      clients.push(legacy);
      await legacy.connect(
        new LegacyTransport(new URL(`${origin}/mcp`), {
          fetch: fetchProbe,
          requestInit: {
            headers: { authorization: `Bearer ${token.access_token}` },
          },
        }),
      );
      const expected = {
        dataset: "s00-oauth",
        authenticated: true,
        fortnoxEnabled: false,
      };
      for (const client of [legacy, reviewer]) {
        assert.deepEqual(
          (
            await client.callTool({
              name: "read_synthetic_status",
              arguments: {},
            })
          ).structuredContent,
          expected,
        );
      }
      const prepared = await reviewer.callTool({
        name: "prepare_synthetic_review",
        arguments: {},
      });
      const capability = prepared._meta?.s00Review as Record<string, unknown>;
      assert.equal(typeof capability.capability, "string");
      assert.ok(
        !JSON.stringify({
          content: prepared.content,
          structuredContent: prepared.structuredContent,
        }).includes(String(capability.capability)),
      );
      const forged = await reviewer.callTool({
        name: "commit_synthetic_review",
        arguments: { confirmed: true, origin: "ui" },
      });
      assert.equal(forged.isError, true);
      const committed = await legacy.callTool({
        name: "commit_synthetic_review",
        arguments: capability,
      });
      assert.deepEqual(committed.structuredContent, {
        accepted: true,
        fortnoxEnabled: false,
      });
      const replay = await reviewer.callTool({
        name: "commit_synthetic_review",
        arguments: capability,
      });
      assert.deepEqual(replay.structuredContent, {
        accepted: false,
        fortnoxEnabled: false,
      });
      const { capability: _secret, ...reference } = capability;
      for (const client of [legacy, reviewer]) {
        const status = await client.callTool({
          name: "read_synthetic_review_status",
          arguments: reference,
        });
        assert.deepEqual(status.structuredContent, {
          status: "consumed",
          fortnoxEnabled: false,
        });
        // Repeat discovery/resource reads as metadata reloads do, on each era.
        const catalog = await client.listTools();
        assert.deepEqual(
          catalog.tools.find(
            (tool) => tool.name === "read_synthetic_review_status",
          )?._meta?.ui,
          { visibility: ["app"] },
        );
        for (let read = 0; read < 2; read++) {
          const resource = await client.readResource({
            uri: "ui://s00/review-v1.html",
          });
          assert.deepEqual(resource.contents[0]?._meta?.ui, {
            csp: { connectDomains: [], resourceDomains: [] },
            prefersBorder: true,
          });
        }
      }
      if (!worker) {
        for (const transport of ["modern", "legacy"]) {
          assert.ok(
            f.requestDiagnostics.some(
              (event) =>
                event.transport === transport &&
                event.authorization === "verified" &&
                event.status === 200,
            ),
          );
        }
        const diagnostics = JSON.stringify(f.requestDiagnostics);
        for (const secret of [
          String(token.access_token),
          String(token.refresh_token),
          String(capability.capability),
          String(capability.proposalId),
          String(capability.proposalHash),
          "synthetic-modern",
          "synthetic-sdk1",
        ])
          assert.ok(!diagnostics.includes(secret));
      }

      assert.equal(
        (
          await f.req(
            "/auth/oauth2/revoke",
            new URLSearchParams({
              client_id: grant.exchangeBody.client_id,
              token: token.refresh_token,
              token_type_hint: "refresh_token",
            }),
          )
        ).status,
        200,
      );
      for (const client of [legacy, reviewer]) {
        await assert.rejects(
          client.callTool({ name: "read_synthetic_status", arguments: {} }),
          "revocation applies across both eras",
        );
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
      await f.close();
    }
  }
});

test("optional review scope is enforced through real OAuth on Node and workerd/D1", async () => {
  for (const worker of [false, true]) {
    const f = await fixture(worker, true);
    try {
      const readonly = await f.grant();
      const readToken = await data(await f.exchange(readonly.exchangeBody));
      const callReview = (token: string) =>
        f.req(
          "/mcp",
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "prepare_synthetic_review", arguments: {} },
          },
          undefined,
          {
            authorization: `Bearer ${token}`,
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
          },
        );
      const denied = (await (
        await callReview(readToken.access_token)
      ).json()) as { result: { isError?: boolean } };
      assert.equal(
        denied.result.isError,
        true,
        "read scope cannot prepare a review or obtain UI capability",
      );
      const review = await f.grant("mcp:read offline_access mcp:review");
      const reviewToken = await data(await f.exchange(review.exchangeBody));
      const prepared = (await (
        await callReview(reviewToken.access_token)
      ).json()) as {
        result: {
          structuredContent: { kind: string };
          _meta: {
            s00Review: Record<string, unknown> & { capability: string };
          };
        };
      };
      assert.equal(
        prepared.result.structuredContent.kind,
        "s00-review-proposal",
      );
      assert.match(
        prepared.result._meta.s00Review.capability,
        /^[0-9a-f]{64}$/,
      );
      const commitReview = () =>
        f.req(
          "/mcp",
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "commit_synthetic_review",
              arguments: prepared.result._meta.s00Review,
            },
          },
          undefined,
          {
            authorization: `Bearer ${reviewToken.access_token}`,
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
          },
        );
      const committed = (await (await commitReview()).json()) as {
        result: { structuredContent: { accepted: boolean } };
      };
      assert.equal(committed.result.structuredContent.accepted, true);
      const replay = (await (await commitReview()).json()) as {
        result: { structuredContent: { accepted: boolean } };
      };
      assert.equal(
        replay.result.structuredContent.accepted,
        false,
        "new HTTP handler cannot reuse a consumed approval",
      );
    } finally {
      await f.close();
    }
  }
});

test("operator diagnostics expose only SDK protocol versions, not private RPC fields", async () => {
  const f = await fixture();
  try {
    const request = {
      jsonrpc: "2.0",
      id: "synthetic-private-request-id",
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "synthetic-private-client-name", version: "1" },
      },
    };
    const accept = { accept: "application/json, text/event-stream" };
    assert.equal((await f.req("/mcp", request, undefined, accept)).status, 200);
    assert.deepEqual(f.negotiations, [
      { requestedProtocol: "2026-07-28", negotiatedProtocol: "2025-11-25" },
    ]);
    assert.equal(
      (
        await f.req("/mcp", request, undefined, {
          ...accept,
          authorization: "Bearer invalid",
        })
      ).status,
      401,
    );
    assert.equal(
      f.negotiations.length,
      1,
      "bad supplied credentials do not fall back to public metadata",
    );
    const { exchangeBody } = await f.grant();
    const tokens = await data(await f.exchange(exchangeBody));
    const response = await f.req("/mcp", request, undefined, {
      authorization: `Bearer ${tokens.access_token}`,
      accept: "application/json, text/event-stream",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(f.negotiations, [
      { requestedProtocol: "2026-07-28", negotiatedProtocol: "2025-11-25" },
      { requestedProtocol: "2026-07-28", negotiatedProtocol: "2025-11-25" },
    ]);
    assert.equal((await f.call(tokens.access_token)).status, 200);
    assert.equal(
      f.negotiations.length,
      2,
      "ordinary calls do not enter diagnostic output",
    );
  } finally {
    await f.close();
  }
});

test("request diagnostics normalize rejected input without retaining private values", async () => {
  const f = await fixture();
  try {
    const response = await f.req(
      "/mcp?private-query=synthetic-secret",
      {
        jsonrpc: "2.0",
        id: "synthetic-private-id",
        method: "synthetic-private-method",
        params: { token: "synthetic-private-token" },
      },
      undefined,
      {
        authorization: "Bearer synthetic-private-credential",
        "mcp-protocol-version": "synthetic-private-version",
      },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(f.requestDiagnostics, [
      {
        method: "POST",
        contentType: "json",
        protocol: "other",
        methods: ["other"],
        authorization: "rejected",
        transport: "rejected",
        status: 401,
      },
    ]);
    const malformed = await f.req("/mcp", {
      method: "tools/list",
      id: "synthetic-private-id",
    });
    assert.equal(malformed.status, 400);
    assert.equal(f.requestDiagnostics.at(-1)?.status, 400);
    assert.equal(f.requestDiagnostics.at(-1)?.authorization, "absent");
    assert.ok(
      !JSON.stringify(f.requestDiagnostics).includes("synthetic-private"),
    );
  } finally {
    await f.close();
  }
});

test("anonymous discovery exposes only fixed schemas and never a tool call or private resource", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.req("/mcp", { method: "synthetic-private-value" })).status,
      400,
    );
    assert.deepEqual(
      f.discoveryDiagnostics,
      [{ methods: ["other"], jsonRpc2: [false] }],
      "diagnostic suppresses unknown input rather than logging it",
    );
    const malformedCall = await f.req("/mcp", {
      method: "tools/call",
      params: { name: "read_synthetic_status", arguments: {} },
    });
    assert.equal(malformedCall.status, 400);
    assert.deepEqual(await malformedCall.json(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
    const headers = { accept: "application/json, text/event-stream" };
    const list = await f.req(
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      undefined,
      headers,
    );
    assert.equal(list.status, 200);
    const body = (await list.json()) as {
      result: {
        tools: { name: string; _meta: { securitySchemes: unknown } }[];
      };
    };
    assert.deepEqual(
      body.result.tools.map((tool) => tool.name),
      ["read_synthetic_status"],
    );
    assert.deepEqual(body.result.tools[0]?._meta.securitySchemes, [
      { type: "oauth2", scopes: ["mcp:read", "offline_access"] },
    ]);
    for (const method of [
      "tools/call",
      "resources/read",
      "resources/list",
      "prompts/get",
      "unknown",
    ]) {
      const rpc = {
        jsonrpc: "2.0",
        id: 2,
        method,
        params: {
          name: "read_synthetic_status",
          arguments: {},
          confirmed: true,
        },
      };
      assert.equal(
        (await f.req("/mcp", rpc, undefined, headers)).status,
        401,
        method,
      );
      assert.equal(
        (
          await f.req(
            "/mcp",
            [{ jsonrpc: "2.0", id: 1, method: "tools/list" }, rpc],
            undefined,
            headers,
          )
        ).status,
        401,
        `mixed batch ${method}`,
      );
    }
    assert.equal(
      (
        await f.req(
          "/mcp?access_token=invalid",
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          undefined,
          headers,
        )
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("reconnection scopes from the challenge include refresh access after an access-only grant", async () => {
  const f = await fixture();
  try {
    const initial = await f.grant("mcp:read");
    const shortLived = await data(await f.exchange(initial.exchangeBody));
    assert.equal(
      shortLived.refresh_token,
      undefined,
      "read-only scope alone cannot renew after expiry",
    );
    const challenge = required(
      (await f.req("/mcp")).headers.get("www-authenticate"),
    );
    const scopes = required(challenge.match(/scope="([^"]+)"/)?.[1]);
    assert.equal(scopes, "mcp:read offline_access");
    const reconnected = await f.grant(scopes, initial.clientId);
    const renewed = await data(await f.exchange(reconnected.exchangeBody));
    assert.ok(
      renewed.refresh_token,
      "challenge-based reauthorization issues a refresh token",
    );
    const refreshed = await f.req(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: initial.clientId,
        refresh_token: renewed.refresh_token,
        resource: `${origin}/mcp`,
      }),
    );
    assert.equal(refreshed.status, 200);
    assert.equal(
      (await f.call((await data(refreshed)).access_token)).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("metadata and all unauthenticated MCP methods advertise OAuth; no signup/admin bypass", async () => {
  const f = await fixture();
  try {
    const r = await f.req("/mcp");
    assert.equal(r.status, 401);
    assert.match(
      required(r.headers.get("www-authenticate")),
      /resource_metadata=/,
    );
    assert.match(
      required(r.headers.get("www-authenticate")),
      /scope="mcp:read offline_access"/,
    );
    const prm = await data(
      await f.req("/.well-known/oauth-protected-resource/mcp"),
    );
    assert.equal(prm.resource, `${origin}/mcp`);
    const as = await data(
      await f.req("/.well-known/oauth-authorization-server/auth"),
    );
    assert.equal(as.issuer, `${origin}/auth`);
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
    assert.equal(as.authorization_response_iss_parameter_supported, true);
    assert.deepEqual(as.grant_types_supported, [
      "authorization_code",
      "refresh_token",
    ]);
    assert.equal((await f.req("/auth/sign-up/email", {})).status, 404);
    assert.equal((await f.req("/auth/one-time-token/generate")).status, 404);
    assert.equal((await f.req("/auth/verify-probe-token", {})).status, 404);
  } finally {
    f.db.close();
  }
});

test("single-use bootstrap; browser mutations require same-origin owner session", async () => {
  const f = await fixture();
  try {
    assert.ok(
      (
        await f.req(
          "/auth/one-time-token/verify",
          { token: f.token },
          undefined,
          { origin },
        )
      ).status >= 400,
      "bootstrap replay rejected",
    );
    assert.equal(
      (await f.req("/auth/oauth2/consent", { accept: true }, f.cookie)).status,
      403,
    );
    assert.equal(
      (
        await f.req("/auth/oauth2/consent", { accept: true }, f.cookie, {
          origin: "https://foreign.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.req("/auth/oauth2/consent", { accept: true }, undefined, {
          origin,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.req("/auth/oauth2/register", {
          redirect_uris: ["https://foreign.invalid/callback"],
        })
      ).status,
      400,
    );
  } finally {
    f.db.close();
  }
});

test("DCR → signed consent → PKCE → authenticated MCP tool → immediate logout denial", async () => {
  const f = await fixture();
  try {
    const g = await f.grant();
    const r = await f.exchange(g.exchangeBody);
    assert.equal(r.status, 200, "code exchange");
    const tokens = await data(r);
    assert.equal(tokens.token_type, "Bearer");
    assert.ok(tokens.refresh_token);
    assert.equal(tokens.expires_in, 300);
    const call = await f.call(tokens.access_token);
    assert.equal(call.status, 200, "protected tool succeeds");
    const result = await data(call);
    assert.deepEqual(result.result.structuredContent, {
      dataset: "s00-oauth",
      authenticated: true,
      fortnoxEnabled: false,
    });
    assert.ok(
      (await f.exchange(g.exchangeBody)).status >= 400,
      "code cannot be reused",
    );
    assert.equal(
      (await f.req("/auth/sign-out", {}, f.cookie, { origin })).status,
      200,
    );
    assert.equal(
      (await f.call(tokens.access_token)).status,
      401,
      "logout invalidates existing token immediately",
    );
  } finally {
    f.db.close();
  }
});

test("wrong verifier, resource, redirect, unknown token, and query bearer are rejected", async () => {
  const f = await fixture();
  try {
    const g = await f.grant();
    assert.ok(
      (
        await f.exchange({
          ...g.exchangeBody,
          code_verifier: randomBytes(48).toString("base64url"),
        })
      ).status >= 400,
      "wrong PKCE verifier",
    );
    const g2 = await f.grant();
    assert.ok(
      (
        await f.exchange({
          ...g2.exchangeBody,
          resource: "https://foreign.invalid/mcp",
        })
      ).status >= 400,
      "wrong resource",
    );
    const client = await f.register();
    const { r } = await f.authorization(client, {
      redirect_uri: `${callback}-other`,
    });
    if (r.status === 302) {
      const target = new URL(required(r.headers.get("location")), origin);
      assert.equal(target.origin, origin, "bad redirect stays at issuer");
      assert.equal(target.searchParams.has("code"), false);
    } else assert.ok(r.status >= 400, "unregistered redirect");
    assert.equal((await f.call("synthetic-invalid")).status, 401);
    assert.equal(
      (await f.req("/mcp?access_token=synthetic-invalid")).status,
      401,
    );
  } finally {
    f.db.close();
  }
});

test("refresh rotates, revocation stops the access token and refresh family", async () => {
  const f = await fixture();
  try {
    const g = await f.grant();
    const tokens = await data(await f.exchange(g.exchangeBody));
    const refresh = {
      grant_type: "refresh_token",
      client_id: g.clientId,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/mcp`,
    };
    const r = await f.exchange(refresh);
    assert.equal(r.status, 200, "refresh succeeds");
    const rotated = await data(r);
    assert.notEqual(
      rotated.refresh_token,
      tokens.refresh_token,
      "refresh token rotated",
    );
    const revoked = await f.req(
      "/auth/oauth2/revoke",
      new URLSearchParams({
        client_id: g.clientId,
        token: rotated.refresh_token,
        token_type_hint: "refresh_token",
      }),
    );
    assert.equal(revoked.status, 200, "revocation");
    assert.equal(
      (await f.call(rotated.access_token)).status,
      401,
      "access token linked to revoked refresh rejected",
    );
    assert.ok(
      (await f.exchange({ ...refresh, refresh_token: rotated.refresh_token }))
        .status >= 400,
      "revoked refresh denied",
    );
  } finally {
    f.db.close();
  }
});

test("expired codes/tokens, another installation, oversized body, and modified signed consent fail closed", async (t) => {
  const f = await fixture();
  try {
    const g = await f.grant();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 601000 });
    assert.ok(
      (await f.exchange(g.exchangeBody)).status >= 400,
      "expired authorization code",
    );
    t.mock.timers.reset();
    const g2 = await f.grant();
    const tokens = await data(await f.exchange(g2.exchangeBody));
    const otherDb = new DatabaseSync(":memory:");
    const other = createProbeHandler({
      origin,
      secret: randomBytes(48).toString("base64url"),
      ownerId: "another-owner",
      database: otherDb,
    });
    const isolated = await other.fetch(
      new Request(`${origin}/mcp`, {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      }),
    );
    assert.equal(
      isolated.status,
      401,
      "other installation does not know the token",
    );
    otherDb.close();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 301000 });
    assert.equal(
      (await f.call(tokens.access_token)).status,
      401,
      "expired access token",
    );
    t.mock.timers.reset();
    assert.equal(
      (await f.req("/mcp", { padding: "x".repeat(17000) })).status,
      413,
    );
    const client = await f.register();
    const { r } = await f.authorization(client);
    const signed = new URL(required(r.headers.get("location")), origin);
    signed.searchParams.set("scope", "mcp:write");
    assert.equal(
      (await f.req(`/consent${signed.search}`, undefined, f.cookie)).status,
      400,
      "signed scopes cannot be altered",
    );
  } finally {
    t.mock.timers.reset();
    f.db.close();
  }
});

test("bootstrap replay is atomic and signed login continues to consent without an auto-grant", async () => {
  const f = await fixture();
  try {
    const one = await f.app.auth.api.generateOneTimeToken({
      headers: new Headers({ cookie: f.cookie }),
    });
    const client = await f.register();
    const verifier = randomBytes(48).toString("base64url");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: client,
      redirect_uri: callback,
      scope: "mcp:read",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: `${origin}/mcp`,
      state: "login-fixture",
    });
    const start = await f.req(`/auth/oauth2/authorize?${q}`);
    const login = new URL(required(start.headers.get("location")), origin);
    assert.equal(login.pathname, "/sign-in");
    const responses = await Promise.all(
      [1, 2].map(() =>
        f.req(
          "/auth/one-time-token/verify",
          { token: one.token, oauth_query: login.search.slice(1) },
          undefined,
          { origin },
        ),
      ),
    );
    assert.equal(
      responses.filter((r) => r.status === 200).length,
      1,
      "one token creates one usable login",
    );
    const success = required(responses.find((r) => r.status === 200));
    const cookie = success.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const resumed = await f.req(
      `/auth/oauth2/authorize${login.search}`,
      undefined,
      cookie,
    );
    assert.equal(resumed.status, 302);
    const target = new URL(required(resumed.headers.get("location")), origin);
    assert.equal(target.pathname, "/consent");
    assert.equal(
      target.searchParams.has("code"),
      false,
      "human consent is still required",
    );
  } finally {
    f.db.close();
  }
});

test("workerd/D1: one-time login, discovery, PKCE, MCP, refresh, revocation and bootstrap replay", async () => {
  const f = await fixture(true);
  try {
    const as = await data(
      await f.req("/.well-known/oauth-authorization-server/auth"),
    );
    assert.equal(as.issuer, `${origin}/auth`);
    assert.ok(
      (
        await f.req(
          "/auth/one-time-token/verify",
          { token: f.token },
          undefined,
          { origin },
        )
      ).status >= 400,
      "D1 rejects bootstrap replay",
    );
    // Remote adapter intentionally allows only ChatGPT's exact redirect.
    const registered = await f.req("/auth/oauth2/register", {
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:read offline_access",
    });
    assert.equal(registered.status, 201);
    const clientId = (await data(registered)).client_id;
    const verifier = randomBytes(48).toString("base64url");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      scope: "mcp:read offline_access",
      state: "synthetic-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: `${origin}/mcp`,
    });
    const authorized = await f.req(
      `/auth/oauth2/authorize?${q}`,
      undefined,
      f.cookie,
    );
    // Miniflare's dispatch client is a fetch request; the provider returns a
    // JSON redirect for fetch, and an HTTP redirect for browser navigation.
    assert.ok([200, 302].includes(authorized.status), "authorization redirect");
    const consentUrl = new URL(
      authorized.status === 302
        ? required(authorized.headers.get("location"))
        : (await data(authorized)).url,
      origin,
    );
    assert.equal(consentUrl.origin, origin);
    assert.equal(consentUrl.pathname, "/consent");
    assert.equal(
      (await f.req(`/consent${consentUrl.search}`, undefined, f.cookie)).status,
      200,
      "D1 serves the verified signed consent page",
    );
    const accepted = await f.req(
      "/auth/oauth2/consent",
      { accept: true, oauth_query: consentUrl.search.slice(1) },
      f.cookie,
      { origin },
    );
    assert.equal(accepted.status, 200);
    const redirect = new URL((await data(accepted)).url);
    assert.equal(redirect.searchParams.get("iss"), `${origin}/auth`);
    const exchange = {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      resource: `${origin}/mcp`,
      code: required(redirect.searchParams.get("code")),
      code_verifier: verifier,
    };
    const response = await f.exchange(exchange);
    assert.equal(response.status, 200);
    const tokens = await data(response);
    assert.equal((await f.call(tokens.access_token)).status, 200);
    const refreshed = await f.exchange({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/mcp`,
    });
    assert.equal(refreshed.status, 200);
    const rotated = await data(refreshed);
    const revoked = await f.req(
      "/auth/oauth2/revoke",
      new URLSearchParams({
        client_id: clientId,
        token: rotated.refresh_token,
        token_type_hint: "refresh_token",
      }),
    );
    assert.equal(revoked.status, 200);
    assert.equal((await f.call(rotated.access_token)).status, 401);
  } finally {
    await f.close();
  }
});
