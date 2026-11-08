import {
  type AccountingProvider,
  type AccountingReferences,
  AccountingValidationError,
  accountingHash,
  Bookkeeping,
  Connections,
  CredentialVault,
  type StateStore,
  type VoucherInput,
  validateVoucher,
} from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { cleanupProduct } from "../../apps/shared/maintenance.js";
import {
  keyA,
  keyB,
  syntheticCompany,
  syntheticCredentials,
} from "./connections.js";

function first<T>(values: readonly (T | undefined)[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Missing synthetic fixture value");
  return value;
}

export function syntheticReferences(
  company: string,
  now = Date.now(),
): AccountingReferences {
  return {
    company_id: company,
    financial_year: 7,
    retrieved_at: now,
    complete: true,
    validation_verified: true,
    year: { id: 7, from: "2025-07-01", to: "2026-06-30" },
    locked_through: "2025-12-31",
    accounts: [1930, 4000].map((number) => ({
      number,
      active: true,
      cost_center: "ALLOWED",
      project: "ALLOWED",
      information: "ALLOWED",
    })),
    series: [{ code: "A", manual: true }],
    cost_centers: [{ code: "CENTER_A", active: true }],
    projects: [{ code: "PROJECT_A", active: true }],
  };
}
export function syntheticVoucher(company: string): VoucherInput {
  return {
    company_id: company,
    financial_year: 7,
    date: "2026-01-01",
    series: "A",
    description: "Synthetic voucher",
    currency: "SEK",
    attachments: [],
    rows: [
      { account: 1930, debit: "0.30", credit: "0" },
      { account: 4000, debit: "0", credit: "0.10" },
      { account: 4000, debit: "0", credit: "0.20" },
    ],
  };
}
export async function accountingFixture(state: StateStore) {
  const connections = new Connections(
    state,
    new CredentialVault({ a: keyA }, "a"),
  );
  const actor = {
    ownerId: "synthetic-owner",
    clientId: "synthetic-mcp-client",
    scopes: ["mcp:read", "mcp:write"],
  };
  const a = await connections.add(
    actor.ownerId,
    {
      ...syntheticCompany,
      scopes: [
        "companyinformation",
        "profile",
        "bookkeeping",
        "settings",
        "costcenter",
        "project",
      ],
    },
    syntheticCredentials,
  );
  const b = await connections.add(
    actor.ownerId,
    {
      ...syntheticCompany,
      tenant: "100002",
      name: "Synthetic B",
      scopes: [...a.scopes],
    },
    { ...syntheticCredentials, accessToken: "synthetic-token-B" },
  );
  await connections.grant(actor.ownerId, actor.clientId, [a.id, b.id]);
  await connections.setAccountingPolicy(
    actor.ownerId,
    a.id,
    1,
    "review_required",
    false,
  );
  let calls = 0;
  const vouchers = new Map<number, VoucherInput>();
  const provider: AccountingProvider = {
    years: async (_actor, company) => ({
      company_id: company,
      retrieved_at: Date.now(),
      complete: true,
      years: [{ id: 7, from: "2025-07-01", to: "2026-06-30" }],
    }),
    references: async (_actor, company) => syntheticReferences(company),
    submit: async (_actor, voucher, before) => {
      await before();
      calls++;
      vouchers.set(calls, voucher);
      return {
        state: "succeeded",
        reference: { financial_year: 7, series: "A", number: calls },
      };
    },
    read: async (_actor, _company, ref) => first([vouchers.get(ref.number)]),
  };
  const gates = { references: true, writes: true, reviewHost: true };
  const service = new Bookkeeping(connections, provider, gates);
  return {
    state,
    connections,
    actor,
    a,
    b,
    provider,
    gates,
    service,
    voucher: syntheticVoucher(a.id),
    calls: () => calls,
  };
}
const commitInput = (p: Awaited<ReturnType<Bookkeeping["prepare"]>>) => ({
  company_id: p.company_id,
  proposal_id: p.proposal_id,
  proposal_hash: p.proposal_hash,
  capability: p.capability,
});

export function accountingContract(fixture: () => Promise<StateStore>) {
  it("blocks financial dispatch during an unreconciled restore interval despite owner policy and valid review", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    await f.state.put("installation", "restore", { reconciled: false }, null);
    await expect(
      f.service.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
    expect(f.calls()).toBe(0);
  });
  it("an owner-attested exact reference can resolve unknown; matching date/amount and wrong rows cannot", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    f.provider.submit = async (_a, _v, before) => {
      await before();
      throw new Error("lost");
    };
    await f.service.commit(f.actor, commitInput(p), "review");
    const ref = {
      company_id: p.company_id,
      proposal_id: p.proposal_id,
      proposal_hash: p.proposal_hash,
    };
    await expect(
      f.service.attestReference("foreign-owner", ref, {
        financial_year: 7,
        series: "A",
        number: 9,
      }),
    ).rejects.toThrow();
    await f.service.attestReference(f.actor.ownerId, ref, {
      financial_year: 7,
      series: "A",
      number: 9,
    });
    f.provider.read = async () => ({
      ...p.voucher,
      description: "Same date/amount but different voucher",
    });
    expect((await f.service.reconcile(f.actor, ref)).state).toBe(
      "outcome_unknown",
    );
    f.provider.read = async () => p.voucher;
    expect((await f.service.reconcile(f.actor, ref)).state).toBe("succeeded");
    expect((await f.service.status(f.actor, ref)).state).toBe("succeeded");
    expect(f.calls()).toBe(0);
  });
  it("scheduled retention deletes expired encrypted input but preserves unresolved intents indefinitely", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    f.provider.submit = async (_a, _v, before) => {
      await before();
      throw new Error("lost");
    };
    await f.service.commit(f.actor, commitInput(p), "review");
    await f.state.put(
      "installation",
      "owner",
      { ownerId: f.actor.ownerId },
      null,
    );
    await cleanupProduct(f.state, Date.now() + 32 * 86400000);
    const c = (await f.connections.list(f.actor.ownerId)).find(
      (c) => c.id === f.a.id,
    );
    expect(c?.bookkeeping?.proposals).toEqual([]);
    expect(c?.bookkeeping?.executions[0]?.state).toBe("outcome_unknown");
    expect(c?.secret).not.toBeNull();
  });
  it("V02/V03 uses exact cents; malformed, signed, overflow and correction rows fail without repair", async () => {
    const f = await accountingFixture(await fixture());
    const valid = validateVoucher(
      f.voucher,
      syntheticReferences(f.a.id),
      Date.now(),
    );
    expect(valid.totals).toEqual({
      debit: "0.30",
      credit: "0.30",
      difference: "0.00",
    });
    for (const bad of [
      "0.001",
      "1e2",
      "NaN",
      "Infinity",
      "-1",
      "1000000000000.00",
      0.3,
    ]) {
      const v = structuredClone(f.voucher);
      first(v.rows).debit = bad as string;
      expect(() =>
        validateVoucher(v, syntheticReferences(f.a.id), Date.now()),
      ).toThrow(AccountingValidationError);
    }
    const v = structuredClone(f.voucher);
    first(v.rows).debit = "0.31";
    try {
      validateVoucher(v, syntheticReferences(f.a.id), Date.now());
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(AccountingValidationError);
      expect((e as AccountingValidationError).fields).toContainEqual({
        path: "rows",
        rule: "unbalanced",
      });
    }
    expect(() =>
      validateVoucher(
        {
          ...f.voucher,
          rows: f.voucher.rows.map((r) => ({ ...r, Removed: true })),
        },
        syntheticReferences(f.a.id),
        Date.now(),
      ),
    ).toThrow();
    expect(f.calls()).toBe(0);
  });
  it("V04-V10 rejects invalid dates, year/lock boundaries, incomplete and foreign references", async () => {
    const f = await accountingFixture(await fixture());
    for (const date of ["2026-02-30", "2025-06-30", "2026-07-01", "2025-12-31"])
      expect(() =>
        validateVoucher(
          { ...f.voucher, date },
          syntheticReferences(f.a.id),
          Date.now(),
        ),
      ).toThrow();
    for (const change of [
      { complete: false },
      { validation_verified: false },
      { retrieved_at: Date.now() - 61000 },
      { financial_year: 8 },
      { accounts: [] },
      { series: [{ code: "A", manual: false }] },
    ])
      expect(() =>
        validateVoucher(
          f.voucher,
          { ...syntheticReferences(f.a.id), ...change },
          Date.now(),
        ),
      ).toThrow();
    expect(() =>
      validateVoucher(f.voucher, syntheticReferences(f.b.id), Date.now()),
    ).toThrow("COMPANY_FORBIDDEN");
    const refs = syntheticReferences(f.a.id);
    first(refs.accounts).active = false;
    expect(() => validateVoucher(f.voucher, refs, Date.now())).toThrow();
    first(refs.accounts).active = true;
    first(refs.accounts).project = "REQUIRED";
    expect(() => validateVoucher(f.voucher, refs, Date.now())).toThrow();
    const withProject = structuredClone(f.voucher);
    first(withProject.rows).project = "PROJECT_A";
    expect(
      validateVoucher(withProject, refs, Date.now()).totals.difference,
    ).toBe("0.00");
    first(withProject.rows).project = "FOREIGN_B";
    expect(() => validateVoucher(withProject, refs, Date.now())).toThrow();
  });
  it("immutable encrypted proposals normalize cents and bind owner/client/company/hash/selection", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    const v = structuredClone(f.voucher);
    first(v.rows).debit = "0.3";
    const second = await f.service.prepare(f.actor, v);
    expect(p.proposal_hash).toBe(second.proposal_hash);
    expect(p.capability).not.toBe(second.capability);
    const stored = JSON.stringify(
      (await f.state.get("connections", f.actor.ownerId))?.value,
    );
    expect(stored).not.toContain(f.voucher.description);
    expect(stored).not.toContain(p.capability);
    await expect(
      f.service.proposal(
        { ...f.actor, clientId: "foreign-client" },
        commitInput(p),
      ),
    ).rejects.toThrow();
    await expect(
      f.service.commit(
        f.actor,
        { ...commitInput(p), company_id: f.b.id },
        "review",
      ),
    ).rejects.toThrow();
    await expect(
      f.service.commit(
        f.actor,
        { ...commitInput(p), proposal_hash: "a".repeat(64) },
        "review",
      ),
    ).rejects.toThrow();
    await expect(
      f.service.commit(
        f.actor,
        { ...commitInput(p), selected: [second.proposal_id] },
        "review",
      ),
    ).rejects.toThrow();
    expect(f.calls()).toBe(0);
  });
  it("V11 reserves and consumes review+intent atomically across concurrent executors; no replay", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    const restart = new Bookkeeping(f.connections, f.provider, f.gates);
    const results = await Promise.allSettled([
      f.service.commit(f.actor, commitInput(p), "review"),
      restart.commit(f.actor, commitInput(p), "review"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.calls()).toBe(1);
    const ref = {
      company_id: p.company_id,
      proposal_id: p.proposal_id,
      proposal_hash: p.proposal_hash,
    };
    expect((await restart.status(f.actor, ref)).state).toBe("succeeded");
    expect((await restart.reconcile(f.actor, ref)).state).toBe("succeeded");
    await expect(
      restart.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow();
    expect(f.calls()).toBe(1);
  });
  it("lost upstream response remains unknown across restart and cannot be resent or matched by date/amount", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    let sent = 0;
    f.provider.submit = async (_a, _v, before) => {
      await before();
      sent++;
      throw new Error("synthetic lost response");
    };
    expect(await f.service.commit(f.actor, commitInput(p), "review")).toEqual({
      state: "outcome_unknown",
    });
    const restart = new Bookkeeping(f.connections, f.provider, f.gates);
    const ref = {
      company_id: p.company_id,
      proposal_id: p.proposal_id,
      proposal_hash: p.proposal_hash,
    };
    expect((await restart.status(f.actor, ref)).state).toBe("outcome_unknown");
    await expect(restart.prepare(f.actor, f.voucher)).rejects.toThrow(
      "OUTCOME_UNKNOWN",
    );
    expect((await restart.reconcile(f.actor, ref)).state).toBe(
      "outcome_unknown",
    );
    await expect(
      restart.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow();
    expect(sent).toBe(1);
  });
  it("post-dispatch persistence failure leaves durable unknown intent and never a second POST", async () => {
    const state = await fixture();
    let unavailable = false;
    const guarded: StateStore = {
      get: (...args) => state.get(...args),
      list: (...args) => state.list(...args),
      put: (...args) => {
        if (unavailable) throw new Error("storage unavailable");
        return state.put(...args);
      },
    };
    const f = await accountingFixture(guarded);
    const p = await f.service.prepare(f.actor, f.voucher);
    let sent = 0;
    f.provider.submit = async (_a, _v, before) => {
      await before();
      sent++;
      unavailable = true;
      return {
        state: "succeeded",
        reference: { financial_year: 7, series: "A", number: 9 },
      };
    };
    expect(await f.service.commit(f.actor, commitInput(p), "review")).toEqual({
      state: "outcome_unknown",
    });
    unavailable = false;
    const ref = {
      company_id: p.company_id,
      proposal_id: p.proposal_id,
      proposal_hash: p.proposal_hash,
    };
    expect((await f.service.status(f.actor, ref)).state).toBe(
      "outcome_unknown",
    );
    await expect(
      f.service.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow();
    expect(sent).toBe(1);
  });
  it("model confirmed flag, fabricated capability and unsupported host cannot approve; read-only overrides", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    await expect(
      f.service.commit(
        f.actor,
        { ...commitInput(p), confirmed: true },
        "review",
      ),
    ).rejects.toThrow();
    await expect(
      f.service.commit(
        f.actor,
        { ...commitInput(p), capability: "A".repeat(43) },
        "review",
      ),
    ).rejects.toThrow();
    await expect(
      f.service.commit(
        f.actor,
        {
          company_id: p.company_id,
          proposal_id: p.proposal_id,
          proposal_hash: p.proposal_hash,
        },
        "client",
      ),
    ).rejects.toThrow("CLIENT_UNSUPPORTED");
    const unsupported = new Bookkeeping(f.connections, f.provider, {
      ...f.gates,
      reviewHost: false,
    });
    await expect(
      unsupported.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow("CLIENT_UNSUPPORTED");
    await expect(
      f.service.commit(
        { ...f.actor, scopes: ["mcp:read"] },
        commitInput(p),
        "review",
      ),
    ).rejects.toThrow("AUTH_REQUIRED");
    await f.connections.setAccountingPolicy(
      f.actor.ownerId,
      f.a.id,
      2,
      "review_required",
      true,
    );
    await expect(f.service.prepare(f.actor, f.voucher)).rejects.toThrow(
      "CAPABILITY_UNAVAILABLE",
    );
    expect(
      (
        await f.service.validate(
          { ...f.actor, scopes: ["mcp:read"] },
          f.voucher,
        )
      ).totals.difference,
    ).toBe("0.00");
    expect(f.calls()).toBe(0);
  });
  it("policy changes invalidate old review; client-managed still uses exact validation and a new intent", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    await f.connections.setAccountingPolicy(
      f.actor.ownerId,
      f.a.id,
      2,
      "client_managed",
      false,
    );
    await expect(
      f.service.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow();
    const next = await f.service.prepare(f.actor, f.voucher);
    const { capability: _capability, ...ref } = commitInput(next);
    expect((await f.service.commit(f.actor, ref, "client")).state).toBe(
      "succeeded",
    );
    expect(f.calls()).toBe(1);
  });
  it("fresh provider constraints invalidate a previously valid proposal before submission", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    f.provider.references = async () => ({
      ...syntheticReferences(f.a.id),
      locked_through: "2026-01-01",
    });
    await expect(
      f.service.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow("VALIDATION_FAILED");
    expect(f.calls()).toBe(0);
  });
  it("review expiry and key rotation survive recreated services; wrong key denies private data", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    const expired = new Bookkeeping(
      f.connections,
      f.provider,
      f.gates,
      () => Date.now() + 900001,
    );
    await expect(
      expired.commit(f.actor, commitInput(p), "review"),
    ).rejects.toThrow();
    const rotatedConnections = new Connections(
      f.state,
      new CredentialVault({ a: keyA, b: keyB }, "b"),
    );
    await rotatedConnections.rotateKey(f.actor.ownerId);
    const restored = new Bookkeeping(
      new Connections(f.state, new CredentialVault({ b: keyB }, "b")),
      f.provider,
      f.gates,
    );
    const ref = {
      company_id: p.company_id,
      proposal_id: p.proposal_id,
      proposal_hash: p.proposal_hash,
    };
    expect((await restored.proposal(f.actor, ref)).voucher.description).toBe(
      f.voucher.description,
    );
    const wrong = new Bookkeeping(
      new Connections(f.state, new CredentialVault({ b: keyA }, "b")),
      f.provider,
      f.gates,
    );
    await expect(wrong.proposal(f.actor, ref)).rejects.toThrow(
      "CAPABILITY_UNAVAILABLE",
    );
  });
  it("disconnect during preparation/dispatch cannot regain credentials, policy or old approvals", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    f.provider.submit = async (_a, _v, before) => {
      await f.connections.disconnect(f.actor.ownerId, f.a.id);
      await before();
      return {
        state: "succeeded",
        reference: { financial_year: 7, series: "A", number: 1 },
      };
    };
    expect(
      (await f.service.commit(f.actor, commitInput(p), "review")).state,
    ).toBe("outcome_unknown");
    const c = first(
      (await f.connections.list(f.actor.ownerId)).filter(
        (c) => c.id === f.a.id,
      ),
    );
    expect(c.state).toBe("disconnected");
    expect(c.secret).toBeNull();
    expect(c.bookkeeping?.proposals).toEqual([]);
    expect(f.calls()).toBe(0);
    await expect(f.service.references(f.actor, f.a.id, 7)).rejects.toThrow(
      "CONNECTION_DISCONNECTED",
    );
    expect((await f.service.references(f.actor, f.b.id, 7)).company_id).toBe(
      f.b.id,
    );
  });
  it("provider rejection never succeeds and only exact provider-issued references reconcile", async () => {
    const f = await accountingFixture(await fixture());
    const p = await f.service.prepare(f.actor, f.voucher);
    f.provider.submit = async (_a, _v, before) => {
      await before();
      return { state: "failed", code: "HTTP_403" };
    };
    expect(await f.service.commit(f.actor, commitInput(p), "review")).toEqual({
      state: "failed",
      code: "HTTP_403",
    });
    const next = await f.service.prepare(f.actor, f.voucher);
    expect(next.proposal_hash).toBe(await accountingHash(next.voucher));
    await expect(
      f.service.reconcile(f.actor, {
        company_id: f.a.id,
        proposal_id: next.proposal_id,
        proposal_hash: next.proposal_hash,
        reference: { financial_year: 7, series: "A", number: 1 },
      } as never),
    ).rejects.toThrow();
  });
}
