import {
  getOAuthProviderApi,
  type OAuthOptions,
  oauthProvider,
} from "@better-auth/oauth-provider";
import {
  type CompanyGrant,
  type ConnectionSet,
  Memberships,
  principalGrantKey,
} from "@fortnox-mcp/core";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { z } from "zod";
import type { AccountEmails } from "./product-email.js";
import type { StateStore } from "./state.js";

export interface Owner {
  phase: "ready" | "claiming" | "active";
  ownerId: string;
  tokenHash: string;
  expiresAt: number;
}
export interface AuthConfig {
  restApi?: boolean;
  restBridge?: boolean;
  offlineClientIds?: readonly string[];
  memberships?: Memberships;
  multiUser?: boolean;
  origin: string;
  secret: string;
  database: BetterAuthOptions["database"];
  state: StateStore;
  onReset?: (token: string) => Promise<void>;
  emails?: AccountEmails;
}
export interface GrantFamily {
  offlineAccess?: boolean;
  subjectId?: string;
  ownerId: string;
  clientId: string;
  revision: number;
  expiresAt: number;
  onboarding?: { id: string; revision: number };
}
async function assertGrantFamily(
  state: StateStore,
  owner: string,
  client: string,
  code?: string,
  offlineClients: readonly string[] = [],
  resource: "mcp" | "api" = "mcp",
  subject?: string,
  memberships = new Memberships(state),
) {
  const families = await state.get<Record<string, GrantFamily>>(
    "oauth-grant-families",
    owner,
  );
  const family = code ? families?.value[code] : undefined;
  const subjectId = subject ?? family?.subjectId ?? owner;
  const key = principalGrantKey(owner, subjectId, client);
  const grant = await state.get<CompanyGrant>("company-grants", key);
  if (
    !grant ||
    grant.value.ownerId !== owner ||
    (grant.value.subjectId ?? owner) !== subjectId ||
    (grant.value.resource ?? "mcp") !== resource
  )
    throw new Error("AUTH_REQUIRED");
  if (subjectId !== owner) {
    const member = await memberships.principal(subjectId);
    if (
      member.ownerId !== owner ||
      member.revision !== grant.value.membershipRevision
    )
      throw new Error("AUTH_REQUIRED");
  }
  if (!grant.value.revision && subjectId === owner) return client;
  if (
    !family ||
    family.ownerId !== owner ||
    family.clientId !== client ||
    (family.subjectId ?? owner) !== subjectId ||
    family.revision !== grant.value.revision ||
    (family.offlineAccess && !offlineClients.includes(client)) ||
    family.expiresAt <= Date.now() ||
    !grant.value.grantId
  )
    throw new Error("AUTH_REQUIRED");
  return grant.value.grantId;
}
export async function hashToken(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export function createProductAuth(config: AuthConfig) {
  const memberships =
    config.memberships ?? new Memberships(config.state, config.multiUser);
  const oauthOptions = {
    loginPage: "/sign-in",
    consentPage: "/consent",
    scopes: [
      "mcp:read",
      "mcp:write",
      "mcp:files",
      "mcp:finance:read",
      "api:read",
      "api:finance:read",
      ...(config.restBridge ? ["api:bridge", "api:write", "api:files"] : []),
      "offline_access",
    ],
    grantTypes: ["authorization_code", "refresh_token"],
    resources: [
      {
        identifier: `${config.origin}/mcp`,
        allowedScopes: [
          "mcp:read",
          "mcp:write",
          "mcp:files",
          "mcp:finance:read",
          "offline_access",
        ],
      },
      ...(config.restApi
        ? [
            {
              identifier: `${config.origin}/api/v1`,
              allowedScopes: [
                "api:read",
                "api:finance:read",
                ...(config.restBridge
                  ? ["api:bridge", "api:write", "api:files"]
                  : []),
                "offline_access",
              ],
            },
          ]
        : []),
    ],
    resourceSeedMode: "insertOnly",
    clientRegistrationDefaultResources: [`${config.origin}/mcp`],
    clientRegistrationAllowedResources: config.restApi
      ? [`${config.origin}/api/v1`]
      : [],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationRequirePKCE: true,
    accessTokenExpiresIn: 300,
    codeExpiresIn: 600,
    refreshTokenExpiresIn: 86400,
    refreshTokenReuseInterval: 0,
    disableJwtPlugin: true,
    clientPrivileges: () => false,
    resourcePrivileges: () => false,
  } satisfies OAuthOptions<string[]>;

  const auth = betterAuth({
    baseURL: config.origin,
    basePath: "/auth",
    secret: config.secret,
    database: config.database,
    trustedOrigins: [config.origin],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 600,
      sendResetPassword: async ({ user, token }) => {
        if (config.onReset) await config.onReset(token);
        if (!config.emails) return;
        try {
          await memberships.principal(user.id);
        } catch {
          return;
        }
        await config.emails.passwordReset(user.email, token);
      },
      onPasswordReset: async ({ user }) => {
        if (!config.emails) return;
        try {
          await memberships.principal(user.id);
          await config.emails.passwordChanged(user.email, crypto.randomUUID());
        } catch {
          // The completed password reset cannot be rolled back by notification failure.
        }
      },
    },
    session: { expiresIn: 86400, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 10 },
    advanced: { useSecureCookies: config.origin.startsWith("https:") },
    plugins: [
      oauthProvider(oauthOptions),
      {
        id: "product-token-validation",
        endpoints: {
          authenticateOnboardingClient: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              requireRequest: true,
              body: z.object({ scopes: z.array(z.string()).max(2) }),
            },
            async (ctx) => {
              const result = await getOAuthProviderApi(
                ctx,
                oauthOptions,
              ).authenticateClient({
                requireCredentials: true,
                scopes: ctx.body.scopes,
              });
              if (result.method !== "client_secret_basic")
                throw new Error("AUTH_REQUIRED");
              return ctx.json({
                clientId: result.clientId,
                name: result.client.name ?? result.clientId,
                redirects: result.client.redirectUris ?? [],
              });
            },
          ),
          getOnboardingClient: createAuthEndpoint.serverOnly(
            { method: "POST", body: z.object({ client: z.string() }) },
            async (ctx) => {
              const client = await getOAuthProviderApi(
                ctx,
                oauthOptions,
              ).getClient(ctx.body.client);
              if (
                !client ||
                client.disabled ||
                client.tokenEndpointAuthMethod !== "client_secret_basic"
              )
                throw new Error("AUTH_REQUIRED");
              return ctx.json({
                clientId: client.clientId,
                name: client.name ?? client.clientId,
                redirects: client.redirectUris ?? [],
              });
            },
          ),
          bindProductCode: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              body: z.object({
                code: z.string().max(4096),
                owner: z.string(),
                subject: z.string().optional(),
                client: z.string(),
                revision: z.number().int(),
                onboarding: z
                  .object({
                    id: z.string().uuid(),
                    revision: z.number().int().positive(),
                  })
                  .optional(),
              }),
            },
            async (ctx) => {
              const code = await getOAuthProviderApi(
                ctx,
                oauthOptions,
              ).hashToken(ctx.body.code, "authorization_code");
              for (let attempt = 0; attempt < 8; attempt++) {
                const prior = await config.state.get<
                  Record<string, GrantFamily>
                >("oauth-grant-families", ctx.body.owner);
                const live = Object.fromEntries(
                  Object.entries(prior?.value ?? {}).filter(
                    ([, f]) => f.expiresAt > Date.now(),
                  ),
                );
                if (Object.keys(live).length >= 128)
                  throw new Error("CAPACITY_EXCEEDED");
                live[code] = {
                  ...(ctx.body.onboarding
                    ? { onboarding: ctx.body.onboarding }
                    : {}),
                  ownerId: ctx.body.owner,
                  ...(ctx.body.subject ? { subjectId: ctx.body.subject } : {}),
                  clientId: ctx.body.client,
                  revision: ctx.body.revision,
                  expiresAt: Date.now() + 600000,
                };
                if (
                  await config.state.put(
                    "oauth-grant-families",
                    ctx.body.owner,
                    live,
                    prior?.version ?? null,
                  )
                )
                  return ctx.json({ ok: true });
              }
              throw new Error("CONNECTION_CONFLICT");
            },
          ),
          retainProductTokens: createAuthEndpoint.serverOnly(
            { method: "POST", body: z.object({ token: z.string().max(4096) }) },
            async (ctx) => {
              const api = getOAuthProviderApi(ctx, oauthOptions);
              const claims = await api.requireActiveAccessToken(ctx.body.token);
              const owner = await config.state.get<Owner>(
                "installation",
                "owner",
              );
              if (
                owner?.value.phase !== "active" ||
                typeof claims.sub !== "string" ||
                typeof claims.client_id !== "string"
              )
                throw new Error("AUTH_REQUIRED");
              const grant = await config.state.get<CompanyGrant>(
                "company-grants",
                principalGrantKey(
                  owner.value.ownerId,
                  claims.sub,
                  claims.client_id,
                ),
              );
              if (!grant || grant.value.ownerId !== owner.value.ownerId)
                throw new Error("AUTH_REQUIRED");
              if (claims.sub !== owner.value.ownerId) {
                const p = await memberships.principal(claims.sub);
                if (p.revision !== grant.value.membershipRevision)
                  throw new Error("AUTH_REQUIRED");
              }
              if (!grant.value.revision) return ctx.json({ ok: true });
              const access = await ctx.context.adapter.findOne<{
                id: string;
                authorizationCodeId?: string;
                refreshId?: string;
                expiresAt: Date;
              }>({
                model: "oauthAccessToken",
                where: [
                  {
                    field: "token",
                    value: await api.hashToken(ctx.body.token, "access_token"),
                  },
                ],
              });
              if (!access?.authorizationCodeId)
                throw new Error("AUTH_REQUIRED");
              const refresh = access.refreshId
                ? await ctx.context.adapter.findOne<{
                    id: string;
                    clientId: string;
                    userId: string;
                    authorizationCodeId?: string;
                    createdAt: Date;
                    expiresAt: Date;
                    revoked?: Date | null;
                    scopes: string[];
                  }>({
                    model: "oauthRefreshToken",
                    where: [{ field: "id", value: access.refreshId }],
                  })
                : null;
              if (
                !grant?.value.grantId ||
                grant.value.ownerId !== owner.value.ownerId
              )
                throw new Error("AUTH_REQUIRED");
              const code = access.authorizationCodeId;
              const familyRows = await config.state.get<
                Record<string, GrantFamily>
              >("oauth-grant-families", owner.value.ownerId);
              if (
                familyRows?.value[code]?.revision !== grant.value.revision ||
                familyRows.value[code]?.clientId !== claims.client_id ||
                (familyRows.value[code]?.subjectId ?? owner.value.ownerId) !==
                  claims.sub
              )
                throw new Error("AUTH_REQUIRED");
              const client = config.offlineClientIds?.includes(claims.client_id)
                ? await api.getClient(claims.client_id)
                : null;
              const offline =
                !!client &&
                !client.disabled &&
                client.tokenEndpointAuthMethod === "client_secret_basic" &&
                !!refresh?.scopes.includes("offline_access");
              if (offline && refresh) {
                if (
                  refresh.clientId !== claims.client_id ||
                  refresh.userId !== claims.sub ||
                  refresh.authorizationCodeId !== code ||
                  refresh.revoked
                )
                  throw new Error("AUTH_REQUIRED");
                // Only finalize the freshly issued pair, before returning it.
                // The maintained provider still owns minting, rotation and replay
                // rejection. Persist the policy in its actual token rows, too.
                refresh.expiresAt = new Date(
                  new Date(refresh.createdAt).getTime() + 30 * 86400_000,
                );
                const updatedRefresh = await ctx.context.adapter.update({
                  model: "oauthRefreshToken",
                  where: [{ field: "id", value: refresh.id }],
                  update: { expiresAt: refresh.expiresAt, sessionId: null },
                });
                const updatedAccess = await ctx.context.adapter.update({
                  model: "oauthAccessToken",
                  where: [{ field: "id", value: access.id }],
                  update: { sessionId: null },
                });
                if (!updatedRefresh || !updatedAccess)
                  throw new Error("CONNECTION_CONFLICT");
              }
              const expiresAt = Math.max(
                new Date(access.expiresAt).getTime(),
                refresh ? new Date(refresh.expiresAt).getTime() : 0,
              );
              // Retain the same rights for the actual lifetime of successfully
              // issued/rotated tokens. An unused code keeps its ten-minute bound.
              for (const space of [
                "oauth-approval-grants",
                "oauth-grant-families",
              ] as const) {
                let saved = false;
                for (let attempt = 0; attempt < 8 && !saved; attempt++) {
                  const row = await config.state.get<
                    Record<
                      string,
                      { expiresAt: number; offlineAccess?: boolean }
                    >
                  >(space, owner.value.ownerId);
                  const key =
                    space === "oauth-approval-grants"
                      ? grant.value.grantId
                      : code;
                  const record = row?.value[key];
                  if (!row || !record) throw new Error("AUTH_REQUIRED");
                  record.expiresAt = Math.max(record.expiresAt, expiresAt);
                  if (space === "oauth-grant-families" && offline)
                    record.offlineAccess = true;
                  saved = await config.state.put(
                    space,
                    owner.value.ownerId,
                    row.value,
                    row.version,
                  );
                }
                if (!saved) throw new Error("CONNECTION_CONFLICT");
              }
              return ctx.json({ ok: true });
            },
          ),
          verifyProductExchange: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              body: z.object({
                token: z.string().max(4096),
                client: z.string(),
                type: z.enum(["authorization_code", "refresh_token"]),
                resource: z.enum(["mcp", "api"]).default("mcp"),
              }),
            },
            async (ctx) => {
              const api = getOAuthProviderApi(ctx, oauthOptions);
              const hash = await api.hashToken(ctx.body.token, ctx.body.type);
              const owner = await config.state.get<Owner>(
                "installation",
                "owner",
              );
              if (owner?.value.phase !== "active")
                throw new Error("AUTH_REQUIRED");
              let code = hash;
              if (ctx.body.type === "refresh_token") {
                const row = await ctx.context.adapter.findOne<{
                  clientId: string;
                  authorizationCodeId?: string;
                }>({
                  model: "oauthRefreshToken",
                  where: [{ field: "token", value: hash }],
                });
                if (!row || row.clientId !== ctx.body.client)
                  throw new Error("AUTH_REQUIRED");
                code = row.authorizationCodeId ?? "";
              }
              await assertGrantFamily(
                config.state,
                owner.value.ownerId,
                ctx.body.client,
                code,
                config.offlineClientIds,
                ctx.body.resource,
                undefined,
                memberships,
              );
              if (ctx.body.type === "authorization_code") {
                const family = (
                  await config.state.get<Record<string, GrantFamily>>(
                    "oauth-grant-families",
                    owner.value.ownerId,
                  )
                )?.value[code];
                if (family?.onboarding) {
                  const a = (
                    await config.state.get<ConnectionSet>(
                      "connections",
                      owner.value.ownerId,
                    )
                  )?.value.onboarding?.find(
                    (a) => a.id === family.onboarding?.id,
                  );
                  if (
                    !a ||
                    a.client !== ctx.body.client ||
                    a.revision !== family.onboarding.revision ||
                    !["authorized", "approval_pending"].includes(a.phase)
                  )
                    throw new Error("AUTH_REQUIRED");
                }
              }
              return ctx.json({ ok: true });
            },
          ),
          verifyProductToken: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              body: z.object({
                token: z.string().max(4096),
                resource: z.enum(["mcp", "api"]).default("mcp"),
              }),
            },
            async (ctx) => {
              const claims = await getOAuthProviderApi(
                ctx,
                oauthOptions,
              ).requireActiveAccessToken(ctx.body.token);
              const owner = await config.state.get<Owner>(
                "installation",
                "owner",
              );
              const audience = Array.isArray(claims.aud)
                ? claims.aud
                : [claims.aud];
              const api = ctx.body.resource === "api";
              const resource = `${config.origin}${api ? "/api/v1" : "/mcp"}`;
              if (
                owner?.value.phase !== "active" ||
                typeof claims.sub !== "string" ||
                claims.iss !== `${config.origin}/auth` ||
                (api && !config.restApi) ||
                audience.length !== 1 ||
                audience[0] !== resource ||
                claims.cnf ||
                typeof claims.client_id !== "string" ||
                typeof claims.scope !== "string" ||
                !claims.scope
                  .split(" ")
                  .includes(api ? "api:read" : "mcp:read") ||
                claims.scope
                  .split(" ")
                  .some(
                    (scope) =>
                      scope !== "offline_access" &&
                      !scope.startsWith(api ? "api:" : "mcp:"),
                  )
              )
                throw ctx.error("UNAUTHORIZED", {
                  message: "Invalid authorization",
                });
              const token = await ctx.context.adapter.findOne<{
                authorizationCodeId?: string;
              }>({
                model: "oauthAccessToken",
                where: [
                  {
                    field: "token",
                    value: await getOAuthProviderApi(
                      ctx,
                      oauthOptions,
                    ).hashToken(ctx.body.token, "access_token"),
                  },
                ],
              });
              const grantId = await assertGrantFamily(
                config.state,
                owner.value.ownerId,
                claims.client_id,
                token?.authorizationCodeId,
                config.offlineClientIds,
                ctx.body.resource,
                claims.sub,
                memberships,
              );
              return ctx.json({
                ownerId: owner.value.ownerId,
                subjectId: claims.sub,
                clientId: grantId,
                oauthClientId: claims.client_id,
                scopes: claims.scope.split(" "),
              });
            },
          ),
        },
      },
    ],
  });
  return Object.assign(auth, { memberships });
}
export type ProductAuth = ReturnType<typeof createProductAuth>;
export async function requireOwner(
  auth: ProductAuth,
  state: StateStore,
  headers: Headers,
) {
  const owner = await state.get<Owner>("installation", "owner");
  const session = await auth.api.getSession({ headers });
  if (
    owner?.value.phase !== "active" ||
    session?.user.id !== owner.value.ownerId
  )
    throw new Error("AUTH_REQUIRED");
  return session;
}

export async function requireMember(auth: ProductAuth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("AUTH_REQUIRED");
  const principal = await auth.memberships.principal(session.user.id);
  return { ...session, principal };
}
export async function requireAdministrator(
  auth: ProductAuth,
  headers: Headers,
) {
  const session = await requireMember(auth, headers);
  if (session.principal.role === "member") throw new Error("AUTH_REQUIRED");
  return session;
}
