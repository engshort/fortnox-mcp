import {
  type Ciphertext,
  type Connection,
  type Connections,
  type Credentials,
  DomainError,
} from "@fortnox-mcp/core";
import * as oauth from "oauth4webapi";
import { z } from "zod";
import { boundedResponse, FortnoxHttp, type ProviderContext } from "./http.js";

const server: oauth.AuthorizationServer = {
  issuer: "https://apps.fortnox.se",
  authorization_endpoint: "https://apps.fortnox.se/oauth-v1/auth",
  token_endpoint: "https://apps.fortnox.se/oauth-v1/token",
  code_challenge_methods_supported: ["S256"],
};
export const consentInput = z
  .object({
    mode: z.enum(["service", "user"]),
    clientId: z.string().regex(/^[A-Za-z0-9_-]{5,128}$/),
    clientSecret: z.string().min(8).max(4096),
  })
  .strict();
interface Flow {
  id: string;
  session: string;
  state: string;
  mode: "service" | "user";
  expiresAt: number;
  secret: Ciphertext;
  claimed: boolean;
  reconnectId?: string;
}
const flowSecret = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
    verifier: z.string(),
  })
  .strict();
export interface FortnoxConfig {
  origin: string;
  connections: Connections;
  fetch: typeof fetch;
  testTenants: readonly string[];
  now?: () => number;
}
export const companyInformation = z.object({
  CompanyInformation: z.object({
    DatabaseNumber: z.union([z.string(), z.number().int()]),
    CompanyName: z.string().max(512),
    OrganizationNumber: z.string().max(128).optional(),
  }),
});

export class FortnoxConnections {
  readonly now: () => number;
  constructor(readonly config: FortnoxConfig) {
    this.now = config.now ?? Date.now;
  }
  private redirect() {
    return `${this.config.origin}/admin/fortnox/callback`;
  }
  async start(
    owner: string,
    session: string,
    input: z.infer<typeof consentInput>,
    reconnectId?: string,
  ) {
    consentInput.parse(input);
    if (input.mode !== "service")
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const id = crypto.randomUUID();
    const state = oauth.generateRandomState();
    const verifier = oauth.generateRandomCodeVerifier();
    const secret = await this.config.connections.vault.sealData(
      { clientId: input.clientId, clientSecret: input.clientSecret, verifier },
      JSON.stringify([owner, id, session]),
    );
    const flow: Flow = {
      id,
      session,
      state,
      mode: input.mode,
      expiresAt: this.now() + 600000,
      secret,
      claimed: false,
      ...(reconnectId ? { reconnectId } : {}),
    };
    for (let n = 0; n < 8; n++) {
      const row = await this.config.connections.state.get<Flow[]>(
        "fortnox-flows",
        owner,
      );
      const flows = (row?.value ?? []).filter((f) => f.expiresAt > this.now());
      if (flows.length >= 4) throw new DomainError("RATE_LIMITED");
      if (
        await this.config.connections.state.put(
          "fortnox-flows",
          owner,
          [...flows, flow],
          row?.version ?? null,
        )
      ) {
        const url = new URL(server.authorization_endpoint ?? "");
        url.search = new URLSearchParams({
          client_id: input.clientId,
          response_type: "code",
          redirect_uri: this.redirect(),
          scope: "companyinformation profile",
          access_type: "offline",
          account_type: "service",
          state,
          code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
        }).toString();
        return url.href;
      }
    }
    throw new DomainError("RATE_LIMITED");
  }
  private upstream(): NonNullable<
    oauth.ProtectedResourceRequestOptions[typeof oauth.customFetch]
  > {
    return async (input, init) => {
      const url = new URL(input);
      if (url.href !== server.token_endpoint || init.method !== "POST")
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      if (
        typeof init.body !== "string" &&
        !(init.body instanceof URLSearchParams)
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      try {
        const response = await this.config.fetch(url, {
          method: init.method,
          headers: init.headers,
          body: init.body,
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
        if (response.status >= 300 && response.status < 400) throw new Error();
        const text = await boundedResponse(response);
        return new Response(text || null, {
          status: response.status,
          headers: response.headers,
        });
      } catch {
        throw new DomainError("RECONNECT_REQUIRED");
      }
    };
  }
  private credentials(
    input: Pick<Credentials, "clientId" | "clientSecret">,
    tokens: oauth.TokenEndpointResponse,
    mode: "service" | "user",
  ): Credentials {
    const scopes = tokens.scope?.split(/\s+/);
    if (
      scopes &&
      (!scopes.includes("companyinformation") ||
        !scopes.includes("profile") ||
        scopes.some((s) => !["companyinformation", "profile"].includes(s)))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (
      !tokens.expires_in ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.expires_in <= 0
    )
      throw new DomainError("RECONNECT_REQUIRED");
    return {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      accessToken: tokens.access_token,
      expiresAt: this.now() + Math.floor(tokens.expires_in * 1000),
      ...(mode === "user" && tokens.refresh_token
        ? { refreshToken: tokens.refresh_token }
        : {}),
    };
  }
  async verify(owner: string, credentials: Credentials, tenant?: string) {
    const context: ProviderContext = {
      owner,
      company: "activation",
      generation: 0,
      tenant: tenant ?? "activation",
      clientId: credentials.clientId,
      assertActive: async () => {},
      token: async () => credentials.accessToken,
    };
    const http = new FortnoxHttp({
      fetch: this.config.fetch,
      state: this.config.connections.state,
    });
    const parsed = companyInformation.safeParse(
      await http.read(context, "company_information"),
    );
    if (!parsed.success) throw new DomainError("UPSTREAM_UNAVAILABLE");
    const identity = parsed.data.CompanyInformation;
    const actual = String(identity.DatabaseNumber);
    if (
      !this.config.testTenants.includes(actual) ||
      (tenant !== undefined && tenant !== actual)
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    return {
      tenant: actual,
      name: identity.CompanyName,
      organizationNumber: identity.OrganizationNumber ?? "",
      scopes: ["companyinformation", "profile"],
    };
  }
  async finish(owner: string, session: string, callback: URL) {
    if (
      callback.origin + callback.pathname !== this.redirect() ||
      callback.hash
    )
      throw new DomainError("AUTH_REQUIRED");
    let flow: Flow | undefined;
    for (let n = 0; n < 8; n++) {
      const row = await this.config.connections.state.get<Flow[]>(
        "fortnox-flows",
        owner,
      );
      const current = row?.value.find(
        (f) =>
          f.state === callback.searchParams.get("state") &&
          f.session === session &&
          f.expiresAt > this.now() &&
          !f.claimed,
      );
      if (!row || !current) throw new DomainError("AUTH_REQUIRED");
      current.claimed = true;
      if (
        await this.config.connections.state.put(
          "fortnox-flows",
          owner,
          row.value,
          row.version,
        )
      ) {
        flow = current;
        break;
      }
    }
    if (!flow) throw new DomainError("AUTH_REQUIRED");
    try {
      const input = flowSecret.parse(
        await this.config.connections.vault.openData(
          flow.secret,
          JSON.stringify([owner, flow.id, session]),
        ),
      );
      const client = {
        client_id: input.clientId,
        token_endpoint_auth_method: "client_secret_basic",
      };
      const params = oauth.validateAuthResponse(
        server,
        client,
        callback,
        flow.state,
      );
      const response = await oauth.authorizationCodeGrantRequest(
        server,
        client,
        oauth.ClientSecretBasic(input.clientSecret),
        params,
        this.redirect(),
        input.verifier,
        { [oauth.customFetch]: this.upstream() },
      );
      const initial = this.credentials(
        input,
        await oauth.processAuthorizationCodeResponse(server, client, response),
        flow.mode,
      );
      const identity = await this.verify(owner, initial);
      if (flow.mode !== "service")
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const grant = await oauth.clientCredentialsGrantRequest(
        server,
        client,
        oauth.ClientSecretBasic(input.clientSecret),
        { scope: "companyinformation profile" },
        {
          [oauth.customFetch]: this.upstream(),
          headers: { TenantId: identity.tenant },
        },
      );
      const credentials = this.credentials(
        input,
        await oauth.processClientCredentialsResponse(server, client, grant),
        "service",
      );
      await this.verify(owner, credentials, identity.tenant);
      if (flow.reconnectId) throw new DomainError("CAPABILITY_UNAVAILABLE");
      return await this.config.connections.add(
        owner,
        { ...identity, mode: flow.mode },
        credentials,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("RECONNECT_REQUIRED");
    }
  }
  async token(owner: string, connection: Connection, force = false) {
    return (
      await this.config.connections.renew(
        owner,
        connection.id,
        connection.generation,
        async (credentials) => {
          const client = {
            client_id: credentials.clientId,
            token_endpoint_auth_method: "client_secret_basic",
          };
          if (connection.mode !== "service")
            throw new DomainError("CAPABILITY_UNAVAILABLE");
          const response = await oauth.clientCredentialsGrantRequest(
            server,
            client,
            oauth.ClientSecretBasic(credentials.clientSecret),
            { scope: "companyinformation profile" },
            {
              [oauth.customFetch]: this.upstream(),
              headers: { TenantId: connection.tenant },
            },
          );
          const next = this.credentials(
            credentials,
            await oauth.processClientCredentialsResponse(
              server,
              client,
              response,
            ),
            "service",
          );
          await this.verify(owner, next, connection.tenant);
          return next;
        },
        force,
        this.now(),
      )
    ).accessToken;
  }
}
