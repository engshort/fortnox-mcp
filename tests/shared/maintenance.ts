import type { StateStore } from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
export function maintenanceContract(fixture: () => Promise<StateStore>) {
  it("expires only temporary flows/continuations and preserves unresolved operational evidence", async () => {
    const state = await fixture();
    await state.put(
      "installation",
      "owner",
      { phase: "active", ownerId: "owner", tokenHash: "", expiresAt: 0 },
      null,
    );
    await state.put(
      "fortnox-flows",
      "owner",
      [
        { id: "expired", expiresAt: 1, secret: "synthetic-expired" },
        { id: "live", expiresAt: 100, secret: "synthetic-live" },
      ],
      null,
    );
    await state.put(
      "continuations",
      "owner",
      { expired: { expiresAt: 1 }, live: { expiresAt: 100 } },
      null,
    );
    await state.put(
      "unresolved",
      "owner",
      { state: "outcome_unknown", reference: "synthetic-intent" },
      null,
    );
    await cleanupProduct(state, 50);
    expect(
      (await state.get<unknown[]>("fortnox-flows", "owner"))?.value,
    ).toHaveLength(1);
    expect(
      Object.keys(
        (await state.get<Record<string, unknown>>("continuations", "owner"))
          ?.value ?? {},
      ),
    ).toEqual(["live"]);
    expect(
      (await state.get<{ state: string }>("unresolved", "owner"))?.value.state,
    ).toBe("outcome_unknown");
  });
}
