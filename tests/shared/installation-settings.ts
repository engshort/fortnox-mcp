import {
  CredentialVault,
  InstallationSettings,
  type InstallationValues,
} from "@fortnox-mcp/core";
import { describe, expect, it, vi } from "vitest";
import {
  createProductApplication,
  type ProductSettings,
} from "../../apps/shared/product.js";
import type { AuthConfig, Owner } from "../../apps/shared/product-auth.js";
import { syntheticBridgeCatalog } from "./bridge.js";
import {
  keyA,
  keyB,
  syntheticCompany,
  syntheticCredentials,
} from "./connections.js";
import { onboardingFixture } from "./onboarding.js";

export function installationSettingsContract(
  fixture: () => Promise<AuthConfig>,
  kind: "node" | "worker",
) {
  describe("installation settings", () => {
    async function seed(
      defaults: Partial<ProductSettings> = {},
      fetcher?: typeof fetch,
    ) {
      const config = await fixture();
      const settings: ProductSettings = {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://client.example.invalid/callback"],
        testMode: false,
        testTenants: [],
        clientId: "",
        clientSecret: "",
        ...defaults,
      };
      const changed = vi.fn(async () => {});
      const providerCalls = vi.fn(async () => {
        throw new Error("Unexpected provider call");
      });
      const app = createProductApplication(
        settings,
        { ...config, kind, configurationChanged: changed },
        fetcher ?? providerCalls,
      );
      const created = await app.auth.api.signUpEmail({
        body: {
          email: "settings-owner@example.invalid",
          name: "Synthetic owner",
          password: "Synthetic-settings-password",
        },
        returnHeaders: true,
      });
      const owner = created.response.user.id;
      await config.state.put<Owner>(
        "installation",
        "owner",
        { phase: "active", ownerId: owner, tokenHash: "", expiresAt: 0 },
        null,
      );
      const cookie = created.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const request = (
        path: string,
        body?: unknown,
        headers: Record<string, string> = { cookie, origin: config.origin },
        method?: string,
      ) =>
        app.fetch(
          new Request(`${config.origin}${path}`, {
            method: method ?? (body === undefined ? "GET" : "POST"),
            headers: { "content-type": "application/json", ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        );
      const status = async () => {
        const response = await request("/admin/settings");
        expect(response.status).toBe(200);
        return (await response.json()) as {
          revision: number | null;
          values: Omit<InstallationValues, "emailApiKey"> & {
            emailApiKey: boolean;
          };
          sources: Record<string, string>;
          availability: Record<string, string | null>;
          can_install_catalog: boolean;
        };
      };
      const save = async (
        changes: Partial<InstallationValues>,
        reset: string[] = [],
      ) =>
        request("/admin/settings", {
          expected_revision: (await status()).revision,
          changes,
          reset,
        });
      return {
        app,
        config,
        settings,
        owner,
        cookie,
        request,
        status,
        save,
        changed,
        providerCalls,
      };
    }
    it("keeps defaults unchanged, separates HTML from JSON, and exposes only safe runtime status", async () => {
      const f = await seed();
      const status = await f.status();
      expect(status.revision).toBeNull();
      expect(
        Object.values(status.values).every(
          (value) =>
            value === false ||
            value === "" ||
            (Array.isArray(value) && !value.length),
        ),
      ).toBe(true);
      expect(Object.keys(status.values)).toHaveLength(14);
      expect(status.can_install_catalog).toBe(true);
      expect(
        (
          await f.request("/admin/settings", undefined, {
            cookie: f.cookie,
            accept: "text/html",
          })
        ).headers.get("content-type"),
      ).toContain("text/html");
      const raw = await (await f.request("/admin/settings")).text();
      for (const hidden of [
        f.settings.secret,
        keyA,
        "relay_token",
        "PRODUCT_DATABASE",
      ])
        expect(raw).not.toContain(hidden);
      expect(f.providerCalls).not.toHaveBeenCalled();
      expect(
        await f.config.state.get("installation-settings-v1", f.owner),
      ).toBeNull();
    });
    it("requires a browser administrator session, exact Origin and a strict bounded change", async () => {
      const f = await seed();
      for (const headers of [
        {},
        { authorization: "Bearer synthetic-token" },
      ] as Record<string, string>[]) {
        expect(
          (await f.request("/admin/settings", undefined, headers)).status,
        ).toBe(401);
        expect(
          (await f.request("/admin/settings/clients", undefined, headers))
            .status,
        ).toBe(401);
      }
      const body = { expected_revision: null, changes: { restApi: true } };
      expect(
        (await f.request("/admin/settings", body, { cookie: f.cookie })).status,
      ).toBe(403);
      expect(
        (
          await f.request("/admin/settings", body, {
            cookie: f.cookie,
            origin: "https://foreign.example.invalid",
          })
        ).status,
      ).toBe(403);
      expect(
        (await f.request("/admin/settings", { ...body, owner: "other-owner" }))
          .status,
      ).toBe(400);
      expect(
        (
          await f.request("/admin/settings", {
            ...body,
            changes: { confirmed: true },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.request("/admin/settings", {
            ...body,
            changes: { emailApiKey: "x".repeat(17000) },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await f.request(
            "/admin/settings",
            body,
            { cookie: f.cookie, origin: f.config.origin },
            "PUT",
          )
        ).status,
      ).toBe(405);
      expect((await f.status()).revision).toBeNull();
    });
    it("validates dependencies and mail atomically without echoing secret input", async () => {
      const f = await seed();
      for (const changes of [
        { restBridge: true },
        { restSync: true },
        { membershipProvisioning: true },
        { fortnoxEvents: true },
        { emailEnabled: true },
        {
          emailEnabled: true,
          emailApiKey: "synthetic-private-invalid-key",
          emailFrom: "sender@example.invalid",
        },
        { financialAnalysisContexts: true },
      ]) {
        const response = await f.save(changes);
        expect(response.status).toBe(400);
        const body = await response.text();
        expect(body).toContain("VALIDATION_FAILED");
        expect(body).not.toContain("synthetic-private-invalid-key");
        expect((await f.status()).revision).toBeNull();
      }
      expect((await f.save({ restApi: true, restBridge: true })).status).toBe(
        200,
      );
      expect((await f.status()).availability.restBridge).toBe(
        "catalog_required",
      );
      expect((await f.save({ restApi: false })).status).toBe(400);
      expect((await f.save({ restApi: false, restBridge: false })).status).toBe(
        200,
      );
    });
    it("can disable an inherited realtime flag on an unsupported runtime", async () => {
      const f = await seed({
        restApi: true,
        restBridge: true,
        restSync: true,
        fortnoxEvents: true,
      });
      expect((await f.status()).values.fortnoxEvents).toBe(true);
      expect((await f.save({ fortnoxEvents: false })).status).toBe(200);
      expect((await f.status()).values.fortnoxEvents).toBe(false);
    });
    it("persists write-only encrypted email configuration, replaces and clears it, and rotates its key", async () => {
      const f = await seed();
      const apiKey = "re_synthetic_settings_secret";
      expect(
        (
          await f.save({
            emailEnabled: true,
            emailApiKey: apiKey,
            emailFrom: "sender@example.invalid",
          })
        ).status,
      ).toBe(200);
      let row = await f.config.state.get("installation-settings-v1", f.owner);
      expect(JSON.stringify(row)).not.toContain(apiKey);
      expect((await f.status()).values.emailApiKey).toBe(true);
      expect(await (await f.request("/admin/settings")).text()).not.toContain(
        apiKey,
      );
      const rotated = new InstallationSettings(
        f.config.state,
        new CredentialVault({ a: keyA, b: keyB }, "b"),
      );
      await rotated.rotate(f.owner);
      const onlyNew = new InstallationSettings(
        f.config.state,
        new CredentialVault({ b: keyB }, "b"),
      );
      expect((await onlyNew.snapshot(f.owner)).values.emailApiKey).toBe(apiKey);
      // Recreate with the rotated deployment keyring and disable mail while
      // retaining its key. Explicit clearing must not revive an ENV fallback.
      const app = createProductApplication(
        { ...f.settings, keys: { b: keyB }, activeKey: "b" },
        { ...f.config, kind },
      );
      row = await f.config.state.get("installation-settings-v1", f.owner);
      const response = await app.fetch(
        new Request(`${f.config.origin}/admin/settings`, {
          method: "POST",
          headers: {
            cookie: f.cookie,
            origin: f.config.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expected_revision: row?.version,
            changes: { emailEnabled: false, emailApiKey: "" },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect((await onlyNew.snapshot(f.owner)).values.emailApiKey).toBe("");
      expect((await onlyNew.snapshot(f.owner)).values.emailEnabled).toBe(false);
    });
    it("overrides explicit server values with false and empty lists, and restores individual defaults", async () => {
      const f = await seed({
        restApi: true,
        offlineClientIds: ["old-registered-backend"],
        installationSources: ["restApi", "offlineClientIds"],
      });
      expect((await f.status()).sources.restApi).toBe("server");
      expect(
        (await f.save({ restApi: false, offlineClientIds: [] })).status,
      ).toBe(200);
      let status = await f.status();
      expect(status.values.restApi).toBe(false);
      expect(status.values.offlineClientIds).toEqual([]);
      expect(status.sources.restApi).toBe("app");
      expect((await f.save({}, ["restApi"])).status).toBe(200);
      status = await f.status();
      expect(status.values.restApi).toBe(true);
      expect(status.sources.restApi).toBe("server");
      expect(status.values.offlineClientIds).toEqual([]);
      expect((await f.save({}, ["offlineClientIds"])).status).toBe(400);
      expect((await f.save({ restApi: false }, ["restApi"])).status).toBe(400);
    });
    it("prevents lost concurrent changes and applies saved values across application recreation", async () => {
      const f = await seed();
      const results = await Promise.all([
        f.request("/admin/settings", {
          expected_revision: null,
          changes: { restApi: true },
        }),
        f.request("/admin/settings", {
          expected_revision: null,
          changes: { financialLargeReads: true },
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const persisted = await f.status();
      const restarted = createProductApplication(f.settings, {
        ...f.config,
        kind,
      });
      const response = await restarted.fetch(
        new Request(`${f.config.origin}/admin/settings`, {
          headers: { cookie: f.cookie },
        }),
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as { values: unknown }).values).toEqual(
        persisted.values,
      );
    });
    it("resolves app overrides before parsing unused malformed server defaults", async () => {
      const f = await seed({
        installationEnvironment: { offlineClientIds: "not-json" },
      });
      await new InstallationSettings(
        f.config.state,
        new CredentialVault({ a: keyA }, "a"),
      ).save(
        f.owner,
        { expected_revision: null, changes: { offlineClientIds: [] } },
        async () => {},
      );
      expect((await f.status()).values.offlineClientIds).toEqual([]);
      expect((await f.save({}, ["offlineClientIds"])).status).toBe(400);
      expect((await f.status()).values.offlineClientIds).toEqual([]);
    });
    it("allows administrators, denies members, retains owner access and preserves financial policy on disable", async () => {
      const f = await seed({ restApi: true, restBridge: true });
      expect(
        (await f.save({ multiUser: true, membershipProvisioning: true }))
          .status,
      ).toBe(200);
      const company = await f.app.connections.add(
        f.owner,
        syntheticCompany,
        syntheticCredentials,
      );
      const before = (await f.app.connections.list(f.owner)).find(
        (c) => c.id === company.id,
      );
      for (const role of ["admin", "member"] as const) {
        const account = await f.app.auth.api.signUpEmail({
          body: {
            email: `settings-${role}@example.invalid`,
            name: `Synthetic ${role}`,
            password: "Synthetic-settings-password",
          },
          returnHeaders: true,
        });
        const member = await f.app.memberships.save(
          f.owner,
          null,
          {
            email: account.response.user.email,
            name: account.response.user.name,
            role,
            active: true,
            companies: {},
          },
          null,
        );
        await f.app.memberships.link(
          f.owner,
          member.id,
          member.revision,
          account.response.user.id,
          "local",
          member.externalId,
        );
        const cookie = account.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        const headers = { cookie, origin: f.config.origin };
        expect(
          (await f.request("/admin/settings", undefined, headers)).status,
        ).toBe(role === "admin" ? 200 : 401);
        expect(
          (await f.request("/admin/settings/clients", undefined, headers))
            .status,
        ).toBe(role === "admin" ? 200 : 401);
        const revision = (await f.status()).revision;
        expect(
          (
            await f.request(
              "/admin/settings",
              {
                expected_revision: revision,
                changes: { financialLargeReads: true },
              },
              headers,
            )
          ).status,
        ).toBe(role === "admin" ? 200 : 401);
        expect(
          (await f.request("/admin/fortnox/bridge-catalog", {}, headers, "PUT"))
            .status,
        ).not.toBe(200);
        if (role === "admin") {
          const response = await f.request(
            "/admin/settings",
            undefined,
            headers,
          );
          expect(
            ((await response.json()) as { can_install_catalog: boolean })
              .can_install_catalog,
          ).toBe(false);
        }
      }
      expect(
        (await f.save({ multiUser: false, membershipProvisioning: false }))
          .status,
      ).toBe(200);
      expect((await f.status()).values.multiUser).toBe(false);
      expect(
        (await f.app.connections.list(f.owner)).find(
          (c) => c.id === company.id,
        ),
      ).toEqual(before);
      expect(f.providerCalls).not.toHaveBeenCalled();
    });
    it("selects only eligible registered clients without exposing their credentials", async () => {
      const f = await seed();
      async function register(method: string, scope: string) {
        const response = await f.request(
          "/auth/oauth2/register",
          {
            client_name: `Synthetic ${method}`,
            redirect_uris: f.settings.redirects,
            token_endpoint_auth_method: method,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            scope,
          },
          {},
        );
        expect(response.status).toBe(201);
        return (await response.json()) as {
          client_id: string;
          client_secret?: string;
        };
      }
      const backend = await register(
        "client_secret_basic",
        "mcp:read offline_access",
      );
      const publicClient = await register("none", "mcp:read offline_access");
      const noOffline = await register("client_secret_basic", "mcp:read");
      // Dynamic registration keeps the provider's scope ceiling. Represent an
      // explicitly constrained managed registration in the real auth adapter.
      await (await f.app.auth.$context).adapter.update({
        model: "oauthClient",
        where: [{ field: "clientId", value: noOffline.client_id }],
        update: { scopes: ["mcp:read"] },
      });
      const response = await f.request("/admin/settings/clients");
      const text = await response.text();
      expect(text).not.toContain(backend.client_secret);
      expect(JSON.parse(text).clients).toContainEqual({
        client_id: backend.client_id,
        name: "Synthetic client_secret_basic",
        onboarding: true,
        offline: true,
      });
      for (const id of [
        publicClient.client_id,
        "missing-client",
        noOffline.client_id,
      ])
        expect((await f.save({ offlineClientIds: [id] })).status).toBe(400);
      expect(
        (
          await f.save({
            externalAppOnboarding: true,
            onboardingClients: [backend.client_id],
            offlineClientIds: [backend.client_id],
          })
        ).status,
      ).toBe(200);
      expect((await f.status()).values.offlineClientIds).toEqual([
        backend.client_id,
      ]);
      expect(
        (
          await f.save({
            externalAppOnboarding: false,
            onboardingClients: [],
            offlineClientIds: [],
          })
        ).status,
      ).toBe(200);
    });
    it("allows new REST bridge registrations after activation while retaining old registration scopes", async () => {
      const f = await seed({ restApi: true });
      const register = (scope: string) =>
        f.request(
          "/auth/oauth2/register",
          {
            client_name: "Synthetic REST backend",
            redirect_uris: f.settings.redirects,
            token_endpoint_auth_method: "client_secret_basic",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            scope,
            resources: [`${f.config.origin}/api/v1`],
          },
          {},
        );
      const original = await register("api:read offline_access");
      expect(original.status).toBe(201);
      const client = (await original.json()) as { client_id: string };
      const adapter = (await f.app.auth.$context).adapter;
      const before = await adapter.findOne({
        model: "oauthClient",
        where: [{ field: "clientId", value: client.client_id }],
      });
      expect((await f.save({ restBridge: true })).status).toBe(200);
      const expanded = await register(
        "api:read api:bridge api:write api:files offline_access",
      );
      expect(expanded.status).toBe(201);
      expect(
        await adapter.findOne({
          model: "oauthClient",
          where: [{ field: "clientId", value: client.client_id }],
        }),
      ).toEqual(before);
      expect((await f.save({ restBridge: false })).status).toBe(200);
      expect(
        (await register("api:read api:bridge offline_access")).status,
      ).not.toBe(201);
    });
    it("does not expose owner recovery codes through an administrator-controlled email provider", async () => {
      const f = await seed();
      expect(
        (
          await f.save({
            multiUser: true,
            emailEnabled: true,
            emailApiKey: "re_synthetic_owner_key",
            emailFrom: "sender@example.invalid",
          })
        ).status,
      ).toBe(200);
      const account = await f.app.auth.api.signUpEmail({
        body: {
          email: "email-admin@example.invalid",
          name: "Synthetic administrator",
          password: "Synthetic-admin-password",
        },
        returnHeaders: true,
      });
      const membership = await f.app.memberships.save(
        f.owner,
        null,
        {
          email: account.response.user.email,
          name: account.response.user.name,
          role: "admin",
          active: true,
          companies: {},
        },
        null,
      );
      await f.app.memberships.link(
        f.owner,
        membership.id,
        membership.revision,
        account.response.user.id,
        "local",
        membership.externalId,
      );
      const cookie = account.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const deliveries: string[] = [];
      const mock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_input, init) => {
          deliveries.push(
            new Headers(init?.headers).get("authorization") ?? "",
          );
          return Response.json({ id: "synthetic-message" });
        });
      try {
        const reset = () =>
          f.request(
            "/auth/request-password-reset",
            { email: "settings-owner@example.invalid" },
            { origin: f.config.origin },
          );
        expect((await reset()).status).toBe(200);
        expect(deliveries).toEqual(["Bearer re_synthetic_owner_key"]);
        const revision = (await f.status()).revision;
        expect(
          (
            await f.request(
              "/admin/settings",
              {
                expected_revision: revision,
                changes: { emailApiKey: "re_synthetic_admin_key" },
              },
              { cookie, origin: f.config.origin },
            )
          ).status,
        ).toBe(200);
        expect((await reset()).status).toBe(200);
        expect(deliveries).toEqual(["Bearer re_synthetic_owner_key"]);
        // An unrelated owner save cannot bless the administrator's key.
        expect(
          (
            await f.request(
              "/admin/settings",
              {
                expected_revision: (await f.status()).revision,
                changes: { emailKeyOwnerApproved: true },
              },
              { cookie, origin: f.config.origin },
            )
          ).status,
        ).toBe(400);
        expect((await f.save({ financialLargeReads: true })).status).toBe(200);
        const status = await f.request("/admin/settings");
        expect(
          ((await status.json()) as { owner_recovery_email: boolean })
            .owner_recovery_email,
        ).toBe(false);
        expect(
          (await f.save({ emailApiKey: "re_synthetic_replaced_owner_key" }))
            .status,
        ).toBe(200);
        expect((await reset()).status).toBe(200);
        expect(deliveries).toEqual([
          "Bearer re_synthetic_owner_key",
          "Bearer re_synthetic_replaced_owner_key",
        ]);
      } finally {
        mock.mockRestore();
      }
    });
    it("keeps corrupt catalogue status recoverable without treating it as an active capability", async () => {
      const f = await seed({ restApi: true, restBridge: true });
      await f.config.state.put(
        "bridge-catalog",
        f.owner,
        { active: { slot: 0, id: "synthetic-corrupt", chunks: 0 } },
        null,
      );
      expect((await f.status()).availability.restBridge).toBe(
        "catalog_unavailable",
      );
      expect((await f.save({ financialLargeReads: true })).status).toBe(200);
      const response = await f.request(
        "/admin/fortnox/bridge-catalog",
        await syntheticBridgeCatalog(),
        { cookie: f.cookie, origin: f.config.origin },
        "PUT",
      );
      expect(response.status).toBe(200);
      expect((await f.status()).availability.restBridge).toBeNull();
    });
    it("fails closed on corrupt encrypted state without silently using server defaults", async () => {
      const f = await seed();
      await f.config.state.put(
        "installation-settings-v1",
        f.owner,
        {
          schema: 1,
          overrides: {},
          emailApiKey: { key: "missing-key", iv: "invalid", data: "invalid" },
        },
        null,
      );
      expect((await f.request("/admin/settings")).status).toBe(503);
      expect(f.providerCalls).not.toHaveBeenCalled();
    });
    it("fences actual offline token use and refresh immediately without widening or deleting grants", async () => {
      const f = await onboardingFixture(await fixture(), true);
      const attempt = await f.start();
      await f.provider(attempt);
      const approval = await f.approve(attempt);
      const exchange = await f.exchange(approval.target);
      expect(exchange.status).toBe(200);
      const pair = (await exchange.json()) as {
        access_token: string;
        refresh_token: string;
      };
      const grant = await f.config.state.get(
        "company-grants",
        f.client.client_id,
      );
      const status = await f.request("/admin/settings", undefined, {
        cookie: f.cookie,
      });
      const revision = ((await status.json()) as { revision: number | null })
        .revision;
      expect(
        (
          await f.browser("/admin/settings", {
            expected_revision: revision,
            changes: { offlineClientIds: [] },
          })
        ).status,
      ).toBe(200);
      await expect(
        f.app.auth.api.verifyProductToken({
          body: { token: pair.access_token },
        }),
      ).rejects.toThrow();
      const refreshed = await f.request(
        "/auth/oauth2/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: pair.refresh_token,
          resource: `${f.config.origin}/mcp`,
        }),
        { authorization: f.client.authorization },
      );
      expect(refreshed.status).not.toBe(200);
      expect(
        await f.config.state.get("company-grants", f.client.client_id),
      ).toEqual(grant);
    });
    it("stops additional provider calls after an in-flight connection is disabled without replay", async () => {
      const f = await onboardingFixture(await fixture());
      const attempt = await f.start();
      const start = await f.browser(
        `/connect/company/${attempt.attempt_id}/provider`,
        { revision: attempt.attempt_revision, mode: "user" },
      );
      expect(start.status).toBe(200);
      const target = new URL(((await start.json()) as { url: string }).url);
      const release = f.pauseProvider();
      const pending = f.browser(
        `/admin/fortnox/callback?${new URLSearchParams({ state: target.searchParams.get("state") ?? "", code: "A" })}`,
      );
      try {
        await vi.waitFor(() => expect(f.calls()).toBe(1));
        const status = await f.request("/admin/settings", undefined, {
          cookie: f.cookie,
        });
        const revision = ((await status.json()) as { revision: number | null })
          .revision;
        expect(
          (
            await f.browser("/admin/settings", {
              expected_revision: revision,
              changes: { externalAppOnboarding: false },
            })
          ).status,
        ).toBe(200);
      } finally {
        release();
      }
      await pending;
      expect(f.calls()).toBe(1);
      expect(await f.app.connections.list(f.owner)).toEqual([]);
    });
  });
}
