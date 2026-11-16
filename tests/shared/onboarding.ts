import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import {
  createProductApplication,
  type ProductSettings,
} from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { keyA } from "./connections.js";

const callback = "https://consumer.example.invalid/fortnox/callback";
const version = "company-onboarding-v1";
export async function onboardingFixture(config: AuthConfig, offline = false) {
  const clients: string[] = [];
  let calls = 0;
  let failProvider = false;
  let providerGate: Promise<void> | undefined;
  const settings: ProductSettings = {
    origin: config.origin,
    secret: config.secret,
    keys: { a: keyA },
    activeKey: "a",
    redirects: [callback],
    testMode: false,
    clientId: "synthetic-client",
    clientSecret: "synthetic-client-secret",
    testTenants: [],
    externalAppOnboarding: true,
    onboardingClients: clients,
    offlineClientIds: offline ? clients : [],
  };
  const app = createProductApplication(
    settings,
    config,
    async (input, init) => {
      calls++;
      if (providerGate) await providerGate;
      if (failProvider) throw new Error("Synthetic lost response");
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/oauth-v1/token") {
        const body = new URLSearchParams(await request.text());
        return Response.json({
          access_token: `synthetic-${body.get("code") ?? "A"}`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "synthetic-provider-refresh",
          scope: "companyinformation profile",
        });
      }
      const token = request.headers.get("authorization") ?? "";
      const b = token.endsWith("-B");
      return Response.json({
        CompanyInformation: {
          DatabaseNumber: b ? "100002" : "100001",
          CompanyName: b ? "Synthetic B" : "Synthetic A",
          OrganizationNumber: b ? "000000-0002" : "000000-0001",
        },
      });
    },
  );
  const seeded = await app.auth.api.signUpEmail({
    body: {
      email: "onboarding@example.invalid",
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
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.fetch(
      new Request(path.startsWith("http") ? path : `${config.origin}${path}`, {
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
  async function register(method = "client_secret_basic") {
    const response = await request("/auth/oauth2/register", {
      client_name: "Synthetic consumer",
      redirect_uris: [callback],
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:read offline_access",
    });
    expect(response.status).toBe(201);
    const c = (await response.json()) as {
      client_id: string;
      client_secret: string;
    };
    clients.push(c.client_id);
    return {
      ...c,
      authorization: `Basic ${btoa(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(c.client_secret)}`)}`,
    };
  }
  const client = await register();
  const verifier = "synthetic-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const startInput = {
    action: "connect",
    redirect_uri: callback,
    state: crypto.randomUUID(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mcp:read offline_access",
  };
  const browser = (path: string, body?: unknown) =>
    request(path, body, { cookie, origin: config.origin, accept: "text/html" });
  async function start(
    overrides: Record<string, unknown> = {},
    key = crypto.randomUUID(),
    c = client,
  ) {
    const input = { ...startInput, state: crypto.randomUUID(), ...overrides };
    const response = await request(
      "/api/company-onboarding/v1/attempts",
      input,
      { authorization: c.authorization, "idempotency-key": key },
    );
    expect(response.status, await response.clone().text()).toBe(201);
    const a = (await response.json()) as {
      version: string;
      attempt_id: string;
      attempt_revision: number;
      authorization_url: string;
      expires_at: string;
      retain_until: string;
    };
    expect(a.version).toBe(version);
    return { ...a, input, key };
  }
  async function provider(
    a: { attempt_id: string; attempt_revision: number },
    code = "A",
  ) {
    const response = await browser(
      `/connect/company/${a.attempt_id}/provider`,
      { revision: a.attempt_revision, mode: "user" },
    );
    expect(response.status).toBe(200);
    const target = new URL(((await response.json()) as { url: string }).url);
    expect(target.searchParams.get("scope")).toBe("companyinformation profile");
    const result = await browser(
      `/admin/fortnox/callback?${new URLSearchParams({ state: target.searchParams.get("state") ?? "", code })}`,
    );
    expect(result.status).toBe(303);
    return { target, location: result.headers.get("location") ?? "" };
  }
  async function approve(a: { attempt_id: string; attempt_revision: number }) {
    const before = await browser(`/connect/company/${a.attempt_id}/approve`, {
      revision: a.attempt_revision,
    });
    expect(before.status).toBe(200);
    const authorization = ((await before.json()) as { url: string }).url;
    const consentResponse = await browser(authorization);
    expect(consentResponse.status).toBe(302);
    const consent = new URL(
      consentResponse.headers.get("location") ??
        ((await consentResponse.json()) as { url: string }).url,
      config.origin,
    );
    const page = await browser(consent.href);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Synthetic consumer");
    const attempt = await app.onboarding?.get(
      owner,
      client.client_id,
      a.attempt_id,
    );
    const approved = await browser("/auth/oauth2/consent", {
      accept: true,
      oauth_query: consent.search.slice(1),
      companies: attempt?.approval?.selection,
    });
    expect(approved.status).toBe(200);
    const target = new URL(((await approved.json()) as { url: string }).url);
    return { target, consent, selection: attempt?.approval?.selection };
  }
  async function exchange(
    target: URL,
    c = client,
    override: Record<string, string> = {},
  ) {
    return request(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: target.searchParams.get("code") ?? "",
        code_verifier: verifier,
        redirect_uri: callback,
        resource: `${config.origin}/mcp`,
        ...override,
      }),
      { authorization: c.authorization },
    );
  }
  async function result(id: string, token: string) {
    return request(
      `/api/company-onboarding/v1/attempts/${id}/result`,
      undefined,
      { authorization: `Bearer ${token}` },
    );
  }
  async function mcp(token: string, name: string, company: string) {
    const sdk = new Client({ name: "synthetic-consumer", version: "1.0.0" });
    await sdk.connect(
      new StreamableHTTPClientTransport(new URL(`${config.origin}/mcp`), {
        fetch: async (input, init) => app.fetch(new Request(input, init)),
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    try {
      return await sdk.callTool({ name, arguments: { company_id: company } });
    } finally {
      await sdk.close();
    }
  }
  return {
    app,
    config,
    owner,
    cookie,
    client,
    settings,
    register,
    request,
    browser,
    start,
    startInput,
    provider,
    approve,
    exchange,
    result,
    mcp,
    verifier,
    challenge,
    calls: () => calls,
    pauseProvider: () => {
      let release!: () => void;
      providerGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        providerGate = undefined;
        release();
      };
    },
    fail: () => {
      failProvider = true;
    },
    recover: () => {
      failProvider = false;
    },
  };
}

export function onboardingContract(fixture: () => Promise<AuthConfig>) {
  it("renders bounded browser errors while preserving JSON contracts and avoiding provider dispatch", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    const missing = `/connect/company/${crypto.randomUUID()}?revision=1`;
    const html = await f.browser(missing);
    expect(html.status).toBe(404);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("cache-control")).toBe("no-store");
    const content = await html.text();
    expect(content).toContain("Anslutningsförsöket hittades inte");
    expect(content).not.toContain("Synthetic consumer");
    const structured = await f.request(missing, undefined, {
      cookie: f.cookie,
    });
    expect(structured.status).toBe(404);
    expect(await structured.json()).toEqual({
      version,
      error: "ATTEMPT_NOT_FOUND",
      recovery_action: "none",
    });
    const invalid = await f.browser(
      a.authorization_url.replace("revision=1", "revision=invalid"),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("Anslutningslänken är ogiltig");
    await f.app.connections.updateSet(f.owner, (set) => {
      const attempt = set.onboarding?.find(
        (attempt) => attempt.id === a.attempt_id,
      );
      if (attempt) attempt.expiresAt = Date.now() - 1;
    });
    const expired = await f.browser(a.authorization_url);
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("Anslutningsförsöket har gått ut");
    const post = await f.browser(`/connect/company/${a.attempt_id}/choose`, {
      revision: 1,
      company_id: crypto.randomUUID(),
    });
    expect(post.headers.get("content-type")).toBe("application/json");
    expect(await post.json()).toEqual({
      version,
      error: "ATTEMPT_EXPIRED",
      recovery_action: "resume",
    });
    const api = await f.request(
      `/api/company-onboarding/v1/attempts/${crypto.randomUUID()}`,
      undefined,
      { authorization: f.client.authorization, accept: "text/html" },
    );
    expect(api.headers.get("content-type")).toBe("application/json");
    expect(await api.json()).toEqual({
      version,
      error: "ATTEMPT_NOT_FOUND",
      recovery_action: "none",
    });
    expect(f.calls()).toBe(0);
  });
  it("completes a provider connection, exact client-bound result and real MCP profile/status reads", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    const login = await f.request(a.authorization_url);
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toContain(
      "/sign-in?company_onboarding=",
    );
    expect((await f.browser(a.authorization_url)).status).toBe(200);
    expect(f.calls()).toBe(0);
    const { location, target: providerUrl } = await f.provider(a);
    expect(location).toBe(a.authorization_url);
    expect(providerUrl.searchParams.get("state")).not.toBe(a.input.state);
    const connections = await f.app.connections.list(f.owner);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.review).toBe("review_required");
    expect(connections[0]?.readOnly).toBe(true);
    const continuation = await f.browser(location);
    expect(continuation.status).toBe(303);
    const authorization = continuation.headers.get("location") ?? "";
    expect(new URL(authorization).pathname).toBe("/auth/oauth2/authorize");
    const pendingApproval = await f.browser(authorization);
    const consent = pendingApproval.headers.get("location") ?? "";
    expect(new URL(consent, f.config.origin).pathname).toBe("/consent");
    expect(
      (await f.browser(new URL(consent, f.config.origin).href)).status,
    ).toBe(200);
    const attempt = await f.app.onboarding?.get(
      f.owner,
      f.client.client_id,
      a.attempt_id,
    );
    expect(attempt?.company?.id).toBe(connections[0]?.id);
    expect(attempt?.approval?.selection.map((c) => c.id)).toEqual([
      connections[0]?.id,
    ]);
    expect(attempt?.phase).toBe("approval_pending");
    expect(attempt?.completedAt).toBeUndefined();
    expect(attempt?.grantId).toBeUndefined();
    expect(f.calls()).toBe(2);
    const approved = await f.approve(a);
    expect(approved.target.searchParams.get("state")).toBe(a.input.state);
    const exchanged = await f.exchange(approved.target);
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.refresh_token).toBeTruthy();
    const completed = await f.result(a.attempt_id, tokens.access_token);
    expect(completed.status).toBe(200);
    const result = (await completed.json()) as { company_id: string };
    expect(result.company_id).toBe(connections[0]?.id);
    const grant = await f.app.connections.clientGrant(
      f.owner,
      f.client.client_id,
    );
    expect(grant.companyAccess).toBeUndefined();
    await expect(
      f.app.connections.allowOwnerConnections(
        f.owner,
        f.client.client_id,
        grant.grantId ?? null,
        grant.revision ?? 0,
      ),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    expect(
      (
        await f.mcp(
          tokens.access_token,
          "get_company_profile",
          result.company_id,
        )
      ).isError,
    ).not.toBe(true);
    expect(
      (
        await f.mcp(
          tokens.access_token,
          "get_connection_status",
          result.company_id,
        )
      ).isError,
    ).not.toBe(true);
    expect((await f.result(a.attempt_id, tokens.access_token)).status).toBe(
      200,
    );
    expect((await f.exchange(approved.target)).status).toBe(400);
    const calls = f.calls();
    expect(
      (
        await f.request(
          `/connect/company/${a.attempt_id}/provider`,
          { revision: 1, mode: "user" },
          {
            authorization: `Bearer ${tokens.access_token}`,
            origin: f.config.origin,
          },
        )
      ).status,
    ).toBe(401);
    expect(f.calls()).toBe(calls);
  });
  it("keeps A when B is approved, isolates another registration and rejects obsolete tokens/codes", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    await f.provider(a, "A");
    const approvedA = await f.approve(a);
    const tokensA = (await (await f.exchange(approvedA.target)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    const companyA = (await f.app.connections.list(f.owner))[0];
    expect(companyA).toBeTruthy();
    const other = await f.register();
    await f.app.connections.grant(f.owner, other.client_id, [
      companyA?.id as string,
    ]);
    const b = await f.start();
    await f.provider(b, "B");
    const approvedB = await f.approve(b);
    expect(approvedB.selection).toHaveLength(2);
    const tokensB = (await (await f.exchange(approvedB.target)).json()) as {
      access_token: string;
    };
    expect((await f.result(b.attempt_id, tokensB.access_token)).status).toBe(
      200,
    );
    expect((await f.result(a.attempt_id, tokensA.access_token)).status).toBe(
      401,
    );
    const identity = await f.app.auth.api.verifyProductToken({
      body: { token: tokensB.access_token },
    });
    expect(
      (
        await f.app.connections.authorize(
          f.owner,
          identity.clientId,
          companyA?.id as string,
        )
      ).id,
    ).toBe(companyA?.id);
    const otherGrant = (
      await f.config.state.get<{ companies: Record<string, number> }>(
        "company-grants",
        other.client_id,
      )
    )?.value;
    expect(Object.keys(otherGrant?.companies ?? {})).toEqual([companyA?.id]);
    const foreign = await f.request(
      `/api/company-onboarding/v1/attempts/${b.attempt_id}`,
      undefined,
      { authorization: other.authorization },
    );
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(await foreign.json())).not.toContain(companyA?.id);
    const refresh = await f.request(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokensA.refresh_token,
        resource: `${f.config.origin}/mcp`,
      }),
      { authorization: f.client.authorization },
    );
    expect(refresh.status).toBe(400);
  });
  it("recovers lost start/resume/code responses without another provider connection", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    const headers = {
      authorization: f.client.authorization,
      "idempotency-key": a.key,
    };
    const again = await f.request(
      "/api/company-onboarding/v1/attempts",
      a.input,
      headers,
    );
    expect(await again.json()).toEqual({
      ...a,
      input: undefined,
      key: undefined,
    });
    expect(
      (
        await f.request(
          "/api/company-onboarding/v1/attempts",
          { ...a.input, state: crypto.randomUUID() },
          headers,
        )
      ).status,
    ).toBe(409);
    await f.provider(a);
    const approved = await f.approve(a);
    expect((await f.exchange(approved.target)).status).toBe(200); // caller loses the body
    const count = f.calls();
    const key = crypto.randomUUID();
    const input = {
      expected_attempt_revision: 1,
      state: crypto.randomUUID(),
      code_challenge: f.challenge,
      code_challenge_method: "S256",
    };
    const path = `/api/company-onboarding/v1/attempts/${a.attempt_id}/resume`;
    const resume = await f.request(path, input, {
      authorization: f.client.authorization,
      "idempotency-key": key,
    });
    expect(resume.status).toBe(200);
    const next = (await resume.json()) as typeof a;
    expect(
      await (
        await f.request(path, input, {
          authorization: f.client.authorization,
          "idempotency-key": key,
        })
      ).json(),
    ).toEqual(next);
    expect((await f.browser(a.authorization_url)).status).toBe(409);
    const nextApproved = await f.approve(next);
    const tokens = (await (await f.exchange(nextApproved.target)).json()) as {
      access_token: string;
    };
    expect((await f.result(a.attempt_id, tokens.access_token)).status).toBe(
      200,
    );
    expect(f.calls()).toBe(count);
    expect(await f.app.connections.list(f.owner)).toHaveLength(1);
  });
  it("reuses an existing company and preserves identity, policy and work on reconnect", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    await f.provider(a);
    let c = (await f.app.connections.list(f.owner))[0];
    expect(c).toBeTruthy();
    const reuse = await f.start();
    const count = f.calls();
    expect(
      (
        await f.browser(`/connect/company/${reuse.attempt_id}/choose`, {
          revision: 1,
          company_id: c?.id,
        })
      ).status,
    ).toBe(200);
    expect(f.calls()).toBe(count + 1);
    expect(await f.app.connections.list(f.owner)).toHaveLength(1);
    await f.app.connections.mutate(f.owner, c?.id as string, (c) => {
      c.review = "client_managed";
      c.readOnly = false;
      c.state = "reconnect_required";
    });
    c = (await f.app.connections.list(f.owner))[0];
    const reconnect = await f.start({
      action: "reconnect",
      expected_company_id: c?.id,
    });
    await f.provider(reconnect);
    const next = (await f.app.connections.list(f.owner))[0];
    expect(next?.id).toBe(c?.id);
    expect(next?.generation).toBe((c?.generation ?? 0) + 1);
    expect(next?.review).toBe("client_managed");
    expect(next?.readOnly).toBe(false);
  });
  it("fails closed for origin, public client, callback, session, PKCE, expiry and unknown exchange", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    expect(
      (
        await f.request("/api/company-onboarding/v1/attempts", a.input, {
          authorization: f.client.authorization,
          origin: "https://foreign.invalid",
          "idempotency-key": crypto.randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/api/company-onboarding/v1/attempts",
          { ...a.input, redirect_uri: "https://foreign.invalid/callback" },
          {
            authorization: f.client.authorization,
            "idempotency-key": crypto.randomUUID(),
          },
        )
      ).status,
    ).toBe(400);
    const publicClient = await f.register("none");
    expect(
      (
        await f.request("/api/company-onboarding/v1/attempts", a.input, {
          authorization: publicClient.authorization,
          "idempotency-key": crypto.randomUUID(),
        })
      ).status,
    ).toBe(401);
    await f.provider(a);
    const approved = await f.approve(a);
    expect(
      (
        await f.exchange(approved.target, f.client, {
          code_verifier:
            "invalid-verifier-abcdefghijklmnopqrstuvwxyz0123456789",
        })
      ).status,
    ).toBe(400);
    await f.app.connections.updateSet(f.owner, (set) => {
      const a = set.onboarding?.[0];
      if (a) a.expiresAt = Date.now() - 1;
    });
    expect((await f.browser(a.authorization_url)).status).toBe(410);
    const unknown = await f.start();
    f.fail();
    await f.provider(unknown);
    const status = await f.request(
      `/api/company-onboarding/v1/attempts/${unknown.attempt_id}`,
      undefined,
      { authorization: f.client.authorization },
    );
    expect(((await status.json()) as { status: string }).status).toBe(
      "provider_outcome_unknown",
    );
    const count = f.calls();
    expect(
      (
        await f.request(
          `/api/company-onboarding/v1/attempts/${unknown.attempt_id}/resume`,
          {
            expected_attempt_revision: 1,
            state: crypto.randomUUID(),
            code_challenge: f.challenge,
            code_challenge_method: "S256",
          },
          {
            authorization: f.client.authorization,
            "idempotency-key": crypto.randomUUID(),
          },
        )
      ).status,
    ).toBe(409);
    expect(f.calls()).toBe(count);
    await cleanupProduct(f.config.state, Date.now() + 25 * 60 * 60_000);
    expect(
      (
        await f.request(
          `/api/company-onboarding/v1/attempts/${unknown.attempt_id}`,
          undefined,
          { authorization: f.client.authorization },
        )
      ).status,
    ).toBe(404);
  });
  it("denies another owner/session, stale policy, tampered state and competing callbacks", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    const start = await f.browser(`/connect/company/${a.attempt_id}/provider`, {
      revision: 1,
      mode: "user",
    });
    const providerUrl = new URL(((await start.json()) as { url: string }).url);
    const login = await f.app.auth.api.signInEmail({
      body: {
        email: "onboarding@example.invalid",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    const anotherCookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(
      (
        await f.request(a.authorization_url, undefined, {
          cookie: anotherCookie,
        })
      ).status,
    ).toBe(401);
    const calls = f.calls();
    expect(
      (await f.browser(`/admin/fortnox/callback?state=wrong&code=A`)).status,
    ).toBe(303);
    expect(f.calls()).toBe(calls);
    const path = `/admin/fortnox/callback?${new URLSearchParams({ state: providerUrl.searchParams.get("state") ?? "", code: "A" })}`;
    const callbacks = await Promise.all([f.browser(path), f.browser(path)]);
    expect(callbacks.every((r) => r.status === 303 || r.status === 409)).toBe(
      true,
    );
    expect(await f.app.connections.list(f.owner)).toHaveLength(1);
    expect(f.calls()).toBe(calls + 2);
    const before = await f.browser(`/connect/company/${a.attempt_id}/approve`, {
      revision: 1,
    });
    const authorization = ((await before.json()) as { url: string }).url;
    const response = await f.browser(authorization);
    const consent = new URL(
      response.headers.get("location") as string,
      f.config.origin,
    );
    expect((await f.browser(consent.href)).status).toBe(200);
    const record = await f.app.onboarding?.get(
      f.owner,
      f.client.client_id,
      a.attempt_id,
    );
    const selection = record?.approval?.selection;
    expect(
      (
        await f.browser("/auth/oauth2/consent", {
          accept: true,
          oauth_query: consent.search.slice(1),
          companies: selection,
          company_access: "owner_connections",
        })
      ).status,
    ).toBe(409);
    expect(
      await f.config.state.get("company-grants", f.client.client_id),
    ).toBeNull();
    const tampered = new URL(consent);
    tampered.searchParams.set("state", crypto.randomUUID());
    const callsBeforeTampered = f.calls();
    const rejected = await f.browser(tampered.href);
    expect(rejected.status).toBe(303);
    expect(rejected.headers.get("location")).toBe(
      `/connect/company/${a.attempt_id}?revision=1`,
    );
    expect(
      (await f.request(tampered.href, undefined, { cookie: f.cookie })).status,
    ).toBe(401);
    expect(
      await f.config.state.get("company-grants", f.client.client_id),
    ).toBeNull();
    expect(f.calls()).toBe(callsBeforeTampered);
    await f.app.connections.mutate(
      f.owner,
      record?.company?.id as string,
      (c) => {
        c.policyVersion++;
      },
    );
    expect(
      (
        await f.browser("/auth/oauth2/consent", {
          accept: true,
          oauth_query: consent.search.slice(1),
          companies: selection,
        })
      ).status,
    ).toBe(409);
    expect(
      await f.config.state.get("company-grants", f.client.client_id),
    ).toBeNull();
  });
  it("cancels safely, resumes with a fresh owner session and keeps live tokens after attempt cleanup", async () => {
    const f = await onboardingFixture(await fixture());
    const cancelled = await f.start();
    const cancellation = await f.browser(
      `/connect/company/${cancelled.attempt_id}/cancel`,
      { revision: 1 },
    );
    expect(cancellation.status).toBe(200);
    const target = new URL(
      ((await cancellation.json()) as { url: string }).url,
    );
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe(cancelled.input.state);
    expect(f.calls()).toBe(0);
    const a = await f.start();
    await f.provider(a);
    const approval = await f.approve(a);
    const tokens = (await (await f.exchange(approval.target)).json()) as {
      access_token: string;
    };
    await f.app.connections.updateSet(f.owner, (set) => {
      for (const a of set.onboarding ?? []) a.retainUntil = Date.now() - 1;
    });
    await cleanupProduct(f.config.state);
    // Cleanup's supplied clock only removes bounded operational records. Real
    // token lifetime/approval retention remains controlled by the auth library.
    const identity = await f.app.auth.api.verifyProductToken({
      body: { token: tokens.access_token },
    });
    expect(identity.oauthClientId).toBe(f.client.client_id);
    expect((await f.result(a.attempt_id, tokens.access_token)).status).toBe(
      404,
    );
  });
  it("rejects a different reconnect tenant and does not duplicate an existing provider company", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    await f.provider(a);
    const c = (await f.app.connections.list(f.owner))[0];
    const duplicate = await f.start();
    await f.provider(duplicate);
    expect(await f.app.connections.list(f.owner)).toHaveLength(1);
    await f.app.connections.mutate(f.owner, c?.id as string, (c) => {
      c.state = "reconnect_required";
    });
    const reconnect = await f.start({
      action: "reconnect",
      expected_company_id: c?.id,
    });
    await f.provider(reconnect, "B");
    const next = (await f.app.connections.list(f.owner))[0];
    expect(next?.id).toBe(c?.id);
    expect(next?.tenant).toBe(c?.tenant);
    expect(next?.generation).toBe(c?.generation);
    expect(next?.state).toBe("reconnect_required");
  });
  it("refuses session recovery while an earlier session or provider exchange remains active", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    const start = await f.browser(`/connect/company/${a.attempt_id}/provider`, {
      revision: 1,
      mode: "user",
    });
    const target = new URL(((await start.json()) as { url: string }).url);
    const login = await f.app.auth.api.signInEmail({
      body: {
        email: "onboarding@example.invalid",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const recover = (origin = f.config.origin) =>
      f.request(
        `/connect/company/${a.attempt_id}/recover-session`,
        { revision: 1 },
        { cookie, origin },
      );
    expect((await recover()).status).toBe(401);
    const release = f.pauseProvider();
    const callback = f.browser(
      `/admin/fortnox/callback?${new URLSearchParams({ state: target.searchParams.get("state") ?? "", code: "A" })}`,
    );
    try {
      await expect.poll(() => f.calls()).toBe(1);
      await f.app.auth.api.signOut({
        headers: new Headers({ cookie: f.cookie }),
      });
      expect((await recover("https://foreign.example.invalid")).status).toBe(
        403,
      );
      const response = await recover();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "CONSENT_IN_PROGRESS",
        recovery_action: "wait",
      });
      await f.app.connections.updateSet(f.owner, (set) => {
        const attempt = set.onboarding?.find(
          (attempt) => attempt.id === a.attempt_id,
        );
        if (attempt) attempt.expiresAt = Date.now() - 1;
      });
      const status = await f.request(
        `/api/company-onboarding/v1/attempts/${a.attempt_id}`,
        undefined,
        { authorization: f.client.authorization },
      );
      expect(await status.json()).toMatchObject({
        status: "provider_pending",
        recovery_action: "wait",
      });
      const page = await f.request(a.authorization_url, undefined, {
        cookie,
        accept: "text/html",
      });
      const html = await page.text();
      expect(html).toContain("Fortnox-godkännande pågår");
      expect(html).not.toContain("recover-session");
      expect(html).not.toContain("Fortsätt i Synthetic consumer");
      expect(f.calls()).toBe(1);
      expect(
        (await f.app.onboarding?.get(f.owner, f.client.client_id, a.attempt_id))
          ?.phase,
      ).toBe("provider_pending");
    } finally {
      release();
      await callback;
    }
    expect(await f.app.connections.list(f.owner)).toHaveLength(1);
  });
  it("rebinds expired owner sessions for pending/unknown provider review without code replay", async () => {
    const f = await onboardingFixture(await fixture());
    const first = await f.start();
    await f.provider(first);
    const company = (await f.app.connections.list(f.owner))[0];
    const pending = await f.start();
    expect(
      (
        await f.browser(`/connect/company/${pending.attempt_id}/provider`, {
          revision: 1,
          mode: "user",
        })
      ).status,
    ).toBe(200);
    await f.app.auth.api.signOut({
      headers: new Headers({ cookie: f.cookie }),
    });
    const login = await f.app.auth.api.signInEmail({
      body: {
        email: "onboarding@example.invalid",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const owner = (path: string, body?: unknown) =>
      f.request(path, body, { cookie, origin: f.config.origin });
    expect((await owner(pending.authorization_url)).status).toBe(200);
    const count = f.calls();
    expect(
      (
        await owner(`/connect/company/${pending.attempt_id}/recover-session`, {
          revision: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner(`/connect/company/${pending.attempt_id}/choose`, {
          revision: 1,
          company_id: company?.id,
        })
      ).status,
    ).toBe(200);
    expect(f.calls()).toBe(count + 1);
    const saved = await f.app.onboarding?.get(
      f.owner,
      f.client.client_id,
      pending.attempt_id,
    );
    expect(saved?.company?.id).toBe(company?.id);
    const unknown = await f.start();
    f.fail();
    const start = await owner(
      `/connect/company/${unknown.attempt_id}/provider`,
      { revision: 1, mode: "user" },
    );
    const target = new URL(((await start.json()) as { url: string }).url);
    await owner(
      `/admin/fortnox/callback?${new URLSearchParams({ state: target.searchParams.get("state") ?? "", code: "B" })}`,
    );
    await f.app.auth.api.signOut({ headers: new Headers({ cookie }) });
    const again = await f.app.auth.api.signInEmail({
      body: {
        email: "onboarding@example.invalid",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    const nextCookie = again.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const before = f.calls();
    expect(
      (
        await f.request(
          `/connect/company/${unknown.attempt_id}/recover-session`,
          { revision: 1 },
          { cookie: nextCookie, origin: f.config.origin },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.app.onboarding?.get(
          f.owner,
          f.client.client_id,
          unknown.attempt_id,
        )
      )?.phase,
    ).toBe("provider_outcome_unknown");
    expect(f.calls()).toBe(before);
    f.recover();
    expect(
      (
        await f.request(
          `/connect/company/${unknown.attempt_id}/choose`,
          { revision: 1, company_id: company?.id },
          { cookie: nextCookie, origin: f.config.origin },
        )
      ).status,
    ).toBe(200);
  });
}
