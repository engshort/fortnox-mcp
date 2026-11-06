import type { StateStore } from "@fortnox-mcp/core";
import {
  continuation,
  FortnoxHttp,
  type ProviderContext,
  readPages,
  resumeContinuation,
} from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";
export function providerContract(fixture: () => Promise<StateStore>) {
  it("recovers a 401 once and does not force another token rotation on a subsequent 5xx", async () => {
    const state = await fixture();
    let now = 10000;
    let requests = 0;
    let rotations = 0;
    const http = new FortnoxHttp({
      state,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      random: () => 0,
      fetch: async () => {
        requests++;
        return requests === 1
          ? new Response("{}", { status: 401 })
          : requests === 2
            ? new Response("{}", { status: 503 })
            : Response.json({ ok: true });
      },
    });
    const context: ProviderContext = {
      owner: "owner",
      company: "A",
      generation: 1,
      tenant: "100001",
      clientId: "client",
      assertActive: async () => {},
      token: async (force) => {
        if (force) rotations++;
        return "synthetic-token";
      },
    };
    await expect(http.read(context, "company_information")).resolves.toEqual({
      ok: true,
    });
    expect(requests).toBe(3);
    expect(rotations).toBe(1);
  });
  it("paces shared tenant reads, bounds retries and keeps other tenants independent", async () => {
    const state = await fixture();
    let now = 10000;
    const waits: number[] = [];
    const targets: string[] = [];
    let calls = 0;
    const http = new FortnoxHttp({
      state,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      random: () => 0,
      fetch: async (request) => {
        targets.push(
          new URL(
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url,
          ).href,
        );
        calls++;
        return calls === 1
          ? new Response("{}", { status: 429, headers: { "retry-after": "1" } })
          : Response.json({ CompanyInformation: { DatabaseNumber: "100001" } });
      },
    });
    const context: ProviderContext = {
      owner: "owner",
      company: "A",
      generation: 1,
      tenant: "100001",
      clientId: "client",
      assertActive: async () => {},
      token: async () => "synthetic-token",
    };
    await http.read(context, "company_information");
    expect(waits).toContain(1000);
    await http.read(context, "company_information");
    expect(waits).toContain(210);
    const before = waits.length;
    await http.read(
      { ...context, tenant: "100002", company: "B" },
      "company_information",
    );
    expect(waits.length).toBe(before);
    expect(
      targets.every((u) => u === "https://api.fortnox.se/3/companyinformation"),
    ).toBe(true);
    await expect(
      http.read(context, "invoice_email" as "company_information"),
    ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
  });
  it("denies redirects, oversized/hostile errors and revoked context without credential leakage", async () => {
    const state = await fixture();
    let now = 10000;
    let requests = 0;
    const context: ProviderContext = {
      owner: "owner",
      company: "A",
      generation: 1,
      tenant: "100001",
      clientId: "client",
      assertActive: async () => {},
      token: async () => "synthetic-secret-token",
    };
    for (const response of [
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
      new Response("x".repeat(65537)),
      new Response(
        '{"ErrorInformation":{"code":"secret-payload","message":"synthetic-secret-token"}}',
        { status: 403 },
      ),
    ]) {
      const http = new FortnoxHttp({
        state,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        fetch: async (input) => {
          requests++;
          expect((input as Request).redirect).toBe("manual");
          return response;
        },
      });
      try {
        await http.read(context, "company_information");
        throw new Error("Unexpected success");
      } catch (e) {
        expect(String(e)).not.toContain("synthetic-secret-token");
        expect(String(e)).not.toContain("secret-payload");
      }
    }
    expect(requests).toBe(3);
    const http = new FortnoxHttp({
      state,
      fetch: async () => {
        requests++;
        return Response.json({});
      },
    });
    await expect(
      http.read(
        {
          ...context,
          assertActive: async () => {
            throw new Error("RECONNECT_REQUIRED");
          },
        },
        "identity",
      ),
    ).rejects.toThrow("RECONNECT_REQUIRED");
    expect(requests).toBe(3);
  });
  it("marks bounded pagination partial and binds continuations to company, generation and query", async () => {
    const state = await fixture();
    const get = async (page: number) => ({
      items: [page],
      next: page === 3 ? null : page + 1,
    });
    const partial = await readPages(
      get,
      { pages: 2, items: 10, bytes: 1024, until: 100 },
      1,
      () => 0,
    );
    expect(partial).toEqual({ items: [1, 2], complete: false, nextPage: 3 });
    expect(
      await readPages(
        get,
        { pages: 2, items: 10, bytes: 1024, until: 100 },
        3,
        () => 0,
      ),
    ).toEqual({ items: [3], complete: true, nextPage: null });
    const context = { owner: "owner", company: "A", generation: 1 };
    const id = await continuation(state, context, "query", 3, 0);
    expect(await resumeContinuation(state, id, context, "query", 1)).toBe(3);
    for (const changed of [
      { ...context, company: "B" },
      { ...context, owner: "other" },
      { ...context, generation: 2 },
    ])
      await expect(
        resumeContinuation(state, id, changed, "query", 1),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
    await expect(
      resumeContinuation(state, id, context, "different", 1),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    await expect(
      resumeContinuation(state, id, context, "query", 600001),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
  });
}
