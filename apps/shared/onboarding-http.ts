import {
  type CompanyOnboarding,
  DomainError,
  type OnboardingAttempt,
  OnboardingError,
  onboardingResume,
  onboardingStart,
  onboardingVersion,
} from "@fortnox-mcp/core";
import type { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { z } from "zod";
import { boundedJson, safeResponse } from "./admin.js";
import type { IntegrationSettings } from "./integration-settings.js";
import { type Owner, type ProductAuth, requireOwner } from "./product-auth.js";

const base = "/api/company-onboarding/v1/attempts";
const esc = (v: string) =>
  v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const json = (value: unknown, status = 200) =>
  safeResponse(JSON.stringify(value), status);
const redirect = (url: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location: url,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
export function onboardingFailure(error: unknown) {
  const e =
    error instanceof OnboardingError
      ? error
      : error instanceof z.ZodError
        ? new OnboardingError("INVALID_REQUEST", 400)
        : error instanceof DomainError
          ? new OnboardingError(
              error.code === "RATE_LIMITED"
                ? "RATE_LIMITED"
                : "ATTEMPT_CONFLICT",
              error.code === "RATE_LIMITED" ? 429 : 409,
              "owner_review",
            )
          : new OnboardingError("TEMPORARILY_UNAVAILABLE", 503, "resume");
  return json(
    { version: onboardingVersion, error: e.code, recovery_action: e.recovery },
    e.status,
  );
}
export function onboardingRoutes(config: {
  onboarding: CompanyOnboarding;
  auth: ProductAuth;
  provider: FortnoxConnections;
  integration: IntegrationSettings;
  redirects: readonly string[];
}) {
  const { onboarding: service, auth, provider, integration } = config;
  const state = service.connections.state;
  async function validateClient(a: OnboardingAttempt, owner: string) {
    const client = await auth.api
      .getOnboardingClient({ body: { client: a.client } })
      .catch(() => {
        throw new OnboardingError("AUTH_REQUIRED", 401);
      });
    const input = await service.request(owner, a);
    if (
      !config.redirects.includes(input.redirect_uri) ||
      !client.redirects.includes(input.redirect_uri)
    )
      throw new OnboardingError("REDIRECT_DENIED", 400);
    return input;
  }
  function oauth(a: OnboardingAttempt, input: z.infer<typeof onboardingStart>) {
    return `${service.origin}/auth/oauth2/authorize?${new URLSearchParams({ client_id: a.client, response_type: "code", redirect_uri: input.redirect_uri, state: input.state, scope: input.scope, code_challenge: input.code_challenge, code_challenge_method: "S256", resource: `${service.origin}/mcp`, onboarding_attempt: a.id, onboarding_revision: String(a.revision) })}`;
  }
  async function budget() {
    for (let n = 0; n < 8; n++) {
      const r = await state.get<{ until: number; count: number }>(
        "onboarding-rate",
        "installation",
      );
      const v =
        r && r.value.until > Date.now()
          ? r.value
          : { until: Date.now() + 60_000, count: 0 };
      if (v.count >= 60) throw new OnboardingError("RATE_LIMITED", 429, "wait");
      if (
        await state.put(
          "onboarding-rate",
          "installation",
          { until: v.until, count: v.count + 1 },
          r?.version ?? null,
        )
      )
        return;
    }
    throw new OnboardingError("RATE_LIMITED", 429, "wait");
  }
  async function fetch(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname === "/connect/company.js" && request.method === "GET")
      return safeResponse(
        `for(const form of document.querySelectorAll('form[data-action]'))form.addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const input=Object.fromEntries(new FormData(form));input.revision=Number(input.revision);const r=await fetch(form.dataset.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const d=await r.json();if(r.ok&&d.url)location.assign(d.url);else{document.querySelector('#status').textContent='Åtgärden kunde inte slutföras. '+(d.error||'Försök igen från applikationen.');button.disabled=false;}}catch{document.querySelector('#status').textContent='Svaret saknas. Ladda om för att kontrollera utfallet innan du försöker igen.';}});`,
        200,
        "text/javascript",
      );
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      try {
        if (url.search || request.headers.has("cookie"))
          throw new OnboardingError("INVALID_REQUEST", 400);
        await budget();
        const owner = (await state.get<Owner>("installation", "owner"))?.value;
        if (owner?.phase !== "active")
          throw new OnboardingError("AUTH_REQUIRED", 401);
        const match = new RegExp(
          `^${base}/([a-f0-9-]{36})(/(resume|result))?$`,
        ).exec(url.pathname);
        const result = match?.[3] === "result";
        if (result && request.method === "GET") {
          const header = request.headers.get("authorization") ?? "";
          if (!/^Bearer [^\s]+$/i.test(header))
            throw new OnboardingError("AUTH_REQUIRED", 401);
          const identity = await auth.api
            .verifyProductToken({ body: { token: header.slice(7) } })
            .catch(() => {
              throw new OnboardingError("AUTH_REQUIRED", 401);
            });
          if (!service.clients.includes(identity.oauthClientId))
            throw new OnboardingError("AUTH_REQUIRED", 401);
          const attempt = await service.get(
            identity.ownerId,
            identity.oauthClientId,
            match?.[1] ?? "",
          );
          await validateClient(attempt, identity.ownerId);
          return json(
            await service.result(
              identity.ownerId,
              identity.oauthClientId,
              identity.clientId,
              match?.[1] ?? "",
            ),
          );
        }
        if (!/^Basic [^\s]+$/i.test(request.headers.get("authorization") ?? ""))
          throw new OnboardingError("AUTH_REQUIRED", 401);
        const input =
          url.pathname === base && request.method === "POST"
            ? onboardingStart.parse(await boundedJson(request))
            : undefined;
        const client = await auth.api
          .authenticateOnboardingClient({
            asResponse: false,
            request: new Request(request.url, {
              method: "POST",
              headers: {
                authorization: request.headers.get("authorization") ?? "",
              },
            }),
            headers: request.headers,
            body: { scopes: input?.scope.split(" ") ?? ["mcp:read"] },
          })
          .catch(() => {
            throw new OnboardingError("AUTH_REQUIRED", 401);
          });
        if (!service.clients.includes(client.clientId))
          throw new OnboardingError("AUTH_REQUIRED", 401);
        if (input) {
          if (
            !config.redirects.includes(input.redirect_uri) ||
            !client.redirects.includes(input.redirect_uri)
          )
            throw new OnboardingError("REDIRECT_DENIED", 400);
          const key = z
            .string()
            .uuid()
            .parse(request.headers.get("idempotency-key"));
          return json(
            await service.start(
              owner.ownerId,
              client.clientId,
              client.name,
              key,
              input,
            ),
            201,
          );
        }
        if (!match) throw new OnboardingError("ATTEMPT_NOT_FOUND", 404);
        const id = match[1] as string;
        if (request.method === "GET" && !match[3])
          return json(
            service.status(
              await service.get(owner.ownerId, client.clientId, id),
            ),
          );
        if (request.method === "POST" && match[3] === "resume") {
          const key = z
            .string()
            .uuid()
            .parse(request.headers.get("idempotency-key"));
          const a = await service.get(owner.ownerId, client.clientId, id);
          await validateClient(a, owner.ownerId);
          return json(
            await service.resume(
              owner.ownerId,
              client.clientId,
              id,
              key,
              onboardingResume.parse(await boundedJson(request)),
            ),
          );
        }
        throw new OnboardingError("INVALID_REQUEST", 400);
      } catch (e) {
        return onboardingFailure(e);
      }
    }
    const browser =
      /^\/connect\/company\/([a-f0-9-]{36})(?:\/(choose|provider|approve|cancel|cancel-provider|recover-session))?$/.exec(
        url.pathname,
      );
    if (!browser) return null;
    const id = browser[1] as string;
    let session: Awaited<ReturnType<typeof requireOwner>>;
    try {
      session = await requireOwner(auth, state, request.headers);
    } catch {
      if (request.method === "GET") {
        const revision = z.coerce
          .number()
          .int()
          .positive()
          .safeParse(url.searchParams.get("revision"));
        if (!revision.success)
          return onboardingFailure(new OnboardingError("INVALID_REQUEST", 400));
        return redirect(
          `/sign-in?${new URLSearchParams({ company_onboarding: id, revision: String(revision.data) })}`,
        );
      }
      return onboardingFailure(new OnboardingError("AUTH_REQUIRED", 401));
    }
    try {
      const record = (
        await service.connections.snapshot(session.user.id)
      )?.value.onboarding?.find(
        (a) => a.id === id && a.retainUntil > service.now(),
      );
      const needsReview =
        record?.session &&
        ["provider_pending", "provider_outcome_unknown", "failed"].includes(
          record.phase,
        ) &&
        (record.session !== session.session.id ||
          record.expiresAt <= service.now());
      if (needsReview && record?.session) {
        const old = await (await auth.$context).adapter.findOne<{
          expiresAt: Date;
        }>({
          model: "session",
          where: [{ field: "id", value: record.session }],
        });
        if (
          record.session !== session.session.id &&
          old &&
          new Date(old.expiresAt).getTime() > service.now()
        )
          throw new OnboardingError("AUTH_REQUIRED", 401);
        await validateClient(record, session.user.id);
        if (request.method === "GET" && !browser[2])
          return safeResponse(
            `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Återuppta ägargranskning</title><link rel="stylesheet" href="/admin-assets/admin.css"><main class="login"><h1>Återuppta ägargranskning</h1><p>Ägarsessionen har gått ut. Kontrollera det sparade utfallet. Ingen Fortnox-kod skickas igen.</p><form data-action="/connect/company/${id}/recover-session"><input type="hidden" name="revision" value="${record.revision}"><button>Fortsätt granska med denna ägarsession</button></form><p id="status" role="status"></p><script src="/connect/company.js"></script></main></html>`,
            200,
            "text/html; charset=utf-8",
          );
        if (request.method === "POST" && browser[2] === "recover-session") {
          if (request.headers.get("origin") !== service.origin)
            throw new OnboardingError("AUTH_REQUIRED", 401);
          const input = z
            .object({ revision: z.number().int().positive() })
            .strict()
            .parse(await boundedJson(request));
          if (input.revision !== record.revision)
            throw new OnboardingError("ATTEMPT_CONFLICT");
          const flow = await provider.onboardingFlow(
            session.user.id,
            id,
            record.revision,
          );
          if (flow?.claimed && flow.expiresAt > service.now())
            throw new OnboardingError("CONSENT_IN_PROGRESS", 409, "wait");
          if (flow && !flow.claimed)
            await provider.cancelOnboardingPending(
              session.user.id,
              record.session,
              id,
              record.revision,
            );
          await service.rebindForReview(
            session.user.id,
            id,
            record.revision,
            record.session,
            session.session.id,
          );
          return json({
            url: `${service.origin}/connect/company/${id}?revision=${record.revision}`,
          });
        }
        throw new OnboardingError("AUTH_REQUIRED", 401);
      }
      if (request.method === "GET" && !browser[2]) {
        const revision = z.coerce
          .number()
          .int()
          .positive()
          .parse(url.searchParams.get("revision"));
        const a = await service.ownerAttempt(
          session.user.id,
          id,
          revision,
          session.session.id,
        );
        await validateClient(a, session.user.id);
        const companies = (
          await service.connections.list(session.user.id)
        ).filter(
          (c) =>
            c.state === "active" &&
            (!a.expected || c.id === a.expected.id) &&
            (!a.company || c.id === a.company.id),
        );
        const path = `/connect/company/${id}`;
        const hidden = `<input type="hidden" name="revision" value="${revision}">`;
        const choices = companies
          .map(
            (c) =>
              `<form data-action="${path}/choose">${hidden}<input type="hidden" name="company_id" value="${c.id}"><button>Välj ${esc(c.name)} — ${esc(c.organizationNumber)}</button></form>`,
          )
          .join("");
        const start =
          !a.company && ["pending_owner", "failed"].includes(a.phase)
            ? `<form data-action="${path}/provider">${hidden}<label>Anslutningstyp <select name="mode"><option value="service">Servicekonto</option><option value="user">Användare</option></select></label><button>Fortsätt till Fortnox</button></form>`
            : "";
        const approve =
          a.company &&
          ["company_verified", "approval_pending"].includes(a.phase)
            ? `<form data-action="${path}/approve">${hidden}<button>Fortsätt till appgodkännande</button></form>`
            : "";
        const pending =
          a.phase === "provider_pending"
            ? `<p>Ett Fortnox-medgivande pågår. Skicka inte koden igen.</p><form data-action="${path}/cancel-provider">${hidden}<button>Avbryt oanvänt medgivande</button></form>`
            : "";
        const unknown =
          a.phase === "provider_outcome_unknown"
            ? "<p>Utfallet av Fortnox-utbytet är okänt. Ingen kod skickas igen. Om företaget redan finns kan du uttryckligen välja och verifiera den befintliga anslutningen nedan. Annars behöver installationsägaren utreda utfallet.</p>"
            : "";
        return safeResponse(
          `<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anslut företag</title><link rel="stylesheet" href="/admin-assets/admin.css"><main class="login"><h1>Anslut företag</h1><p>Applikation: <strong>${esc(a.clientName)}</strong></p><p>Välj eller anslut företaget och godkänn sedan appens åtkomst. Ingen företagspolicy ändras.</p>${pending}${unknown}${["pending_owner", "company_verified", "failed", "provider_outcome_unknown"].includes(a.phase) ? choices : ""}${start}${approve}${!["provider_pending", "provider_outcome_unknown", "authorized"].includes(a.phase) ? `<form data-action="${path}/cancel">${hidden}<button>Avbryt och återgå till applikationen</button></form>` : ""}<p id="status" role="status"></p><script src="/connect/company.js"></script></main></html>`,
          200,
          "text/html; charset=utf-8",
        );
      }
      if (
        request.method !== "POST" ||
        request.headers.get("origin") !== service.origin
      )
        throw new OnboardingError("AUTH_REQUIRED", 401);
      const input = z
        .object({
          revision: z.number().int().positive(),
          company_id: z.string().uuid().optional(),
          mode: z.enum(["service", "user"]).optional(),
        })
        .strict()
        .parse(await boundedJson(request));
      const a = await service.ownerAttempt(
        session.user.id,
        id,
        input.revision,
        session.session.id,
        true,
      );
      const protocol = await validateClient(a, session.user.id);
      if (browser[2] === "choose") {
        const c = (await service.connections.list(session.user.id)).find(
          (c) => c.id === input.company_id && c.state === "active",
        );
        if (
          !c ||
          (a.expected && a.expected.id !== c.id) ||
          (a.company && a.company.id !== c.id)
        )
          throw new OnboardingError("ATTEMPT_CONFLICT");
        const credentials = await service.connections.credentials(
          session.user.id,
          c,
        );
        await provider.verify(
          session.user.id,
          {
            ...credentials,
            accessToken: await provider.token(session.user.id, c),
          },
          c.tenant,
        );
        await service.choose(
          session.user.id,
          id,
          a.revision,
          session.session.id,
          c.id,
        );
      } else if (browser[2] === "provider") {
        const binding = await service.reserveProvider(
          session.user.id,
          id,
          a.revision,
          session.session.id,
        );
        try {
          const credentials = await integration.credentials(session.user.id);
          if (!credentials || !input.mode)
            throw new OnboardingError("INVALID_REQUEST", 400);
          return json({
            url: await provider.start(
              session.user.id,
              session.session.id,
              { ...credentials, mode: input.mode },
              a.expected?.id,
              undefined,
              binding,
            ),
          });
        } catch (e) {
          await service.providerFailure(session.user.id, binding, false);
          throw e;
        }
      } else if (browser[2] === "approve") {
        if (
          !a.company ||
          !["company_verified", "approval_pending"].includes(a.phase)
        )
          throw new OnboardingError("ATTEMPT_CONFLICT");
        return json({ url: oauth(a, protocol) });
      } else if (browser[2] === "cancel") {
        await service.cancel(
          session.user.id,
          id,
          a.revision,
          session.session.id,
        );
        const target = new URL(protocol.redirect_uri);
        target.searchParams.set("state", protocol.state);
        target.searchParams.set("error", "access_denied");
        target.searchParams.set("iss", `${service.origin}/auth`);
        return json({ url: target.href });
      } else if (browser[2] === "cancel-provider") {
        await provider.cancelOnboardingPending(
          session.user.id,
          session.session.id,
          id,
          a.revision,
        );
      } else throw new OnboardingError("INVALID_REQUEST", 400);
      return json({
        url: `${service.origin}/connect/company/${id}?revision=${a.revision}`,
      });
    } catch (e) {
      return onboardingFailure(e);
    }
  }
  return { fetch };
}
