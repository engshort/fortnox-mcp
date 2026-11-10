import {
  assertNoUncertainWrites,
  type Ciphertext,
  type Connection,
  type Connections,
  type Credentials,
  DomainError,
  type ProgramChange,
  type ProgramGates,
  type ProgramSelection,
  previewProgram,
  programSelection,
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
export type ConsentStage =
  | "flow_validation"
  | "flow_decryption"
  | "authorization_response"
  | "code_exchange"
  | "code_response"
  | "initial_credentials"
  | "tenant_verification"
  | "service_exchange"
  | "service_response"
  | "service_credentials"
  | "service_tenant_verification"
  | "connection_storage";
const publicOAuthErrors = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "invalid_scope",
  "access_denied",
  "unsupported_grant_type",
  "unsupported_response_type",
  "server_error",
  "temporarily_unavailable",
]);
// Retain only fixed diagnostics. Never attach the library error, cause or body.
export class FortnoxConsentError extends DomainError {
  readonly providerError?: string;
  readonly providerStatus?: number;
  constructor(
    readonly stage: ConsentStage,
    error: unknown,
  ) {
    super(error instanceof DomainError ? error.code : "RECONNECT_REQUIRED");
    if (
      error instanceof oauth.AuthorizationResponseError ||
      error instanceof oauth.ResponseBodyError
    ) {
      if (publicOAuthErrors.has(error.error)) this.providerError = error.error;
      if (error instanceof oauth.ResponseBodyError)
        this.providerStatus = error.status;
    }
  }
}
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
  reconnectGeneration?: number;
  extension?: {
    generation: number;
    revision: number;
    policy: number;
    selection: Omit<ProgramSelection, "revision">;
    change: ProgramChange;
  };
}
const flowSecret = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
    verifier: z.string(),
    scopes: z.array(z.string()).optional(),
  })
  .strict();
export interface FortnoxConfig {
  origin: string;
  connections: Connections;
  fetch: typeof fetch;
  testTenants: readonly string[];
  now?: () => number;
  scopes?: readonly string[];
  programGates?: ProgramGates | (() => ProgramGates);
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
    if (
      config.scopes &&
      (!config.scopes.includes("companyinformation") ||
        !config.scopes.includes("profile") ||
        config.scopes.some(
          (s) =>
            ![
              "companyinformation",
              "profile",
              "bookkeeping",
              "settings",
              "costcenter",
              "project",
              "inbox",
              "connectfile",
              "customer",
              "supplier",
              "article",
              "currency",
              "price",
              "offer",
              "order",
              "invoice",
              "supplierinvoice",
              "payment",
            ].includes(s),
        ))
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
  }
  private gates() {
    return typeof this.config.programGates === "function"
      ? this.config.programGates()
      : (this.config.programGates ?? {
          references: false,
          receiptConsent: false,
        });
  }
  private redirect() {
    return `${this.config.origin}/admin/fortnox/callback`;
  }
  async start(
    owner: string,
    session: string,
    input: z.infer<typeof consentInput>,
    reconnectId?: string,
    extension?: ProgramChange,
  ) {
    consentInput.parse(input);
    const target = reconnectId
      ? (await this.config.connections.list(owner)).find(
          (c) => c.id === reconnectId,
        )
      : undefined;
    if (reconnectId && (!target || (!extension && target.state === "active")))
      throw new DomainError("CONNECTION_CONFLICT");
    if (extension && (!target || target.mode !== input.mode))
      throw new DomainError("COMPANY_FORBIDDEN");
    const preview =
      extension && target
        ? previewProgram(target, extension, this.gates())
        : undefined;
    const scopes =
      preview?.scopes ??
      (target
        ? target.scopes
        : (this.config.scopes ?? ["companyinformation", "profile"]));
    const id = crypto.randomUUID();
    const state = oauth.generateRandomState();
    const verifier = oauth.generateRandomCodeVerifier();
    const secret = await this.config.connections.vault.sealData(
      {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        verifier,
        scopes,
      },
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
      ...(target
        ? { reconnectId: target.id, reconnectGeneration: target.generation }
        : {}),
      ...(preview && target && extension
        ? {
            extension: {
              generation: target.generation,
              revision: preview.expected_revision,
              policy: target.policyVersion,
              selection: {
                enabled: preview.enabled,
                features: preview.features,
              },
              change: extension,
            },
          }
        : {}),
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
          scope: scopes.join(" "),
          access_type: "offline",
          ...(input.mode === "service" ? { account_type: "service" } : {}),
          state,
          code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
        }).toString();
        return url.href;
      }
    }
    throw new DomainError("RATE_LIMITED");
  }
  // A session cancels its own pending flows. Null is reserved for the owner's
  // forget-configuration action, which clears all unused owner flows. Claimed
  // exchanges remain untouched; cancellation cannot interrupt token storage.
  async cancelPending(owner: string, session: string | null) {
    for (let n = 0; n < 8; n++) {
      const row = await this.config.connections.state.get<Flow[]>(
        "fortnox-flows",
        owner,
      );
      if (!row) return;
      const flows = row.value.filter(
        (f) => (session !== null && f.session !== session) || f.claimed,
      );
      if (
        flows.length === row.value.length ||
        (await this.config.connections.state.put(
          "fortnox-flows",
          owner,
          flows,
          row.version,
        ))
      )
        return;
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
  async pending(owner: string) {
    const rows = await this.config.connections.state.get<Flow[]>(
      "fortnox-flows",
      owner,
    );
    return (rows?.value ?? [])
      .filter((f) => !f.claimed && f.expiresAt > this.now())
      .flatMap((f) => (f.reconnectId ? [f.reconnectId] : []));
  }
  private credentials(
    input: Pick<Credentials, "clientId" | "clientSecret">,
    tokens: oauth.TokenEndpointResponse,
    mode: "service" | "user",
    requested: readonly string[] = ["companyinformation", "profile"],
  ): Credentials {
    const scopes = tokens.scope?.split(/\s+/);
    if (
      scopes &&
      (requested.some((s) => !scopes.includes(s)) ||
        scopes.some((s) => !requested.includes(s)))
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
  async verify(
    owner: string,
    credentials: Credentials,
    tenant?: string,
    scopes: readonly string[] = ["companyinformation", "profile"],
  ) {
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
      scopes: [...scopes],
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
    let stage: ConsentStage = "flow_decryption";
    try {
      const target = flow.reconnectId
        ? (await this.config.connections.list(owner)).find(
            (c) => c.id === flow.reconnectId,
          )
        : undefined;
      if (
        flow.reconnectId &&
        (!target || target.generation !== flow.reconnectGeneration)
      )
        throw new DomainError("CONNECTION_CONFLICT");
      if (flow.extension && target) {
        if (
          target.state !== "active" ||
          target.policyVersion !== flow.extension.policy ||
          programSelection(target).revision !== flow.extension.revision
        )
          throw new DomainError("CONNECTION_CONFLICT");
        assertNoUncertainWrites(target);
        previewProgram(target, flow.extension.change, this.gates());
      }
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
      stage = "authorization_response";
      const params = oauth.validateAuthResponse(
        server,
        client,
        callback,
        flow.state,
      );
      stage = "code_exchange";
      const response = await oauth.authorizationCodeGrantRequest(
        server,
        client,
        oauth.ClientSecretBasic(input.clientSecret),
        params,
        this.redirect(),
        input.verifier,
        { [oauth.customFetch]: this.upstream() },
      );
      stage = "code_response";
      const initialTokens = await oauth.processAuthorizationCodeResponse(
        server,
        client,
        response,
      );
      stage = "initial_credentials";
      const requested = input.scopes ?? ["companyinformation", "profile"];
      const initial = this.credentials(
        input,
        initialTokens,
        flow.mode,
        requested,
      );
      stage = "tenant_verification";
      const identity = await this.verify(
        owner,
        initial,
        target?.tenant,
        requested,
      );
      let credentials = initial;
      if (flow.mode === "user" && !initial.refreshToken)
        throw new DomainError("RECONNECT_REQUIRED");
      if (flow.mode === "service") {
        stage = "service_exchange";
        const grant = await oauth.clientCredentialsGrantRequest(
          server,
          client,
          oauth.ClientSecretBasic(input.clientSecret),
          { scope: requested.join(" ") },
          {
            [oauth.customFetch]: this.upstream(),
            headers: { TenantId: identity.tenant },
          },
        );
        stage = "service_response";
        const serviceTokens = await oauth.processClientCredentialsResponse(
          server,
          client,
          grant,
        );
        stage = "service_credentials";
        credentials = this.credentials(
          input,
          serviceTokens,
          "service",
          requested,
        );
        stage = "service_tenant_verification";
        await this.verify(owner, credentials, identity.tenant);
      }
      stage = "connection_storage";
      if (flow.reconnectId) {
        const previous = (await this.config.connections.list(owner)).find(
          (c) => c.id === flow.reconnectId,
        );
        if (
          !previous ||
          previous.generation !== flow.reconnectGeneration ||
          (!flow.extension && previous.state === "active")
        )
          throw new DomainError("CONNECTION_CONFLICT");
        if (previous.tenant !== identity.tenant)
          throw new DomainError("COMPANY_FORBIDDEN");
        if (flow.extension) {
          if (programSelection(previous).revision !== flow.extension.revision)
            throw new DomainError("CONNECTION_CONFLICT");
          previewProgram(previous, flow.extension.change, this.gates());
          return await this.config.connections.extendPrograms(
            owner,
            previous.id,
            flow.extension,
            { ...identity, mode: flow.mode },
            flow.extension.selection,
            credentials,
          );
        }
        return await this.config.connections.reconnect(
          owner,
          previous.id,
          previous.generation,
          { ...identity, mode: flow.mode },
          credentials,
        );
      }
      return await this.config.connections.add(
        owner,
        { ...identity, mode: flow.mode },
        credentials,
      );
    } catch (error) {
      throw new FortnoxConsentError(stage, error);
    } finally {
      for (let n = 0; n < 8; n++) {
        const row = await this.config.connections.state.get<Flow[]>(
          "fortnox-flows",
          owner,
        );
        if (!row) break;
        if (
          await this.config.connections.state.put(
            "fortnox-flows",
            owner,
            row.value.filter(
              (f) => f.id !== flow.id && f.expiresAt > this.now(),
            ),
            row.version,
          )
        )
          break;
      }
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
          if (connection.mode === "user") {
            if (!credentials.refreshToken)
              throw new DomainError("RECONNECT_REQUIRED");
            const response = await oauth.refreshTokenGrantRequest(
              server,
              client,
              oauth.ClientSecretBasic(credentials.clientSecret),
              credentials.refreshToken,
              { [oauth.customFetch]: this.upstream() },
            );
            const next = this.credentials(
              credentials,
              await oauth.processRefreshTokenResponse(server, client, response),
              "user",
              connection.scopes,
            );
            if (
              !next.refreshToken ||
              next.refreshToken === credentials.refreshToken
            )
              throw new DomainError("RECONNECT_REQUIRED");
            await this.verify(owner, next, connection.tenant);
            return next;
          }
          const response = await oauth.clientCredentialsGrantRequest(
            server,
            client,
            oauth.ClientSecretBasic(credentials.clientSecret),
            { scope: connection.scopes.join(" ") },
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
            connection.scopes,
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
