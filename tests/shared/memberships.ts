import {
  type AccountingProvider,
  Bookkeeping,
  type CompanyGrant,
  Memberships,
  principalGrantKey,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig, Owner } from "../../apps/shared/product-auth.js";
import { syntheticReferences, syntheticVoucher } from "./accounting.js";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";

export function membershipContract(fixture: () => Promise<AuthConfig>) {
  describe("installation memberships", () => {
    async function seed(enabled = true, restApi = false) {
      const config = await fixture();
      const settings = {
        origin: config.origin,
        secret: config.secret,
        keys: { a: keyA },
        activeKey: "a",
        redirects: ["https://client.example.invalid/callback"],
        testMode: false,
        clientId: "",
        clientSecret: "",
        testTenants: [],
        multiUser: enabled,
        restApi,
        membershipProvisioning: enabled,
      };
      const app = createProductApplication(settings, config, async () => {
        throw new Error("Unexpected provider call");
      });
      const ownerAccount = await app.auth.api.signUpEmail({
        body: {
          email: "owner@example.invalid",
          name: "Synthetic owner",
          password: "Synthetic-password-123456",
        },
        returnHeaders: true,
      });
      const owner = ownerAccount.response.user.id;
      await config.state.put<Owner>(
        "installation",
        "owner",
        { phase: "active", ownerId: owner, tokenHash: "", expiresAt: 0 },
        null,
      );
      const cookie = ownerAccount.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const company = await app.connections.add(
        owner,
        {
          ...syntheticCompany,
          scopes: [
            "companyinformation",
            "profile",
            "bookkeeping",
            "settings",
            "costcenter",
            "project",
          ],
        },
        syntheticCredentials,
      );
      await app.connections.setAccountingPolicy(
        owner,
        company.id,
        company.policyVersion,
        "review_required",
        false,
      );
      const other = await app.connections.add(
        owner,
        { ...syntheticCompany, tenant: "100002", name: "Synthetic B" },
        syntheticCredentials,
      );
      const request = (
        path: string,
        body?: unknown,
        options: { method?: string; headers?: Record<string, string> } = {},
      ) =>
        app.fetch(
          new Request(`${config.origin}${path}`, {
            method: options.method ?? (body === undefined ? "GET" : "POST"),
            headers: {
              "content-type":
                body instanceof URLSearchParams
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
              ...options.headers,
            },
            ...(body === undefined
              ? {}
              : {
                  body:
                    body instanceof URLSearchParams
                      ? body
                      : JSON.stringify(body),
                }),
          }),
        );
      const browser = { cookie, origin: config.origin };
      async function member(
        email = "member@example.invalid",
        access: "read" | "read_write" = "read",
        role: "member" | "admin" = "member",
      ) {
        const account = await app.auth.api.signUpEmail({
          body: {
            email,
            name: "Synthetic member",
            password: "Synthetic-password-123456",
          },
          returnHeaders: true,
        });
        const saved = await app.memberships.save(
          owner,
          null,
          {
            email,
            name: "Synthetic member",
            role,
            active: true,
            companies: { [company.id]: access },
          },
          null,
        );
        const linked = await app.memberships.link(
          owner,
          saved.id,
          saved.revision,
          account.response.user.id,
          "local",
          saved.externalId,
        );
        const memberCookie = account.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; ");
        return {
          member: linked,
          subject: account.response.user.id,
          cookie: memberCookie,
          browser: { cookie: memberCookie, origin: config.origin },
        };
      }
      return {
        config,
        settings,
        app,
        owner,
        company,
        other,
        cookie,
        browser,
        request,
        member,
      };
    }
    type Fixture = Awaited<ReturnType<typeof seed>>;
    async function oauth(
      f: Fixture,
      client: string,
      cookie: string,
      companies = [f.company],
      resource: "mcp" | "api" = "mcp",
    ) {
      const verifier =
        "synthetic-membership-pkce-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
      const challenge = btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(verifier),
            ),
          ),
        ),
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const params = new URLSearchParams({
        response_type: "code",
        client_id: client,
        redirect_uri: f.settings.redirects[0] ?? "",
        scope:
          resource === "api"
            ? "api:read offline_access"
            : "mcp:read mcp:write mcp:files offline_access",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: `${f.config.origin}${resource === "api" ? "/api/v1" : "/mcp"}`,
        state: "synthetic-membership-state",
      });
      const authorize = await f.request(
        `/auth/oauth2/authorize?${params}`,
        undefined,
        { headers: { cookie } },
      );
      const target =
        authorize.headers.get("location") ??
        ((await authorize.json()) as { url: string }).url;
      const consent = new URL(target, f.config.origin);
      const page = await f.request(
        consent.pathname + consent.search,
        undefined,
        { headers: { cookie } },
      );
      expect(page.status).toBe(200);
      const html = await page.text();
      if (cookie !== f.cookie) expect(html).not.toContain("Synthetic B");
      const approved = await f.request(
        "/auth/oauth2/consent",
        {
          accept: true,
          oauth_query: consent.search.slice(1),
          companies: companies.map((c) => ({
            id: c.id,
            generation: c.generation,
            access_revision: c.accessRevision ?? 0,
          })),
        },
        { headers: { cookie, origin: f.config.origin } },
      );
      expect(approved.status).toBe(200);
      const code =
        new URL(
          ((await approved.json()) as { url: string }).url,
        ).searchParams.get("code") ?? "";
      const tokens = await f.request(
        "/auth/oauth2/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client,
          redirect_uri: f.settings.redirects[0] ?? "",
          code,
          code_verifier: verifier,
          resource: `${f.config.origin}${resource === "api" ? "/api/v1" : "/mcp"}`,
        }),
      );
      expect(tokens.status).toBe(200);
      return (await tokens.json()) as {
        access_token: string;
        refresh_token: string;
      };
    }
    async function register(f: Fixture, resource: "mcp" | "api" = "mcp") {
      const response = await f.request("/auth/oauth2/register", {
        ...(resource === "api"
          ? { resources: [`${f.config.origin}/api/v1`] }
          : {}),
        client_name: "Synthetic shared client",
        redirect_uris: f.settings.redirects,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope:
          resource === "api"
            ? "api:read offline_access"
            : "mcp:read mcp:write mcp:files offline_access",
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { client_id: string }).client_id;
    }
    it("keeps multi-user routes off by default and retains the original owner's access", async () => {
      const f = await seed(false);
      expect(
        (await f.request("/api/me", undefined, { headers: f.browser })).status,
      ).toBe(404);
      expect(
        (await f.request("/admin/state", undefined, { headers: f.browser }))
          .status,
      ).toBe(200);
      await expect(
        f.app.memberships.save(
          f.owner,
          null,
          {
            email: "new@example.invalid",
            name: "New",
            role: "member",
            active: true,
            companies: {},
          },
          null,
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    });
    it("separates administrator sessions from employees and never treats MCP credentials as admin sessions", async () => {
      const f = await seed();
      const admin = await f.member(
        "admin@example.invalid",
        "read_write",
        "admin",
      );
      const employee = await f.member();
      const signedIn = await f.request(
        "/auth/sign-in/email",
        { email: employee.member.email, password: "Synthetic-password-123456" },
        { headers: { origin: f.config.origin } },
      );
      expect(signedIn.status).toBe(200);
      expect(await signedIn.json()).toEqual({ ok: true, redirect: "/app" });
      expect(
        (await f.request("/admin/state", undefined, { headers: admin.browser }))
          .status,
      ).toBe(200);
      expect(
        (
          await f.request("/admin/state", undefined, {
            headers: employee.browser,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await f.request("/admin/members/state", undefined, {
            headers: employee.browser,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await f.request("/admin/members/state", undefined, {
            headers: { authorization: "Bearer synthetic" },
          })
        ).status,
      ).toBe(401);
      const me = (await (
        await f.request("/api/me", undefined, { headers: employee.browser })
      ).json()) as { companies: Array<{ company_id: string }> };
      expect(me.companies.map((c) => c.company_id)).toEqual([f.company.id]);
      expect(JSON.stringify(me)).not.toContain("integration");
      expect(
        (
          await f.request(
            "/admin/members/block",
            {
              id: admin.member.id,
              revision: admin.member.revision,
              blocked: true,
            },
            { headers: { ...f.browser, origin: "https://foreign.invalid" } },
          )
        ).status,
      ).toBe(403);
    });
    it("isolates member REST approvals by subject, projects read-only access and fences revocation", async () => {
      const f = await seed(true, true);
      const a = await f.member();
      const b = await f.member("api-second@example.invalid", "read_write");
      const client = await register(f, "api");
      const ta = await oauth(f, client, a.cookie, [f.company], "api");
      const tb = await oauth(f, client, b.cookie, [f.company], "api");
      const headers = (token: string) => ({ authorization: `Bearer ${token}` });
      const list = async (token: string) =>
        f.request("/api/v1/companies", undefined, { headers: headers(token) });
      const ar = await list(ta.access_token);
      expect(ar.status).toBe(200);
      expect(await ar.json()).toMatchObject({
        data: {
          count: 1,
          companies: [{ company_id: f.company.id, read_only: true }],
        },
      });
      const br = await list(tb.access_token);
      expect(br.status).toBe(200);
      expect(await br.json()).toMatchObject({
        data: {
          count: 1,
          companies: [{ company_id: f.company.id, read_only: false }],
        },
      });
      expect(
        (
          await f.request(
            `/api/v1/companies/${f.other.id}/profile`,
            undefined,
            { headers: headers(ta.access_token) },
          )
        ).status,
      ).toBe(403);
      await expect(
        f.app.auth.api.verifyProductToken({ body: { token: ta.access_token } }),
      ).rejects.toThrow();
      const ia = await f.app.auth.api.verifyProductToken({
        body: { token: ta.access_token, resource: "api" },
      });
      expect(ia.subjectId).toBe(a.subject);
      await f.app.memberships.block(
        f.owner,
        a.member.id,
        a.member.revision,
        true,
      );
      expect((await list(ta.access_token)).status).toBe(401);
      expect((await list(tb.access_token)).status).toBe(200);
      await expect(
        f.app.connections.authorize(
          ia.ownerId,
          ia.clientId,
          f.company.id,
          true,
          "api",
        ),
      ).rejects.toThrow();
      expect(
        (
          await f.request(
            "/auth/oauth2/token",
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: client,
              refresh_token: ta.refresh_token,
              resource: `${f.config.origin}/api/v1`,
            }),
          )
        ).status,
      ).toBe(400);
    });
    it("isolates two users of one OAuth registration, blocks read-only preparation and requires new consent after membership changes", async () => {
      const f = await seed();
      const a = await f.member();
      const b = await f.member("second@example.invalid", "read_write");
      const client = await register(f);
      const ta = await oauth(f, client, a.cookie);
      const tb = await oauth(f, client, b.cookie);
      const ia = await f.app.auth.api.verifyProductToken({
        body: { token: ta.access_token },
      });
      const ib = await f.app.auth.api.verifyProductToken({
        body: { token: tb.access_token },
      });
      expect(ia.subjectId).toBe(a.subject);
      expect(ib.subjectId).toBe(b.subject);
      expect(ia.clientId).not.toBe(ib.clientId);
      expect(
        (
          await f.app.connections.authorize(
            ia.ownerId,
            ia.clientId,
            f.company.id,
          )
        ).readOnly,
      ).toBe(true);
      expect(
        (
          await f.app.connections.authorize(
            ib.ownerId,
            ib.clientId,
            f.company.id,
          )
        ).readOnly,
      ).toBe(false);
      await expect(
        f.app.connections.authorize(ia.ownerId, ia.clientId, f.other.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      let calls = 0;
      const provider: AccountingProvider = {
        years: async () => {
          throw new Error("Unexpected");
        },
        references: async (_actor, company) => {
          calls++;
          return syntheticReferences(company);
        },
        submit: async () => {
          calls++;
          return { state: "outcome_unknown" };
        },
        read: async () => {
          throw new Error("Unexpected");
        },
      };
      const service = new Bookkeeping(f.app.connections, provider, {
        references: true,
        writes: true,
        reviewHost: true,
      });
      await expect(
        service.prepare(ia, syntheticVoucher(f.company.id)),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(calls).toBe(0);
      const proposal = await service.prepare(
        ib,
        syntheticVoucher(f.company.id),
      );
      await expect(service.status(ia, proposal)).rejects.toThrow();
      const blocked = await f.app.memberships.block(
        f.owner,
        a.member.id,
        a.member.revision,
        true,
      );
      const deniedLogin = await f.request(
        "/auth/sign-in/email",
        { email: a.member.email, password: "Synthetic-password-123456" },
        { headers: { origin: f.config.origin } },
      );
      expect(deniedLogin.status).toBe(401);
      expect(deniedLogin.headers.getSetCookie()).toHaveLength(0);
      await expect(
        f.app.auth.api.verifyProductToken({ body: { token: ta.access_token } }),
      ).rejects.toThrow();
      await f.app.memberships.block(
        f.owner,
        blocked.id,
        blocked.revision,
        false,
      );
      await expect(
        f.app.auth.api.verifyProductToken({ body: { token: ta.access_token } }),
      ).rejects.toThrow();
      expect(
        (
          await f.request(
            "/auth/oauth2/token",
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: client,
              refresh_token: ta.refresh_token,
              resource: `${f.config.origin}/mcp`,
            }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await f.app.auth.api.verifyProductToken({
            body: { token: tb.access_token },
          })
        ).subjectId,
      ).toBe(b.subject);
      const registrations = (await (
        await f.request("/api/me", undefined, { headers: b.browser })
      ).json()) as {
        clients: Array<{
          registration_key: string;
          revision: number;
          current: boolean;
        }>;
      };
      const own = registrations.clients[0];
      if (!own) throw new Error("Missing synthetic client grant");
      const revoke = {
        registration_key: own.registration_key,
        revision: own.revision,
      };
      expect(
        (
          await f.request("/api/me/clients/revoke", revoke, {
            headers: a.browser,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await f.request("/api/me/clients/revoke", revoke, {
            headers: b.browser,
          })
        ).status,
      ).toBe(200);
      await expect(
        f.app.auth.api.verifyProductToken({ body: { token: tb.access_token } }),
      ).rejects.toThrow();
      await expect(
        f.app.connections.authorize(ib.ownerId, ib.clientId, f.company.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      const revoked = (await (
        await f.request("/api/me", undefined, { headers: b.browser })
      ).json()) as typeof registrations;
      expect(revoked.clients[0]?.current).toBe(false);
    });
    it("rejects forged installation-wide member consent and keeps owner grants separate", async () => {
      const f = await seed();
      const a = await f.member();
      const p = await f.app.memberships.principal(a.subject);
      await expect(
        f.app.connections.renewGrant(
          f.owner,
          "client",
          [],
          undefined,
          "owner_connections",
          "mcp",
          p,
        ),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        f.app.connections.renewGrant(
          f.owner,
          "client",
          [
            {
              id: f.other.id,
              generation: f.other.generation,
              access_revision: 0,
            },
          ],
          undefined,
          undefined,
          "mcp",
          p,
        ),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      const ownerGrant = await f.app.connections.renewGrant(
        f.owner,
        "client",
        [],
        undefined,
        "owner_connections",
      );
      const g = await f.app.connections.renewGrant(
        f.owner,
        "client",
        [
          {
            id: f.company.id,
            generation: f.company.generation,
            access_revision: 0,
          },
        ],
        undefined,
        undefined,
        "mcp",
        p,
      );
      expect(ownerGrant.grantId).not.toBe(g.grantId);
      expect(
        (await f.config.state.get<CompanyGrant>("company-grants", "client"))
          ?.value.grantId,
      ).toBe(ownerGrant.grantId);
      expect(
        (
          await f.config.state.get<CompanyGrant>(
            "company-grants",
            principalGrantKey(f.owner, a.subject, "client"),
          )
        )?.value.grantId,
      ).toBe(g.grantId);
    });
    it("provisions through the generic API with source boundaries, explicit deactivation, revision and idempotency recovery", async () => {
      const f = await seed();
      const source = await f.app.memberships.source(f.owner, {
        name: "Generic client",
        allowAdmins: false,
        companies: [f.company.id],
      });
      const otherSource = await f.app.memberships.source(f.owner, {
        name: "Other",
        allowAdmins: true,
        companies: [f.other.id],
      });
      const key = crypto.randomUUID();
      const path = "/api/membership-provisioning/v1/users/external-001";
      const input = {
        email: "external@example.invalid",
        name: "Synthetic external",
        role: "member",
        active: true,
        companies: { [f.company.id]: "read" },
      };
      const headers = {
        authorization: `Bearer ${source.token}`,
        "idempotency-key": key,
        "if-none-match": "*",
      };
      const create = () => f.request(path, input, { method: "PUT", headers });
      const first = await create();
      expect(first.status).toBe(201);
      const saved = (await first.json()) as {
        user: { id: string; revision: number };
      };
      expect(await (await create()).json()).toEqual(saved);
      expect(
        (
          await f.request(
            path,
            { ...input, name: "Changed" },
            { method: "PUT", headers },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await f.request(path, undefined, {
            headers: { authorization: `Bearer ${otherSource.token}` },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await f.request(
            path,
            { ...input, role: "admin" },
            {
              method: "PUT",
              headers: {
                authorization: headers.authorization,
                "idempotency-key": crypto.randomUUID(),
                "if-match": '"1"',
              },
            },
          )
        ).status,
      ).toBe(403);
      const blocked = await f.app.memberships.block(
        f.owner,
        saved.user.id,
        saved.user.revision,
        true,
      );
      const update = await f.request(
        path,
        { ...input, active: false },
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${source.token}`,
            "idempotency-key": crypto.randomUUID(),
            "if-match": `"${blocked.revision}"`,
          },
        },
      );
      expect(update.status).toBe(200);
      expect(
        (
          (await update.json()) as {
            user: { blocked: boolean; active: boolean };
          }
        ).user,
      ).toMatchObject({ blocked: true, active: false });
      const restarted = new Memberships(f.config.state, true);
      expect((await restarted.directory(f.owner)).members).toHaveLength(1);
      await f.app.memberships.rotateSource(
        f.owner,
        source.source.id,
        source.source.revision,
        false,
      );
      expect((await create()).status).toBe(401);
      expect(
        (
          await f.request(path, undefined, {
            headers: { ...headers, cookie: f.cookie },
          })
        ).status,
      ).toBe(401);
    });
    it("requires owner delegation for provisioning admins and cannot link the owner or steal local memberships", async () => {
      const f = await seed();
      const admin = await f.member(
        "admin@example.invalid",
        "read_write",
        "admin",
      );
      await expect(
        f.app.memberships.source(admin.subject, {
          name: "Escalation",
          allowAdmins: true,
          companies: [],
        }),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      const source = await f.app.memberships.source(f.owner, {
        name: "Delegated",
        allowAdmins: true,
        companies: [],
      });
      const created = await f.app.memberships.provision(
        source.token,
        "admin-id",
        {
          email: "synced-admin@example.invalid",
          name: "Synced admin",
          role: "admin",
          active: true,
          companies: {},
        },
        null,
        crypto.randomUUID(),
      );
      expect(created.role).toBe("admin");
      await expect(
        f.app.memberships.link(
          f.owner,
          created.id,
          created.revision,
          f.owner,
          source.source.id,
          "admin-id",
        ),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        f.app.memberships.provision(
          source.token,
          "collision",
          {
            email: admin.member.email,
            name: "Collision",
            role: "admin",
            active: true,
            companies: {},
          },
          null,
          crypto.randomUUID(),
        ),
      ).rejects.toThrow("CONNECTION_CONFLICT");
    });
    it("accepts a one-time invitation, excludes its secret from listings, and does not expose public signup", async () => {
      const f = await seed();
      const member = await f.app.memberships.save(
        f.owner,
        null,
        {
          email: "invited@example.invalid",
          name: "Invited member",
          role: "member",
          active: true,
          companies: { [f.company.id]: "read" },
        },
        null,
      );
      const invitation = await f.request(
        "/admin/members/invitation",
        { id: member.id, revision: member.revision },
        { headers: f.browser },
      );
      expect(invitation.status).toBe(200);
      const link = new URL(
        ((await invitation.json()) as { invitation_url: string })
          .invitation_url,
      );
      const parts = new URLSearchParams(link.hash.slice(1));
      expect(
        await (
          await f.request("/admin/members/state", undefined, {
            headers: f.browser,
          })
        ).text(),
      ).not.toContain(parts.get("token"));
      const body = {
        id: parts.get("id"),
        token: parts.get("token"),
        password: "Synthetic-invitation-password",
      };
      expect(
        (
          await f.request("/api/invitations/accept", body, {
            headers: { origin: f.config.origin },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await f.request("/api/invitations/accept", body, {
            headers: { origin: f.config.origin },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await f.request(
            "/auth/sign-up/email",
            {
              email: "public@example.invalid",
              name: "No",
              password: "Synthetic-password-123456",
            },
            { headers: { origin: f.config.origin } },
          )
        ).status,
      ).toBe(404);
      const actual = (await f.app.memberships.directory(f.owner)).members.find(
        (m) => m.id === member.id,
      );
      expect(actual?.userId).toBeTruthy();
      expect(actual?.invitation).toBeUndefined();
    });
    it("replays a lost machine invitation response without storing plaintext, and never matches existing accounts by email", async () => {
      const f = await seed();
      const source = await f.app.memberships.source(f.owner, {
        name: "Generic",
        allowAdmins: false,
        companies: [],
      });
      const m = await f.app.memberships.provision(
        source.token,
        "external",
        {
          email: "owner@example.invalid",
          name: "Collision",
          role: "member",
          active: true,
          companies: {},
        },
        null,
        crypto.randomUUID(),
      );
      const headers = {
        authorization: `Bearer ${source.token}`,
        "idempotency-key": crypto.randomUUID(),
        "if-match": `"${m.revision}"`,
      };
      const path = "/api/membership-provisioning/v1/users/external/invitation";
      const first = await f.request(path, {}, { headers });
      expect(first.status).toBe(200);
      const response = (await first.json()) as { invitation_url: string };
      expect(await (await f.request(path, {}, { headers })).json()).toEqual(
        response,
      );
      const params = new URLSearchParams(
        new URL(response.invitation_url).hash.slice(1),
      );
      expect(
        JSON.stringify(await f.app.memberships.directory(f.owner)),
      ).not.toContain(params.get("token"));
      expect(
        (
          await f.request(
            "/api/invitations/accept",
            {
              id: params.get("id"),
              token: params.get("token"),
              password: "Synthetic-password-123456",
            },
            { headers: { origin: f.config.origin } },
          )
        ).status,
      ).toBe(409);
      expect(
        (await f.app.memberships.directory(f.owner)).members.find(
          (v) => v.id === m.id,
        )?.userId,
      ).toBeNull();
    });

    it.each(["revoke_before_dispatch", "lost_provider_response"])(
      "preserves durable write state across %s and deactivation",
      async (mode) => {
        const f = await seed();
        await f.app.connections.setAccountingPolicy(
          f.owner,
          f.company.id,
          2,
          "client_managed",
          false,
        );
        const a = await f.member("writer@example.invalid", "read_write");
        const p = await f.app.memberships.principal(a.subject);
        const grant = await f.app.connections.renewGrant(
          f.owner,
          "client",
          [
            {
              id: f.company.id,
              generation: f.company.generation,
              access_revision: 0,
            },
          ],
          undefined,
          undefined,
          "mcp",
          p,
        );
        const actor = {
          ownerId: f.owner,
          clientId: grant.grantId ?? "",
          scopes: ["mcp:read", "mcp:write"],
        };
        let dispatched = 0;
        const provider: AccountingProvider = {
          years: async () => {
            throw new Error("Unexpected");
          },
          references: async (_actor, company) => syntheticReferences(company),
          read: async () => {
            throw new Error("No exact reference");
          },
          submit: async (_actor, _voucher, authorize) => {
            if (mode === "revoke_before_dispatch")
              await f.app.memberships.block(
                f.owner,
                a.member.id,
                a.member.revision,
                true,
              );
            await authorize();
            dispatched++;
            return { state: "outcome_unknown" };
          },
        };
        const service = new Bookkeeping(f.app.connections, provider, {
          references: true,
          writes: true,
          reviewHost: true,
        });
        const prepared = await service.prepare(
          actor,
          syntheticVoucher(f.company.id),
        );
        const ref = {
          company_id: prepared.company_id,
          proposal_id: prepared.proposal_id,
          proposal_hash: prepared.proposal_hash,
        };
        expect((await service.commit(actor, ref, "client")).state).toBe(
          "outcome_unknown",
        );
        expect(dispatched).toBe(mode === "revoke_before_dispatch" ? 0 : 1);
        if (mode === "lost_provider_response")
          await f.app.memberships.block(
            f.owner,
            a.member.id,
            a.member.revision,
            true,
          );
        await expect(service.commit(actor, ref, "client")).rejects.toThrow();
        expect(
          (await f.app.connections.list(f.owner))[0]?.bookkeeping?.executions[0]
            ?.state,
        ).toBe("outcome_unknown");
        expect(dispatched).toBe(mode === "revoke_before_dispatch" ? 0 : 1);
      },
    );
    it("keeps unchanged syncs stable and serializes competing updates", async () => {
      const f = await seed();
      const source = await f.app.memberships.source(f.owner, {
        name: "Generic",
        allowAdmins: false,
        companies: [],
      });
      const input = {
        email: "sync@example.invalid",
        name: "Sync",
        role: "member" as const,
        active: true,
        companies: {},
      };
      const m = await f.app.memberships.provision(
        source.token,
        "sync",
        input,
        null,
        crypto.randomUUID(),
      );
      expect(
        (
          await f.app.memberships.provision(
            source.token,
            "sync",
            input,
            m.revision,
            crypto.randomUUID(),
          )
        ).revision,
      ).toBe(m.revision);
      const competing = await Promise.allSettled(
        [true, false].map((active) =>
          f.app.memberships.provision(
            source.token,
            "sync",
            { ...input, name: "Changed", active },
            m.revision,
            crypto.randomUUID(),
          ),
        ),
      );
      expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(competing.filter((r) => r.status === "rejected")).toHaveLength(1);
    });
    it("expires invitations, restores fail-closed membership state and invalidates temporary secrets on rotation", async () => {
      const f = await seed();
      const a = await f.member();
      const source = await f.app.memberships.source(f.owner, {
        name: "Generic",
        allowAdmins: false,
        companies: [],
      });
      const m = await f.app.memberships.save(
        f.owner,
        null,
        {
          email: "pending@example.invalid",
          name: "Pending",
          role: "member",
          active: true,
          companies: {},
        },
        null,
      );
      const invite = await f.app.memberships.invite(f.owner, m.id, m.revision);
      if (!("token" in invite)) throw new Error("Missing synthetic invitation");
      const expired = new Memberships(
        f.config.state,
        true,
        () => Date.now() + 86400001,
      );
      await expect(expired.claimInvitation(m.id, invite.token)).rejects.toThrow(
        "AUTH_REQUIRED",
      );
      await f.app.memberships.maintenance(f.owner, "rotation");
      await expect(
        f.app.memberships.claimInvitation(m.id, invite.token),
      ).rejects.toThrow("AUTH_REQUIRED");
      expect((await f.app.memberships.principal(a.subject)).role).toBe(
        "member",
      );
      await f.app.memberships.maintenance(f.owner, "restore");
      await expect(f.app.memberships.principal(a.subject)).rejects.toThrow(
        "AUTH_REQUIRED",
      );
      await expect(
        f.app.memberships.authenticate(source.token),
      ).rejects.toThrow("AUTH_REQUIRED");
      expect((await f.app.memberships.principal(f.owner)).role).toBe("owner");
    });
  });
}
