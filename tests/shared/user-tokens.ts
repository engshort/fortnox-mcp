import {
  Connections,
  CredentialVault,
  type StateStore,
} from "@fortnox-mcp/core";
import { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { expect, it } from "vitest";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";
export function userTokenContract(fixture: () => Promise<StateStore>) {
  it("uses a separate user flow and atomically saves the replacement refresh token", async () => {
    const state = await fixture();
    const connections = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    let exchanges = 0;
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      testTenants: ["100001"],
      fetch: async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.pathname === "/oauth-v1/token") {
          exchanges++;
          if (exchanges === 2)
            expect(String(init?.body)).toContain("grant_type=refresh_token");
          return Response.json({
            access_token: `synthetic-access-${exchanges}`,
            refresh_token: `synthetic-refresh-${exchanges}`,
            token_type: "bearer",
            scope: "companyinformation profile",
            expires_in: 3600,
          });
        }
        return Response.json({
          CompanyInformation: {
            DatabaseNumber: "100001",
            CompanyName: "Synthetic A",
          },
        });
      },
    });
    const url = new URL(
      await provider.start("owner", "session", {
        mode: "user",
        clientId: "synthetic-client",
        clientSecret: "synthetic-client-secret",
      }),
    );
    expect(url.searchParams.has("account_type")).toBe(false);
    const c = await provider.finish(
      "owner",
      "session",
      new URL(
        `https://product.example.invalid/admin/fortnox/callback?${new URLSearchParams({ code: "synthetic-code", state: url.searchParams.get("state") ?? "" })}`,
      ),
    );
    expect(exchanges).toBe(1);
    expect((await connections.credentials("owner", c)).refreshToken).toBe(
      "synthetic-refresh-1",
    );
    expect(await provider.token("owner", c, true)).toBe("synthetic-access-2");
    expect((await connections.credentials("owner", c)).refreshToken).toBe(
      "synthetic-refresh-2",
    );
  });
  it("lost refresh response and restarted expired lease require reconnect without reuse", async () => {
    const state = await fixture();
    const connections = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    const c = await connections.add("owner", syntheticCompany, {
      ...syntheticCredentials,
      expiresAt: 0,
    });
    let requests = 0;
    const provider = new FortnoxConnections({
      origin: "https://product.example.invalid",
      connections,
      testTenants: ["100001"],
      fetch: async () => {
        requests++;
        throw new Error("synthetic dropped rotation response");
      },
    });
    await expect(provider.token("owner", c)).rejects.toThrow(
      "RECONNECT_REQUIRED",
    );
    expect((await connections.list("owner"))[0]?.state).toBe(
      "reconnect_required",
    );
    expect((await connections.list("owner"))[0]?.secret).toBeNull();
    await expect(provider.token("owner", c)).rejects.toThrow(
      "RECONNECT_REQUIRED",
    );
    expect(requests).toBe(1);
    const other = await connections.add(
      "owner",
      { ...syntheticCompany, tenant: "100002" },
      { ...syntheticCredentials, expiresAt: 0 },
    );
    await connections.mutate("owner", other.id, (c) => {
      c.renewal = {
        id: "synthetic-crashed-refresh",
        until: 0,
        dispatched: true,
      };
    });
    const restarted = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    let exchanges = 0;
    await expect(
      restarted.renew("owner", other.id, other.generation, async () => {
        exchanges++;
        return syntheticCredentials;
      }),
    ).rejects.toThrow("RECONNECT_REQUIRED");
    expect(exchanges).toBe(0);
  });
}
