import { Connections, CredentialVault } from "@fortnox-mcp/core";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { AuthConfig, Owner } from "../../apps/shared/product-auth.js";
import { createProductGateway } from "../../apps/shared/product-gateway.js";
import { keyA } from "./connections.js";

export function oauthContract(fixture: () => Promise<AuthConfig>) {
  it("product OAuth validates PKCE/resource/redirect, rotates refresh and revokes access", async () => {
    const config = await fixture();
    const callback = "https://client.example.invalid/callback";
    const app = createProductGateway(
      {
        ...config,
        redirects: [callback],
        connections: new Connections(
          config.state,
          new CredentialVault({ a: keyA }, "a"),
        ),
      },
      () => new McpServer({ name: "synthetic-product-test", version: "0" }),
    );
    const seeded = await app.auth.api.signUpEmail({
      body: {
        email: "oauth@example.invalid",
        name: "Synthetic owner",
        password: "Synthetic-password-123456",
      },
      returnHeaders: true,
    });
    await config.state.put<Owner>(
      "installation",
      "owner",
      {
        phase: "active",
        ownerId: seeded.response.user.id,
        expiresAt: 0,
        tokenHash: "",
      },
      null,
    );
    const cookie = seeded.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const req = (
      path: string,
      body?: unknown,
      extra: Record<string, string> = {},
    ) =>
      app.fetch(
        new Request(`${config.origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(body instanceof URLSearchParams
              ? { "content-type": "application/x-www-form-urlencoded" }
              : { "content-type": "application/json" }),
            ...extra,
          },
          ...(body === undefined
            ? {}
            : {
                body:
                  body instanceof URLSearchParams ? body : JSON.stringify(body),
              }),
        }),
      );
    const dcr = () =>
      req("/auth/oauth2/register", {
        client_name: "Synthetic client",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "mcp:read offline_access",
      });
    const registered = await dcr();
    expect(registered.status).toBe(201);
    const { client_id: client } = (await registered.json()) as {
      client_id: string;
    };
    expect(
      (
        await req("/auth/oauth2/register", {
          redirect_uris: ["https://attacker.invalid/callback"],
        })
      ).status,
    ).toBe(400);
    const verifier =
      "synthetic-code-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const authorize = async (overrides: Record<string, string> = {}) =>
      req(
        `/auth/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: callback, scope: "mcp:read offline_access", state: "synthetic-state", code_challenge: challenge, code_challenge_method: "S256", resource: `${config.origin}/mcp`, ...overrides })}`,
        undefined,
        { cookie },
      );
    const response = await authorize();
    const location =
      response.headers.get("location") ??
      ((await response.json()) as { url: string }).url;
    const consent = new URL(location, config.origin);
    const accepted = await req(
      "/auth/oauth2/consent",
      { accept: true, oauth_query: consent.search.slice(1) },
      { cookie, origin: config.origin },
    );
    expect(accepted.status).toBe(200);
    const redirect = new URL(((await accepted.json()) as { url: string }).url);
    expect(redirect.searchParams.get("state")).toBe("synthetic-state");
    expect(redirect.searchParams.get("iss")).toBe(`${config.origin}/auth`);
    const exchange = {
      grant_type: "authorization_code",
      client_id: client,
      redirect_uri: callback,
      resource: `${config.origin}/mcp`,
      code: redirect.searchParams.get("code") ?? "",
      code_verifier: verifier,
    };
    // Invalid verifier fails before any private request.
    expect(
      (
        await req(
          "/auth/oauth2/token",
          new URLSearchParams({ ...exchange, code_verifier: "wrong-verifier" }),
        )
      ).ok,
    ).toBe(false);
    // The library may consume a failed code; acquire a fresh, consented code.
    const next = await authorize();
    const nextUrl = new URL(
      next.headers.get("location") ??
        ((await next.json()) as { url: string }).url,
      config.origin,
    );
    const second = nextUrl.searchParams.has("code")
      ? null
      : await req(
          "/auth/oauth2/consent",
          { accept: true, oauth_query: nextUrl.search.slice(1) },
          { cookie, origin: config.origin },
        );
    if (second) expect(second.status).toBe(200);
    exchange.code =
      (second
        ? new URL(((await second.json()) as { url: string }).url)
        : nextUrl
      ).searchParams.get("code") ?? "";
    const tokensResponse = await req(
      "/auth/oauth2/token",
      new URLSearchParams(exchange),
    );
    expect(tokensResponse.status).toBe(200);
    const tokens = (await tokensResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const claims = await app.auth.api.verifyProductToken({
      body: { token: tokens.access_token },
    });
    expect(claims.ownerId).toBe(seeded.response.user.id);
    expect(claims.clientId).toBe(client);
    const refreshed = await req(
      "/auth/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client,
        resource: `${config.origin}/mcp`,
        refresh_token: tokens.refresh_token,
      }),
    );
    expect(refreshed.status).toBe(200);
    const replacement = (await refreshed.json()) as typeof tokens;
    expect(replacement.refresh_token).not.toBe(tokens.refresh_token);
    expect(
      (
        await req(
          "/auth/oauth2/revoke",
          new URLSearchParams({
            client_id: client,
            token: replacement.access_token,
            token_type_hint: "access_token",
          }),
        )
      ).ok,
    ).toBe(true);
    await expect(
      app.auth.api.verifyProductToken({
        body: { token: replacement.access_token },
      }),
    ).rejects.toThrow();
    expect(
      (await req("/auth/oauth2/token", new URLSearchParams(exchange))).ok,
    ).toBe(false);
    const privateCall = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_companies", arguments: {} },
    };
    expect((await req("/mcp", privateCall)).status).toBe(401);
    expect(
      (
        await req("/mcp", [
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          privateCall,
        ])
      ).status,
    ).toBe(401);
    expect(
      (
        await req(
          "/mcp",
          { jsonrpc: "2.0", id: 3, method: "tools/list" },
          { authorization: "Bearer invalid" },
        )
      ).status,
    ).toBe(401);
    expect(
      (await req("/.well-known/oauth-protected-resource/mcp")).status,
    ).toBe(200);
  }, 20000);
}
