import { z } from "zod";

export const receiptRecoveryScenarios = [
  "lostUploadAnswer",
  "lostVoucherAnswer",
  "concurrentSubmit",
  "restartUnknown",
  "knownUnappliedLinkRepair",
  "lostLinkAnswer",
  "tenItemPartial",
  "mixedItemOutcomes",
  "lateDisconnectAnswer",
  "resultStorageFailure",
];
const sourceCommit = z.string().regex(/^(?!0{40}$)[a-f0-9]{40}$/);
const counts = z
  .object({
    requested: z.number().int().min(1).max(10),
    completed: z.number().int().min(0).max(10),
    partial: z.number().int().min(0).max(10),
    failed: z.number().int().min(0).max(10),
    unknown: z.number().int().min(0).max(10),
    needs_input: z.number().int().min(0).max(10),
    prepared: z.number().int().min(0).max(10),
  })
  .strict()
  .refine(
    (c) =>
      c.requested ===
      c.completed +
        c.partial +
        c.failed +
        c.unknown +
        c.needs_input +
        c.prepared,
  );
const batchReference = z
  .object({
    company_id: z.string().uuid(),
    batch_id: z.string().uuid(),
    batch_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const configSchema = z
  .object({
    origin: z.string().url(),
    serverCommit: sourceCommit,
    accessToken: z.string().min(1).max(8192),
    companyIds: z
      .array(z.string().uuid())
      .length(2)
      .refine((ids) => new Set(ids).size === 2),
    snapshots: z
      .array(batchReference.extend({ expectedCounts: counts }).strict())
      .min(2)
      .max(8),
  })
  .strict()
  .refine(
    (r) =>
      r.snapshots.every((s) => r.companyIds.includes(s.company_id)) &&
      r.companyIds.every((id) =>
        r.snapshots.some((s) => s.company_id === id),
      ) &&
      new Set(r.snapshots.map((s) => s.batch_id)).size === r.snapshots.length,
  );

export function parseReceiptRecoveryConfig(input) {
  const config = configSchema.parse(input),
    url = new URL(config.origin);
  if (
    url.origin !== config.origin ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))
    )
  )
    throw new Error("Invalid acceptance origin");
  return config;
}
const manualRecord = z
  .object({
    serverCommit: sourceCommit,
    observedAt: z.iso.datetime(),
    client: z.string().min(1).max(160),
    runtime: z.string().min(1).max(160),
    deployment: z.string().min(1).max(160),
    limitations: z.string().min(1).max(2000),
    scenarios: z
      .array(
        z
          .object({
            id: z.enum(receiptRecoveryScenarios),
            result: z.enum(["pass", "fail", "not_run"]),
            observedAt: z.iso.datetime(),
            privateEvidenceRef: z.string().min(1).max(256),
          })
          .strict(),
      )
      .length(receiptRecoveryScenarios.length),
  })
  .strict()
  .refine(
    (r) =>
      new Set(r.scenarios.map((s) => s.id)).size ===
        receiptRecoveryScenarios.length &&
      r.scenarios.every((s) => s.result === "pass"),
  );

// Structural validation of an operator report is never observation or approval.
export function validateReceiptRecoveryRecord(input) {
  return manualRecord.safeParse(input).success;
}
const states = [
  "completed",
  "partial",
  "failed",
  "outcome_unknown",
  "needs_input",
  "prepared",
];
function verifySnapshot(data, expected) {
  if (
    !data ||
    data.company_id !== expected.company_id ||
    data.batch_id !== expected.batch_id ||
    data.batch_hash !== expected.batch_hash ||
    !Array.isArray(data.items) ||
    data.items.length < 1 ||
    data.items.length > 10
  )
    throw new Error("Invalid snapshot");
  const actual = counts.parse(data.counts);
  if (
    Object.keys(actual).some(
      (key) => actual[key] !== expected.expectedCounts[key],
    ) ||
    data.items.length !== actual.requested ||
    new Set(data.items.map((i) => i.item_id)).size !== data.items.length
  )
    throw new Error("Invalid snapshot counts");
  for (const item of data.items) {
    if (
      !z.string().uuid().safeParse(item.item_id).success ||
      item.file?.company_id !== expected.company_id ||
      (item.proposal && item.proposal.company_id !== expected.company_id) ||
      !states.includes(item.state)
    )
      throw new Error("Invalid item binding");
    const steps = [item.steps?.upload, item.steps?.voucher, item.steps?.link];
    if (
      steps.some(
        (s) =>
          !s ||
          ![
            "pending",
            "submitting",
            "succeeded",
            "failed",
            "outcome_unknown",
          ].includes(s.state),
      ) ||
      steps.some(
        (s) =>
          s.state === "succeeded" &&
          (typeof s.reference !== "string" || !s.reference),
      )
    )
      throw new Error("Invalid step");
    if (
      item.state === "completed" &&
      !steps.every((s) => s.state === "succeeded")
    )
      throw new Error("Invalid completion");
    if (
      steps.some((s) => ["submitting", "outcome_unknown"].includes(s.state)) &&
      item.state !== "outcome_unknown"
    )
      throw new Error("Hidden uncertainty");
    if (item.state === "completed" && item.next_action !== "none")
      throw new Error("Invalid completed action");
    if (
      item.state === "outcome_unknown" &&
      !steps.some((s) => ["submitting", "outcome_unknown"].includes(s.state))
    )
      throw new Error("Invalid uncertainty");
    if (
      item.next_action === "repair_link_only" &&
      item.steps.voucher.state !== "succeeded"
    )
      throw new Error("Invalid repair");
    if (
      typeof item.next_action !== "string" ||
      !item.next_action ||
      !(item.reason === null || typeof item.reason === "string")
    )
      throw new Error("Missing item result");
  }
  for (const [state, key] of [
    ["completed", "completed"],
    ["partial", "partial"],
    ["failed", "failed"],
    ["outcome_unknown", "unknown"],
    ["needs_input", "needs_input"],
    ["prepared", "prepared"],
  ])
    if (data.items.filter((i) => i.state === state).length !== actual[key])
      throw new Error("Invalid outcome count");
  return actual;
}
async function boundedJson(response) {
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    await response.body?.cancel();
    throw new Error("MCP response unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing MCP body");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1048576) {
        await reader.cancel();
        throw new Error("MCP response limit");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
// The only remotely callable names are fixed reads. No operation comes from input.
export async function readReceiptRecoverySnapshots(input, send = fetch) {
  const config = parseReceiptRecoveryConfig(input);
  let requestId = 0;
  const call = async (name, args) => {
    const id = ++requestId;
    const response = await send(`${config.origin}/mcp`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const envelope = await boundedJson(response),
      result = envelope.result;
    if (
      envelope.id !== id ||
      envelope.jsonrpc !== "2.0" ||
      envelope.error ||
      result?.isError ||
      result?.structuredContent?.status !== "ok"
    )
      throw new Error("MCP read failed");
    return result.structuredContent.data;
  };
  const companies = (await call("list_companies", {}))?.companies;
  if (
    !Array.isArray(companies) ||
    companies.length !== 2 ||
    !config.companyIds.every((id) => companies.some((c) => c.company_id === id))
  )
    throw new Error("Test company mismatch");
  const aggregate = {
    requested: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    unknown: 0,
    needs_input: 0,
    prepared: 0,
  };
  for (const snapshot of config.snapshots) {
    const { expectedCounts: _, ...ref } = snapshot;
    const actual = verifySnapshot(
      await call("get_receipt_batch", ref),
      snapshot,
    );
    for (const key of Object.keys(aggregate)) aggregate[key] += actual[key];
  }
  return {
    status: "authenticated_receipt_status_reads_match",
    serverCommit: config.serverCommit,
    companies: 2,
    batches: config.snapshots.length,
    counts: aggregate,
    commitSource: "operator supplied; verify deployment separately",
    providerOrBrowserExecutedByThisCheck: false,
    mutationsPerformed: false,
    acceptanceGranted: false,
  };
}
