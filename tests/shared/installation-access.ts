import {
  agencyScopes,
  agencySelection,
  InstallationAccess,
  type InstallationGrant,
  installationReference,
  type RequestActor,
} from "@fortnox-mcp/core";
import { describe, expect, it, vi } from "vitest";
import {
  createProductApplication,
  type ProductSettings,
} from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { syntheticBridgeCatalog } from "./bridge.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";

export async function installationAccessFixture(
  config: AuthConfig,
  enabled = true,
  overrides: Partial<ProductSettings> = {},
) {
  const settings: ProductSettings = {
    origin: config.origin,
    secret: config.secret,
    keys: { a: keyA },
    activeKey: "a",
    redirects: ["https://consumer.example.invalid/callback"],
    testMode: false,
    clientId: "synthetic-client",
    clientSecret: "synthetic-client-secret",
    testTenants: [],
    restApi: true,
    restBridge: true,
    installationAccess: enabled,
    externalAppOnboarding: true,
    onboardingClients: [],
    ...overrides,
  };
  let requests: Request[] = [];
  let hook: ((r: Request) => Promise<Response | undefined>) | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const r = new Request(input, init) as Request;
    requests.push(new Request(r.url, { headers: r.headers, method: r.method }));
    const intercepted = await hook?.(r);
    if (intercepted) return intercepted;
    if (new URL(r.url).pathname === "/oauth-v1/token") {
      const body = new URLSearchParams(await r.text());
      return Response.json({
        access_token: `synthetic-renewed-${r.headers.get("TenantId") ?? "100001"}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope: body.get("scope") ?? agencyScopes.join(" "),
      });
    }
    if (new URL(r.url).pathname === "/3/companyinformation")
      return Response.json({
        CompanyInformation: {
          DatabaseNumber: r.headers.get("authorization")?.endsWith("100002")
            ? "100002"
            : "100001",
          CompanyName: "Synthetic A",
          OrganizationNumber: "000000-0000",
        },
      });
    if (new URL(r.url).pathname === "/3/accounts")
      return Response.json({
        Accounts: [
          {
            Number: 1930,
            Year: Number(new URL(r.url).searchParams.get("financialyear")),
            Description: "Synthetic account",
            Active: true,
            BalanceBroughtForward: "0.00",
            BalanceCarriedForward: "0.00",
          },
        ],
        MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
      });
    return Response.json({ Invoice: { DocumentNumber: "1", InvoiceRows: [] } });
  };
  const app = createProductApplication(settings, config, fetcher);
  const seeded = await app.auth.api.signUpEmail({
    body: {
      email: "installation-access@example.invalid",
      name: "Synthetic owner",
      password: "Synthetic-password-123456",
    },
    returnHeaders: true,
  });
  const owner = seeded.response.user.id;
  await config.state.put(
    "installation",
    "owner",
    { phase: "active", ownerId: owner, tokenHash: "", expiresAt: 0 },
    null,
  );
  const cookie = seeded.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const a = await app.connections.add(
    owner,
    {
      ...syntheticCompany,
      mode: "service",
      scopes: [...agencyScopes],
      programs: agencySelection,
    },
    { ...syntheticCredentials, refreshToken: undefined },
  );
  await app.bridgeCatalog.install(owner, await syntheticBridgeCatalog());
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    target = app,
  ) =>
    target.fetch(
      new Request(`${config.origin}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined
            ? {}
            : {
                "content-type":
                  body instanceof URLSearchParams
                    ? "application/x-www-form-urlencoded"
                    : "application/json",
              }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                body instanceof URLSearchParams ? body : JSON.stringify(body),
            }),
      }),
    );
  const browser = (body: unknown) =>
    request("/admin/integrations/data", body, {
      cookie,
      origin: config.origin,
    });
  async function create(writes = false) {
    const response = await browser({
      action: "create",
      name: "Synthetic Office",
      allow_writes: writes,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const data = (await response.json()) as {
      integration: InstallationGrant;
      client_id: string;
      client_secret: string;
    };
    return {
      ...data,
      authorization: `Basic ${btoa(`${encodeURIComponent(data.client_id)}:${encodeURIComponent(data.client_secret)}`)}`,
    };
  }
  const token = (
    client: { authorization: string },
    extra: Record<string, string> = {},
    target = app,
  ) =>
    request(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        resource: `${config.origin}/api/v1`,
        ...extra,
      }),
      { authorization: client.authorization },
      target,
    );
  return {
    app,
    owner,
    cookie,
    settings,
    a,
    config,
    fetcher,
    create,
    token,
    request,
    browser,
    calls: () => requests,
    resetCalls: () => {
      requests = [];
    },
    setHook: (value: typeof hook) => {
      hook = value;
    },
  };
}

export function installationAccessContract(fixture: () => Promise<AuthConfig>) {
  describe("persistent installation access", () => {
    it("issues five-minute machine tokens, reads finance, adds B without consent and survives logout and 31 idle days", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const response = await f.token(c);
      expect(response.status, await response.clone().text()).toBe(200);
      const pair = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
      };
      expect(pair.expires_in).toBe(300);
      expect(pair.refresh_token).toBeUndefined();
      const headers = { authorization: `Bearer ${pair.access_token}` };
      expect(
        (
          await f.request(
            `/api/v1/companies/${f.a.id}/financial-years/1/accounts`,
            undefined,
            headers,
          )
        ).status,
      ).toBe(200);
      const b = await f.app.connections.add(
        f.owner,
        {
          ...syntheticCompany,
          tenant: "100002",
          mode: "service",
          scopes: [...agencyScopes],
          programs: agencySelection,
        },
        syntheticCredentials,
      );
      expect(
        (
          (await (
            await f.request("/api/v1/companies", undefined, headers)
          ).json()) as { data: { count: number } }
        ).data.count,
      ).toBe(2);
      await f.app.auth.api.signOut({
        headers: new Headers({ cookie: f.cookie }),
      });
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const future = Date.now() + 31 * 86400_000;
        const wallStart = performance.now();
        vi.setSystemTime(future);
        vi.spyOn(Date, "now").mockImplementation(() =>
          Math.floor(future + performance.now() - wallStart),
        );
        const restarted = createProductApplication(
          f.settings,
          f.config,
          f.fetcher,
        );
        const refreshed = await f.token(c, {}, restarted);
        expect(refreshed.status, await refreshed.clone().text()).toBe(200);
        const fresh = (await refreshed.json()) as { access_token: string };
        const auth = { authorization: `Bearer ${fresh.access_token}` };
        expect(
          (
            await f.request(
              `/api/v1/companies/${b.id}/connection-status`,
              undefined,
              auth,
              restarted,
            )
          ).status,
        ).toBe(200);
        expect(
          (await f.request("/api/v1/companies", undefined, headers, restarted))
            .status,
        ).toBe(401);
        for (const company of [f.a.id, b.id]) {
          expect(
            (
              await f.request(
                `/api/v1/companies/${company}/financial-years/1/accounts`,
                undefined,
                auth,
                restarted,
              )
            ).status,
          ).toBe(200);
        }
        await restarted.connections.disconnect(f.owner, f.a.id);
        expect(
          (
            await f.request(
              `/api/v1/companies/${f.a.id}/connection-status`,
              undefined,
              auth,
              restarted,
            )
          ).status,
        ).toBe(409);
        expect(
          (
            await f.request(
              `/api/v1/companies/${b.id}/connection-status`,
              undefined,
              auth,
              restarted,
            )
          ).status,
        ).toBe(200);
      } finally {
        vi.restoreAllMocks();
        vi.useRealTimers();
      }
    });
    it("fences old tokens on writes approval, revocation and secret rotation; rejects unknown or foreign resources", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const first = (await (await f.token(c)).json()) as {
        access_token: string;
      };
      const update = await f.browser({
        action: "change",
        id: c.integration.id,
        expected_revision: 1,
        allow_writes: true,
      });
      expect(update.status, await update.clone().text()).toBe(200);
      expect(
        (
          await f.request("/api/v1/companies", undefined, {
            authorization: `Bearer ${first.access_token}`,
          })
        ).status,
      ).toBe(401);
      const next = await f.token(c);
      expect(next.status, await next.clone().text()).toBe(200);
      expect(((await next.json()) as { scope: string }).scope).toContain(
        "api:write",
      );
      const rotation = await f.browser({
        action: "rotate",
        id: c.integration.id,
        expected_revision: 2,
      });
      expect(rotation.status, await rotation.clone().text()).toBe(200);
      const rotated = (await rotation.json()) as {
        client_id: string;
        client_secret: string;
        integration: InstallationGrant;
      };
      expect((await f.token(c)).ok).toBe(false);
      const replacement = {
        authorization: `Basic ${btoa(`${encodeURIComponent(rotated.client_id)}:${encodeURIComponent(rotated.client_secret)}`)}`,
      };
      expect((await f.token(replacement)).status).toBe(200);
      expect(
        (await f.token(replacement, { resource: `${f.settings.origin}/mcp` }))
          .ok,
      ).toBe(false);
      expect(
        (await f.token(replacement, { scope: "api:read api:files" })).ok,
      ).toBe(false);
      expect(
        (
          await f.browser({
            action: "revoke",
            id: c.integration.id,
            expected_revision: rotated.integration.revision,
          })
        ).status,
      ).toBe(200);
      expect((await f.token(replacement)).ok).toBe(false);
    });
    it("rotates a revoked write integration back to read-only without stale library scopes", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create(true);
      expect(
        (
          await f.browser({
            action: "revoke",
            id: c.integration.id,
            expected_revision: 1,
          })
        ).status,
      ).toBe(200);
      const response = await f.browser({
        action: "rotate",
        id: c.integration.id,
        expected_revision: 2,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const rotated = (await response.json()) as {
        client_id: string;
        client_secret: string;
      };
      const pair = await f.token({
        authorization: `Basic ${btoa(`${encodeURIComponent(rotated.client_id)}:${encodeURIComponent(rotated.client_secret)}`)}`,
      });
      expect(pair.status, await pair.clone().text()).toBe(200);
      expect(((await pair.json()) as { scope: string }).scope).not.toContain(
        "api:write",
      );
    });
    it("cannot administer with a bearer token and is disabled by default", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const pair = (await (await f.token(c)).json()) as {
        access_token: string;
      };
      expect(
        (
          await f.request("/admin/integrations/data", undefined, {
            authorization: `Bearer ${pair.access_token}`,
          })
        ).status,
      ).toBe(401);
      const disabled = createProductApplication(
        { ...f.settings, installationAccess: false },
        f.config,
        f.fetcher,
      );
      expect((await f.token(c, {}, disabled)).ok).toBe(false);
      expect(
        (
          await f.request(
            "/api/v1/companies",
            undefined,
            { authorization: `Bearer ${pair.access_token}` },
            disabled,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await f.request(
            "/admin/integrations/data",
            { action: "revoke", id: c.integration.id, expected_revision: 1 },
            { cookie: f.cookie, origin: f.settings.origin },
            disabled,
          )
        ).status,
      ).toBe(200);
      expect((await f.token(c)).ok).toBe(false);
      expect(
        (
          await f.request("/auth/oauth2/register", {
            redirect_uris: [f.settings.redirects[0]],
            token_endpoint_auth_method: "client_secret_basic",
            grant_types: ["client_credentials"],
            client_credentials_scopes: ["api:read"],
          })
        ).status,
      ).toBe(400);
    });
    it("read grants deny writes, write grants preserve voucher review, read-only and profile restrictions", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const actor = (reference: string): RequestActor => ({
        ownerId: f.owner,
        clientId: reference,
        installationGrant: reference,
        oauthClientId: c.client_id,
        subjectId: `installation:${c.integration.id}`,
        resource: "api",
        permissions: ["read", "finance_read", "bridge", "write"],
      });
      // The domain independently forces read-only even if a caller constructs
      // an actor with write permission. The machine grant is authoritative.
      expect(
        (
          await f.app.connections.authorizeActor(
            actor(installationReference(c.integration)),
            f.a.id,
          )
        ).readOnly,
      ).toBe(true);
      const access = new InstallationAccess(f.config.state, true);
      const upgraded = await access.save(
        f.owner,
        { ...c.integration, writes: true, revision: 2 },
        1,
      );
      const a = actor(installationReference(upgraded));
      await f.app.connections.mutate(f.owner, f.a.id, (c) => {
        c.readOnly = false;
      });
      const operations = await f.app.bridge?.operations(a, f.a.id);
      expect(
        operations?.operations.find(
          (op) => op.operation_id === "voucher_create",
        )?.reason,
      ).toBe("REVIEW_REQUIRED");
      expect(
        operations?.operations.find(
          (op) => op.operation_id === "customer_create",
        )?.reason,
      ).toBe("CAPABILITY_UNAVAILABLE");
      expect(
        operations?.operations.find((op) => op.operation_id === "invoice_get")
          ?.reason,
      ).toBeNull();
      await expect(
        f.app.connections.authorizeActor(
          { ...a, ownerId: "foreign-owner" },
          f.a.id,
        ),
      ).rejects.toThrow("AUTH_REQUIRED");
    });
    it("discards a financial response if installation access is revoked during provider I/O", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const pair = (await (await f.token(c)).json()) as {
        access_token: string;
      };
      f.setHook(async (r) => {
        if (new URL(r.url).pathname === "/3/accounts") {
          await new InstallationAccess(f.config.state, true).save(
            f.owner,
            { ...c.integration, active: false, revision: 2 },
            1,
          );
        }
        return undefined;
      });
      const response = await f.request(
        `/api/v1/companies/${f.a.id}/financial-years/1/accounts`,
        undefined,
        { authorization: `Bearer ${pair.access_token}` },
      );
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain('"Accounts"');
    });
    it("dispatches explicitly enabled writes and retains an unknown write without replay", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create(true);
      await f.app.connections.mutate(f.owner, f.a.id, (c) => {
        c.readOnly = false;
      });
      const pair = (await (await f.token(c)).json()) as {
        access_token: string;
      };
      const path = `/api/v1/companies/${f.a.id}/fortnox/3/invoices/1/email`;
      const headers = {
        authorization: `Bearer ${pair.access_token}`,
        "idempotency-key": crypto.randomUUID(),
      };
      const result = await f.request(path, undefined, headers);
      expect(result.status, await result.clone().text()).toBe(200);
      expect(result.headers.get("x-fortnox-execution-state")).toBe("succeeded");
      f.setHook(async (r) => {
        if (new URL(r.url).pathname.endsWith("/email"))
          throw new Error("Synthetic response lost");
        return undefined;
      });
      f.resetCalls();
      const uncertain = { ...headers, "idempotency-key": crypto.randomUUID() };
      const lost = await f.request(path, undefined, uncertain);
      expect(lost.status, await lost.clone().text()).toBe(409);
      expect(await lost.json()).toMatchObject({ state: "outcome_unknown" });
      const count = f.calls().length;
      const retry = await f.request(path, undefined, uncertain);
      expect(retry.status).toBe(409);
      expect(f.calls().length).toBe(count);
    });
    it("enforces library client disablement and does not revive an earlier grant token", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const pair = (await (await f.token(c)).json()) as {
        access_token: string;
      };
      await f.app.auth.api.adminUpdateOAuthClient({
        headers: new Headers({ cookie: f.cookie }),
        body: { client_id: c.client_id, update: { disabled: true } },
      });
      expect(
        (
          await f.request("/api/v1/companies", undefined, {
            authorization: `Bearer ${pair.access_token}`,
          })
        ).status,
      ).toBe(401);
      expect((await f.token(c)).ok).toBe(false);
    });
    it("freezes the linked onboarding profile and preserves idempotency after integration revocation", async () => {
      const f = await installationAccessFixture(await fixture());
      const registration = await f.request("/auth/oauth2/register", {
        redirect_uris: f.settings.redirects,
        token_endpoint_auth_method: "client_secret_basic",
        grant_types: ["authorization_code", "refresh_token"],
        scope: "mcp:read offline_access",
      });
      expect(registration.status).toBe(201);
      const client = (await registration.json()) as {
        client_id: string;
        client_secret: string;
      };
      f.settings.onboardingClients?.push(client.client_id);
      const created = await f.browser({
        action: "create",
        name: "Synthetic linked Office",
        allow_writes: false,
        onboarding_client_id: client.client_id,
      });
      expect(created.status).toBe(201);
      const integration = (await created.json()) as {
        integration: InstallationGrant;
      };
      const body = {
        action: "connect",
        redirect_uri: f.settings.redirects[0],
        state: "synthetic-state-with-at-least-32-characters",
        code_challenge: "A".repeat(43),
        code_challenge_method: "S256",
        scope: "mcp:read",
      };
      const headers = {
        authorization: `Basic ${btoa(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`)}`,
        "idempotency-key": crypto.randomUUID(),
      };
      const started = await f.request(
        "/api/company-onboarding/v1/attempts",
        body,
        headers,
      );
      expect(started.status, await started.clone().text()).toBe(201);
      const attempt = (await started.json()) as { attempt_id: string };
      const retained = await f.app.onboarding?.get(
        f.owner,
        client.client_id,
        attempt.attempt_id,
      );
      if (!retained || !f.app.onboarding)
        throw new Error("Synthetic attempt missing");
      expect(
        (await f.app.onboarding.request(f.owner, retained)).connection_profile,
      ).toBe("agency_finance_v1");
      expect(
        (
          await f.browser({
            action: "revoke",
            id: integration.integration.id,
            expected_revision: 1,
          })
        ).status,
      ).toBe(200);
      const replay = await f.request(
        "/api/company-onboarding/v1/attempts",
        body,
        headers,
      );
      expect(replay.status).toBe(201);
      expect(((await replay.json()) as { attempt_id: string }).attempt_id).toBe(
        attempt.attempt_id,
      );
      expect(
        (await f.app.onboarding.request(f.owner, retained)).connection_profile,
      ).toBe("agency_finance_v1");
    });
    it("connects the complete profile once, reuses local scopes and reconnects a revoked service company", async () => {
      const f = await installationAccessFixture(await fixture());
      const credentials = {
        clientId: f.settings.clientId,
        clientSecret: f.settings.clientSecret,
        mode: "service" as const,
      };
      const start = new URL(
        await f.app.provider.start(
          "profile-owner",
          "synthetic-session",
          credentials,
          undefined,
          undefined,
          undefined,
          "agency_finance_v1",
        ),
      );
      expect(new Set(start.searchParams.get("scope")?.split(" "))).toEqual(
        new Set(agencyScopes),
      );
      const company = await f.app.provider.finish(
        "profile-owner",
        "synthetic-session",
        new URL(
          `${f.settings.origin}/admin/fortnox/callback?${new URLSearchParams({ state: start.searchParams.get("state") ?? "", code: "synthetic-profile" })}`,
        ),
      );
      expect(company.mode).toBe("service");
      expect(company.programs?.features).toEqual(agencySelection.features);
      await f.app.connections.mutate("profile-owner", company.id, (c) => {
        c.programs = { revision: 2, enabled: [], features: [] };
      });
      f.resetCalls();
      const local = await f.app.connections.applyAgencyProfile(
        "profile-owner",
        company.id,
        {
          generation: company.generation,
          policy: company.policyVersion,
          revision: 2,
        },
      );
      expect(local.generation).toBe(company.generation);
      expect(f.calls()).toHaveLength(0);
      await f.app.connections.mutate("profile-owner", company.id, (c) => {
        c.state = "reconnect_required";
        c.secret = null;
      });
      const reconnect = new URL(
        await f.app.provider.start(
          "profile-owner",
          "synthetic-session",
          credentials,
          company.id,
          undefined,
          undefined,
          "agency_finance_v1",
        ),
      );
      const renewed = await f.app.provider.finish(
        "profile-owner",
        "synthetic-session",
        new URL(
          `${f.settings.origin}/admin/fortnox/callback?${new URLSearchParams({ state: reconnect.searchParams.get("state") ?? "", code: "synthetic-profile" })}`,
        ),
      );
      expect(renewed.id).toBe(company.id);
      expect(renewed.state).toBe("active");
      await f.app.connections.mutate("profile-owner", company.id, (c) => {
        c.scopes = c.scopes.filter((s) => s !== "invoice");
      });
      const extension = new URL(
        await f.app.provider.start(
          "profile-owner",
          "synthetic-session",
          credentials,
          company.id,
          undefined,
          undefined,
          "agency_finance_v1",
        ),
      );
      const extended = await f.app.provider.finish(
        "profile-owner",
        "synthetic-session",
        new URL(
          `${f.settings.origin}/admin/fortnox/callback?${new URLSearchParams({ state: extension.searchParams.get("state") ?? "", code: "synthetic-profile" })}`,
        ),
      );
      expect(extended.id).toBe(company.id);
      expect(extended.scopes).toContain("invoice");
      expect(extended.generation).toBe(renewed.generation + 1);
      expect(extended.review).toBe(renewed.review);
    });
    it("reacquires once for native reads and distinguishes a provider 401 from Office authentication", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const pair = (await (await f.token(c)).json()) as {
        access_token: string;
      };
      let reads = 0;
      f.setHook(async (r) => {
        if (new URL(r.url).pathname === "/3/invoices/1" && ++reads === 1)
          return Response.json(
            { ErrorInformation: { code: 200 } },
            { status: 401 },
          );
        return undefined;
      });
      const path = `/api/v1/companies/${f.a.id}/fortnox/3/invoices/1`;
      expect(
        (
          await f.request(path, undefined, {
            authorization: `Bearer ${pair.access_token}`,
          })
        ).status,
      ).toBe(200);
      expect(reads).toBe(2);
      f.setHook(async (r) =>
        new URL(r.url).pathname === "/3/invoices/1"
          ? Response.json({}, { status: 401 })
          : undefined,
      );
      const denied = await f.request(path, undefined, {
        authorization: `Bearer ${pair.access_token}`,
      });
      expect(denied.status).toBe(401);
      expect(denied.headers.get("x-fortnox-mcp-error-source")).toBe("provider");
      const invalid = await f.request(path, undefined, {
        authorization: "Bearer synthetic-invalid",
      });
      expect(invalid.status).toBe(401);
      expect(invalid.headers.get("x-fortnox-mcp-error-source")).toBe(
        "integration",
      );
    });
    it("does not publish a token when its installation grant changes during issuance", async () => {
      const f = await installationAccessFixture(await fixture());
      const c = await f.create();
      const bind = f.app.auth.api.bindInstallationToken;
      f.app.auth.api.bindInstallationToken = Object.assign(
        async (...args: Parameters<typeof bind>) => {
          await new InstallationAccess(f.config.state, true).save(
            f.owner,
            { ...c.integration, active: false, revision: 2 },
            1,
          );
          return bind(...args);
        },
        bind,
      );
      expect((await f.token(c)).ok).toBe(false);
    });
    it("preserves service credentials on transient and installation errors, but marks proven tenant denial", async () => {
      const f = await installationAccessFixture(await fixture());
      f.setHook(async (r) =>
        new URL(r.url).pathname === "/oauth-v1/token"
          ? Response.json({ error: "server_error" }, { status: 503 })
          : undefined,
      );
      await expect(f.app.provider.token(f.owner, f.a, true)).rejects.toThrow(
        "UPSTREAM_UNAVAILABLE",
      );
      expect((await f.app.connections.list(f.owner))[0]?.state).toBe("active");
      expect((await f.app.connections.list(f.owner))[0]?.secret).not.toBeNull();
      f.setHook(async (r) =>
        new URL(r.url).pathname === "/oauth-v1/token"
          ? Response.json({ error: "invalid_client" }, { status: 401 })
          : undefined,
      );
      await expect(f.app.provider.token(f.owner, f.a, true)).rejects.toThrow(
        "UPSTREAM_UNAVAILABLE",
      );
      expect((await f.app.connections.list(f.owner))[0]?.state).toBe("active");
      f.setHook(undefined);
      expect(await f.app.provider.token(f.owner, f.a, true)).toBe(
        "synthetic-renewed-100001",
      );
      f.setHook(async (r) =>
        new URL(r.url).pathname === "/oauth-v1/token"
          ? Response.json({ error: "invalid_grant" }, { status: 400 })
          : undefined,
      );
      await expect(f.app.provider.token(f.owner, f.a, true)).rejects.toThrow(
        "RECONNECT_REQUIRED",
      );
      expect((await f.app.connections.list(f.owner))[0]?.secret).toBeNull();
    });
  });
}
