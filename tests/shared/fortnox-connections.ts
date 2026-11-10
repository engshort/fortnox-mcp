import {
  Connections,
  CredentialVault,
  type StateStore,
} from "@fortnox-mcp/core";
import { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";
export function fortnoxConnectionContract(fixture: () => Promise<StateStore>) {
  it("cancels only unclaimed consent flows of the same owner and browser session", async () => {
    const state = await fixture();
    const connections = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      testTenants: ["100001", "100002"],
      fetch: async () => {
        throw new Error("Cancellation must not contact Fortnox");
      },
    });
    const input = {
      mode: "service" as const,
      clientId: "synthetic-client",
      clientSecret: "synthetic-private-secret",
    };
    const cancelled = new URL(
      await provider.start("owner", "session-A", input),
    );
    await provider.start("owner", "session-B", input);
    await provider.start("other-owner", "session-A", input);
    const snapshot = await state.get<{ session: string; claimed: boolean }[]>(
      "fortnox-flows",
      "owner",
    );
    if (!snapshot) throw new Error("Missing synthetic flows");
    snapshot.value.push({
      ...snapshot.value[0],
      session: "session-A",
      claimed: true,
    } as { session: string; claimed: boolean });
    await state.put("fortnox-flows", "owner", snapshot.value, snapshot.version);
    await provider.cancelPending("owner", "session-A");
    const remaining = await state.get<{ session: string; claimed: boolean }[]>(
      "fortnox-flows",
      "owner",
    );
    expect(remaining?.value.map((f) => [f.session, f.claimed])).toEqual([
      ["session-B", false],
      ["session-A", true],
    ]);
    expect(
      (await state.get<unknown[]>("fortnox-flows", "other-owner"))?.value,
    ).toHaveLength(1);
    const callback = new URL(
      "https://product.example.invalid/admin/fortnox/callback",
    );
    callback.search = new URLSearchParams({
      state: cancelled.searchParams.get("state") ?? "",
      code: "synthetic-code",
    }).toString();
    await expect(
      provider.finish("owner", "session-A", callback),
    ).rejects.toThrow("AUTH_REQUIRED");
    await provider.cancelPending("owner", null);
    expect(
      (
        await state.get<{ claimed: boolean }[]>("fortnox-flows", "owner")
      )?.value.map((f) => f.claimed),
    ).toEqual([true]);
    expect(
      (await state.get<unknown[]>("fortnox-flows", "other-owner"))?.value,
    ).toHaveLength(1);
  });
  it("requests receipt scopes only through fresh consent and retains stored scope sets through both token lifecycles", async () => {
    const connections = new Connections(
      await fixture(),
      new CredentialVault({ a: keyA }, "a"),
    );
    const old = await connections.add(
      "owner",
      { ...syntheticCompany, mode: "service" },
      syntheticCredentials,
    );
    await connections.grant("owner", "old-client", [old.id]);
    const scopes = [
      "companyinformation",
      "profile",
      "bookkeeping",
      "settings",
      "costcenter",
      "project",
      "inbox",
      "connectfile",
    ];
    const requested: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url);
      if (url.pathname === "/oauth-v1/token") {
        const body = new URLSearchParams(await request.text()),
          grant = body.get("grant_type");
        const user =
          body.get("code") === "user-code" || grant === "refresh_token";
        const scope =
          grant === "client_credentials"
            ? (body.get("scope") ?? "")
            : scopes.join(" ");
        if (grant === "client_credentials") requested.push(scope);
        return Response.json({
          access_token: user ? "synthetic-user-B" : "synthetic-service-A",
          token_type: "bearer",
          expires_in: 3600,
          scope,
          ...(user
            ? {
                refresh_token:
                  grant === "refresh_token"
                    ? "synthetic-refresh-B2"
                    : "synthetic-refresh-B1",
              }
            : {}),
        });
      }
      expect(url.pathname).toBe("/3/companyinformation");
      const user =
        request.headers.get("authorization") === "Bearer synthetic-user-B";
      return Response.json({
        CompanyInformation: {
          DatabaseNumber: user ? "100002" : "100001",
          CompanyName: user ? "Synthetic B" : "Synthetic A",
        },
      });
    };
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      testTenants: ["100001", "100002"],
      scopes,
      programGates: { references: true, receiptConsent: true },
      fetch: transport,
    });
    await provider.token("owner", old, true);
    expect(requested[0]).toBe("companyinformation profile");
    expect(
      (await connections.authorize("owner", "old-client", old.id)).scopes,
    ).toEqual(["companyinformation", "profile"]);
    const finish = async (
      mode: "user" | "service",
      code: string,
      reconnectId?: string,
    ) => {
      const url = new URL(
        await provider.start(
          "owner",
          `session-${mode}`,
          {
            mode,
            clientId: "synthetic-client",
            clientSecret: "synthetic-client-secret",
          },
          reconnectId,
          reconnectId
            ? {
                program: "bookkeeping",
                features: ["references", "receipt-files"],
                expected_revision: 0,
              }
            : undefined,
        ),
      );
      expect(url.searchParams.get("scope")).toBe(scopes.join(" "));
      const callback = new URL(
        "https://product.example.invalid/admin/fortnox/callback",
      );
      callback.search = new URLSearchParams({
        code,
        state: url.searchParams.get("state") ?? "",
      }).toString();
      return provider.finish("owner", `session-${mode}`, callback);
    };
    await finish("user", "user-code");
    let b = (await connections.list("owner")).find(
      (c) => c.tenant === "100002",
    );
    if (!b) throw new Error("fixture");
    expect(b.scopes).toEqual(scopes);
    await provider.token("owner", b, true);
    b = (await connections.list("owner")).find((c) => c.id === b?.id);
    expect(b?.scopes).toEqual(scopes);
    await expect(
      connections.authorize("owner", "old-client", b?.id ?? ""),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    await finish("service", "service-code", old.id);
    const a = (await connections.list("owner")).find((c) => c.id === old.id);
    if (!a) throw new Error("fixture");
    expect(a.scopes).toEqual(scopes);
    expect(a.generation).toBeGreaterThan(old.generation);
    await provider.token("owner", a, true);
    expect(requested.at(-1)).toBe(scopes.join(" "));
    await expect(
      connections.authorize("owner", "old-client", old.id),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
  });
  it("binds service consent to owner/session, verifies tenant and excludes service refresh tokens", async () => {
    const state = await fixture();
    const connections = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    let exchanges = 0;
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input,
      );
      if (url.pathname === "/oauth-v1/token") {
        exchanges++;
        expect(init?.redirect).toBe("manual");
        return Response.json({
          access_token: `synthetic-token-${exchanges}`,
          token_type: "bearer",
          expires_in: 3600,
          scope: "companyinformation profile",
          refresh_token: "synthetic-unused-service-refresh",
        });
      }
      expect(url.pathname).toBe("/3/companyinformation");
      return Response.json({
        CompanyInformation: {
          DatabaseNumber: "100001",
          CompanyName: "Synthetic A",
          OrganizationNumber: "000000-0000",
        },
      });
    };
    const service = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      fetch: transport,
      testTenants: ["100001", "100002"],
    });
    const url = new URL(
      await service.start("owner", "admin-session", {
        mode: "service",
        clientId: "synthetic-client",
        clientSecret: "synthetic-client-secret",
      }),
    );
    expect(url.searchParams.get("account_type")).toBe("service");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = new URL(
      "https://product.example.invalid/admin/fortnox/callback",
    );
    callback.search = new URLSearchParams({
      code: "synthetic-code",
      state: url.searchParams.get("state") ?? "",
    }).toString();
    await expect(
      service.finish("owner", "wrong-session", callback),
    ).rejects.toThrow("AUTH_REQUIRED");
    expect(exchanges).toBe(0);
    const result = await Promise.allSettled([
      service.finish("owner", "admin-session", callback),
      service.finish("owner", "admin-session", callback),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(exchanges).toBe(2);
    const c = (await connections.list("owner"))[0];
    if (!c) throw new Error("Missing synthetic connection");
    expect(
      (await connections.credentials("owner", c)).refreshToken,
    ).toBeUndefined();
    await service.token("owner", c, true);
    expect(exchanges).toBe(3);
    await expect(
      service.finish("owner", "admin-session", callback),
    ).rejects.toThrow("AUTH_REQUIRED");
    expect(
      JSON.stringify(await state.get("fortnox-flows", "owner")),
    ).not.toContain("synthetic-client-secret");
  });
  it("rejects unauthorized test tenants before client-credentials acquisition and serializes renewal", async () => {
    const state = await fixture();
    const connections = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    let calls = 0;
    const service = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      testTenants: ["100001"],
      fetch: async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname === "/oauth-v1/token") {
          calls++;
          return Response.json({
            access_token: "synthetic-token",
            token_type: "bearer",
            expires_in: 3600,
            scope: "companyinformation profile",
          });
        }
        return Response.json({
          CompanyInformation: {
            DatabaseNumber: "999999",
            CompanyName: "Synthetic other",
          },
        });
      },
    });
    const url = new URL(
      await service.start("owner", "session", {
        mode: "service",
        clientId: "synthetic-client",
        clientSecret: "synthetic-client-secret",
      }),
    );
    const callback = new URL(
      `https://product.example.invalid/admin/fortnox/callback?${new URLSearchParams({ code: "synthetic-code", state: url.searchParams.get("state") ?? "" })}`,
    );
    await expect(service.finish("owner", "session", callback)).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
    expect(calls).toBe(1);
    const c = await connections.add(
      "owner",
      { ...syntheticCompany, mode: "service" },
      { ...syntheticCredentials, expiresAt: 0 },
    );
    let release: (value: typeof syntheticCredentials) => void = () => {};
    let exchanged = 0;
    const blocked = new Promise<typeof syntheticCredentials>((resolve) => {
      release = resolve;
    });
    const exchange = async () => {
      exchanged++;
      return blocked;
    };
    const first = connections.renew("owner", c.id, c.generation, exchange);
    // Wait for the durable lease rather than relying on isolate-local coordination.
    for (
      let n = 0;
      n < 50 && !(await connections.list("owner"))[0]?.renewal;
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 1));
    await expect(
      connections.renew("owner", c.id, c.generation, exchange),
    ).rejects.toThrow("RATE_LIMITED");
    release(syntheticCredentials);
    await first;
    expect(exchanged).toBe(1);
  });
}
