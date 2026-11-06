import type { StateStore } from "@fortnox-mcp/core";
import type { Owner } from "./product-auth.js";
// Bounded operational snapshots only; financial reconciliation state is untouched.
export async function cleanupProduct(state: StateStore, now = Date.now()) {
  const owner = (await state.get<Owner>("installation", "owner"))?.value
    .ownerId;
  if (!owner) return;
  for (const space of ["fortnox-flows", "continuations"]) {
    for (let n = 0; n < 8; n++) {
      const row = await state.get<unknown>(space, owner);
      if (!row) break;
      const live = (v: unknown) =>
        Boolean(
          v &&
            typeof v === "object" &&
            "expiresAt" in v &&
            typeof v.expiresAt === "number" &&
            v.expiresAt > now,
        );
      const value = Array.isArray(row.value)
        ? row.value.filter(live)
        : Object.fromEntries(
            Object.entries(row.value ?? {}).filter(([, v]) => live(v)),
          );
      if (await state.put(space, owner, value, row.version)) break;
    }
  }
}
