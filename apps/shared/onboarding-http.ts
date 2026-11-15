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
import { connectionPage } from "./connection-page.js";
import type { IntegrationSettings } from "./integration-settings.js";
import {
  onboardingPage,
  onboardingRecoveryPage,
  onboardingReturnPage,
} from "./onboarding-page.js";
import { type Owner, type ProductAuth, requireOwner } from "./product-auth.js";

const base = "/api/company-onboarding/v1/attempts";
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
// OAuth/login errors return to a local attempt, never to query-supplied URLs.
export function onboardingGuideRedirect(request: Request) {
  if (
    request.method !== "GET" ||
    !request.headers.get("accept")?.includes("text/html")
  )
    return null;
  const query = new URL(request.url).searchParams;
  const id = z.string().uuid().safeParse(query.get("onboarding_attempt"));
  const revision = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .safeParse(query.get("onboarding_revision"));
  return id.success && revision.success
    ? redirect(`/connect/company/${id.data}?revision=${revision.data}`)
    : null;
}
export function onboardingFailure(error: unknown, request?: Request) {
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
  if (
    request?.method === "GET" &&
    request.headers.get("accept")?.includes("text/html")
  ) {
    const messages: Record<string, [string, string]> = {
      ATTEMPT_EXPIRED: [
        "Anslutningsförsöket har gått ut",
        "Återgå till applikationen och återuppta anslutningen där. Anslut inte företaget på nytt på chans.",
      ],
      ATTEMPT_NOT_FOUND: [
        "Anslutningsförsöket hittades inte",
        "Länken är inte längre tillgänglig. Återgå till applikationen och starta eller återuppta anslutningen där.",
      ],
      INVALID_REQUEST: [
        "Anslutningslänken är ogiltig",
        "Öppna anslutningen på nytt från applikationen.",
      ],
      AUTH_REQUIRED: [
        "Granskningen är inte tillgänglig",
        "Det här försöket kan inte granskas med den aktuella sessionen. Återgå till applikationen eller låt installationsägaren kontrollera försöket.",
      ],
      ATTEMPT_CONFLICT: [
        "Anslutningsförsöket har ändrats",
        "Återgå till applikationen och öppna den senaste anslutningslänken.",
      ],
      OUTCOME_UNKNOWN: [
        "Utfallet behöver kontrolleras",
        "Installationsägaren behöver kontrollera det sparade utfallet. Ingen Fortnox-kod skickas igen.",
      ],
      CONSENT_IN_PROGRESS: [
        "Fortnox-godkännande pågår",
        "Vänta tills det pågående medgivandet är klart. Skicka inte koden igen.",
      ],
    };
    const [title, message] = messages[e.code] ?? [
      "Anslutningen kunde inte visas",
      "Återgå till applikationen och kontrollera anslutningsförsöket där. Ingen åtgärd skickas automatiskt igen.",
    ];
    return safeResponse(
      connectionPage({
        title,
        content: `<div class="consent-heading"><h1>${title}</h1></div><div class="notice"><p>${message}</p></div>`,
      }),
      e.status,
      "text/html; charset=utf-8",
    );
  }
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
        `let busy=false;
const forms=[...document.querySelectorAll('form[data-action]')];
const status=document.querySelector('#status');
for(const form of forms)form.addEventListener('submit',async e=>{
  e.preventDefault();
  if(busy)return;
  const input=Object.fromEntries(new FormData(form));
  input.revision=Number(input.revision);
  busy=true;
  const buttons=forms.flatMap(f=>[...f.querySelectorAll('button:not(:disabled)')]);
  buttons.forEach(b=>b.disabled=true);
  form.setAttribute('aria-busy','true');
  status.textContent='Åtgärden pågår…';
  try{
    const r=await fetch(form.dataset.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    const d=await r.json();
    if(r.ok&&d.url){location.assign(d.url);return;}
    const messages={CONSENT_IN_PROGRESS:'Ett Fortnox-godkännande pågår. Slutför det innan du fortsätter.',OUTCOME_UNKNOWN:'Utfallet behöver kontrolleras. Ladda om för att se det sparade läget. Ingen kod skickas igen.',ATTEMPT_CONFLICT:'Försöket har ändrats. Öppna den senaste anslutningslänken från applikationen.',ATTEMPT_EXPIRED:'Försöket har gått ut. Återuppta anslutningen från applikationen.',AUTH_REQUIRED:'Sessionen kan inte användas för denna åtgärd. Logga in igen via anslutningslänken.'};
    status.textContent=messages[d.error]||'Åtgärden kunde inte slutföras. Kontrollera anslutningsförsöket från applikationen.';
    if(d.error==='ATTEMPT_EXPIRED'||d.error==='AUTH_REQUIRED'){
      const resume=document.createElement('a');
      resume.href=location.href;
      resume.textContent=' Logga in och fortsätt';
      status.append(resume);
    }
    buttons.forEach(b=>b.disabled=false);
    busy=false;
  }catch{
    status.textContent='Svaret saknas. Ladda om för att kontrollera utfallet innan du försöker igen. ';
    const reload=document.createElement('a');
    reload.href=location.href;
    reload.textContent='Kontrollera sparat läge';
    status.append(reload);
  }finally{
    form.removeAttribute('aria-busy');
    status.focus();
  }
});`,
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
      /^\/connect\/company\/([a-f0-9-]{36})(?:\/(choose|provider|approve|cancel|cancel-provider|recover-session|return))?$/.exec(
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
          return onboardingFailure(
            new OnboardingError("INVALID_REQUEST", 400),
            request,
          );
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
      if (!record) throw new OnboardingError("ATTEMPT_NOT_FOUND", 404);
      if (!service.clients.includes(record.client))
        throw new OnboardingError("AUTH_REQUIRED", 401);
      if (request.method === "GET") {
        const revision = z.coerce
          .number()
          .int()
          .positive()
          .safe()
          .parse(url.searchParams.get("revision"));
        if (record.revision !== revision)
          throw new OnboardingError("ATTEMPT_CONFLICT");
      }
      const interrupted =
        record.expiresAt <= service.now() ||
        (!!record.session && record.session !== session.session.id);
      if (
        interrupted &&
        record.session &&
        record.session !== session.session.id
      ) {
        const old = await (await auth.$context).adapter.findOne<{
          expiresAt: Date;
        }>({
          model: "session",
          where: [{ field: "id", value: record.session }],
        });
        if (old && new Date(old.expiresAt).getTime() > service.now())
          throw new OnboardingError("AUTH_REQUIRED", 401);
      }
      if (
        interrupted &&
        !["provider_pending", "provider_outcome_unknown", "failed"].includes(
          record.phase,
        )
      ) {
        const protocol = await validateClient(record, session.user.id);
        if (
          request.method === "GET" &&
          !browser[2] &&
          request.headers.get("accept")?.includes("text/html")
        )
          return safeResponse(
            onboardingReturnPage(record),
            410,
            "text/html; charset=utf-8",
          );
        if (request.method === "POST" && browser[2] === "return") {
          if (request.headers.get("origin") !== service.origin)
            throw new OnboardingError("AUTH_REQUIRED", 401);
          const input = z
            .object({ revision: z.number().int().positive() })
            .strict()
            .parse(await boundedJson(request));
          if (record.revision !== input.revision)
            throw new OnboardingError("ATTEMPT_CONFLICT");
          const target = new URL(protocol.redirect_uri);
          target.searchParams.set("error", "interaction_required");
          target.searchParams.set("state", protocol.state);
          target.searchParams.set("iss", `${service.origin}/auth`);
          return json({ url: target.href });
        }
      }
      const needsReview =
        record?.session &&
        ["provider_pending", "provider_outcome_unknown", "failed"].includes(
          record.phase,
        ) &&
        (record.session !== session.session.id ||
          record.expiresAt <= service.now());
      if (needsReview && record?.session) {
        await validateClient(record, session.user.id);
        if (request.method === "GET" && !browser[2]) {
          const flow = await provider.onboardingFlow(
            session.user.id,
            id,
            record.revision,
          );
          return safeResponse(
            onboardingRecoveryPage(
              record,
              !!flow?.claimed && flow.expiresAt > service.now(),
            ),
            200,
            "text/html; charset=utf-8",
          );
        }
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
        const protocol = await validateClient(a, session.user.id);
        if (a.phase === "company_verified" && a.company)
          return redirect(oauth(a, protocol));
        const companies = (
          await service.connections.list(session.user.id)
        ).filter(
          (c) =>
            c.state === "active" &&
            (!a.expected || c.id === a.expected.id) &&
            (!a.company || c.id === a.company.id),
        );
        return safeResponse(
          onboardingPage(a, companies),
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
      return onboardingFailure(e, request);
    }
  }
  return { fetch };
}
