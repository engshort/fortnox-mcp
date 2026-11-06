import {
  Connections,
  CredentialVault,
  type StateStore,
} from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { keyA, syntheticCompany, syntheticCredentials } from "./connections.js";
export function disconnectContract(fixture: () => Promise<StateStore>) {
  it("disconnect fences late renewal, removes credentials and preserves company identity only for same tenant", async () => {
    const state = await fixture();
    const service = new Connections(
      state,
      new CredentialVault({ a: keyA }, "a"),
    );
    const c = await service.add("owner", syntheticCompany, {
      ...syntheticCredentials,
      expiresAt: 0,
    });
    await service.grant("owner", "old-client", [c.id]);
    let release: (value: typeof syntheticCredentials) => void = () => {};
    const promise = new Promise<typeof syntheticCredentials>((resolve) => {
      release = resolve;
    });
    const pending = service.renew(
      "owner",
      c.id,
      c.generation,
      async () => promise,
    );
    for (let n = 0; n < 50 && !(await service.list("owner"))[0]?.renewal; n++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    const stopped = await service.disconnect("owner", c.id);
    release(syntheticCredentials);
    await expect(pending).rejects.toThrow("RECONNECT_REQUIRED");
    expect((await service.list("owner"))[0]?.secret).toBeNull();
    await expect(
      service.authorize("owner", "old-client", c.id),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    const resumed = await service.reconnect(
      "owner",
      c.id,
      stopped.generation,
      syntheticCompany,
      syntheticCredentials,
    );
    expect(resumed.id).toBe(c.id);
    expect(resumed.generation).toBeGreaterThan(stopped.generation);
    await expect(
      service.authorize("owner", "old-client", c.id),
    ).rejects.toThrow("COMPANY_FORBIDDEN");
    await expect(service.grant("owner", "old-client", [c.id])).rejects.toThrow(
      "COMPANY_FORBIDDEN",
    );
    await service.grant("owner", "new-client", [c.id]);
    expect((await service.authorize("owner", "new-client", c.id)).state).toBe(
      "active",
    );
    await expect(
      service.reconnect(
        "owner",
        c.id,
        stopped.generation,
        { ...syntheticCompany, tenant: "100002" },
        syntheticCredentials,
      ),
    ).rejects.toThrow("CONNECTION_CONFLICT");
    const other = await service.add(
      "owner",
      { ...syntheticCompany, tenant: "100002" },
      syntheticCredentials,
    );
    expect(other.id).not.toBe(c.id);
  });
}
