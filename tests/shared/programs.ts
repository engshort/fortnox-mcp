import {
  type AccountingProvider,
  assertScopeProgram,
  Bookkeeping,
  Connections,
  CredentialVault,
  type ProgramChange,
  previewProgram,
  programSelection,
  programStatus,
  type StateStore,
} from "@fortnox-mcp/core";
import { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";

const gates = {
  references: true,
  receiptConsent: true,
  registerScopes: ["customer", "article", "supplier", "settings", "currency"],
};
const bookkeeping: ProgramChange = {
  program: "bookkeeping",
  features: ["references"],
  expected_revision: 0,
};
export function programContract(fixture: () => Promise<StateStore>) {
  async function seed(mode: "user" | "service" = "service") {
    const connections = new Connections(
      await fixture(),
      new CredentialVault({ a: keyA }, "a"),
    );
    const a = await connections.add(
      "owner",
      { ...syntheticCompany, mode },
      syntheticCredentials,
    );
    const b = await connections.add(
      "owner",
      { ...syntheticCompany, mode, tenant: "100002", name: "Synthetic B" },
      syntheticCredentials,
    );
    await connections.grant("owner", "old-client", [a.id, b.id]);
    let now = Date.now(),
      calls = 0;
    let enabled = true;
    const codes = new Map<string, { scopes: string[]; tenant: string }>();
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      testTenants: ["100001", "100002"],
      programGates: () =>
        enabled ? gates : { references: false, receiptConsent: false },
      now: () => now,
      fetch: async (input, init) => {
        calls++;
        const req = new Request(input, init),
          url = new URL(req.url);
        if (url.pathname === "/oauth-v1/token") {
          const body = new URLSearchParams(await req.text());
          const data =
            body.get("grant_type") === "authorization_code"
              ? codes.get(body.get("code") ?? "")
              : {
                  scopes: (body.get("scope") ?? "").split(" "),
                  tenant: req.headers.get("TenantId") ?? "100001",
                };
          if (!data)
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          return Response.json({
            access_token: `synthetic-${data.tenant}`,
            token_type: "bearer",
            expires_in: 3600,
            scope: data.scopes.join(" "),
            refresh_token: "synthetic-new-refresh",
          });
        }
        expect(url.pathname).toBe("/3/companyinformation");
        return Response.json({
          CompanyInformation: {
            DatabaseNumber: req.headers.get("authorization")?.endsWith("100002")
              ? "100002"
              : "100001",
            CompanyName: "Synthetic verified company",
          },
        });
      },
    });
    const begin = async (
      id = a.id,
      change = bookkeeping,
      session = "session",
    ) => {
      const url = new URL(
        await provider.start(
          "owner",
          session,
          {
            mode,
            clientId: syntheticCredentials.clientId,
            clientSecret: syntheticCredentials.clientSecret,
          },
          id,
          change,
        ),
      );
      const code = crypto.randomUUID();
      codes.set(code, {
        scopes: (url.searchParams.get("scope") ?? "").split(" "),
        tenant: id === b.id ? b.tenant : a.tenant,
      });
      const callback = new URL(
        "https://product.example.invalid/admin/fortnox/callback",
      );
      callback.search = new URLSearchParams({
        code,
        state: url.searchParams.get("state") ?? "",
      }).toString();
      return { url, callback, code };
    };
    return {
      a,
      b,
      connections,
      provider,
      begin,
      codes,
      calls: () => calls,
      disableGates: () => {
        enabled = false;
      },
      expire: () => {
        now += 600001;
      },
    };
  }
  it.each(["service", "user"] as const)(
    "extends the existing %s connection atomically and never widens an old client grant",
    async (mode) => {
      const f = await seed(mode);
      await f.connections.setAccountingPolicy(
        "owner",
        f.a.id,
        1,
        "client_managed",
        false,
      );
      const flow = await f.begin();
      expect(flow.url.searchParams.get("scope")).toBe(
        "companyinformation profile bookkeeping settings costcenter project",
      );
      expect(await f.connections.credentials("owner", f.a)).toEqual(
        syntheticCredentials,
      );
      const result = await f.provider.finish("owner", "session", flow.callback);
      expect(result.id).toBe(f.a.id);
      expect(result.readOnly).toBe(false);
      expect(result.review).toBe("client_managed");
      expect(result.generation).toBe(f.a.generation + 1);
      expect(programSelection(result).enabled).toContain("bookkeeping");
      await expect(
        f.connections.authorize("owner", "old-client", f.a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      expect(
        (await f.connections.authorize("owner", "old-client", f.b.id)).scopes,
      ).toEqual(syntheticCompany.scopes);
      await f.connections.grant("owner", "new-client", [result.id]);
      expect(
        (await f.connections.authorize("owner", "new-client", result.id)).id,
      ).toBe(f.a.id);
      const calls = f.calls();
      await expect(
        f.provider.finish("owner", "session", flow.callback),
      ).rejects.toThrow("AUTH_REQUIRED");
      expect(f.calls()).toBe(calls);
    },
  );
  it("keeps scope unions company-bound with concurrent flows and verifies each target tenant", async () => {
    const f = await seed();
    const first = await f.begin();
    const second = await f.begin(
      f.b.id,
      {
        program: "invoicing",
        features: ["customer-registers"],
        expected_revision: 0,
      },
      "second-session",
    );
    expect(second.url.searchParams.get("scope")).toBe(
      "companyinformation profile customer article settings currency",
    );
    await expect(
      f.provider.finish("owner", "session", second.callback),
    ).rejects.toThrow("AUTH_REQUIRED");
    await f.provider.finish("owner", "second-session", second.callback);
    await f.provider.finish("owner", "session", first.callback);
    const [a, b] = await Promise.all([
      f.connections.list("owner").then((cs) => cs.find((c) => c.id === f.a.id)),
      f.connections.list("owner").then((cs) => cs.find((c) => c.id === f.b.id)),
    ]);
    expect(a?.scopes).not.toContain("customer");
    expect(b?.scopes).not.toContain("bookkeeping");
  });
  it.each(["wrong-tenant", "partial-scopes", "denied", "expired", "cancelled"])(
    "preserves the working connection after %s consent",
    async (failure) => {
      const f = await seed();
      const flow = await f.begin();
      if (failure === "wrong-tenant")
        f.codes.set(flow.code, {
          scopes: (flow.url.searchParams.get("scope") ?? "").split(" "),
          tenant: "100002",
        });
      if (failure === "partial-scopes")
        f.codes.set(flow.code, {
          scopes: ["companyinformation", "profile"],
          tenant: "100001",
        });
      if (failure === "denied") {
        flow.callback.searchParams.delete("code");
        flow.callback.searchParams.set("error", "access_denied");
      }
      if (failure === "expired") f.expire();
      if (failure === "cancelled")
        await f.provider.cancelPending("owner", "session");
      await expect(
        f.provider.finish("owner", "session", flow.callback),
      ).rejects.toThrow();
      expect(await f.connections.credentials("owner", f.a)).toEqual(
        syntheticCredentials,
      );
      expect(
        (await f.connections.authorize("owner", "old-client", f.a.id))
          .generation,
      ).toBe(f.a.generation);
      expect(await f.connections.list("owner")).toHaveLength(2);
      if (
        failure === "expired" ||
        failure === "cancelled" ||
        failure === "denied"
      )
        expect(f.calls()).toBe(0);
    },
  );
  it("rejects stale simultaneous changes and preserves unresolved write history", async () => {
    const f = await seed();
    const first = await f.begin(),
      second = await f.begin();
    await f.provider.finish("owner", "session", first.callback);
    const calls = f.calls();
    await expect(
      f.provider.finish("owner", "session", second.callback),
    ).rejects.toThrow("CONNECTION_CONFLICT");
    expect(f.calls()).toBe(calls);
    await f.connections.mutate("owner", f.b.id, (c) => {
      c.business = {
        proposals: [],
        executions: [
          {
            id: crypto.randomUUID(),
            hash: "0".repeat(64),
            operation: "customer.create",
            client: "old-client",
            generation: c.generation,
            created: Date.now(),
            state: "outcome_unknown",
          },
        ],
      };
    });
    await expect(f.begin(f.b.id)).rejects.toThrow("OUTCOME_UNKNOWN");
    expect(
      (await f.connections.list("owner")).find((c) => c.id === f.b.id)?.business
        ?.executions[0]?.state,
    ).toBe("outcome_unknown");
  });
  it("invalidates a pending extension on policy change before any provider exchange", async () => {
    const f = await seed();
    const flow = await f.begin();
    await f.connections.setAccountingPolicy(
      "owner",
      f.a.id,
      1,
      "review_required",
      true,
    );
    await expect(
      f.provider.finish("owner", "session", flow.callback),
    ).rejects.toThrow("CONNECTION_CONFLICT");
    expect(f.calls()).toBe(0);
  });
  it("rechecks activation gates on callback and never exchanges an obsolete test consent", async () => {
    const f = await seed();
    const flow = await f.begin();
    f.disableGates();
    await expect(
      f.provider.finish("owner", "session", flow.callback),
    ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    expect(f.calls()).toBe(0);
    expect(await f.connections.credentials("owner", f.a)).toEqual(
      syntheticCredentials,
    );
  });
  it("retains an unknown outcome appearing during consent and blocks local inactivation until reconciliation", async () => {
    const f = await seed();
    const flow = await f.begin();
    await f.connections.mutate("owner", f.a.id, (c) => {
      c.business = {
        proposals: [],
        executions: [
          {
            id: crypto.randomUUID(),
            hash: "0".repeat(64),
            operation: "customer.create",
            client: "old-client",
            generation: c.generation,
            created: Date.now(),
            state: "outcome_unknown",
          },
        ],
      };
    });
    await expect(
      f.provider.finish("owner", "session", flow.callback),
    ).rejects.toThrow("OUTCOME_UNKNOWN");
    await expect(
      f.connections.disableProgram("owner", f.a.id, "bookkeeping", 0),
    ).rejects.toThrow("OUTCOME_UNKNOWN");
    expect(f.calls()).toBe(0);
    expect(
      (await f.connections.list("owner"))[0]?.business?.executions[0]?.state,
    ).toBe("outcome_unknown");
  });
  it("does not resurrect a disabled feature when another feature of the program is connected", async () => {
    const f = await seed();
    await f.connections.mutate("owner", f.a.id, (c) => {
      c.scopes.push("bookkeeping", "settings", "costcenter", "project");
    });
    await f.connections.disableProgram("owner", f.a.id, "bookkeeping", 0);
    const flow = await f.begin(f.a.id, {
      program: "bookkeeping",
      features: ["supplier-registers"],
      expected_revision: 1,
    });
    await f.provider.finish("owner", "session", flow.callback);
    await f.connections.grant("owner", "new-client", [f.a.id]);
    let reads = 0;
    const provider = {
      years: async () => {
        reads++;
        throw new Error("Must not reach provider");
      },
    } as unknown as AccountingProvider;
    await expect(
      new Bookkeeping(f.connections, provider, {
        references: true,
        writes: false,
        reviewHost: false,
      }).years(
        { ownerId: "owner", clientId: "new-client", scopes: ["mcp:read"] },
        f.a.id,
      ),
    ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    expect(reads).toBe(0);
  });
  it("derives legacy selections without mutating credentials, grants or generations", async () => {
    const f = await seed();
    await f.connections.mutate("owner", f.a.id, (c) => {
      c.scopes.push("bookkeeping");
    });
    const before = await f.connections.state.get("connections", "owner");
    const c = (await f.connections.list("owner"))[0];
    if (!c) throw new Error("Missing synthetic connection");
    expect(programSelection(c).enabled).toEqual(["bookkeeping"]);
    expect(
      programStatus(c, gates).programs.find((p) => p.id === "bookkeeping")
        ?.availability,
    ).toBe("verification_pending");
    expect(await f.connections.state.get("connections", "owner")).toEqual(
      before,
    );
  });
  it("stops domain reads on local disable while retaining shared scopes for another program", async () => {
    const f = await seed();
    await f.connections.mutate("owner", f.a.id, (c) => {
      c.scopes.push("bookkeeping", "customer", "settings");
    });
    let reads = 0;
    const provider = {
      years: async () => {
        reads++;
        throw new Error("Must not reach provider");
      },
    } as unknown as AccountingProvider;
    await f.connections.disableProgram("owner", f.a.id, "bookkeeping", 0);
    const c = await f.connections.authorize("owner", "old-client", f.a.id);
    expect(c.scopes).toContain("bookkeeping");
    expect(() => assertScopeProgram(c, "customer")).not.toThrow();
    expect(() => assertScopeProgram(c, "settings")).not.toThrow();
    await expect(
      new Bookkeeping(f.connections, provider, {
        references: true,
        writes: false,
        reviewHost: false,
      }).years(
        { ownerId: "owner", clientId: "old-client", scopes: ["mcp:read"] },
        c.id,
      ),
    ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    expect(reads).toBe(0);
    await expect(
      f.connections.disableProgram("owner", f.a.id, "invoicing", 0),
    ).rejects.toThrow("CONNECTION_CONFLICT");
  });
  it("rejects unimplemented programs, unsupported features and caller-supplied scopes", async () => {
    const f = await seed();
    expect(() =>
      previewProgram(
        f.a,
        { program: "payroll", features: ["references"], expected_revision: 0 },
        gates,
      ),
    ).toThrow("CAPABILITY_UNAVAILABLE");
    expect(() =>
      previewProgram(f.a, bookkeeping, {
        references: false,
        receiptConsent: false,
      }),
    ).toThrow("CAPABILITY_UNAVAILABLE");
    expect(() =>
      previewProgram(
        f.a,
        { ...bookkeeping, scopes: ["salary"] } as ProgramChange,
        gates,
      ),
    ).toThrow();
  });
}

export function programHttpContract(fixture: () => Promise<AuthConfig>) {
  it("protects deep links and program APIs, exposes bounded grants and keeps initial consent minimal", async () => {
    const config = await fixture();
    let calls = 0;
    const app = createProductApplication(
      {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://client.example.invalid/callback"],
        testMode: true,
        testTenants: ["100001", "100002"],
        clientId: syntheticCredentials.clientId,
        clientSecret: syntheticCredentials.clientSecret,
        accountingReferences: true,
      },
      config,
      async () => {
        calls++;
        throw new Error("No outbound access during preparation");
      },
    );
    const owner = await app.auth.api.signUpEmail({
      body: {
        email: "program-owner@example.invalid",
        name: "Synthetic owner",
        password: "synthetic-owner-password",
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
    const a = await app.connections.add(
      owner.response.user.id,
      syntheticCompany,
      syntheticCredentials,
    );
    const base = `/admin/companies/${a.id}`;
    const req = (
      path: string,
      body?: unknown,
      origin = config.origin,
      authenticated = true,
    ) =>
      app.fetch(
        new Request(`${config.origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(authenticated ? { cookie } : {}),
            origin,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    expect((await req(base, undefined, config.origin, false)).status).toBe(401);
    expect((await req(`${base}/bookkeeping`)).status).toBe(200);
    expect(
      (await req(`${base}/programs`, undefined, config.origin, false)).status,
    ).toBe(401);
    expect(
      (
        await req(
          `${base}/programs/start`,
          bookkeeping,
          "https://foreign.invalid",
        )
      ).status,
    ).toBe(403);
    expect(
      (await req(`/admin/companies/${crypto.randomUUID()}/programs`)).status,
    ).toBe(400);
    expect(
      (
        await req(`${base}/programs/preview`, {
          ...bookkeeping,
          scopes: ["salary"],
        })
      ).status,
    ).toBe(400);
    const initial = await req("/admin/fortnox/start", { mode: "service" });
    expect(
      new URL(((await initial.json()) as { url: string }).url).searchParams.get(
        "scope",
      ),
    ).toBe("companyinformation profile");
    const preview = await req(`${base}/programs/preview`, bookkeeping);
    expect(preview.status).toBe(200);
    expect(await preview.text()).not.toContain(
      syntheticCredentials.clientSecret,
    );
    await app.connections.grant(
      owner.response.user.id,
      "synthetic-client-grant",
      [a.id],
    );
    const clients = await req("/admin/clients");
    expect(await clients.json()).toMatchObject({
      clients: [
        {
          client_id: "synthetic-client-grant",
          companies: [{ company_id: a.id, current: true }],
        },
      ],
      partial: false,
    });
    const execution = crypto.randomUUID();
    await app.connections.mutate(owner.response.user.id, a.id, (c) => {
      c.business = {
        proposals: [],
        executions: [
          {
            id: execution,
            hash: "0".repeat(64),
            operation: "customer.create",
            client: "synthetic-client-grant",
            generation: c.generation,
            created: Date.now(),
            state: "outcome_unknown",
          },
        ],
      };
    });
    await app.connections.disconnect(owner.response.user.id, a.id);
    const status = await req("/admin/state");
    expect(await status.json()).toMatchObject({
      uncertain_outcomes: [
        { company_id: a.id, kind: "business", id: execution },
      ],
    });
    expect(calls).toBe(0);
  });
}
