import {
  accountingHash,
  CompanySync,
  DomainError,
  requestActor,
  type StateStore,
  type SyncEvent,
  type SyncJournal,
  syncLimits,
  syncResources,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { normalizeFortnoxEvent } from "../../packages/fortnox/src/events.js";
import { restApi } from "../../packages/rest/src/index.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";

export async function syntheticSyncCatalog() {
  const paths: Record<string, unknown> = {};
  const operations = [];
  for (const r of syncResources) {
    const detail = `${r.path}/${r.keys.map((key) => `{${key}}`).join("/")}`;
    for (const [kind, path] of [
      ["list", r.path],
      ["get", detail],
    ] as const) {
      const operation_id = `${r.id}_${kind}`;
      paths[path] = {
        get: {
          operationId: operation_id,
          parameters:
            kind === "get"
              ? r.keys.map((name) => ({
                  name,
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                }))
              : [],
          responses: { "200": { description: "Original synthetic response" } },
        },
      };
      operations.push({
        operation_id,
        method: "GET",
        path,
        scopes: [r.scope],
        effect: "read",
        finance: true,
        manual_vouchers: false,
        files: false,
        credentials: "company_oauth",
        unavailable: null,
      });
    }
  }
  const specification = JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Original synthetic sync API", version: "1" },
    paths,
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
  return {
    version: "fortnox-bridge-catalog-v1",
    specification,
    source_sha256,
    operations,
  };
}
export function companySyncContract(
  fixture: () => Promise<AuthConfig & { journal: SyncJournal }>,
) {
  describe("company-sync-v1", () => {
    async function setup() {
      const f = await fixture();
      let now = Date.now();
      let calls = 0;
      const app = createProductApplication(
        {
          origin: f.origin,
          secret: f.secret,
          keys: { a: keyA },
          activeKey: "a",
          redirects: [],
          testMode: false,
          testTenants: [],
          clientId: syntheticCredentials.clientId,
          clientSecret: syntheticCredentials.clientSecret,
          restApi: true,
          restBridge: true,
          restSync: true,
        },
        { ...f, syncJournal: f.journal },
        async () => {
          calls++;
          return new Response(
            '{"Invoices":[{"DocumentNumber":1,"Total":9007199254740993.01}],"MetaInformation":{"@CurrentPage":1,"@TotalPages":2}}',
            { headers: { "content-type": "application/json" } },
          );
        },
      );
      const owner = `sync-${crypto.randomUUID()}`;
      await f.state.put(
        "installation",
        "owner",
        { phase: "active", ownerId: owner, tokenHash: "", expiresAt: 0 },
        null,
      );
      // The actual installed singleton owner can already exist in D1 fixtures.
      const installed = await f.state.get("installation", "owner");
      if (installed)
        await f.state.put(
          "installation",
          "owner",
          { phase: "active", ownerId: owner, tokenHash: "", expiresAt: 0 },
          installed.version,
        );
      const a = await app.connections.add(
        owner,
        {
          ...syntheticCompany,
          scopes: [
            ...new Set([
              "companyinformation",
              "profile",
              ...syncResources.map((r) => r.scope),
            ]),
          ],
        },
        syntheticCredentials,
      );
      const b = await app.connections.add(
        owner,
        { ...syntheticCompany, tenant: "100002" },
        syntheticCredentials,
      );
      const actor = requestActor(
        {
          ownerId: owner,
          clientId: "sync-grant",
          oauthClientId: "sync-registration",
          scopes: ["api:read", "api:finance:read", "api:bridge"],
        },
        "api",
      );
      await app.connections.grant(owner, actor.clientId, [a.id], "api");
      await app.bridgeCatalog.install(owner, await syntheticSyncCatalog());
      const sync = new CompanySync(
        app.bridge,
        f.journal,
        () => "connected",
        () => now,
      );
      let valid = true;
      const authenticate = async () => {
        if (!valid) throw new DomainError("AUTH_REQUIRED");
        return actor;
      };
      const api = restApi({
        origin: f.origin,
        enabled: true,
        services: app.reads,
        bridge: app.bridge,
        sync,
        authenticate,
      });
      const request = (path: string) =>
        api.fetch(new Request(`${f.origin}/api/v1/companies/${a.id}/${path}`));
      const event = (n: number): SyncEvent => ({
        event_id: `synthetic-${n}`,
        company_id: a.id,
        resource: "customer_invoices",
        action: "upsert",
        identity: { DocumentNumber: String(n) },
        occurred_at: new Date(now).toISOString(),
      });
      const append = (n: number, events = [event(n)]) =>
        f.journal.append(
          owner,
          a.id,
          a.generation,
          "synthetic-integration",
          "invoices",
          String(n),
          events,
          now,
        );
      return {
        ...f,
        app,
        owner,
        a,
        b,
        actor,
        sync,
        api,
        authenticate,
        request,
        event,
        append,
        calls: () => calls,
        advance: (ms: number) => {
          now += ms;
        },
        revoke: () => {
          valid = false;
        },
      };
    }
    it("discovers twelve reviewed resources and preserves full exact native pages", async () => {
      const f = await setup();
      const manifest = await f.sync.manifest(f.actor, f.a.id);
      expect(manifest.resources).toHaveLength(12);
      expect(manifest.resources.every((r) => r.available)).toBe(true);
      expect(
        manifest.resources.find((r) => r.resource === "vouchers")
          ?.identity_fields,
      ).toEqual(["financialyear", "VoucherSeries", "VoucherNumber"]);
      expect(
        manifest.resources.find(
          (r) => r.resource === "supplier_invoice_payments",
        )?.event_support,
      ).toBe(false);
      const response = await f.request("fortnox/3/invoices?page=2&limit=1");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("9007199254740993.01");
      expect(f.calls()).toBe(1);
      expect((await f.request("fortnox/3/vouchers?limit=100")).status).toBe(
        400,
      );
    });
    it("bootstraps before a baseline and atomically persists duplicate-safe events and offsets", async () => {
      const f = await setup();
      const bootstrap = await f.sync.changes(
        f.actor,
        f.a.id,
        {},
        f.authenticate,
      );
      expect(bootstrap.resync_reason).toBe("initial_baseline");
      expect(bootstrap.events).toEqual([]);
      await f.append(1, [f.event(1), f.event(2)]);
      await f.append(1, [f.event(1), f.event(2)]);
      const one = await f.sync.changes(
        f.actor,
        f.a.id,
        { cursor: bootstrap.next_cursor, limit: 1 },
        f.authenticate,
      );
      expect(one.events.map((e) => e.event_id)).toEqual(["synthetic-1"]);
      expect(one.has_more).toBe(true);
      const two = await f.sync.changes(
        f.actor,
        f.a.id,
        { cursor: one.next_cursor },
        f.authenticate,
      );
      expect(two.events.map((e) => e.event_id)).toEqual(["synthetic-2"]);
      expect(two.has_more).toBe(false);
      expect(
        (await f.journal.offsets("synthetic-integration"))[0]?.offset,
      ).toBe("1");
      const recreated = new CompanySync(
        f.app.bridge,
        f.journal,
        () => "connected",
      );
      expect(
        (
          await recreated.changes(
            f.actor,
            f.a.id,
            { cursor: one.next_cursor },
            f.authenticate,
          )
        ).events[0]?.event_id,
      ).toBe("synthetic-2");
    });
    it("fails closed on company, permission, cursor and query bypasses without provider I/O", async () => {
      const f = await setup();
      const boot = await f.sync.changes(f.actor, f.a.id, {}, f.authenticate);
      await expect(f.sync.manifest(f.actor, f.b.id)).rejects.toThrow(
        "COMPANY_FORBIDDEN",
      );
      await expect(
        f.sync.manifest(
          { ...f.actor, permissions: ["read", "bridge"] },
          f.a.id,
        ),
      ).rejects.toThrow("AUTH_REQUIRED");
      await expect(
        f.sync.changes(
          { ...f.actor, oauthClientId: "foreign" },
          f.a.id,
          { cursor: boot.next_cursor },
          f.authenticate,
        ),
      ).rejects.toThrow("VALIDATION_FAILED");
      expect((await f.request("sync/changes?cursor=forged")).status).toBe(400);
      expect((await f.request("sync/changes?limit=1&limit=2")).status).toBe(
        400,
      );
      expect(
        (await f.request("sync/changes?url=https://private.invalid")).status,
      ).toBe(400);
      expect(f.calls()).toBe(0);
    });
    it("returns explicit resets after retention, journal reset and source changes", async () => {
      const f = await setup();
      const boot = await f.sync.changes(f.actor, f.a.id, {}, f.authenticate);
      await f.append(1);
      f.advance(syncLimits.retentionMs + 1);
      expect(
        (
          await f.sync.changes(
            f.actor,
            f.a.id,
            { cursor: boot.next_cursor },
            f.authenticate,
          )
        ).resync_reason,
      ).toBe("cursor_expired");
      const fresh = await f.sync.changes(f.actor, f.a.id, {}, f.authenticate);
      await f.journal.reset(f.owner, f.a.id, f.a.generation);
      expect(
        (
          await f.sync.changes(
            f.actor,
            f.a.id,
            { cursor: fresh.next_cursor },
            f.authenticate,
          )
        ).resync_reason,
      ).toBe("journal_reset");
      const before = await f.sync.changes(f.actor, f.a.id, {}, f.authenticate);
      const bundle = await syntheticSyncCatalog();
      const first = bundle.operations[0];
      if (!first) throw new Error("Missing synthetic operation");
      Object.assign(first, { unavailable: "domain_validation_required" });
      await f.app.bridgeCatalog.install(f.owner, bundle);
      expect(
        (
          await f.sync.changes(
            f.actor,
            f.a.id,
            { cursor: before.next_cursor },
            f.authenticate,
          )
        ).resync_reason,
      ).toBe("source_changed");
    });
    it("rechecks revocation and cancellation while waiting, and token rotation preserves the cursor", async () => {
      const f = await setup();
      const boot = await f.sync.changes(f.actor, f.a.id, {}, f.authenticate);
      const rotated = { ...f.actor, clientId: "rotated-grant" };
      await f.app.connections.grant(f.owner, rotated.clientId, [f.a.id], "api");
      await f.append(1);
      expect(
        (
          await f.sync.changes(
            rotated,
            f.a.id,
            { cursor: boot.next_cursor },
            f.authenticate,
          )
        ).events,
      ).toHaveLength(1);
      const tail = await f.sync.changes(f.actor, f.a.id, {}, f.authenticate);
      let checks = 0;
      await expect(
        f.sync.changes(
          f.actor,
          f.a.id,
          { cursor: tail.next_cursor, wait_seconds: 1 },
          async () => {
            checks++;
            throw new DomainError("AUTH_REQUIRED");
          },
        ),
      ).rejects.toThrow("AUTH_REQUIRED");
      expect(checks).toBe(1);
      const controller = new AbortController();
      controller.abort();
      await expect(
        f.sync.changes(f.actor, f.a.id, {}, f.authenticate, controller.signal),
      ).rejects.toThrow("CONNECTION_CONFLICT");
    });
    it("bounds retained changes and reports a gap instead of silently skipping trimmed events", async () => {
      const f = await setup();
      const bootstrap = await f.sync.changes(
        f.actor,
        f.a.id,
        {},
        f.authenticate,
      );
      for (let start = 1; start <= 1008; start += 12)
        await f.append(
          start,
          Array.from({ length: 12 }, (_, i) => f.event(start + i)),
        );
      const page = await f.journal.read(
        f.owner,
        f.a.id,
        f.a.generation,
        0,
        100,
        Date.now(),
      );
      expect(page.tail - page.floor).toBe(syncLimits.companyEvents);
      expect(
        (
          await f.sync.changes(
            f.actor,
            f.a.id,
            { cursor: bootstrap.next_cursor },
            f.authenticate,
          )
        ).resync_reason,
      ).toBe("retention_gap");
    }, 20000);
    it("turns unknown events and incomplete voucher identities into explicit rescan signals", async () => {
      const f = await setup();
      const raw = {
        topic: "vouchers",
        offset: "opaque-offset",
        type: "voucher-updated-v1",
        tenantId: f.a.tenant,
        entityId: "42",
        timestamp: new Date().toISOString(),
      };
      const incomplete = await normalizeFortnoxEvent(raw, "integration", f.a);
      expect(incomplete.events[0]).toMatchObject({
        resource: "vouchers",
        action: "rescan",
        identity: null,
      });
      const complete = await normalizeFortnoxEvent(
        { ...raw, year: "7", series: "A", id: "42" },
        "integration",
        f.a,
      );
      expect(complete.events[0]).toMatchObject({
        action: "rescan",
        identity: null,
      });
      const unknown = await normalizeFortnoxEvent(
        { ...raw, type: "voucher-updated-v99" },
        "integration",
        f.a,
      );
      expect(unknown.events.every((e) => e.action === "rescan")).toBe(true);
      expect(complete.events[0]?.event_id).toBe(
        await accountingHash([
          "integration",
          "vouchers",
          "opaque-offset",
          "vouchers",
        ]),
      );
      await expect(
        normalizeFortnoxEvent(
          { ...raw, tenantId: f.b.tenant },
          "integration",
          f.a,
        ),
      ).rejects.toThrow();
    });
  });
}
export type SyncFixture = { state: StateStore; journal: SyncJournal };
