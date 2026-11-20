import {
  oauthProviderAuthServerMetadata,
  verifyOAuthQueryParams,
} from "@better-auth/oauth-provider";
import {
  type CompanyOnboarding,
  type CompanySync,
  type Connections,
  DomainError,
  type FortnoxBridge,
  featureLabels,
  InstallationAccess,
  installationReference,
  installationScopes,
  type OfficeContacts,
  type OnboardingAttempt,
  OnboardingError,
  programSelection,
  type ReadServices,
  requestActor,
} from "@fortnox-mcp/core";
import {
  createMcpHandler,
  isLegacyRequest,
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { restApi } from "../../packages/rest/src/index.js";
import {
  boundedJson,
  createAdmin,
  privateHeaders,
  safeResponse,
} from "./admin.js";
import { connectionPage, escapeHtml } from "./connection-page.js";
import {
  onboardingFailure,
  onboardingGuideRedirect,
} from "./onboarding-http.js";
import {
  type AuthConfig,
  requireMember,
  requireOwner,
} from "./product-auth.js";
export interface McpIdentity {
  subjectId?: string;
  ownerId: string;
  clientId: string;
  scopes: string[];
}
const publicMessage = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.enum([
    "initialize",
    "notifications/initialized",
    "tools/list",
    "server/discover",
  ]),
});
const publicRequest = z.union([
  publicMessage,
  z.array(publicMessage).min(1).max(8),
]);
const authRoutes = new Set([
  "GET /auth/oauth2/authorize",
  "POST /auth/oauth2/token",
  "POST /auth/oauth2/register",
  "POST /auth/oauth2/consent",
  "POST /auth/oauth2/continue",
  "POST /auth/oauth2/revoke",
]);
export function createProductGateway(
  config: AuthConfig & {
    redirects: readonly string[];
    connections: Connections;
    onboarding?: CompanyOnboarding;
  },
  server: (identity: McpIdentity | null) => McpServer,
  reads: ReadServices,
  bridge?: FortnoxBridge,
  sync?: CompanySync,
  officeContacts?: OfficeContacts,
) {
  const admin = createAdmin(config);
  const auth = admin.auth;
  const installationAccess = new InstallationAccess(
    config.state,
    config.installationAccess,
  );
  const api = restApi({
    origin: config.origin,
    enabled: config.restApi === true,
    services: reads,
    ...(bridge ? { bridge } : {}),
    ...(sync ? { sync } : {}),
    ...(officeContacts ? { officeContacts } : {}),
    authenticate: async (request) => {
      const header = request.headers.get("authorization");
      if (!header || !/^Bearer [^\s]+$/i.test(header))
        throw new DomainError("AUTH_REQUIRED");
      try {
        return requestActor(
          await auth.api.verifyProductToken({
            body: { token: header.slice(7), resource: "api" },
          }),
          "api",
        );
      } catch {
        throw new DomainError("AUTH_REQUIRED");
      }
    },
  });
  const consentResource = (query: URLSearchParams) => {
    const resources = query.getAll("resource");
    if (resources.length > 1) throw new DomainError("AUTH_REQUIRED");
    const resource = resources[0] ?? `${config.origin}/mcp`;
    if (resource === `${config.origin}/mcp`) return "mcp" as const;
    if (resource === `${config.origin}/api/v1` && config.restApi)
      return "api" as const;
    throw new DomainError("AUTH_REQUIRED");
  };
  const challenge = () =>
    new Response("OAuth required", {
      status: 401,
      headers: {
        ...privateHeaders,
        "www-authenticate": `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:read offline_access"`,
      },
    });
  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.origin !== config.origin ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== config.origin)
    )
      return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/"))
      return api.fetch(request);
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/oauth-protected-resource/api/v1"
    ) {
      if (!config.restApi) return safeResponse('{"error":"NOT_FOUND"}', 404);
      return safeResponse(
        JSON.stringify({
          resource: `${config.origin}/api/v1`,
          authorization_servers: [`${config.origin}/auth`],
          scopes_supported: [
            "api:read",
            "api:finance:read",
            ...(config.officeContacts ? ["api:office:contacts:read"] : []),
            ...(config.restBridge
              ? ["api:bridge", "api:write", "api:files"]
              : []),
            "offline_access",
          ],
          bearer_methods_supported: ["header"],
        }),
      );
    }
    if (
      request.method === "GET" &&
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ].includes(url.pathname)
    )
      return safeResponse(
        JSON.stringify({
          resource: `${config.origin}/mcp`,
          authorization_servers: [`${config.origin}/auth`],
          scopes_supported: [
            "mcp:read",
            "mcp:write",
            "mcp:files",
            "mcp:finance:read",
            "offline_access",
          ],
          bearer_methods_supported: ["header"],
        }),
      );
    if (
      request.method === "GET" &&
      [
        "/auth/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/auth",
        "/.well-known/oauth-authorization-server",
      ].includes(url.pathname)
    )
      return oauthProviderAuthServerMetadata(auth)(request);
    if (
      request.method === "GET" &&
      url.pathname === "/auth/error" &&
      request.headers.get("accept")?.includes("text/html")
    )
      return onboardingFailure(
        new OnboardingError("INVALID_REQUEST", 400),
        request,
      );
    if (request.method === "GET" && url.pathname === "/consent") {
      let ownerId: string;
      let resource: "mcp" | "api";
      let memberSession: Awaited<ReturnType<typeof requireMember>>;
      try {
        memberSession = await requireMember(auth, request.headers);
        ownerId = memberSession.principal.ownerId;
        if (
          !(await verifyOAuthQueryParams(
            url.search.slice(1),
            (
              await auth.$context
            ).secret,
          ))
        )
          throw new Error();
        resource = consentResource(url.searchParams);
      } catch {
        const continuation = onboardingGuideRedirect(request);
        if (continuation) return continuation;
        if (request.headers.get("accept")?.includes("text/html"))
          return new Response(null, {
            status: 303,
            headers: { ...privateHeaders, location: `/sign-in${url.search}` },
          });
        return challenge();
      }
      let onboarding: OnboardingAttempt | undefined;
      if (url.searchParams.has("onboarding_attempt")) {
        try {
          if (resource === "api" || !config.onboarding) throw new Error();
          const session = await requireOwner(
            auth,
            config.state,
            request.headers,
          );
          const a = await config.onboarding.validateQuery(
            ownerId,
            session.session.id,
            url.searchParams,
          );
          const client = await auth.api.getOnboardingClient({
            body: { client: a.client },
          });
          if (
            !client.redirects.includes(
              url.searchParams.get("redirect_uri") ?? "",
            ) ||
            !config.redirects.includes(
              url.searchParams.get("redirect_uri") ?? "",
            )
          )
            throw new Error();
          onboarding = await config.onboarding.prepareApproval(
            ownerId,
            a.id,
            a.revision,
            session.session.id,
            url.search.slice(1),
          );
        } catch (e) {
          return (
            onboardingGuideRedirect(request) ?? onboardingFailure(e, request)
          );
        }
      }
      const companies = (await config.connections.list(ownerId)).filter(
        (c) =>
          c.state === "active" &&
          (memberSession.principal.role !== "member" ||
            !!memberSession.principal.companies[c.id]) &&
          (!onboarding ||
            onboarding.approval?.selection.some((s) => s.id === c.id)),
      );
      const selectedOnly =
        !!onboarding ||
        resource === "api" ||
        memberSession.principal.role === "member";
      const companyChoices = companies
        .map(
          (c) => `<label class="consent-company">
          <input type="checkbox" name="company" checked ${selectedOnly ? "" : "disabled"} value="${escapeHtml(JSON.stringify({ id: c.id, generation: c.generation, access_revision: c.accessRevision ?? 0 }))}">
          <span><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(
            programSelection(c)
              .features.map((id) => featureLabels[id].sv)
              .join(", ") || "Företagsuppgifter",
          )}</small></span>
        </label>`,
        )
        .join("");
      const scopes = (url.searchParams.get("scope") ?? "").split(" ");
      const offline =
        scopes.includes("offline_access") &&
        config.offlineClientIds?.includes(
          url.searchParams.get("client_id") ?? "",
        ) &&
        (await auth.api
          .getOnboardingClient({
            body: { client: url.searchParams.get("client_id") ?? "" },
          })
          .catch(() => null));
      const permissions = [
        scopes.includes("api:bridge")
          ? `<li><strong>Använda Fortnox-bryggan</strong><p>Applikationen får använda katalogens granskade Fortnox-operationer för de valda företagen, inom nedanstående rättigheter och företagets policy.</p></li>`
          : "",
        scopes.includes("api:bridge") && scopes.includes("api:finance:read")
          ? `<li><strong>Läsa ekonomiska företagsdata</strong><p>Kan omfatta fakturor, verifikationer, konton och löneunderlag enligt företagets program och den granskade katalogen. Ger ingen skrivbehörighet.</p></li>`
          : scopes.some((s) =>
                ["mcp:finance:read", "api:finance:read"].includes(s),
              )
            ? `<li><strong>Läsa ekonomiska rådata</strong><p>Kund- och leverantörsfakturor, verifikationer och konton med Fortnox rapporterade årssaldon. Ger ingen skrivbehörighet.</p></li>`
            : "",
        scopes.includes("mcp:read") || scopes.includes("api:read")
          ? `<li><strong>Läsa företagsuppgifter</strong><p>Klienten begär läsåtkomst till anslutna företag.</p></li>`
          : "",
        scopes.includes("mcp:write") || scopes.includes("api:write")
          ? `<li><strong>Skriva i Fortnox</strong><p>Bokföring följer företagets aktuella policy, skrivskydd och krav på granskning.</p></li>`
          : "",
        scopes.includes("api:files")
          ? `<li><strong>Hantera företagets filer och bilagor</strong><p>Applikationen får läsa och överföra filer i de valda företagen enligt katalog och behörighet. Bryggan behåller ingen permanent filkopia; uppladdade bilagor lagras i Fortnox.</p></li>`
          : scopes.includes("mcp:files")
            ? `<li><strong>Hantera valda filer</strong><p>Valda filer kan hämtas, tillfälligt lagras krypterade och återläsas inom 55 minuter för uttryckligen behöriga företag. Normal rensning sker inom en timme när installationens schemalagda jobb körs; driftavbrott kan fördröja fysisk radering. Filåtkomst följer företagets behörigheter och policy.</p></li>`
            : "",
        scopes.includes("offline_access")
          ? `<li><strong>Behålla anslutningen</strong><p>${offline ? "Appens backend får förnya åtkomsten även när du är utloggad. Förnyelsetoken gäller i 30 dagar från senaste lyckade förnyelse. Installationsägaren kan återkalla åtkomsten." : "Klienten kan förnya anslutningen så länge godkännandet är giltigt."}</p></li>`
          : "",
      ].join("");
      return safeResponse(
        connectionPage({
          title: "Godkänn klient",
          back:
            memberSession.principal.role === "member"
              ? "/app"
              : "/admin/ai-clients",
          script: "/consent.js",
          content: `    <div class="consent-heading"><h1>Godkänn klient</h1><p class="intro muted">Granska åtkomsten innan du ansluter din AI-klient.</p></div>
    <div class="consent-layout">
      <div class="consent-details">
        <section class="consent-access" aria-labelledby="access-heading">
          <h2 id="access-heading">${selectedOnly ? "Åtkomst till valda företag" : "Nuvarande och framtida företag"}</h2>
          ${
            onboarding
              ? `<p>Applikation: <strong>${escapeHtml(onboarding.clientName)}</strong>. Företaget i detta försök: <strong>${escapeHtml(companies.find((c) => c.id === onboarding?.company?.id)?.name ?? "")}</strong>.</p><p>Godkännandet behåller nedanstående tidigare åtkomst och lägger till det valda företaget. Föregående token ersätts.</p>`
              : selectedOnly
                ? `<p>Godkännandet omfattar de företag du väljer nedan och begränsas alltid av dina aktuella läs- och skrivrättigheter. Nya tilldelningar kräver ett nytt godkännande.</p>`
                : `<p>Godkännandet omfattar alla företag som du ansluter till denna Fortnox MCP-installation, nu och i framtiden.</p><p>Nya företag och ändrad företagsåtkomst blir tillgängliga utan att du ansluter AI-klienten igen. Klientens begärda läs-, skriv- och filbehörigheter samt företagets policy gäller fortfarande.</p>`
          }
        </section>
        <section class="consent-permissions" aria-labelledby="permissions-heading">
          <h2 id="permissions-heading">Begärda behörigheter</h2>
          <ul>${permissions}</ul>
        </section>
      </div>
      <fieldset class="consent-companies">
        <legend>${selectedOnly ? "Välj företag för detta godkännande" : "Nu anslutna företag"}</legend>
        ${resource === "api" && !onboarding && memberSession.principal.role !== "member" ? '<label class="consent-company"><input type="checkbox" id="all-companies"><span><strong>Alla nuvarande och framtida företag</strong><small>Nya anslutna företag blir tillgängliga inom detta godkännandes behörigheter.</small></span></label>' : ""}
        <div class="consent-company-list">${companyChoices || `<p class="muted">${onboarding ? "Inga aktiva företag finns i detta godkännande. Gå tillbaka till anslutningsflödet." : "Inga företag är anslutna ännu. Företag som du ansluter senare blir tillgängliga via detta godkännande."}</p>`}</div>
      </fieldset>
    </div>
    <footer class="consent-actions">
      <button id="accept" ${selectedOnly ? "" : 'data-company-access="owner_connections"'}>${selectedOnly ? "Godkänn begärda behörigheter till valda företag" : "Godkänn åtkomst till nuvarande och framtida företag"}</button>
      ${onboarding ? `<a href="/connect/company/${onboarding.id}?revision=${onboarding.revision}">Tillbaka eller avbryt</a>` : ""}
      <p id="status" class="status" role="status" tabindex="-1"></p>
    </footer>
`,
        }),
        200,
        "text/html; charset=utf-8",
      );
    }
    if (request.method === "GET" && url.pathname === "/consent.js")
      return safeResponse(
        `const accept=document.querySelector('#accept');
const status=document.querySelector('#status');
const allCompanies=document.querySelector('#all-companies');
allCompanies?.addEventListener('change',()=>{
  accept.textContent=allCompanies.checked?'Godkänn åtkomst till nuvarande och framtida företag':'Godkänn begärda behörigheter till valda företag';
  document.querySelectorAll('input[name=company]').forEach(c=>c.disabled=allCompanies.checked);
});
accept.onclick=async()=>{
  if(accept.disabled)return;
  const companies=[...document.querySelectorAll('input[name=company]:checked')].map(c=>JSON.parse(c.value));
  const choices=[...document.querySelectorAll('input[name=company]:not(:disabled)')];
  accept.disabled=true;
  choices.forEach(c=>c.disabled=true);
  accept.setAttribute('aria-busy','true');
  status.textContent='Godkännandet skickas…';
  try{
    const r=await fetch('/auth/oauth2/consent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accept:true,oauth_query:location.search.slice(1),...((accept.dataset.companyAccess||document.querySelector('#all-companies')?.checked)?{company_access:accept.dataset.companyAccess||'owner_connections'}:{}),companies})});
    const d=await r.json();
    if(r.ok&&d.url){location.assign(d.url);return;}
    status.textContent='Godkännandet misslyckades. Öppna anslutningen igen i klienten och försök på nytt.';
    accept.disabled=false;
    choices.forEach(c=>c.disabled=false);
  }catch{
    status.textContent='Svaret saknas. Öppna anslutningen från applikationen eller klienten för att kontrollera utfallet innan du försöker igen.';
  }finally{
    accept.removeAttribute('aria-busy');
    status.focus();
  }
};`,
        200,
        "text/javascript",
      );
    if (authRoutes.has(`${request.method} ${url.pathname}`)) {
      if (
        request.method === "GET" &&
        url.pathname === "/auth/oauth2/authorize"
      ) {
        if (url.searchParams.has("onboarding_attempt")) {
          try {
            if (!config.onboarding) throw new Error();
            const session = await requireOwner(
              auth,
              config.state,
              request.headers,
            );
            await config.onboarding.validateQuery(
              session.user.id,
              session.session.id,
              url.searchParams,
            );
          } catch (e) {
            return (
              onboardingGuideRedirect(request) ?? onboardingFailure(e, request)
            );
          }
        }
        // Every approval must display its company access and current companies.
        url.searchParams.set("prompt", "consent");
        request = new Request(url, request);
      }
      let parsed: unknown;
      if (request.method === "POST") {
        const browser = [
          "/auth/oauth2/consent",
          "/auth/oauth2/continue",
        ].includes(url.pathname);
        if (browser) {
          if (request.headers.get("origin") !== config.origin)
            return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
          try {
            await requireMember(auth, request.headers);
          } catch {
            return challenge();
          }
        }
        try {
          if (
            request.headers
              .get("content-type")
              ?.startsWith("application/x-www-form-urlencoded")
          ) {
            const text = await boundedText(request);
            parsed = Object.fromEntries(new URLSearchParams(text));
            request = new Request(request.url, {
              method: "POST",
              headers: request.headers,
              body: text,
            });
          } else {
            parsed = await boundedJson(request);
            request = new Request(request.url, {
              method: "POST",
              headers: request.headers,
              body: JSON.stringify(parsed),
            });
          }
        } catch {
          return safeResponse('{"error":"VALIDATION_FAILED"}', 400);
        }
        if (url.pathname === "/auth/oauth2/register") {
          const body = z
            .object({ redirect_uris: z.array(z.string()).min(1).max(4) })
            .safeParse(parsed);
          if (
            !body.success ||
            body.data.redirect_uris.some(
              (uri) => !config.redirects.includes(uri),
            )
          )
            return safeResponse('{"error":"REDIRECT_DENIED"}', 400);
        }
        if (url.pathname === "/auth/oauth2/consent") {
          const body = z
            .object({
              accept: z.boolean(),
              company_access: z.literal("owner_connections").optional(),
              oauth_query: z.string().max(12000),
              companies: z
                .array(
                  z
                    .object({
                      id: z.string().uuid(),
                      generation: z.number().int().nonnegative(),
                      access_revision: z.number().int().nonnegative(),
                    })
                    .strict(),
                )
                .max(50),
            })
            .safeParse(parsed);
          if (
            !body.success ||
            !(await verifyOAuthQueryParams(
              body.data.oauth_query,
              (
                await auth.$context
              ).secret,
            ))
          )
            return safeResponse('{"error":"CONSENT_DENIED"}', 400);
          const client = new URLSearchParams(body.data.oauth_query).get(
            "client_id",
          );
          if (!client) return safeResponse('{"error":"CONSENT_DENIED"}', 400);
          let resource: "mcp" | "api";
          try {
            resource = consentResource(
              new URLSearchParams(body.data.oauth_query),
            );
          } catch {
            return safeResponse('{"error":"CONSENT_DENIED"}', 400);
          }
          if (
            resource === "api" &&
            body.data.accept &&
            ((!body.data.company_access && !body.data.companies.length) ||
              new Set(body.data.companies.map((c) => c.id)).size !==
                body.data.companies.length)
          )
            return safeResponse('{"error":"CONSENT_DENIED"}', 400);
          if (body.data.accept) {
            const session = await requireMember(auth, request.headers);
            try {
              let onboarding: OnboardingAttempt | undefined;
              const query = new URLSearchParams(body.data.oauth_query);
              if (query.has("onboarding_attempt")) {
                if (
                  resource === "api" ||
                  body.data.company_access ||
                  session.principal.role !== "owner"
                )
                  throw new Error();
                if (!config.onboarding) throw new Error();
                const a = await config.onboarding.validateQuery(
                  session.user.id,
                  session.session.id,
                  query,
                );
                onboarding = await config.onboarding.approval(
                  session.user.id,
                  a.id,
                  a.revision,
                  session.session.id,
                  body.data.oauth_query,
                );
                const canonical = (s: typeof body.data.companies) =>
                  JSON.stringify(
                    [...s].sort((a, b) => a.id.localeCompare(b.id)),
                  );
                if (
                  canonical(body.data.companies) !==
                  canonical(onboarding.approval?.selection ?? [])
                )
                  throw new Error();
              }
              // Let the maintained OAuth implementation validate/consume the
              // signed consent first. No grant is changed for denied consent.
              const response = await auth.handler(request);
              if (!response.ok) return response;
              const result = (await response.clone().json()) as {
                url?: string;
              };
              const code = result.url
                ? new URL(result.url).searchParams.get("code")
                : null;
              if (!code) return safeResponse('{"error":"CONSENT_DENIED"}', 400);
              const grant = await config.connections.renewGrant(
                session.principal.ownerId,
                client,
                body.data.companies,
                onboarding
                  ? {
                      expectedRevision: onboarding.approval?.grantRevision ?? 0,
                      onboarding: {
                        id: onboarding.id,
                        revision: onboarding.revision,
                        companyId: onboarding.company?.id as string,
                        completedAt: Date.now(),
                      },
                    }
                  : undefined,
                body.data.company_access,
                resource,
                session.principal,
              );
              await auth.api.bindProductCode({
                body: {
                  code,
                  owner: session.principal.ownerId,
                  subject: session.principal.subjectId,
                  client,
                  revision: grant.revision as number,
                  ...(onboarding
                    ? {
                        onboarding: {
                          id: onboarding.id,
                          revision: onboarding.revision,
                        },
                      }
                    : {}),
                },
              });
              if (onboarding)
                await config.onboarding?.authorized(
                  session.user.id,
                  onboarding,
                  grant,
                );
              return response;
            } catch {
              return safeResponse('{"error":"CONSENT_CONFLICT"}', 409);
            }
          }
          request = new Request(request.url, {
            method: "POST",
            headers: {
              ...Object.fromEntries(request.headers),
              "content-type": "application/json",
            },
            body: JSON.stringify({
              accept: body.data.accept,
              oauth_query: body.data.oauth_query,
            }),
          });
        }
        if (url.pathname === "/auth/oauth2/token") {
          const body = z
            .object({
              client_id: z.string().optional(),
              grant_type: z.enum([
                "authorization_code",
                "refresh_token",
                "client_credentials",
              ]),
              scope: z.string().optional(),
              code: z.string().optional(),
              refresh_token: z.string().optional(),
              resource: z.string().optional(),
            })
            .safeParse(parsed);
          if (!body.success)
            return safeResponse('{"error":"invalid_grant"}', 400);
          let client = body.data.client_id;
          if (
            !client &&
            /^Basic /i.test(request.headers.get("authorization") ?? "")
          ) {
            try {
              client = decodeURIComponent(
                atob(
                  (request.headers.get("authorization") ?? "").slice(6),
                ).split(":")[0] ?? "",
              );
            } catch {
              return safeResponse('{"error":"invalid_client"}', 400);
            }
          }
          if (!client) return safeResponse('{"error":"invalid_client"}', 400);
          if (body.data.grant_type === "client_credentials") {
            try {
              if (
                !config.installationAccess ||
                !config.restApi ||
                !config.restBridge ||
                body.data.resource !== `${config.origin}/api/v1` ||
                !/^Basic /i.test(request.headers.get("authorization") ?? "")
              )
                throw new Error();
              const owner = (
                await config.state.get<{ phase: string; ownerId: string }>(
                  "installation",
                  "owner",
                )
              )?.value;
              if (owner?.phase !== "active") throw new Error();
              const grant = await installationAccess.authorize(
                owner.ownerId,
                client,
              );
              const scopes =
                body.data.scope?.split(" ") ??
                installationScopes(
                  grant.writes,
                  !!grant.officeContacts?.length,
                );
              if (
                !scopes.includes("api:read") ||
                scopes.some(
                  (s) =>
                    !installationScopes(
                      grant.writes,
                      !!grant.officeContacts?.length,
                    ).includes(s),
                )
              )
                return safeResponse('{"error":"invalid_scope"}', 400);
              const reference = installationReference(grant);
              const response = await auth.handler(request);
              if (!response.ok) return response;
              const pair = (await response.clone().json()) as {
                access_token: string;
              };
              await auth.api.bindInstallationToken({
                body: { token: pair.access_token, client, reference },
              });
              await auth.api.verifyProductToken({
                body: { token: pair.access_token, resource: "api" },
              });
              return response;
            } catch {
              return safeResponse('{"error":"invalid_grant"}', 400);
            }
          }
          let resource: "mcp" | "api";
          try {
            resource = consentResource(
              new URLSearchParams(
                body.data.resource ? { resource: body.data.resource } : {},
              ),
            );
            await auth.api.verifyProductExchange({
              body: {
                client,
                type: body.data.grant_type,
                resource,
                token:
                  (body.data.grant_type === "authorization_code"
                    ? body.data.code
                    : body.data.refresh_token) ?? "",
              },
            });
          } catch {
            return safeResponse('{"error":"invalid_grant"}', 400);
          }
          const response = await auth.handler(request);
          if (!response.ok) return response;
          try {
            const tokens = (await response.clone().json()) as {
              access_token: string;
            };
            await auth.api.retainProductTokens({
              body: { token: tokens.access_token },
            });
            await auth.api.verifyProductToken({
              body: { token: tokens.access_token, resource },
            });
            return response;
          } catch {
            return safeResponse('{"error":"invalid_grant"}', 400);
          }
        }
      }
      const response = await auth.handler(request);
      if (
        request.method === "GET" &&
        response.status >= 400 &&
        request.headers.get("accept")?.includes("text/html")
      )
        return onboardingFailure(
          new OnboardingError("INVALID_REQUEST", response.status),
          request,
        );
      return response;
    }
    if (url.pathname !== "/mcp") return admin.fetch(request);
    if (url.search) return challenge();
    let body: unknown;
    if (request.method === "POST") {
      try {
        body = await boundedJson(request);
      } catch {
        return safeResponse('{"error":"VALIDATION_FAILED"}', 400);
      }
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
      });
    }
    const authorization = request.headers.get("authorization");
    let identity: McpIdentity | null = null;
    if (authorization) {
      try {
        if (!/^Bearer [^\s]+$/i.test(authorization)) throw new Error();
        identity = await auth.api.verifyProductToken({
          body: { token: authorization.slice(7) },
        });
        if (identity.clientId.startsWith("owner-recovery:")) throw new Error();
      } catch {
        return challenge();
      }
    } else if (
      request.method !== "POST" ||
      !publicRequest.safeParse(body).success
    )
      return challenge();
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    const build = () => server(identity);
    if (
      !(await isLegacyRequest(request, body, { maxRequestBodySize: 16384 }))
    ) {
      const handler = createMcpHandler(build, {
        legacy: "reject",
        responseMode: "auto",
        maxRequestBodySize: 16384,
      });
      try {
        return await handler.fetch(request, { parsedBody: body });
      } finally {
        await handler.close();
      }
    }
    const instance = build();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: 16384,
    });
    try {
      await instance.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await instance.close();
    }
  }
  return { auth, fetch };
}
async function boundedText(request: Request) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("VALIDATION_FAILED");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(out);
}
