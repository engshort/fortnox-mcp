import { expect, it, vi } from "vitest";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import { createProductApplication } from "../../apps/shared/product.js";
import type { AuthConfig } from "../../apps/shared/product-auth.js";
import { onboardingFixture } from "./onboarding.js";

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing synthetic fixture value");
  return value;
}
const day = 86400_000;
type Pair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
};

async function refresh(
  f: Awaited<ReturnType<typeof onboardingFixture>>,
  token: string,
  extra = {},
) {
  return f.request(
    "/auth/oauth2/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token,
      resource: `${f.config.origin}/mcp`,
      ...extra,
    }),
    { authorization: f.client.authorization },
  );
}
async function issued(f: Awaited<ReturnType<typeof onboardingFixture>>) {
  const a = await f.start();
  await f.provider(a);
  const approval = await f.approve(a);
  const r = await f.exchange(approval.target);
  expect(r.status, await r.clone().text()).toBe(200);
  return { a, approval, pair: (await r.json()) as Pair };
}
async function tokenRows(f: Awaited<ReturnType<typeof onboardingFixture>>) {
  const ctx = await f.app.auth.$context;
  return ctx.adapter.findMany<{
    id: string;
    clientId: string;
    sessionId?: string | null;
    expiresAt: Date;
    createdAt: Date;
  }>({
    model: "oauthRefreshToken",
    where: [{ field: "clientId", value: f.client.client_id }],
  });
}

export function onboardingContinuityContract(
  fixture: () => Promise<AuthConfig>,
) {
  it("keeps configured offline access across a 73-hour stop, owner logout, purged attempts and repeated rotations", async () => {
    const f = await onboardingFixture(await fixture(), true);
    const { a, pair } = await issued(f);
    const company = (await f.app.connections.list(f.owner))[0];
    expect(pair.expires_in).toBe(300);
    const rows = await tokenRows(f);
    expect(rows).toHaveLength(1);
    expect(
      new Date(required(rows[0]).expiresAt).getTime() -
        new Date(required(rows[0]).createdAt).getTime(),
    ).toBe(30 * day);
    expect(rows[0]?.sessionId).toBeFalsy();
    await f.app.auth.api.signOut({
      headers: new Headers({ cookie: f.cookie }),
    });
    expect(
      (
        await f.app.auth.api.verifyProductToken({
          body: { token: pair.access_token },
        })
      ).ownerId,
    ).toBe(f.owner);
    const before = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(before + 73 * 3600_000);
      await cleanupProduct(f.config.state);
      expect(
        (
          await f.request(
            `/api/company-onboarding/v1/attempts/${a.attempt_id}`,
            undefined,
            { authorization: f.client.authorization },
          )
        ).status,
      ).toBe(404);
      let current = pair;
      for (let n = 0; n < 3; n++) {
        const r = await refresh(f, current.refresh_token);
        expect(r.status, await r.clone().text()).toBe(200);
        const next = (await r.json()) as Pair;
        expect(next.refresh_token).not.toBe(current.refresh_token);
        expect(next.access_token).not.toBe(current.access_token);
        expect(next.scope).toBe(pair.scope);
        expect(next.expires_in).toBe(300);
        const identity = await f.app.auth.api.verifyProductToken({
          body: { token: next.access_token },
        });
        expect(
          (
            await f.app.connections.authorize(
              f.owner,
              identity.clientId,
              required(company).id,
            )
          ).id,
        ).toBe(required(company).id);
        const live = required(
          (await tokenRows(f)).sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0],
        );
        const expiry = new Date(live.expiresAt).getTime();
        expect(expiry).toBe(Math.floor(Date.now() / 1000) * 1000 + 30 * day);
        for (const space of ["oauth-approval-grants", "oauth-grant-families"]) {
          const row = await f.config.state.get<
            Record<string, { expiresAt: number }>
          >(space, f.owner);
          expect(
            Math.max(
              ...Object.values(required(row).value).map((r) => r.expiresAt),
            ),
          ).toBe(expiry);
        }
        current = next;
        vi.setSystemTime(Date.now() + day);
      }
      const restarted = createProductApplication(
        f.settings,
        f.config,
        async () => {
          throw new Error("No provider call");
        },
      );
      const renewed = await restarted.fetch(
        new Request(`${f.config.origin}/auth/oauth2/token`, {
          method: "POST",
          headers: {
            authorization: f.client.authorization,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: current.refresh_token,
            resource: `${f.config.origin}/mcp`,
          }),
        }),
      );
      expect(renewed.status).toBe(200);
      const last = (await renewed.json()) as Pair;
      const status = await f.mcp(
        last.access_token,
        "get_connection_status",
        required(company).id,
      );
      expect(status.isError).not.toBe(true);
      // Removal of the operator policy fences already detached families as well.
      required(f.settings.offlineClientIds).splice(0);
      await expect(
        f.app.auth.api.verifyProductToken({
          body: { token: last.access_token },
        }),
      ).rejects.toThrow();
      expect((await refresh(f, last.refresh_token)).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves ordinary 24-hour/session-bound tokens and expires an idle offline family after 30 days", async () => {
    const regular = await onboardingFixture(await fixture());
    const { pair: ordinary } = await issued(regular);
    const r = required((await tokenRows(regular))[0]);
    expect(
      new Date(r.expiresAt).getTime() - new Date(r.createdAt).getTime(),
    ).toBe(day);
    expect(r.sessionId).toBeTruthy();
    const f = await onboardingFixture(await fixture(), true);
    const { pair } = await issued(f);
    const before = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(before + 31 * day);
      expect((await refresh(f, pair.refresh_token)).status).toBe(400);
      expect((await refresh(regular, ordinary.refresh_token)).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains offline company isolation and revocation without widening scopes or reactivating old approvals", async () => {
    const f = await onboardingFixture(await fixture(), true);
    const { a, pair } = await issued(f);
    const companyA = required((await f.app.connections.list(f.owner))[0]);
    expect(
      (
        await refresh(f, pair.refresh_token, {
          scope: "mcp:read mcp:write offline_access",
        })
      ).status,
    ).toBe(400);
    const b = await f.start();
    await f.provider(b, "B");
    const approvalB = await f.approve(b);
    expect(approvalB.selection?.map((c) => c.id)).toContain(companyA.id);
    const pairB = (await (await f.exchange(approvalB.target)).json()) as Pair;
    expect((await refresh(f, pair.refresh_token)).status).toBe(400);
    expect((await f.result(a.attempt_id, pair.access_token)).status).toBe(401);
    const identity = await f.app.auth.api.verifyProductToken({
      body: { token: pairB.access_token },
    });
    expect(
      (
        await f.app.connections.authorize(
          f.owner,
          identity.clientId,
          companyA.id,
        )
      ).id,
    ).toBe(companyA.id);
    const revoke = await f.request(
      "/auth/oauth2/revoke",
      new URLSearchParams({
        token: pairB.refresh_token,
        token_type_hint: "refresh_token",
      }),
      { authorization: f.client.authorization },
    );
    expect(revoke.status).toBe(200);
    expect((await refresh(f, pairB.refresh_token)).status).toBe(400);
    await expect(
      f.app.auth.api.verifyProductToken({
        body: { token: pairB.access_token },
      }),
    ).rejects.toThrow();
    expect(await f.app.connections.list(f.owner)).toHaveLength(2);
  });

  it("recovers a lost rotating response through explicit same-company consent, never replaying the old refresh", async () => {
    const f = await onboardingFixture(await fixture(), true);
    const { a, pair } = await issued(f);
    const company = required((await f.app.connections.list(f.owner))[0]);
    const lost = await refresh(f, pair.refresh_token);
    expect(lost.status).toBe(200); // The consumer loses the body; do not use its replacement.
    const calls = f.calls();
    const resume = await f.request(
      `/api/company-onboarding/v1/attempts/${a.attempt_id}/resume`,
      {
        expected_attempt_revision: 1,
        state: crypto.randomUUID(),
        code_challenge: f.challenge,
        code_challenge_method: "S256",
      },
      {
        authorization: f.client.authorization,
        "idempotency-key": crypto.randomUUID(),
      },
    );
    expect(resume.status).toBe(200);
    const next = (await resume.json()) as typeof a;
    const approval = await f.approve(next);
    const replacement = (await (
      await f.exchange(approval.target)
    ).json()) as Pair;
    const identity = await f.app.auth.api.verifyProductToken({
      body: { token: replacement.access_token },
    });
    expect(
      (
        await f.app.connections.authorize(
          f.owner,
          identity.clientId,
          company.id,
        )
      ).id,
    ).toBe(company.id);
    expect(f.calls()).toBe(calls);
    expect((await refresh(f, pair.refresh_token)).status).toBe(400);
    // Replaying the superseded pair cannot invalidate the new approval's family.
    expect(
      (
        await f.app.auth.api.verifyProductToken({
          body: { token: replacement.access_token },
        })
      ).clientId,
    ).toBe(identity.clientId);
  });

  it("renders HTML when onboarding is disabled or the browser route is missing, keeping API errors JSON", async () => {
    const f = await onboardingFixture(await fixture());
    const disabled = createProductApplication(
      { ...f.settings, externalAppOnboarding: false },
      f.config,
    );
    for (const path of [
      "/connect/company/missing",
      `/connect/company/${crypto.randomUUID()}?revision=1`,
    ]) {
      const r = await disabled.fetch(
        new Request(`${f.config.origin}${path}`, {
          headers: { accept: "text/html" },
        }),
      );
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("text/html");
      expect(await r.text()).toContain("Anslutningsförsöket hittades inte");
    }
    const api = await disabled.fetch(
      new Request(`${f.config.origin}/api/company-onboarding/v1/attempts`, {
        headers: { accept: "text/html" },
      }),
    );
    expect(api.headers.get("content-type")).toBe("application/json");
    const missing = await f.browser("/connect/company/missing");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");
    const oauth = await f.browser(
      "/auth/oauth2/authorize?client_id=not-registered&response_type=code",
    );
    expect(oauth.status).toBe(302);
    const target = new URL(
      required(oauth.headers.get("location")),
      f.config.origin,
    );
    expect(target.origin).toBe(f.config.origin);
    expect(target.pathname).toBe("/auth/error");
    const error = await f.browser(target.href);
    expect(error.status).toBe(400);
    expect(error.headers.get("content-type")).toContain("text/html");
  });

  it("returns only to the retained callback with interaction_required and fences stale revisions and redirects", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    await f.provider(a);
    const approved = await f.approve(a);
    await f.app.connections.updateSet(f.owner, (set) => {
      required(set.onboarding?.[0]).expiresAt = Date.now() - 1;
    });
    const page = await f.browser(a.authorization_url);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("Fortsätt i Synthetic consumer");
    const path = `/connect/company/${a.attempt_id}/return`;
    const returned = await f.browser(path, { revision: 1 });
    expect(returned.status).toBe(200);
    const target = new URL(((await returned.json()) as { url: string }).url);
    expect(target.origin + target.pathname).toBe(a.input.redirect_uri);
    expect(Object.fromEntries(target.searchParams)).toEqual({
      error: "interaction_required",
      state: a.input.state,
      iss: `${f.config.origin}/auth`,
    });
    expect(
      (
        await f.request(
          path,
          { revision: 1 },
          { cookie: f.cookie, origin: "https://foreign.example.invalid" },
        )
      ).status,
    ).toBe(403);
    expect((await f.browser(path, { revision: 2 })).status).toBe(409);
    const resume = await f.request(
      `/api/company-onboarding/v1/attempts/${a.attempt_id}/resume`,
      {
        expected_attempt_revision: 1,
        state: crypto.randomUUID(),
        code_challenge: "b".repeat(43),
        code_challenge_method: "S256",
      },
      {
        authorization: f.client.authorization,
        "idempotency-key": crypto.randomUUID(),
      },
    );
    expect(resume.status).toBe(200);
    expect((await f.browser(path, { revision: 1 })).status).toBe(409);
    expect((await f.exchange(approved.target)).status).toBe(400);
    const current = await required(f.app.onboarding).get(
      f.owner,
      f.client.client_id,
      a.attempt_id,
    );
    expect(current.revision).toBe(2);
    expect(current.company).toBeTruthy();
    const request = await required(f.app.onboarding).request(f.owner, current);
    expect(request.state).not.toBe(a.input.state);
    expect(request.code_challenge).toBe("b".repeat(43));
    await f.app.connections.updateSet(f.owner, (set) => {
      required(set.onboarding?.[0]).expiresAt = Date.now() - 1;
    });
    f.settings.redirects.splice(0);
    const denied = await f.browser(path, { revision: 2 });
    expect(denied.status).toBe(400);
    expect(await denied.text()).not.toContain(a.input.redirect_uri);
    f.settings.redirects.push(a.input.redirect_uri);
    await f.app.connections.updateSet(f.owner, (set) => {
      required(set.onboarding?.[0]).retainUntil = Date.now() - 1;
    });
    const purged = await f.browser(
      a.authorization_url.replace("revision=1", "revision=2"),
    );
    expect(purged.status).toBe(404);
    expect(await purged.text()).not.toContain(a.input.state);
  });

  it("preserves the local attempt across login and provider return without saving or exchanging old callback codes", async () => {
    const f = await onboardingFixture(await fixture());
    const a = await f.start();
    const started = await f.browser(
      `/connect/company/${a.attempt_id}/provider`,
      { revision: 1, mode: "user" },
    );
    const providerUrl = new URL(
      ((await started.json()) as { url: string }).url,
    );
    const callback = `/admin/fortnox/callback?${new URLSearchParams({ state: required(providerUrl.searchParams.get("state")), code: "never-exchange-after-login" })}`;
    await f.app.auth.api.signOut({
      headers: new Headers({ cookie: f.cookie }),
    });
    const response = await f.request(callback, undefined, {
      accept: "text/html",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/connect/company/${a.attempt_id}?revision=1`,
    );
    const login = await f.request(required(response.headers.get("location")));
    expect(login.headers.get("location")).toBe(
      `/sign-in?company_onboarding=${a.attempt_id}&revision=1`,
    );
    expect(login.headers.get("location")).not.toContain("code");
    expect(f.calls()).toBe(0);
    const query = new URL(
      `${f.config.origin}/auth/oauth2/authorize?${new URLSearchParams({ onboarding_attempt: a.attempt_id, onboarding_revision: "1" })}`,
    );
    const oauth = await f.request(query.href, undefined, {
      accept: "text/html",
    });
    expect(oauth.status).toBe(303);
    expect(oauth.headers.get("location")).toBe(
      response.headers.get("location"),
    );
    const api = await f.request(callback);
    expect(api.status).toBe(401);
  });
}
