import {
  getOAuthProviderApi,
  type OAuthOptions,
  oauthProvider,
} from "@better-auth/oauth-provider";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { z } from "zod";
import type { FileContext } from "./files.js";
import type { ReviewStore } from "./review.js";

export interface ProbeConfig {
  origin: string;
  secret: string;
  ownerId: string;
  database: BetterAuthOptions["database"];
  review?: ReviewStore;
  files?: Omit<FileContext, "owner" | "secret" | "company">;
}

export function createProbeAuth(config: ProbeConfig) {
  const origin = new URL(config.origin).origin;
  const issuer = `${origin}/auth`;
  const scopes = [
    "mcp:read",
    "offline_access",
    ...(config.review ? ["mcp:review"] : []),
    ...(config.files ? ["mcp:files"] : []),
  ];
  const oauthOptions = {
    loginPage: "/sign-in",
    consentPage: "/consent",
    scopes,
    grantTypes: ["authorization_code", "refresh_token"],
    resources: [
      {
        identifier: `${origin}/mcp`,
        allowedScopes: scopes,
      },
    ],
    // This isolated probe has no resource-policy admin API. Its explicit config
    // owns allowedScopes, including review opt-in/out on an existing database.
    // The provider default is insertOnly and would retain the old read-only row.
    resourceSeedMode: "merge",
    clientRegistrationDefaultResources: [`${origin}/mcp`],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationRequirePKCE: true,
    accessTokenExpiresIn: 300,
    // The provider also uses this TTL for the signed browser-login query.
    codeExpiresIn: 600,
    refreshTokenExpiresIn: 86400,
    refreshTokenReuseInterval: 0,
    // Opaque, resource-bound tokens permit immediate DB-backed revocation.
    // All issuance, hashing, rotation and validation remain in Better Auth.
    disableJwtPlugin: true,
    clientPrivileges: () => false,
    resourcePrivileges: () => false,
  } satisfies OAuthOptions<string[]>;

  return betterAuth({
    baseURL: origin,
    basePath: "/auth",
    secret: config.secret,
    database: config.database,
    trustedOrigins: [origin],
    // Only the operator's offline seed command invokes signup/signin. The
    // HTTP adapter never forwards password or signup endpoints.
    emailAndPassword: { enabled: true },
    session: { expiresIn: 86400, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    advanced: { useSecureCookies: origin.startsWith("https:") },
    logger: { disabled: true },
    plugins: [
      oneTimeToken({
        expiresIn: 5,
        storeToken: "hashed",
        disableClientRequest: true,
        setOttHeaderOnNewSession: true,
      }),
      oauthProvider(oauthOptions),
      {
        id: "s00-resource-validation",
        endpoints: {
          verifyProbeToken: createAuthEndpoint.serverOnly(
            {
              method: "POST",
              body: z.object({ token: z.string().max(4096) }),
            },
            async (ctx) => {
              const claims = await getOAuthProviderApi(
                ctx,
                oauthOptions,
              ).requireActiveAccessToken(ctx.body.token);
              const audiences = Array.isArray(claims.aud)
                ? claims.aud
                : [claims.aud];
              if (
                claims.iss !== issuer ||
                !audiences.includes(`${origin}/mcp`) ||
                !config.ownerId ||
                claims.sub !== config.ownerId ||
                claims.cnf ||
                typeof claims.scope !== "string" ||
                !claims.scope.split(" ").includes("mcp:read")
              ) {
                throw ctx.error("UNAUTHORIZED", {
                  message: "Invalid probe authorization",
                });
              }
              return ctx.json({
                owner: "synthetic-owner" as const,
                scopes: claims.scope.split(" "),
              });
            },
          ),
        },
      },
    ],
  });
}

export type ProbeAuth = ReturnType<typeof createProbeAuth>;
