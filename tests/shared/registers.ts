import {
  type BusinessReference,
  type RegisterResource,
  Registers,
  registerOperationIds,
  type StateStore,
  type WritableRegister,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  FortnoxRegisters,
  parseExactProviderJson,
  registerProviderResources,
} from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { companyServer } from "../../packages/mcp/src/companies.js";
import { accountingFixture } from "./accounting.js";

export async function registerFixture(state: StateStore) {
  const f = await accountingFixture(state);
  for (const c of [f.a, f.b])
    await f.connections.mutate(f.actor.ownerId, c.id, (c) => {
      c.scopes.push("customer", "supplier", "article", "currency", "price");
    });
  const data = new Map<string, Record<string, unknown>>();
  const requests: Array<{
    method: string;
    path: string;
    query: string;
    body: string;
    token: string;
  }> = [];
  const flags = {
    lost: false,
    active: true,
    noMeta: false,
    pages: 1,
    deny: false,
    disconnect: false,
    readFail: false,
  };
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const req = input as Request,
        url = new URL(req.url),
        body = req.method === "GET" ? "" : await req.text(),
        token = req.headers.get("authorization") ?? "";
      requests.push({
        method: req.method,
        path: url.pathname,
        query: url.search,
        body,
        token,
      });
      if (flags.deny)
        return Response.json(
          {
            ErrorInformation: { Message: "synthetic-private-provider-message" },
          },
          { status: 403 },
        );
      if (flags.disconnect) {
        flags.disconnect = false;
        await f.connections.disconnect(f.actor.ownerId, f.a.id);
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const resource = (
        Object.keys(registerProviderResources) as RegisterResource[]
      ).find((r) => registerProviderResources[r].path === parts[1]);
      if (!resource) throw new Error("unexpected synthetic path");
      const spec = registerProviderResources[resource];
      if (resource === "price")
        return Response.json(
          parts[2] === "sublist"
            ? {
                Prices: [
                  {
                    ArticleNumber: "A1",
                    PriceList: "P1",
                    Price: "0.10",
                    FromQuantity: "0",
                  },
                ],
                MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 },
              }
            : {
                Price: {
                  ArticleNumber: "A1",
                  PriceList: "P1",
                  Price: "0.10",
                  FromQuantity: "0",
                },
              },
        );
      const id = parts[2] ? decodeURIComponent(parts[2]) : null;
      if (req.method === "GET") {
        if (flags.readFail) throw new Error("synthetic lost readback");
        if (id !== null) {
          const row = data.get(`${token}:${resource}:${id}`);
          return row
            ? Response.json({ [spec.single]: row })
            : Response.json({}, { status: 404 });
        }
        const page = Number(url.searchParams.get("page") ?? "1");
        const rows =
          flags.pages > 1
            ? Array.from({ length: 100 }, (_, i) => ({
                CustomerNumber: `C${page * 100 + i}`,
                Name: `Synthetic ${page * 100 + i}`,
                Active: true,
              }))
            : [...data]
                .filter(([key]) => key.startsWith(`${token}:${resource}:`))
                .map(([, v]) => v);
        return Response.json({
          [spec.list]: rows,
          ...(flags.noMeta
            ? {}
            : {
                MetaInformation: {
                  "@CurrentPage": page,
                  "@TotalPages": flags.pages,
                },
              }),
        });
      }
      const inputBody = parseExactProviderJson(body) as Record<
        string,
        Record<string, unknown>
      >;
      const fields = inputBody[spec.single];
      if (!fields) throw new Error("missing synthetic body");
      const assigned = id ?? String(fields[spec.identity] ?? `${resource}-new`);
      const key = `${token}:${resource}:${assigned}`;
      const previous = data.get(key) ?? {};
      const row = {
        Active: true,
        ...previous,
        ...fields,
        [spec.identity]: assigned,
      };
      data.set(key, row);
      if (flags.lost) throw new Error("synthetic lost write response");
      return Response.json(
        { [spec.single]: row },
        { status: req.method === "POST" ? 201 : 200 },
      );
    },
  });
  const adapter = new FortnoxRegisters(
    f.connections,
    provider,
    registerOperationIds,
    Date.now,
    () => flags.active,
  );
  const service = new Registers(f.connections, adapter, registerOperationIds);
  const put = (
    resource: RegisterResource,
    id: string,
    fields: Record<string, unknown>,
    company = "A",
  ) =>
    data.set(`Bearer synthetic-token-${company}:${resource}:${id}`, {
      [registerProviderResources[resource].identity]: id,
      ...fields,
    });
  // The accounting fixture's first token has its own conventional spelling.
  const first = (
    await f.connections.credentials(
      f.actor.ownerId,
      (
        await f.connections.list(f.actor.ownerId)
      ).find((c) => c.id === f.a.id) as typeof f.a,
    )
  ).accessToken;
  const seed = (
    resource: RegisterResource,
    id: string,
    fields: Record<string, unknown>,
    company = "A",
  ) =>
    company === "A"
      ? data.set(`Bearer ${first}:${resource}:${id}`, {
          [registerProviderResources[resource].identity]: id,
          ...fields,
        })
      : put(resource, id, fields, company);
  return { ...f, provider, adapter, service, data, requests, flags, seed };
}
function ref(p: {
  company_id: string;
  proposal_id: string;
  proposal_hash: string;
}): BusinessReference {
  return {
    company_id: p.company_id,
    proposal_id: p.proposal_id,
    proposal_hash: p.proposal_hash,
  };
}
export function registersContract(fixture: () => Promise<StateStore>) {
  describe("company register workflows", () => {
    it("reads provider nulls without treating them as caller-authorized field clearing", async () => {
      const f = await registerFixture(await fixture());
      f.seed("customer", "C-NULL", {
        Name: "Synthetic null fields",
        Active: true,
        Address1: null,
        Address2: null,
        City: null,
        ZipCode: null,
        CountryCode: null,
        Phone1: null,
        CostCenter: null,
      });
      const record = (
        await f.service.get(f.actor, f.a.id, "customer", "C-NULL")
      ).record;
      expect(record.fields.Address1).toBeNull();
      await expect(
        f.service.writes.prepare(f.actor, f.a.id, "customer.update", {
          id: "C-NULL",
          fields: { Address1: null },
        }),
      ).rejects.toThrow();
      const p = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "customer.update",
        { id: "C-NULL", fields: { Name: "Synthetic preserved nulls" } },
      );
      expect(p.preview).toMatchObject({
        before: { Address1: null },
        after: { Address1: null, Name: "Synthetic preserved nulls" },
      });
      await expect(
        f.service.writes.execute(f.actor, "customer.update", ref(p)),
      ).resolves.toMatchObject({ state: "succeeded" });
      const write = f.requests.find((r) => r.method === "PUT");
      expect(write?.body).not.toContain("Address1");
      expect(
        (await f.service.get(f.actor, f.a.id, "customer", "C-NULL")).record
          .fields.Address1,
      ).toBeNull();
      f.seed("article", "A-NULL", {
        Description: "Synthetic unpriced service",
        Type: "SERVICE",
        SalesPrice: null,
        PurchasePrice: null,
        VAT: null,
      });
      const article = await f.service.get(f.actor, f.a.id, "article", "A-NULL");
      expect(article.record.fields.SalesPrice).toBeNull();
      const update = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "article.update",
        { id: "A-NULL", fields: { Description: "Synthetic renamed service" } },
      );
      await expect(
        f.service.writes.execute(f.actor, "article.update", ref(update)),
      ).resolves.toMatchObject({ state: "succeeded" });
      expect(
        f.requests.filter((r) => r.method === "PUT").at(-1)?.body,
      ).not.toContain("SalesPrice");
      await expect(
        f.service.writes.prepare(f.actor, f.a.id, "article.update", {
          id: "A-NULL",
          fields: { SalesPrice: null },
        }),
      ).rejects.toThrow();
    });
    it("creates, reads and updates each writable register through durable intents", async () => {
      const f = await registerFixture(await fixture());
      for (const resource of [
        "customer",
        "supplier",
        "article",
      ] as WritableRegister[]) {
        const fields =
          resource === "article"
            ? { Description: "Synthetic service", Type: "SERVICE" }
            : { Name: `Synthetic ${resource}` };
        const p = await f.service.writes.prepare(
          f.actor,
          f.a.id,
          `${resource}.create`,
          { id: `${resource}-1`, fields },
        );
        expect(
          await f.service.writes.execute(f.actor, `${resource}.create`, ref(p)),
        ).toEqual({ state: "succeeded", reference: `${resource}-1` });
        const changed =
          resource === "article"
            ? { Description: "Synthetic changed" }
            : { Name: "Synthetic changed" };
        const update = await f.service.writes.prepare(
          f.actor,
          f.a.id,
          `${resource}.update`,
          { id: `${resource}-1`, fields: changed },
        );
        expect((update.preview as { diff: unknown[] }).diff).toHaveLength(1);
        expect(
          (
            await f.service.writes.execute(
              f.actor,
              `${resource}.update`,
              ref(update),
            )
          ).state,
        ).toBe("succeeded");
      }
      expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(3);
      expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(3);
    });
    it("revalidates the whole source version and preserves omitted register fields", async () => {
      const f = await registerFixture(await fixture());
      f.seed("customer", "C1", {
        Name: "Synthetic original",
        Active: true,
        City: "Synthetic city",
        Unmodeled: "v1",
      });
      const p = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "customer.update",
        { id: "C1", fields: { Name: "Synthetic changed" } },
      );
      f.seed("customer", "C1", {
        Name: "Synthetic original",
        Active: true,
        City: "Synthetic city",
        Unmodeled: "v2",
      });
      await expect(
        f.service.writes.execute(f.actor, "customer.update", ref(p)),
      ).rejects.toThrow("PROPOSAL_STALE");
      expect(f.requests.some((r) => r.method === "PUT")).toBe(false);
      const fresh = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "customer.update",
        { id: "C1", fields: { Name: "Synthetic changed" } },
      );
      await f.service.writes.execute(f.actor, "customer.update", ref(fresh));
      expect(
        (await f.service.get(f.actor, f.a.id, "customer", "C1")).record.fields
          .City,
      ).toBe("Synthetic city");
      const sent = JSON.parse(
        f.requests.find((r) => r.method === "PUT")?.body ?? "{}",
      );
      expect(sent.Customer).toEqual({ Name: "Synthetic changed" });
    });
    it("keeps exact price lexemes on writes and source reads", async () => {
      const f = await registerFixture(await fixture());
      const p = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "article.create",
        {
          fields: {
            Description: "Synthetic precision",
            Type: "SERVICE",
            SalesPrice: "90071992547409.123456",
            VAT: "25",
          },
        },
      );
      expect(
        (await f.service.writes.execute(f.actor, "article.create", ref(p)))
          .state,
      ).toBe("succeeded");
      const wire = f.requests.find((r) => r.method === "POST")?.body ?? "";
      expect(wire).toContain('"SalesPrice":90071992547409.123456');
      expect(
        (await f.service.get(f.actor, f.a.id, "article", "article-new")).record
          .fields.SalesPrice,
      ).toBe("90071992547409.123456");
    });
    it("bounds provider search and pagination and never claims completeness without metadata", async () => {
      const f = await registerFixture(await fixture());
      f.flags.pages = 8;
      const result = await f.service.list(f.actor, f.a.id, "customer", {
        name: "Synthetic",
      });
      expect(result.records).toHaveLength(500);
      expect(result.complete).toBe(false);
      expect(result.next_page).toBe(6);
      expect(
        f.requests.every(
          (r) =>
            r.query.includes("name=Synthetic") && r.query.includes("limit=100"),
        ),
      ).toBe(true);
      const next = await f.service.list(
        f.actor,
        f.a.id,
        "customer",
        { name: "Synthetic" },
        6,
      );
      expect(next.complete).toBe(true);
      expect(next.records).toHaveLength(300);
      f.flags.pages = 1;
      f.flags.noMeta = true;
      expect((await f.service.list(f.actor, f.a.id, "customer")).complete).toBe(
        false,
      );
      const calls = f.requests.length;
      await expect(
        f.service.list(f.actor, f.a.id, "supplier", { filter: "active" }),
      ).rejects.toThrow();
      expect(f.requests).toHaveLength(calls);
    });
    it("resolves references only in the selected company and rejects inactive references", async () => {
      const f = await registerFixture(await fixture());
      f.seed("unit", "st", { Description: "Synthetic unit" });
      f.seed("cost_center", "CC1", {
        Description: "Synthetic inactive",
        Active: false,
      });
      await expect(
        f.service.resolve(f.actor, f.b.id, "unit", "st"),
      ).rejects.toMatchObject({ reason: "record_not_found" });
      await expect(
        f.service.writes.prepare(f.actor, f.a.id, "customer.create", {
          fields: { Name: "Synthetic", CostCenter: "CC1" },
        }),
      ).rejects.toThrow("VALIDATION_FAILED");
      const p = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "article.create",
        { fields: { Description: "Synthetic", Type: "SERVICE", Unit: "st" } },
      );
      expect(
        (await f.service.writes.execute(f.actor, "article.create", ref(p)))
          .state,
      ).toBe("succeeded");
      expect((await f.service.list(f.actor, f.a.id, "unit")).complete).toBe(
        true,
      );
      expect(f.requests.filter((r) => r.method !== "GET")).toHaveLength(1);
    });
    it("does not send on missing scopes, read-only, foreign company or expired test profile", async () => {
      const f = await registerFixture(await fixture());
      await expect(
        f.service.writes.prepare(f.actor, f.b.id, "supplier.create", {
          fields: { Name: "Synthetic" },
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.service.list(f.actor, crypto.randomUUID(), "customer"),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes = c.scopes.filter((v) => v !== "customer");
      });
      await expect(f.service.list(f.actor, f.a.id, "customer")).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      f.flags.active = false;
      await expect(
        f.service.get(f.actor, f.a.id, "unit", "st"),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      expect(f.requests).toHaveLength(0);
    });
    it("preserves an uncertain create and reconciles a trusted identity without resending", async () => {
      const f = await registerFixture(await fixture());
      const p = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "customer.create",
        { id: "unique-test-C", fields: { Name: "Synthetic known target" } },
      );
      f.flags.lost = true;
      expect(
        await f.service.writes.execute(f.actor, "customer.create", ref(p)),
      ).toEqual({ state: "outcome_unknown" });
      await expect(
        f.service.writes.prepare(f.actor, f.a.id, "customer.create", {
          fields: { Name: "Synthetic again" },
        }),
      ).rejects.toThrow("OUTCOME_UNKNOWN");
      expect(
        await f.service.writes.reconcile(f.actor, "customer.create", ref(p)),
      ).toEqual({ state: "succeeded", reference: "unique-test-C" });
      expect(
        (await f.service.writes.execute(f.actor, "customer.create", ref(p)))
          .state,
      ).toBe("succeeded");
      expect(f.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    });
    it("keeps ambiguous or mismatched outcomes unknown and stores no field values in evidence", async () => {
      const f = await registerFixture(await fixture());
      const p = await f.service.writes.prepare(
        f.actor,
        f.a.id,
        "customer.create",
        { fields: { Name: "Synthetic private intent" } },
      );
      f.flags.lost = true;
      await f.service.writes.execute(f.actor, "customer.create", ref(p));
      const calls = f.requests.length;
      expect(
        (await f.service.writes.reconcile(f.actor, "customer.create", ref(p)))
          .state,
      ).toBe("outcome_unknown");
      expect(f.requests).toHaveLength(calls);
      expect(
        JSON.stringify((await f.connections.snapshot(f.actor.ownerId))?.value),
      ).not.toContain("Synthetic private intent");
    });
    it("separates denied data from missing data and discards late disconnected responses", async () => {
      const f = await registerFixture(await fixture());
      f.flags.deny = true;
      await expect(
        f.service.get(f.actor, f.a.id, "customer", "C1"),
      ).rejects.toMatchObject({
        reason: "permission_scope_or_license_unknown",
      });
      f.flags.deny = false;
      await expect(
        f.service.get(f.actor, f.a.id, "customer", "C1"),
      ).rejects.toMatchObject({ reason: "record_not_found" });
      f.seed("customer", "C1", { Name: "Synthetic", Active: true });
      f.flags.disconnect = true;
      await expect(
        f.service.get(f.actor, f.a.id, "customer", "C1"),
      ).rejects.toThrow();
    });
    it("uses the selected price-list/article route without guessing company prices", async () => {
      const f = await registerFixture(await fixture());
      const list = await f.service.list(f.actor, f.a.id, "price", {
        price_list: "P1",
        article_number: "A1",
      });
      expect(list.complete).toBe(true);
      expect(list.records[0]?.fields.Price).toBe("0.10");
      await f.service.get(f.actor, f.a.id, "price", "A1", {
        price_list: "P1",
        article_number: "A1",
      });
      expect(f.requests[0]?.path).toBe("/3/prices/sublist/P1/A1");
      expect(f.requests[1]?.query).toBe("?fromquantity=0");
    });
    it("advertises only enabled focused tools with strict inputs and real MCP execution", async () => {
      const f = await registerFixture(await fixture());
      const pair = InMemoryTransport.createLinkedPair(),
        client = new Client({
          name: "synthetic-register-client",
          version: "1",
        });
      const server = companyServer({
        identity: f.actor,
        connections: f.connections,
        provider: f.provider,
        testMode: true,
        registers: f.service,
      });
      await server.connect(pair[0]);
      await client.connect(pair[1]);
      try {
        const tools = await client.listTools();
        expect(
          tools.tools.find((t) => t.name === "create_customer")?.annotations
            ?.readOnlyHint,
        ).toBe(false);
        expect(
          tools.tools.find((t) => t.name === "list_customers")?.annotations
            ?.readOnlyHint,
        ).toBe(true);
        expect(
          tools.tools.some((t) =>
            /delete_customer|proxy|send_invoice/.test(t.name),
          ),
        ).toBe(false);
        const result = await client.callTool({
          name: "prepare_customer_create",
          arguments: {
            company_id: f.a.id,
            fields: { Name: "Synthetic MCP customer" },
          },
        });
        const prepared = result.structuredContent as {
          status: string;
          data: {
            company_id: string;
            proposal_id: string;
            proposal_hash: string;
          };
        };
        expect(prepared.status).toBe("ok");
        const created = await client.callTool({
          name: "create_customer",
          arguments: ref(prepared.data),
        });
        expect(created.isError).not.toBe(true);
        expect(
          (created.structuredContent as { data: { state: string } }).data.state,
        ).toBe("succeeded");
        const calls = f.requests.length;
        const invalid = await client.callTool({
          name: "prepare_customer_create",
          arguments: {
            company_id: f.a.id,
            fields: { Name: "Synthetic", HTTPMethod: "POST" },
          },
        });
        expect(invalid.isError).toBe(true);
        expect(f.requests).toHaveLength(calls);
      } finally {
        await client.close();
        await server.close();
      }
      const off = new Registers(f.connections, f.adapter);
      await expect(off.list(f.actor, f.a.id, "customer")).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
    });
  });
}
