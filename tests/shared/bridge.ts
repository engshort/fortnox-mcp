import {
  BusinessWrites,
  bridgeSchemaCheck,
  DomainError,
  parseBridgeJson,
  type RequestActor,
  requestActor,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { compileBridgeCatalog } from "../../apps/shared/bridge-catalog.js";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { restApi } from "../../packages/rest/src/index.js";
import { syntheticReferences } from "./accounting.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";
import { pngFixture } from "./receipt-fixtures.js";

export async function syntheticBridgeCatalog() {
  const customer = {
    type: "object",
    required: ["Customer"],
    additionalProperties: false,
    properties: {
      Customer: {
        type: "object",
        required: ["Name"],
        additionalProperties: false,
        properties: {
          Name: { type: "string", minLength: 1 },
          Balance: { type: "number" },
        },
      },
    },
  };
  const op = (
    operationId: string,
    body?: unknown,
    parameters: unknown[] = [],
  ) => ({
    operationId,
    parameters,
    responses: { "200": { description: "Synthetic response" } },
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: body } },
          },
        }
      : {}),
  });
  const pathParam = {
    name: "CustomerNumber",
    in: "path",
    required: true,
    schema: { type: "string", pattern: "^[A-Z0-9]+$" },
  };
  const voucherSchema = {
    type: "object",
    required: ["Voucher"],
    properties: {
      Voucher: {
        type: "object",
        properties: {
          Description: { type: "string" },
          TransactionDate: { type: "string" },
          VoucherSeries: { type: "string" },
          VoucherRows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                Account: { type: "integer" },
                Debit: { type: "number" },
                Credit: { type: "number" },
              },
            },
          },
        },
      },
    },
  };
  const invoiceSchema = {
    type: "object",
    properties: {
      Invoice: {
        type: "object",
        properties: {
          InvoiceRows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                RowId: { type: "integer" },
                Description: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
  const specification = JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Original synthetic bridge source", version: "1" },
    paths: {
      "/3/customers": {
        get: op("customers_list"),
        post: op("customer_create", customer),
      },
      "/3/customers/{CustomerNumber}": {
        parameters: [pathParam],
        get: op("customer_get"),
        put: op("customer_replace", customer),
      },
      "/3/invoices/{DocumentNumber}/email": {
        get: op("invoice_email", undefined, [
          {
            name: "DocumentNumber",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ]),
      },
      "/3/invoices/{DocumentNumber}": {
        parameters: [
          {
            name: "DocumentNumber",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: op("invoice_get"),
        put: op("invoice_replace", invoiceSchema),
      },
      "/3/vouchers": {
        post: op("voucher_create", voucherSchema, [
          {
            name: "financialyear",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 1 },
          },
        ]),
      },
      "/3/inbox": {
        post: {
          ...op("inbox_upload"),
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: { file: { type: "object" } },
                },
              },
            },
          },
        },
      },
      "/3/inbox/{FileId}": {
        get: op("inbox_read", undefined, [
          {
            name: "FileId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ]),
      },
      "/api/specialist/v1": {
        post: op("specialist_create", { type: "object" }),
      },
    },
  });
  const source_sha256 = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(specification),
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const paths = JSON.parse(specification).paths as Record<
    string,
    Record<string, { operationId: string }>
  >;
  const operations = Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ["get", "post", "put"].includes(method))
      .map(([method, value]) => ({
        operation_id: value.operationId,
        method: method.toUpperCase(),
        reconciliation:
          value.operationId === "customer_replace"
            ? "exact_existing_target"
            : "none",
        credentials: path.startsWith("/api/specialist")
          ? "specialist"
          : "company_oauth",
        path,
        scopes: [
          path.includes("inbox")
            ? "inbox"
            : path.includes("vouchers")
              ? "bookkeeping"
              : path.includes("invoices")
                ? "invoice"
                : "customer",
        ],
        effect: method === "get" && !path.endsWith("/email") ? "read" : "write",
        finance: path.includes("vouchers") || path.includes("invoices"),
        manual_vouchers: path.includes("vouchers"),
        files: path.includes("inbox"),
        unavailable: null,
      })),
  );
  return {
    version: "fortnox-bridge-catalog-v1",
    specification,
    source_sha256,
    operations,
  };
}
export function bridgeContract(fixture: () => Promise<AuthConfig>) {
  describe("catalogue-driven Fortnox REST bridge", () => {
    async function setup() {
      const config = await fixture();
      let calls = 0,
        hook: ((request: Request) => Promise<Response>) | undefined;
      const fetcher: typeof fetch = async (input) => {
        calls++;
        const request = input as Request;
        expect(request.headers.get("authorization")).toBe(
          "Bearer synthetic-access-token",
        );
        expect(new URL(request.url).origin).toBe("https://api.fortnox.se");
        if (hook) return hook(request);
        return new Response(
          '{"Customer":{"Name":"Synthetic private name","Balance":9007199254740993.01}}',
          {
            status: request.method === "POST" ? 201 : 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "must-not-escape",
              authorization: "must-not-escape",
            },
          },
        );
      };
      const settings = {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://client.example.invalid/callback"],
        testMode: false,
        clientId: "synthetic-client",
        clientSecret: "synthetic-client-secret",
        testTenants: [],
        restApi: true,
        restBridge: true,
      };
      const app = createProductApplication(settings, config, fetcher);
      const owner = "synthetic-bridge-owner";
      await config.state.put(
        "installation",
        "owner",
        { phase: "active", ownerId: owner, expiresAt: 0, tokenHash: "" },
        null,
      );
      const a = await app.connections.add(
        owner,
        {
          ...syntheticCompany,
          scopes: [
            "companyinformation",
            "profile",
            "customer",
            "invoice",
            "bookkeeping",
            "settings",
            "project",
            "costcenter",
            "inbox",
          ],
        },
        syntheticCredentials,
      );
      const b = await app.connections.add(
        owner,
        { ...syntheticCompany, tenant: "100002" },
        syntheticCredentials,
      );
      await app.connections.setAccountingPolicy(
        owner,
        a.id,
        1,
        "review_required",
        false,
      );
      let actor: RequestActor = requestActor(
        {
          ownerId: owner,
          oauthClientId: "stable-registration",
          clientId: "synthetic-api-client",
          scopes: [
            "api:read",
            "api:bridge",
            "api:finance:read",
            "api:write",
            "api:files",
          ],
        },
        "api",
      );
      await app.connections.grant(owner, actor.clientId, [a.id], "api");
      await app.bridgeCatalog.install(owner, await syntheticBridgeCatalog());
      let valid = true;
      const api = restApi({
        origin: config.origin,
        enabled: true,
        services: app.reads,
        bridge: app.bridge,
        authenticate: async () => {
          if (!valid) throw new DomainError("AUTH_REQUIRED");
          return actor;
        },
      });
      const req = (
        path: string,
        method = "GET",
        body?: BodyInit,
        headers: Record<string, string> = {},
      ) =>
        api.fetch(
          new Request(`${config.origin}/api/v1/companies/${a.id}/${path}`, {
            method,
            headers,
            ...(body ? { body } : {}),
          }),
        );
      const write = (
        key: string,
        body = '{"Customer":{"Name":"Synthetic private name","Balance":9007199254740993.01}}',
      ) =>
        req("fortnox/3/customers", "POST", body, {
          "content-type": "application/json",
          "idempotency-key": key,
        });
      return {
        app,
        config,
        a,
        b,
        settings,
        fetcher,
        req,
        write,
        actor: () => actor,
        setActor: (a: RequestActor) => {
          actor = a;
        },
        setValid: (v: boolean) => {
          valid = v;
        },
        setHook: (h: typeof hook) => {
          hook = h;
        },
        calls: () => calls,
      };
    }
    it("requires a complete source-bound review and protects delivery GETs, finance and specialist prerequisites", async () => {
      const bundle = await syntheticBridgeCatalog();
      await expect(
        compileBridgeCatalog({
          ...bundle,
          operations: bundle.operations.slice(1),
        }),
      ).rejects.toThrow();
      await expect(
        compileBridgeCatalog({ ...bundle, source_sha256: "0".repeat(64) }),
      ).rejects.toThrow();
      await expect(
        compileBridgeCatalog({
          ...bundle,
          operations: bundle.operations.map((o) =>
            o.operation_id === "voucher_create"
              ? { ...o, manual_vouchers: false }
              : o,
          ),
        }),
      ).rejects.toThrow();
      await expect(
        compileBridgeCatalog({
          ...bundle,
          operations: bundle.operations.map((o) =>
            o.operation_id === "invoice_email" ? { ...o, effect: "read" } : o,
          ),
        }),
      ).rejects.toThrow();
      const f = await setup();
      const discovery = await f.req("bridge/operations");
      expect(discovery.status).toBe(200);
      expect(await discovery.json()).toMatchObject({
        operations: expect.arrayContaining([
          {
            operation_id: "specialist_create",
            method: "POST",
            path: "/api/specialist/v1",
            scopes: ["customer"],
            effect: "write",
            reconciliation: "none",
            finance: false,
            manual_vouchers: false,
            files: false,
            available: false,
            reason: "specialist_credentials_required",
          },
        ]),
      });
      expect(f.calls()).toBe(0);
    });
    it("preserves native exact JSON and HTTP status while removing provider credentials and cookies", async () => {
      const f = await setup();
      f.setHook(async (request) => {
        expect(await request.text()).toContain("9007199254740993.01");
        return new Response('{"Customer":{"Balance":9007199254740993.01}}', {
          status: 201,
          headers: {
            "content-type": "application/json",
            "set-cookie": "private",
            authorization: "private",
          },
        });
      });
      const response = await f.write(crypto.randomUUID());
      expect(response.status).toBe(201);
      expect(await response.text()).toContain("9007199254740993.01");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("authorization")).toBeNull();
      expect(response.headers.get("x-fortnox-execution-state")).toBe(
        "succeeded",
      );
      expect(
        JSON.stringify(await f.app.connections.snapshot(f.actor().ownerId)),
      ).not.toContain("Synthetic private name");
    });
    it("denies foreign companies, resource/scope bypasses, unknown inputs and paths before provider I/O", async () => {
      const f = await setup();
      expect(
        (await f.req("fortnox/3/customers?url=https://evil.invalid")).status,
      ).toBe(400);
      expect((await f.req("fortnox/3/customers?x=1&x=2")).status).toBe(400);
      expect((await f.req("fortnox/3/unknown")).status).toBe(404);
      expect((await f.req("fortnox/3/customers", "DELETE")).status).toBe(405);
      expect(
        (
          await f.req(
            "fortnox/3/customers",
            "POST",
            '{"Customer":{"Name":"a","Unknown":1}}',
            {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
            },
          )
        ).status,
      ).toBe(400);
      const denied = restApi({
        origin: f.config.origin,
        enabled: true,
        services: f.app.reads,
        bridge: f.app.bridge,
        authenticate: async () => f.actor(),
      });
      expect(
        (
          await denied.fetch(
            new Request(
              `${f.config.origin}/api/v1/companies/${f.b.id}/fortnox/3/customers`,
            ),
          )
        ).status,
      ).toBe(403);
      const authorized = f.actor();
      f.setActor({
        ...authorized,
        permissions: authorized.permissions.filter((p) => p !== "bridge"),
      });
      expect((await f.req("fortnox/3/customers")).status).toBe(403);
      f.setActor({ ...f.actor(), permissions: ["read", "bridge"] });
      expect((await f.write(crypto.randomUUID())).status).toBe(403);
      expect((await f.req("fortnox/3/invoices/1/email")).status).toBe(403);
      f.setActor({ ...f.actor(), resource: "mcp" });
      expect((await f.req("fortnox/3/customers")).status).toBe(401);
      expect(f.calls()).toBe(0);
    });
    it("claims concurrent keys once, rejects changed content and survives service recreation", async () => {
      const f = await setup(),
        key = crypto.randomUUID();
      const results = await Promise.all([f.write(key), f.write(key)]);
      expect(results.map((r) => r.status)).toContain(201);
      expect(f.calls()).toBe(1);
      expect((await f.write(key)).status).toBe(200);
      expect(
        (await f.write(key, '{"Customer":{"Name":"Changed"}}')).status,
      ).toBe(409);
      const recreated = createProductApplication(
        f.settings,
        f.config,
        f.fetcher,
      );
      expect(
        (await recreated.bridge.operations(f.actor(), f.a.id)).operations.some(
          (op) => op.operation_id === "customer_create",
        ),
      ).toBe(true);
      const c = (await recreated.connections.list(f.actor().ownerId)).find(
        (v) => v.id === f.a.id,
      );
      const id = c?.bridge?.executions[0]?.id as string;
      expect(
        await recreated.bridge.status(f.actor(), f.a.id, id),
      ).toMatchObject({ state: "succeeded" });
      expect(f.calls()).toBe(1);
      expect(
        await f.app.bridge
          .status(
            {
              ...f.actor(),
              clientId: f.actor().clientId,
              oauthClientId: "other-registration",
            },
            f.a.id,
            id,
          )
          .catch((e) => e.message),
      ).toBe("RESOURCE_NOT_FOUND");
    });
    it("retains lost writes across cleanup and blocks another key and the shared business policy", async () => {
      const f = await setup(),
        key = crypto.randomUUID();
      f.setHook(async () => {
        throw new Error("Synthetic lost response");
      });
      const response = await f.write(key);
      expect(response.status).toBe(409);
      const execution = (await response.json()) as { execution_id: string };
      expect((await f.write(key)).status).toBe(409);
      expect((await f.write(crypto.randomUUID())).status).toBe(409);
      expect(
        (
          await f.req(
            `bridge/executions/${execution.execution_id}/reconcile`,
            "POST",
            "{}",
          )
        ).status,
      ).toBe(409);
      await cleanupProduct(f.config.state, Date.now() + 40 * 86400000);
      expect(
        await f.app.bridge.status(f.actor(), f.a.id, execution.execution_id),
      ).toMatchObject({ state: "outcome_unknown" });
      expect(f.calls()).toBe(1);
      const business = new BusinessWrites(f.app.connections, {
        create: {
          enabled: true,
          scope: "customer",
          prepare: async () => {
            throw new Error("Must fail before preparation");
          },
          validate: async () => {},
          dispatch: async () => ({ state: "succeeded" as const }),
        },
      });
      await expect(
        business.prepare(f.actor(), f.a.id, "create", {}),
      ).rejects.toThrow("OUTCOME_UNKNOWN");
    });
    it("reconciles an uncertain replacement only through exact readback of its original target", async () => {
      const f = await setup();
      let writes = 0;
      f.setHook(async (request) => {
        if (request.method === "PUT") {
          writes++;
          throw new Error("Synthetic lost acknowledgement");
        }
        return Response.json({ Customer: { Name: "Replacement" } });
      });
      const response = await f.req(
        "fortnox/3/customers/C1",
        "PUT",
        '{"Customer":{"Name":"Replacement"}}',
        {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
      );
      expect(response.status).toBe(409);
      const result = (await response.json()) as { execution_id: string };
      const reconciled = await f.req(
        `bridge/executions/${result.execution_id}/reconcile`,
        "POST",
        "{}",
      );
      expect(reconciled.status).toBe(200);
      expect(await reconciled.json()).toMatchObject({ state: "succeeded" });
      expect(writes).toBe(1);
    });
    it("records a proven pre-dispatch budget failure without blocking later valid actions", async () => {
      const f = await setup();
      const budgetId = JSON.stringify([
        syntheticCredentials.clientId,
        syntheticCompany.tenant,
      ]);
      await f.config.state.put(
        "provider-budget",
        budgetId,
        { next: Date.now() + 30000 },
        null,
      );
      const result = await f.write(crypto.randomUUID());
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ state: "failed" });
      expect(f.calls()).toBe(0);
      const budget = await f.config.state.get("provider-budget", budgetId);
      await f.config.state.put(
        "provider-budget",
        budgetId,
        { next: 0 },
        budget?.version ?? null,
      );
      expect((await f.write(crypto.randomUUID())).status).toBe(201);
      expect(f.calls()).toBe(1);
    });
    it("requires a key even for delivery GET and classifies it as a write", async () => {
      const f = await setup();
      expect((await f.req("fortnox/3/invoices/1/email")).status).toBe(400);
      expect(f.calls()).toBe(0);
      const response = await f.req(
        "fortnox/3/invoices/1/email",
        "GET",
        undefined,
        { "idempotency-key": crypto.randomUUID() },
      );
      expect(response.status).toBe(200);
      expect(f.calls()).toBe(1);
    });
    it("never substitutes an API assertion for voucher review and uses the common exact validator", async () => {
      const f = await setup();
      const voucher =
        '{"Voucher":{"Description":"Synthetic voucher","TransactionDate":"2026-02-01","VoucherSeries":"A","VoucherRows":[{"Account":1930,"Debit":0.30,"Credit":0},{"Account":4000,"Debit":0,"Credit":0.20}]}}';
      const headers = {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-fortnox-currency": "SEK",
      };
      expect(
        (
          await f.req(
            "fortnox/3/vouchers?financialyear=7",
            "POST",
            voucher,
            headers,
          )
        ).status,
      ).toBe(409);
      const c = (await f.app.connections.list(f.actor().ownerId)).find(
        (v) => v.id === f.a.id,
      );
      await f.app.connections.setAccountingPolicy(
        f.actor().ownerId,
        f.a.id,
        c?.policyVersion as number,
        "client_managed",
        false,
      );
      f.app.bookkeeping.provider.references = async (_actor, company) =>
        syntheticReferences(company);
      expect(
        (
          await f.req(
            "fortnox/3/vouchers?financialyear=7",
            "POST",
            voucher,
            headers,
          )
        ).status,
      ).toBe(400);
      expect(f.calls()).toBe(0);
    });
    it("validates multipart files and preserves binary downloads without leaking transport headers", async () => {
      const f = await setup(),
        bytes = pngFixture();
      const form = new FormData();
      form.set(
        "file",
        new File([new Uint8Array(bytes)], "synthetic.png", {
          type: "image/png",
        }),
      );
      f.setHook(async (request) => {
        if (request.method === "POST") {
          expect((await request.formData()).get("file")).toBeInstanceOf(File);
          return Response.json(
            { File: { Id: "synthetic-file" } },
            { status: 201 },
          );
        }
        return new Response(new Uint8Array(bytes), {
          headers: { "content-type": "image/png" },
        });
      });
      expect(
        (
          await f.req("fortnox/3/inbox", "POST", form, {
            "idempotency-key": crypto.randomUUID(),
          })
        ).status,
      ).toBe(201);
      const read = await f.req("fortnox/3/inbox/synthetic-file");
      expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    });
    it("withholds a read after token revocation and refuses execution after a catalogue change", async () => {
      const f = await setup();
      f.setHook(async () => {
        f.setValid(false);
        return Response.json({ Customer: { Name: "Must not escape" } });
      });
      const response = await f.req("fortnox/3/customers/C1");
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("Must not escape");
      f.setValid(true);
      f.setHook(async () => {
        const bundle = await syntheticBridgeCatalog();
        await f.app.bridgeCatalog.install(f.actor().ownerId, {
          ...bundle,
          operations: bundle.operations.map((o, n) =>
            n === 0 ? { ...o, unavailable: "domain_validation_required" } : o,
          ),
        });
        return Response.json({
          Customer: { Name: "Changed catalogue must not escape" },
        });
      });
      const changed = await f.req("fortnox/3/customers/C1");
      expect(changed.status).toBe(409);
      expect(await changed.text()).not.toContain(
        "Changed catalogue must not escape",
      );
    });
    it("keeps the module absent by default and rejects oversized bodies, cookie and read-only bypasses", async () => {
      const f = await setup();
      const disabled = createProductApplication(
        { ...f.settings, restBridge: false },
        f.config,
        f.fetcher,
      );
      expect(
        (
          await disabled.fetch(
            new Request(`${f.config.origin}/admin/fortnox/bridge-catalog`),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await f.app.fetch(
            new Request(`${f.config.origin}/admin/fortnox/bridge-catalog`, {
              headers: { authorization: "Bearer synthetic-api-token" },
            }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await f.req("fortnox/3/customers", "GET", undefined, {
            cookie: "forged-owner",
          })
        ).status,
      ).toBe(400);
      expect(
        (await f.write(crypto.randomUUID(), "x".repeat(1048577))).status,
      ).toBe(400);
      const c = (await f.app.connections.list(f.actor().ownerId)).find(
        (v) => v.id === f.a.id,
      );
      if (!c) throw new Error("Missing synthetic company");
      await f.app.connections.setAccountingPolicy(
        f.actor().ownerId,
        f.a.id,
        c.policyVersion,
        "review_required",
        true,
      );
      expect((await f.write(crypto.randomUUID())).status).toBe(403);
      expect(f.calls()).toBe(0);
    });
    it("requires the current document ETag and explicit removal of original rows", async () => {
      const f = await setup();
      let writes = 0;
      f.setHook(async (request) => {
        if (request.method === "PUT") writes++;
        return Response.json({
          Invoice: {
            InvoiceRows: [
              { RowId: 1, Description: "First" },
              { RowId: 2, Description: "Second" },
            ],
          },
        });
      });
      const original = await f.req("fortnox/3/invoices/1");
      const etag = original.headers.get("etag");
      if (!etag) throw new Error("Missing bridge ETag");
      const body =
        '{"Invoice":{"InvoiceRows":[{"RowId":1,"Description":"First"}]}}';
      const headers = {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      };
      expect(
        (await f.req("fortnox/3/invoices/1", "PUT", body, headers)).status,
      ).toBe(428);
      expect(
        (
          await f.req("fortnox/3/invoices/1", "PUT", body, {
            ...headers,
            "if-match": "stale",
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await f.req("fortnox/3/invoices/1", "PUT", body, {
            ...headers,
            "if-match": etag,
          })
        ).status,
      ).toBe(400);
      expect(writes).toBe(0);
      expect(
        (
          await f.req("fortnox/3/invoices/1", "PUT", body, {
            ...headers,
            "if-match": etag,
            "x-fortnox-removed-row-ids": "2",
          })
        ).status,
      ).toBe(200);
      expect(writes).toBe(1);
    });
    it("rejects duplicate JSON keys and validates large decimals without floating-point rounding", () => {
      expect(() => parseBridgeJson('{"Debit":1,"\\u0044ebit":2}')).toThrow();
      const value = parseBridgeJson('{"amount":9007199254740993.01}');
      expect(() =>
        bridgeSchemaCheck(
          {},
          {
            type: "object",
            properties: { amount: { type: "number", multipleOf: 0.01 } },
          },
          value,
        ),
      ).not.toThrow();
      expect(() =>
        bridgeSchemaCheck(
          {},
          {
            type: "object",
            properties: {
              amount: { type: "number", maximum: 9007199254740992 },
            },
          },
          value,
        ),
      ).toThrow();
    });
  });
}
