import { expect, it } from "vitest";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig, Owner } from "../../apps/shared/product-auth.js";
import { keyA } from "./connections.js";

export function ownerSetupContract(fixture: () => Promise<AuthConfig>) {
  async function seed(operator = false) {
    const config = await fixture();
    let calls = 0;
    const app = createProductApplication(
      {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        testMode: false,
        testTenants: [],
        clientId: operator ? "synthetic-operator-client" : "",
        clientSecret: operator ? "synthetic-operator-secret" : "",
      },
      {
        ...config,
        assets: async (name) =>
          new Response(name, {
            headers: {
              "content-type": name.endsWith("js")
                ? "text/javascript"
                : "text/css",
            },
          }),
      },
      async () => {
        calls++;
        throw new Error("No upstream for setup");
      },
    );
    const owner = await app.auth.api.signUpEmail({
      body: {
        email: "setup@example.invalid",
        name: "Synthetic owner",
        password: "synthetic-setup-password",
      },
      returnHeaders: true,
    });
    await config.state.put<Owner>(
      "installation",
      "owner",
      {
        phase: "active",
        ownerId: owner.response.user.id,
        tokenHash: "",
        expiresAt: 0,
      },
      null,
    );
    const cookie = owner.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const request = (
      path: string,
      body?: unknown,
      headers: Record<string, string> = { cookie },
    ) =>
      app.fetch(
        new Request(`${config.origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin: config.origin,
            "content-type": "application/json",
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return {
      app,
      config,
      owner: owner.response.user.id,
      cookie,
      request,
      calls: () => calls,
    };
  }
  it("serves the shared owner shell/assets and protects private state before reading configuration", async () => {
    const f = await seed();
    expect((await f.request("/setup", undefined, {})).status).toBe(200);
    expect((await f.request("/admin", undefined, {})).status).toBe(401);
    expect((await f.request("/admin/state", undefined, {})).status).toBe(401);
    const shell = await f.request("/admin");
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("/admin-assets/admin.js");
    expect(shell.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(
      (await f.request("/admin-assets/admin.js", undefined, {})).status,
    ).toBe(200);
    expect(
      (
        await f.request("/admin/state", undefined, {
          cookie: f.cookie,
          origin: "https://foreign.invalid",
        })
      ).status,
    ).toBe(403);
    expect(f.calls()).toBe(0);
  });
  it("encrypts write-only owner credentials and never exports secrets in status", async () => {
    const f = await seed();
    const credentials = {
      client_id: "synthetic-managed-client",
      client_secret: "synthetic-managed-secret",
    };
    expect(
      (await f.request("/admin/fortnox/configuration", credentials)).status,
    ).toBe(200);
    const row = await f.config.state.get("integration-config", f.owner);
    expect(JSON.stringify(row)).not.toContain(credentials.client_secret);
    expect(JSON.stringify(row)).not.toContain(credentials.client_id);
    const state = await f.request("/admin/state");
    const text = await state.text();
    expect(JSON.parse(text).integration).toEqual({
      configured: true,
      source: "owner",
    });
    expect(text).not.toContain(credentials.client_secret);
    expect(text).not.toContain("client_secret");
    expect(f.calls()).toBe(0);
  });
  it("rejects bearer-only, foreign-Origin and operator-managed credential changes", async () => {
    const f = await seed(true);
    const credentials = {
      client_id: "synthetic-replacement",
      client_secret: "synthetic-replacement-secret",
    };
    expect(
      (
        await f.request("/admin/fortnox/configuration", credentials, {
          authorization: "Bearer synthetic-mcp-token",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await f.request("/admin/fortnox/configuration", credentials, {
          cookie: f.cookie,
          origin: "https://foreign.invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/admin/fortnox/configuration", credentials)).status,
    ).toBe(400);
    expect(await f.config.state.get("integration-config", f.owner)).toBeNull();
    const status = (await (await f.request("/admin/state")).json()) as {
      integration: unknown;
    };
    expect(status.integration).toEqual({
      configured: true,
      source: "operator",
    });
    expect(f.calls()).toBe(0);
  });
}
