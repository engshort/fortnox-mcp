import { type BetterAuthOptions, betterAuth } from "better-auth";
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
