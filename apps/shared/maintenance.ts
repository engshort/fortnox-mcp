import {
  type ConnectionSet,
  Memberships,
  retainBridgeExecution,
  retainBusinessExecution,
  retainVoucherExecution,
  type StateStore,
} from "@fortnox-mcp/core";
import type { Owner } from "./product-auth.js";
// Bounded operational snapshots only; financial reconciliation state is untouched.
export async function cleanupProduct(state: StateStore, now = Date.now()) {
  const owner = (await state.get<Owner>("installation", "owner"))?.value
    .ownerId;
  if (!owner) return;
  await new Memberships(state, true, () => now).maintenance(owner, "cleanup");
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await state.get<ConnectionSet>("connections", owner);
    if (!row) break;
    row.value.onboarding = (row.value.onboarding ?? []).filter(
      (a) => a.retainUntil > now,
    );
    for (const c of row.value.connections) {
      if (c.bridge)
        c.bridge.executions = c.bridge.executions.filter((e) =>
          retainBridgeExecution(e, now),
        );
      if (c.business) {
        c.business.proposals = c.business.proposals.filter(
          (p) => p.expires > now,
        );
        c.business.executions = c.business.executions.filter((e) =>
          retainBusinessExecution(e, now),
        );
      }
      if (!c.bookkeeping) continue;
      c.bookkeeping.proposals = c.bookkeeping.proposals.filter(
        (p) => p.expires > now,
      );
      c.bookkeeping.executions = c.bookkeeping.executions.filter((e) =>
        retainVoucherExecution(e, now),
      );
    }
    if (await state.put("connections", owner, row.value, row.version)) break;
  }
  for (const space of [
    "fortnox-flows",
    "continuations",
    "read-continuations-v1",
    "office-contact-continuations-v1",
    "oauth-grant-families",
    "oauth-approval-grants",
  ]) {
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
