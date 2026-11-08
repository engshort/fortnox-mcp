import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteReceiptFiles } from "../../apps/node/src/receipt-storage.js";
import { companyServer } from "../../packages/mcp/src/companies.js";
import {
  readReceiptRecoverySnapshots,
  receiptRecoveryScenarios,
  validateReceiptRecoveryRecord,
} from "../../scripts/receipt-recovery-acceptance-lib.mjs";
import { batchFixture } from "../shared/receipt-batches.js";

const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002";
it("consumes the actual company/receipt MCP result contracts for two isolated SQLite companies without provider calls", async () => {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0002_product_state.sql",
    "0004_product_oauth.sql",
    "0006_receipt_files.sql",
  ])
    db.exec(
      readFileSync(
        new URL(`../../apps/worker/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  const f = await batchFixture({
    state: sqliteState(db),
    files: sqliteReceiptFiles(db),
    raw: async () => "",
  });
  const first = await f.receipts.prepare(f.actor, {
    company_id: f.a.id,
    items: f.items,
  });
  const secondCompany = await f.connections.authorize(
    f.actor.ownerId,
    f.actor.clientId,
    f.b.id,
  );
  await f.connections.setAccountingPolicy(
    f.actor.ownerId,
    f.b.id,
    secondCompany.policyVersion,
    "review_required",
    false,
  );
  const staged = await f.service.ingest(f.actor, f.b.id, f.files);
  const second = await f.receipts.prepare(f.actor, {
    company_id: f.b.id,
    items: staged.files.map((file) => ({
      file: {
        company_id: f.b.id,
        workflow_id: staged.workflow_id,
        file_id: file.file_id,
      },
      voucher: { ...f.voucher, company_id: f.b.id },
      duplicate_resolution: "separate_transaction",
    })),
  });
  let providerCalls = 0;
  for (const operation of ["references", "years", "read", "submit"] as const)
    f.provider[operation] = async () => {
      providerCalls++;
      throw new Error("No accounting provider call expected");
    };
  const provider = new FortnoxConnections({
    origin: "https://product.example.com",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async () => {
      providerCalls++;
      throw new Error("No provider read expected");
    },
  });
  const server = companyServer({
    identity: f.actor,
    connections: f.connections,
    provider,
    testMode: true,
    receipts: f.receipts,
  });
  const client = new Client({
    name: "synthetic-recovery-reader",
    version: "0",
  });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    const send: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const body = (await request.json()) as {
        id: number;
        params: { name: string; arguments: Record<string, unknown> };
      };
      const result = await client.callTool(body.params);
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    };
    const result = await readReceiptRecoverySnapshots(
      {
        origin: "https://product.example.com",
        serverCommit: "a".repeat(40),
        accessToken: "synthetic-only",
        companyIds: [f.a.id, f.b.id],
        snapshots: [first, second].map((p) => ({
          company_id: p.company_id,
          batch_id: p.batch_id,
          batch_hash: p.batch_hash,
          expectedCounts: p.counts,
        })),
      },
      send,
    );
    expect(result.counts).toMatchObject({
      requested: 4,
      prepared: 4,
      completed: 0,
    });
    expect(providerCalls).toBe(0);
    expect(f.bookings()).toBe(0);
  } finally {
    await client.close();
    await server.close();
    db.close();
  }
});
function operatorReport() {
  return {
    serverCommit: "a".repeat(40),
    observedAt: new Date().toISOString(),
    client: "Synthetic client version",
    runtime: "Synthetic workerd version",
    deployment: "Synthetic deployment identity",
    limitations: "Shape test only; no actual provider calls",
    scenarios: receiptRecoveryScenarios.map((id) => ({
      id,
      result: "pass",
      observedAt: new Date().toISOString(),
      privateEvidenceRef: `.data/synthetic-${id}`,
    })),
  };
}

function fixture() {
  const snapshots = [
    {
      company_id: a,
      batch_id: "10000000-0000-4000-8000-000000000001",
      batch_hash: "a".repeat(64),
      expectedCounts: {
        requested: 2,
        completed: 0,
        partial: 1,
        unknown: 1,
        failed: 0,
        needs_input: 0,
        prepared: 0,
      },
    },
    {
      company_id: b,
      batch_id: "10000000-0000-4000-8000-000000000002",
      batch_hash: "b".repeat(64),
      expectedCounts: {
        requested: 1,
        completed: 1,
        partial: 0,
        unknown: 0,
        failed: 0,
        needs_input: 0,
        prepared: 0,
      },
    },
  ];
  const step = (state: string) =>
    state === "succeeded"
      ? { state, reference: "synthetic-provider-reference" }
      : { state };
  const item = (
    id: string,
    company: string,
    state: string,
    upload: string,
    voucher: string,
    link: string,
  ) => ({
    item_id: id,
    file: { company_id: company },
    proposal: { company_id: company },
    state,
    reason: null,
    next_action:
      state === "partial"
        ? "repair_link_only"
        : state === "outcome_unknown"
          ? "reconcile_before_resending"
          : "none",
    steps: { upload: step(upload), voucher: step(voucher), link: step(link) },
    voucher: { description: "SYNTHETIC-PRIVATE-INPUT-DO-NOT-PRINT" },
  });
  const data = snapshots.map((s, index) => ({
    company_id: s.company_id,
    batch_id: s.batch_id,
    batch_hash: s.batch_hash,
    counts: s.expectedCounts,
    items:
      index === 0
        ? [
            item(
              "20000000-0000-4000-8000-000000000001",
              a,
              "partial",
              "succeeded",
              "succeeded",
              "failed",
            ),
            item(
              "20000000-0000-4000-8000-000000000002",
              a,
              "outcome_unknown",
              "succeeded",
              "outcome_unknown",
              "pending",
            ),
          ]
        : [
            item(
              "20000000-0000-4000-8000-000000000003",
              b,
              "completed",
              "succeeded",
              "succeeded",
              "succeeded",
            ),
          ],
  }));
  const config = {
    origin: "https://product.example.com",
    serverCommit: "a".repeat(40),
    accessToken: "SYNTHETIC-PRIVATE-ACCESS-TOKEN",
    companyIds: [a, b],
    snapshots,
  };
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe(`${config.origin}/mcp`);
    expect(request.redirect).toBe("error");
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${config.accessToken}`,
    );
    const body = (await request.json()) as {
      id: number;
      params: { name: string; arguments: Record<string, unknown> };
    };
    calls.push(body.params);
    const result =
      body.params.name === "list_companies"
        ? { companies: [{ company_id: a }, { company_id: b }] }
        : data.find((d) => d.batch_id === body.params.arguments.batch_id);
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { structuredContent: { status: "ok", data: result } },
    });
  };
  return { config, calls, send, data };
}
it("reads only the two fixed MCP tools, verifies company-bound per-item counts and emits no private values or acceptance", async () => {
  const f = fixture(),
    result = await readReceiptRecoverySnapshots(f.config, f.send);
  expect(f.calls.map((c) => c.name)).toEqual([
    "list_companies",
    "get_receipt_batch",
    "get_receipt_batch",
  ]);
  expect(result.counts).toMatchObject({
    requested: 3,
    completed: 1,
    partial: 1,
    unknown: 1,
  });
  expect(result).toMatchObject({
    mutationsPerformed: false,
    acceptanceGranted: false,
    providerOrBrowserExecutedByThisCheck: false,
  });
  for (const privateValue of [
    a,
    b,
    f.config.accessToken,
    "synthetic-provider-reference",
    "SYNTHETIC-PRIVATE-INPUT-DO-NOT-PRINT",
  ])
    expect(JSON.stringify(result)).not.toContain(privateValue);
});
it("refuses foreign, duplicate, incomplete or extended operator configurations before network access", async () => {
  const f = fixture();
  for (const config of [
    { ...f.config, companyIds: [a, a] },
    { ...f.config, companyIds: [a] },
    { ...f.config, serverCommit: "0".repeat(40) },
    { ...f.config, origin: "https://product.example.com/private" },
    { ...f.config, origin: "ftp://localhost" },
    { ...f.config, confirmed: true },
    {
      ...f.config,
      snapshots: [
        { ...f.config.snapshots[0], company_id: crypto.randomUUID() },
        f.config.snapshots[1],
      ],
    },
  ])
    await expect(
      readReceiptRecoverySnapshots(config, f.send),
    ).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
it("rejects a cross-company item, inconsistent counts or false completed result instead of laundering it into a successful report", async () => {
  for (const failure of ["company", "counts", "completion", "unknown"]) {
    const f = fixture(),
      first = f.data[0],
      last = f.data[1];
    if (!first || !last) throw new Error("fixture");
    if (failure === "company") {
      const item = first.items[0];
      if (!item) throw new Error("fixture");
      item.file.company_id = b;
    } else if (failure === "counts")
      first.counts = { ...first.counts, partial: 0, prepared: 1 };
    else if (failure === "unknown") {
      const item = first.items[1];
      if (!item) throw new Error("fixture");
      item.steps.voucher = { state: "pending" };
    } else {
      const item = last.items[0];
      if (!item) throw new Error("fixture");
      item.steps.link = { state: "pending" };
    }
    await expect(
      readReceiptRecoverySnapshots(f.config, f.send),
    ).rejects.toThrow();
  }
});
it("bounds MCP response bytes and stops on protocol/error responses without reflecting their content", async () => {
  const f = fixture();
  let cancelled = false;
  const oversized: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(1048577));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  await expect(
    readReceiptRecoverySnapshots(f.config, oversized),
  ).rejects.toThrow("MCP response limit");
  expect(cancelled).toBe(true);
  for (const response of [
    new Response(null, { status: 302 }),
    Response.json({
      jsonrpc: "2.0",
      id: 1,
      error: { message: "SYNTHETIC-PRIVATE-PROVIDER-ERROR" },
    }),
    Response.json({
      jsonrpc: "2.0",
      id: 99,
      result: { structuredContent: { status: "ok" } },
    }),
  ]) {
    const send: typeof fetch = async () => response;
    await expect(
      readReceiptRecoverySnapshots(f.config, send),
    ).rejects.toThrow();
  }
});
it("requires distinct complete claimed scenarios while explicitly treating report validation as structure, never observed proof", () => {
  const record = operatorReport();
  expect(validateReceiptRecoveryRecord(record)).toBe(true);
  expect(
    validateReceiptRecoveryRecord(
      JSON.parse(
        readFileSync(
          new URL(
            "../../docs/examples/m4-recovery-record.example.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ),
  ).toBe(false);
  for (const result of ["not_run", "fail"])
    expect(
      validateReceiptRecoveryRecord({
        ...record,
        scenarios: record.scenarios.map((s, index) =>
          index === 0 ? { ...s, result } : s,
        ),
      }),
    ).toBe(false);
  expect(
    validateReceiptRecoveryRecord({
      ...record,
      scenarios: record.scenarios.map((s) => ({
        ...s,
        id: receiptRecoveryScenarios[0],
      })),
    }),
  ).toBe(false);
});
it("the opt-in CLI denies missing confirmation or public/private invalid configuration without leaking values", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-recovery-check-"));
  try {
    const path = join(dir, "record.json"),
      secret = "SYNTHETIC-PRIVATE-NOT-FOR-LOGS";
    writeFileSync(path, JSON.stringify({ accessToken: secret }), {
      mode: 0o600,
    });
    for (const mode of ["status", "record"]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/receipt-recovery-acceptance.mjs", mode],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            ACCEPTANCE_CONFIG: path,
            RECEIPT_ACCEPTANCE_CONFIRM: "",
          },
          timeout: 5000,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stderr).toContain("No private values emitted");
    }
    const publicPath = join(dir, "public-record.json"),
      privatePath = join(dir, "private-record.json");
    for (const [target, mode] of [
      [publicPath, 0o644],
      [privatePath, 0o600],
    ] as const)
      writeFileSync(target, JSON.stringify(operatorReport()), { mode });
    const run = (target: string) =>
      spawnSync(
        process.execPath,
        ["scripts/receipt-recovery-acceptance.mjs", "record"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, ACCEPTANCE_CONFIG: target },
          timeout: 5000,
        },
      );
    expect(run(publicPath).status).toBe(1);
    const valid = run(privatePath);
    expect(valid.status).toBe(0);
    const summary = JSON.parse(valid.stdout);
    expect(summary).toMatchObject({
      status: "operator_recovery_report_structurally_complete",
      providerOrBrowserExecutedByThisCheck: false,
      acceptanceGranted: false,
    });
    expect(valid.stdout).not.toContain(".data/synthetic-");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
