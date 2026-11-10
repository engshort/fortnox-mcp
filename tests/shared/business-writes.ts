import {
  accountingHash,
  type BusinessOperation,
  BusinessWrites,
  Connections,
  CredentialVault,
  DomainError,
  type StateStore,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import { accountingFixture } from "./accounting.js";
import { keyA, keyB } from "./connections.js";

export function businessWritesContract(fixture: () => Promise<StateStore>) {
  describe("bounded business write intents", () => {
    async function setup() {
      const f = await accountingFixture(await fixture());
      let calls = 0;
      const op: BusinessOperation = {
        enabled: true,
        scope: "bookkeeping",
        prepare: async (_actor, _company, input) => {
          const value = z
            .object({ text: z.string().max(100) })
            .strict()
            .parse(input);
          return { input: value, baseline: null, preview: value };
        },
        validate: async () => {},
        dispatch: async (_actor, _company, _input, authorizeDispatch) => {
          await authorizeDispatch();
          calls++;
          return { state: "succeeded", reference: "synthetic-record-1" };
        },
      };
      const service = new BusinessWrites(f.connections, { create: op });
      return { ...f, op, service, calls: () => calls };
    }
    it("encrypts proposals and prevents concurrent and repeated dispatch", async () => {
      const f = await setup();
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic private input",
      });
      const ref = {
        company_id: p.company_id,
        proposal_id: p.proposal_id,
        proposal_hash: p.proposal_hash,
      };
      expect(
        JSON.stringify(await f.connections.snapshot(f.actor.ownerId)),
      ).not.toContain("Synthetic private input");
      const results = await Promise.allSettled([
        f.service.execute(f.actor, "create", ref),
        f.service.execute(f.actor, "create", ref),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      expect(f.calls()).toBe(1);
      expect(await f.service.execute(f.actor, "create", ref)).toEqual({
        state: "succeeded",
        reference: "synthetic-record-1",
      });
      expect(f.calls()).toBe(1);
    });
    it("denies foreign company, missing write scope, read-only, restore block and unregistered operations", async () => {
      const f = await setup();
      await expect(
        f.service.prepare(f.actor, crypto.randomUUID(), "create", {}),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      await expect(
        f.service.prepare(
          { ...f.actor, scopes: ["mcp:read"] },
          f.a.id,
          "create",
          {},
        ),
      ).rejects.toThrow("AUTH_REQUIRED");
      await expect(
        f.service.prepare(f.actor, f.b.id, "create", {}),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.service.prepare(f.actor, f.a.id, "__proto__", {}),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await f.state.put("installation", "restore", { reconciled: false }, null);
      await expect(
        f.service.prepare(f.actor, f.a.id, "create", {}),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls()).toBe(0);
    });
    it("retains a lost response across service restart without retry", async () => {
      const f = await setup();
      f.op.dispatch = async (_a, _c, _p, authorizeDispatch) => {
        await authorizeDispatch();
        throw new Error("synthetic lost response");
      };
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      const ref = {
        company_id: p.company_id,
        proposal_id: p.proposal_id,
        proposal_hash: p.proposal_hash,
      };
      expect(await f.service.execute(f.actor, "create", ref)).toEqual({
        state: "outcome_unknown",
      });
      const restarted = new BusinessWrites(
        new Connections(f.state, new CredentialVault({ a: keyA }, "a")),
        {
          create: {
            ...f.op,
            dispatch: async () => {
              throw new Error("must not dispatch");
            },
          },
        },
      );
      expect(await restarted.execute(f.actor, "create", ref)).toEqual({
        state: "outcome_unknown",
      });
      await expect(
        restarted.prepare(f.actor, f.a.id, "create", { text: "Synthetic" }),
      ).rejects.toThrow("OUTCOME_UNKNOWN");
    });
    it("persists a known different result without success, replay or changing the original intent", async () => {
      const f = await setup();
      const expected = await accountingHash({ Amount: "0.01" });
      const observed = await accountingHash({ Amount: "0.00" });
      f.op.evidence = async () => ({
        target: null,
        fields: ["Amount"],
        digest: expected,
      });
      const difference = {
        expected_digest: expected,
        observed_digest: observed,
        fields: ["Amount"],
        proof: "retained_provider_response_and_exact_readback" as const,
      };
      const dispatch = f.op.dispatch;
      f.op.dispatch = async (...args) => ({
        ...(await dispatch(...args)),
        state: "applied_different",
        difference,
      });
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      const ref = {
        company_id: p.company_id,
        proposal_id: p.proposal_id,
        proposal_hash: p.proposal_hash,
      };
      const result = await f.service.execute(f.actor, "create", ref);
      expect(result).toEqual({
        state: "applied_different",
        reference: "synthetic-record-1",
        difference,
      });
      const restarted = new BusinessWrites(
        new Connections(f.state, new CredentialVault({ a: keyA }, "a")),
        { create: f.op },
      );
      expect(await restarted.execute(f.actor, "create", ref)).toEqual(result);
      expect(await restarted.reconcile(f.actor, "create", ref)).toEqual(result);
      expect(f.calls()).toBe(1);
      const execution = (
        await restarted.connections.list(f.actor.ownerId)
      ).find((c) => c.id === f.a.id)?.business?.executions[0];
      expect(execution).toMatchObject({
        hash: ref.proposal_hash,
        evidence: { digest: expected },
        difference,
      });
      // The original intent remains terminal; a separate reviewed correction can be prepared.
      expect(
        await restarted.prepare(f.actor, f.a.id, "create", {
          text: "Separate correction",
        }),
      ).toHaveProperty("proposal_id");
    });
    for (const invalid of [
      "expected_digest",
      "field",
      "reference",
      "missing_reference",
      "equal_digests",
    ] as const)
      it(`keeps uncertainty when difference reconciliation has invalid ${invalid} evidence`, async () => {
        const f = await setup();
        const expected = await accountingHash({ Amount: "0.01" });
        f.op.evidence = async () => ({
          target: null,
          fields: ["Amount"],
          digest: expected,
        });
        f.op.dispatch = async (_a, _c, _p, before) => {
          await before();
          return {
            state: "outcome_unknown",
            ...(invalid === "missing_reference"
              ? {}
              : { reference: "synthetic-record-1" }),
          };
        };
        f.op.reconcile = async () => ({
          state: "applied_different",
          reference:
            invalid === "reference" ? "different-record" : "synthetic-record-1",
          difference: {
            expected_digest:
              invalid === "expected_digest" ? "a".repeat(64) : expected,
            observed_digest:
              invalid === "equal_digests" ? expected : "b".repeat(64),
            fields: [invalid === "field" ? "Secret" : "Amount"],
            proof: "retained_provider_response_and_exact_readback",
          },
        });
        const p = await f.service.prepare(f.actor, f.a.id, "create", {
          text: "Synthetic",
        });
        const ref = {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        };
        await f.service.execute(f.actor, "create", ref);
        await expect(
          f.service.reconcile(f.actor, "create", ref),
        ).rejects.toThrow();
        expect((await f.service.status(f.actor, ref)).state).toBe(
          "outcome_unknown",
        );
        await expect(
          f.service.prepare(f.actor, f.a.id, "create", { text: "Synthetic" }),
        ).rejects.toThrow("OUTCOME_UNKNOWN");
      });
    it("rejects changed documents and policy changes before dispatch", async () => {
      const f = await setup();
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      const ref = {
        company_id: p.company_id,
        proposal_id: p.proposal_id,
        proposal_hash: p.proposal_hash,
      };
      f.op.validate = async () => {
        throw new DomainError("PROPOSAL_STALE");
      };
      await expect(f.service.execute(f.actor, "create", ref)).rejects.toThrow(
        "PROPOSAL_STALE",
      );
      f.op.validate = async () => {};
      await f.connections.setAccountingPolicy(
        f.actor.ownerId,
        f.a.id,
        2,
        "client_managed",
        false,
      );
      await expect(f.service.execute(f.actor, "create", ref)).rejects.toThrow(
        "PROPOSAL_STALE",
      );
      expect(f.calls()).toBe(0);
    });
    it("rotates proposal encryption and fails closed with old keys", async () => {
      const f = await setup();
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      const rotated = new Connections(
        f.state,
        new CredentialVault({ a: keyA, b: keyB }, "b"),
      );
      await rotated.rotateKey(f.actor.ownerId);
      const next = new BusinessWrites(
        new Connections(f.state, new CredentialVault({ b: keyB }, "b")),
        { create: f.op },
      );
      expect(
        (
          await next.execute(f.actor, "create", {
            company_id: p.company_id,
            proposal_id: p.proposal_id,
            proposal_hash: p.proposal_hash,
          })
        ).state,
      ).toBe("succeeded");
      await expect(f.connections.list(f.actor.ownerId)).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
    });
    it("blocks a disconnect during pre-dispatch validation", async () => {
      const f = await setup();
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      f.op.validate = async () => {
        await f.connections.disconnect(f.actor.ownerId, f.a.id);
      };
      await expect(
        f.service.execute(f.actor, "create", {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        }),
      ).rejects.toThrow();
      expect(f.calls()).toBe(0);
    });
    it("checks current provider scopes and expires status without dispatch", async () => {
      const f = await setup();
      let now = Date.now();
      const service = new BusinessWrites(
        f.connections,
        { create: f.op },
        () => now,
      );
      const p = await service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      const ref = {
        company_id: p.company_id,
        proposal_id: p.proposal_id,
        proposal_hash: p.proposal_hash,
      };
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes = [];
      });
      await expect(service.execute(f.actor, "create", ref)).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes = ["bookkeeping"];
      });
      now += 900001;
      await expect(service.status(f.actor, ref)).rejects.toThrow(
        "PROPOSAL_STALE",
      );
      await expect(service.execute(f.actor, "create", ref)).rejects.toThrow(
        "PROPOSAL_STALE",
      );
      expect(f.calls()).toBe(0);
    });
    it("cleans expired encrypted inputs and terminal history but retains old unknown outcomes", async () => {
      const f = await setup();
      await f.state.put(
        "installation",
        "owner",
        { ownerId: f.actor.ownerId },
        null,
      );
      const p = await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic",
      });
      await f.service.execute(f.actor, "create", {
        company_id: p.company_id,
        proposal_id: p.proposal_id,
        proposal_hash: p.proposal_hash,
      });
      await f.service.prepare(f.actor, f.a.id, "create", {
        text: "Synthetic expiring input",
      });
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        const success = c.business?.executions[0];
        if (!success) throw new Error("missing synthetic execution");
        c.business?.executions.push({
          ...success,
          id: crypto.randomUUID(),
          state: "outcome_unknown",
        });
        c.business?.executions.push({
          ...success,
          id: crypto.randomUUID(),
          state: "applied_different",
          difference: {
            expected_digest: "a".repeat(64),
            observed_digest: "b".repeat(64),
            fields: ["Amount"],
            proof: "retained_provider_response_and_exact_readback",
          },
        });
      });
      await cleanupProduct(f.state, Date.now() + 31 * 86400000);
      const c = (await f.connections.list(f.actor.ownerId)).find(
        (c) => c.id === f.a.id,
      );
      expect(c?.business?.proposals).toEqual([]);
      expect(c?.business?.executions.map((e) => e.state)).toEqual([
        "outcome_unknown",
      ]);
    });
  });
}
