import { expect, it } from "vitest";
import {
  createProductApplication,
  requestedFortnoxScopes,
} from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { keyA } from "./connections.js";

export function consentHttpContract(fixture: () => Promise<AuthConfig>) {
  it("allows receipt consent outside test mode and keeps initial company consent minimal", async () => {
    const config = await fixture();
    for (const settings of [
      {
        testMode: false,
        accountingReferences: true,
        receiptProviderConsent: true,
      },
      {
        testMode: true,
        accountingReferences: false,
        receiptProviderConsent: true,
      },
    ])
      expect(requestedFortnoxScopes(settings)).toContain("connectfile");
    expect(requestedFortnoxScopes({ testMode: true })).toEqual([
      "companyinformation",
      "profile",
    ]);
    const app = createProductApplication(
      {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://client.example.invalid/callback"],
        testMode: true,
        clientId: "synthetic-client",
        clientSecret: "synthetic-client-secret",
        testTenants: ["100001", "100002"],
        accountingReferences: true,
        receiptProviderConsent: true,
      },
      config,
      async () => {
        throw new Error("No provider call during consent preparation");
      },
    );
    const owner = await app.auth.api.signUpEmail({
      body: {
        email: "receipt-consent@example.invalid",
        name: "Synthetic owner",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    await config.state.put(
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
    const response = await app.fetch(
      new Request(`${config.origin}/admin/fortnox/start`, {
        method: "POST",
        headers: {
          origin: config.origin,
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ mode: "service" }),
      }),
    );
    expect(response.status).toBe(200);
    const url = new URL(((await response.json()) as { url: string }).url);
    expect(url.searchParams.get("scope")).toBe("companyinformation profile");
    const startAgain = () =>
      app.fetch(
        new Request(`${config.origin}/admin/fortnox/start`, {
          method: "POST",
          headers: {
            origin: config.origin,
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "service" }),
        }),
      );
    const blocked = await startAgain();
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({
      error: "CONNECTION_REQUEST_FAILED",
      reason: "CONSENT_IN_PROGRESS",
      stage: "consent_start",
    });
    const cancelled = await app.fetch(
      new Request(`${config.origin}/admin/fortnox/cancel-consent`, {
        method: "POST",
        headers: {
          origin: config.origin,
          cookie,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(cancelled.status).toBe(200);
    expect((await startAgain()).status).toBe(200);
    expect(app.bookkeeping.gates.writes).toBe(true);
    expect(app.bookkeeping.gates.reviewHost).toBe(true);
    expect(await app.connections.list(owner.response.user.id)).toEqual([]);
  });
  it("reports bounded consent stages without leaking provider errors or replaying code exchanges", async () => {
    const config = await fixture();
    let exchanges = 0;
    const privateMarker = "synthetic-provider-secret-never-return";
    const app = createProductApplication(
      {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://client.example.invalid/callback"],
        testMode: true,
        clientId: "synthetic-client",
        clientSecret: "synthetic-client-secret",
        testTenants: ["100001", "100002"],
      },
      config,
      async () => {
        exchanges++;
        return Response.json(
          {
            error: "invalid_grant",
            error_description: privateMarker,
            access_token: privateMarker,
          },
          { status: 400 },
        );
      },
    );
    const owner = await app.auth.api.signUpEmail({
      body: {
        email: "consent@example.invalid",
        name: "Synthetic owner",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    await config.state.put(
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
    const begin = async () => {
      const r = await app.fetch(
        new Request(`${config.origin}/admin/fortnox/start`, {
          method: "POST",
          headers: {
            origin: config.origin,
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "service" }),
        }),
      );
      expect(r.status).toBe(200);
      const url = new URL(((await r.json()) as { url: string }).url);
      return url.searchParams.get("state") ?? "";
    };
    const finish = (params: Record<string, string>) =>
      app.fetch(
        new Request(
          `${config.origin}/admin/fortnox/callback?${new URLSearchParams(params)}`,
          { headers: { cookie } },
        ),
      );
    const denied = await finish({
      state: await begin(),
      error: "invalid_scope",
      error_description: privateMarker,
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({
      error: "CONNECTION_REQUEST_FAILED",
      reason: "RECONNECT_REQUIRED",
      stage: "authorization_response",
      provider_error: "invalid_scope",
    });
    expect(exchanges).toBe(0);
    const params = { state: await begin(), code: "synthetic-code" };
    const failed = await finish(params);
    expect(failed.status).toBe(400);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.json()).toEqual({
      error: "CONNECTION_REQUEST_FAILED",
      reason: "RECONNECT_REQUIRED",
      stage: "code_response",
      provider_error: "invalid_grant",
      provider_status: 400,
    });
    expect(exchanges).toBe(1);
    const replay = await finish(params);
    expect(await replay.json()).toEqual({
      error: "CONNECTION_REQUEST_FAILED",
      reason: "AUTH_REQUIRED",
      stage: "flow_validation",
    });
    expect(exchanges).toBe(1);
    expect(await app.connections.list(owner.response.user.id)).toEqual([]);
  });
}
