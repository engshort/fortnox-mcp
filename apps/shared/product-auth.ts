import {
  getOAuthProviderApi,
  type OAuthOptions,
  oauthProvider,
} from "@better-auth/oauth-provider";
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
              return ctx.json({
                ownerId: owner.value.ownerId,
                clientId: claims.client_id,
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
