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
    it("a competing OAuth renewal fences an owner upgrade of the earlier authorization", async () => {
      const state = await fixture();
      const vault = new CredentialVault({ a: keyA }, "a");
      const service = new Connections(state, vault);
      const a = await service.add(
        "owner",
        syntheticCompany,
        syntheticCredentials,
      );
      const old = await service.renewGrant("owner", "client", []);
      let reached: () => void = () => {};
      let release: () => void = () => {};
      const intercepted = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let pause = true;
      const competing = new Connections(
        {
          get: state.get.bind(state),
          list: state.list.bind(state),
          put: async (space, id, value, expected) => {
            if (space === "oauth-approval-grants" && pause) {
              pause = false;
              reached();
              await gate;
            }
            return state.put(space, id, value, expected);
          },
        },
        vault,
      );
      const upgrade = competing.allowOwnerConnections(
        "owner",
        "client",
        old.grantId ?? null,
        old.revision ?? 0,
      );
      const rejected = expect(upgrade).rejects.toThrow("CONNECTION_CONFLICT");
      await intercepted;
      const renewed = await service.renewGrant("owner", "client", [
        {
          id: a.id,
          generation: a.generation,
          access_revision: a.accessRevision ?? 0,
        },
      ]);
      release();
      await rejected;
      expect(
        (await service.clientGrant("owner", "client")).companyAccess,
      ).toBeUndefined();
      await expect(
        service.authorize("owner", old.grantId as string, a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      expect(
        (await service.authorize("owner", renewed.grantId as string, a.id)).id,
      ).toBe(a.id);
    });
    it("upgrades legacy access only for its owner and cannot revive expired or superseded OAuth approvals", async () => {
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
      await service.grant("owner", "legacy-client", []);
      await expect(
        service.allowOwnerConnections("other-owner", "legacy-client", null, 0),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await service.allowOwnerConnections("owner", "legacy-client", null, 0);
      expect((await service.authorize("owner", "legacy-client", a.id)).id).toBe(
        a.id,
      );
      await expect(service.grant("owner", "legacy-client", [])).rejects.toThrow(
        "COMPANY_FORBIDDEN",
      );
      const approved = await service.renewGrant("owner", "legacy-client", []);
      await expect(
        service.authorize("owner", "legacy-client", a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        service.allowOwnerConnections("owner", "legacy-client", null, 0),
      ).rejects.toThrow("CONNECTION_CONFLICT");
      const row = await state.get<Record<string, { expiresAt?: number }>>(
        "oauth-approval-grants",
        "owner",
      );
      if (!row || !approved.grantId)
        throw new Error("Missing approval fixture");
      const record = row.value[approved.grantId];
      if (!record) throw new Error("Missing approval fixture");
      record.expiresAt = Date.now() - 1;
      await state.put("oauth-approval-grants", "owner", row.value, row.version);
      await expect(
        service.allowOwnerConnections(
          "owner",
          "legacy-client",
          approved.grantId,
          approved.revision as number,
        ),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        service.authorize("owner", approved.grantId, a.id),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
    });
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
      ]) {
        await expect(
          new Connections(state, vault).list("owner"),
        ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
        await expect(
          new Connections(state, vault).credentials("owner", c),
        ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      }
      if (!c.secret) throw new Error("Missing fixture ciphertext");
      await expect(
        service.vault.open(c.secret, service.binding("other-owner", c)),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      const next = new Connections(
        state,
        new CredentialVault({ a: keyA, b: keyB }, "b"),
      );
      const second = await next.add(
        "owner",
        { ...syntheticCompany, tenant: "100002", name: "Synthetic B" },
        { ...syntheticCredentials, accessToken: "synthetic-B-token" },
      );
      await expect(
        new Connections(state, new CredentialVault({ b: keyB }, "b")).list(
          "owner",
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await next.rotateKey("owner");
      expect((await next.list("owner"))[0]?.secret?.key).toBe("b");
      expect(
        await new Connections(
          state,
          new CredentialVault({ b: keyB }, "b"),
        ).credentials("owner", c),
      ).toEqual(syntheticCredentials);
      await next.disconnect("owner", c.id);
      await next.disconnect("owner", second.id);
      const onlyNewKey = new Connections(
        state,
        new CredentialVault({ b: keyB }, "b"),
      );
      expect((await onlyNewKey.list("owner"))[0]?.state).toBe("disconnected");
      await expect(
        new Connections(state, new CredentialVault({ b: keyA }, "b")).list(
          "owner",
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    });
    it("upgrades an earlier encrypted snapshot by CAS without changing handles, generations or grants", async () => {
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
      await service.grant("owner", "client", [c.id]);
      const row = await state.get<{ connections: (typeof c)[] }>(
        "connections",
        "owner",
      );
      if (!row) throw new Error("Missing synthetic snapshot");
      await state.put(
        "connections",
        "owner",
        { connections: row.value.connections },
        row.version,
      );
      await expect(
        new Connections(state, new CredentialVault({ a: keyB }, "a")).list(
          "owner",
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(
        (await service.authorize("owner", "client", c.id)).generation,
      ).toBe(1);
      expect((await service.list("owner"))[0]?.id).toBe(c.id);
      expect(
        (await state.get<{ keyCheck?: unknown }>("connections", "owner"))?.value
          .keyCheck,
      ).toBeDefined();
    });
  });
}
