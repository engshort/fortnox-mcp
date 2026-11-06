import {
  Connections,
  CredentialVault,
  type StateStore,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
export const syntheticCredentials = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-client-secret",
  accessToken: "synthetic-access-token",
  refreshToken: "synthetic-refresh-token",
  expiresAt: Date.now() + 3600000,
};
export const syntheticCompany = {
  tenant: "100001",
  mode: "user" as const,
  name: "Synthetic A",
  organizationNumber: "000000-0000",
  scopes: ["companyinformation", "profile"],
};
export const keyA = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));
export const keyB = btoa(String.fromCharCode(...new Uint8Array(32).fill(22)));
export function connectionContract(fixture: () => Promise<StateStore>) {
  describe("encrypted owner/company connections", () => {
    it("authorizes durable grants and isolates credentials, tenant uniqueness and policy", async () => {
      const state = await fixture();
      const service = new Connections(
        state,
        new CredentialVault({ a: keyA }, "a"),
      );
      const a = await service.add(
        "owner",
        syntheticCompany,
        syntheticCredentials,
      );
      const b = await service.add(
        "owner",
        { ...syntheticCompany, tenant: "100002", name: "Synthetic B" },
        { ...syntheticCredentials, accessToken: "synthetic-B-token" },
      );
      await service.grant("owner", "client-A", [a.id]);
      expect((await service.authorize("owner", "client-A", a.id)).tenant).toBe(
        "100001",
      );
      await expect(
        service.authorize("owner", "client-A", b.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        service.authorize("other-owner", "client-A", a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(service.credentials("other-owner", a)).rejects.toThrow(
        "RECONNECT_REQUIRED",
      );
      await expect(
        service.add("owner", syntheticCompany, syntheticCredentials),
      ).rejects.toThrow("CONNECTION_CONFLICT");
      expect(a.review).toBe("review_required");
      expect(a.policyVersion).toBe(1);
      expect(JSON.stringify(await service.snapshot("owner"))).not.toContain(
        syntheticCredentials.accessToken,
      );
      expect(
        await new Connections(
          state,
          new CredentialVault({ a: keyA }, "a"),
        ).credentials("owner", a),
      ).toEqual(syntheticCredentials);
      expect((await service.credentials("owner", b)).accessToken).toBe(
        "synthetic-B-token",
      );
    });
    it("authenticates ciphertext binding, rejects missing/wrong keys and rotates without losing state", async () => {
      const state = await fixture();
      const service = new Connections(
        state,
        new CredentialVault({ a: keyA }, "a"),
      );
      const c = await service.add(
        "owner",
        syntheticCompany,
        syntheticCredentials,
      );
      for (const vault of [
        new CredentialVault({}, "a"),
        new CredentialVault({ a: keyB }, "a"),
      ])
        await expect(
          new Connections(state, vault).credentials("owner", c),
        ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      if (!c.secret) throw new Error("Missing fixture ciphertext");
      await expect(
        service.vault.open(c.secret, service.binding("other-owner", c)),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      const next = new Connections(
        state,
        new CredentialVault({ a: keyA, b: keyB }, "b"),
      );
      await next.rotateKey("owner");
      expect((await next.list("owner"))[0]?.secret?.key).toBe("b");
      expect(
        await new Connections(
          state,
          new CredentialVault({ b: keyB }, "b"),
        ).credentials("owner", c),
      ).toEqual(syntheticCredentials);
    });
  });
}
