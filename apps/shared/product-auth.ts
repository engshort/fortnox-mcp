import {
  getOAuthProviderApi,
  type OAuthOptions,
  oauthProvider,
} from "@better-auth/oauth-provider";
import type { CompanyGrant } from "@fortnox-mcp/core";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { z } from "zod";
import type { StateStore } from "./state.js";

export interface Owner {
  phase: "ready" | "claiming" | "active";
  ownerId: string;
  tokenHash: string;
  expiresAt: number;
}
export interface AuthConfig {
  origin: string;
  secret: string;
  database: BetterAuthOptions["database"];
  state: StateStore;
  onReset?: (token: string) => Promise<void>;
}
export interface GrantFamily {
  ownerId: string;
  clientId: string;
  revision: number;
  expiresAt: number;
}
async function assertGrantFamily(
  state: StateStore,
  owner: string,
  client: string,
  code?: string,
) {
  const grant = await state.get<CompanyGrant>("company-grants", client);
  if (!grant || grant.value.ownerId !== owner) throw new Error("AUTH_REQUIRED");
  if (!grant.value.revision) return client; // Existing tokens retain only legacy grants.
  const families = await state.get<Record<string, GrantFamily>>(
    "oauth-grant-families",
    owner,
  );
  const family = code ? families?.value[code] : undefined;
  if (
    !family ||
    family.ownerId !== owner ||
    family.clientId !== client ||
    family.revision !== grant.value.revision ||
    family.expiresAt <= Date.now()
  )
    throw new Error("AUTH_REQUIRED");
  if (!grant.value.grantId) throw new Error("AUTH_REQUIRED");
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
  const oauthOptions = {
    loginPage: "/sign-in",
    consentPage: "/consent",
    scopes: ["mcp:read", "mcp:write", "mcp:files", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
    resources: [
      {
        identifier: `${config.origin}/mcp`,
        allowedScopes: ["mcp:read", "mcp:write", "mcp:files", "offline_access"],
      },
    ],
    resourceSeedMode: "insertOnly",
    clientRegistrationDefaultResources: [`${config.origin}/mcp`],
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

  return betterAuth({
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
      sendResetPassword: async ({ token }) => {
        if (config.onReset) await config.onReset(token);
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
          bindProductCode: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              body: z.object({
                code: z.string().max(4096),
                owner: z.string(),
                client: z.string(),
                revision: z.number().int(),
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
                  ownerId: ctx.body.owner,
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
                claims.sub !== owner.value.ownerId ||
                typeof claims.client_id !== "string"
              )
                throw new Error("AUTH_REQUIRED");
              const grant = await config.state.get<CompanyGrant>(
                "company-grants",
                claims.client_id,
              );
              if (!grant || grant.value.ownerId !== owner.value.ownerId)
                throw new Error("AUTH_REQUIRED");
              if (!grant.value.revision) return ctx.json({ ok: true });
              const access = await ctx.context.adapter.findOne<{
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
                ? await ctx.context.adapter.findOne<{ expiresAt: Date }>({
                    model: "oauthRefreshToken",
                    where: [{ field: "id", value: access.refreshId }],
                  })
                : null;
              const expiresAt = Math.max(
                new Date(access.expiresAt).getTime(),
                refresh ? new Date(refresh.expiresAt).getTime() : 0,
              );
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
                familyRows.value[code]?.clientId !== claims.client_id
              )
                throw new Error("AUTH_REQUIRED");
              // Retain the same rights for the actual lifetime of successfully
              // issued/rotated tokens. An unused code keeps its ten-minute bound.
              for (const space of [
                "oauth-approval-grants",
                "oauth-grant-families",
              ] as const) {
                let saved = false;
                for (let attempt = 0; attempt < 8 && !saved; attempt++) {
                  const row = await config.state.get<
                    Record<string, { expiresAt: number }>
                  >(space, owner.value.ownerId);
                  const key =
                    space === "oauth-approval-grants"
                      ? grant.value.grantId
                      : code;
                  const record = row?.value[key];
                  if (!row || !record) throw new Error("AUTH_REQUIRED");
                  record.expiresAt = Math.max(record.expiresAt, expiresAt);
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
              );
              return ctx.json({ ok: true });
            },
          ),
          verifyProductToken: createAuthEndpoint.serverOnly(
            { method: "POST", body: z.object({ token: z.string().max(4096) }) },
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
              if (
                owner?.value.phase !== "active" ||
                claims.sub !== owner.value.ownerId ||
                claims.iss !== `${config.origin}/auth` ||
                !audience.includes(`${config.origin}/mcp`) ||
                claims.cnf ||
                typeof claims.client_id !== "string" ||
                typeof claims.scope !== "string" ||
                !claims.scope.split(" ").includes("mcp:read")
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
              );
              return ctx.json({
                ownerId: owner.value.ownerId,
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
