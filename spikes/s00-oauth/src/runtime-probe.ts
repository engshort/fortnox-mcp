import { Decimal } from "decimal.js";
import { digest, type FileContext, fileService } from "./files.js";
import type { ReviewRecord, ReviewStore } from "./review.js";

export const runtimeWorkloads = {
  small: 1024,
  representative: 1024 * 1024,
  limit: 5 * 1024 * 1024,
} as const;
export type RuntimeWorkload = keyof typeof runtimeWorkloads;
export const runtimeCompany = "s00-runtime-benchmark";
export function runtimeFile(size: number) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
  ];
  let text = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 4\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n`;
  if (
    !Number.isInteger(size) ||
    size < text.length + 5 ||
    size > runtimeWorkloads.limit
  )
    throw new Error("RUNTIME_SIZE_INVALID");
  return new TextEncoder().encode(
    `${text}${" ".repeat(size - text.length - 5)}%%EOF`,
  );
}
export interface RuntimeContext {
  owner: string;
  secret: string;
  files: FileContext["store"];
  reviews: ReviewStore;
  validator: FileContext["validator"];
}
export async function runRuntimeProbe(
  context: RuntimeContext,
  workload: RuntimeWorkload,
  body: Uint8Array,
) {
  const bytes = runtimeWorkloads[workload];
  if (body.length !== bytes * 2) throw new Error("RUNTIME_SIZE_INVALID");
  const started = performance.now();
  const timings: Record<string, number> = {};
  let checkpoint = started;
  const phase = (name: string) => {
    const time = performance.now();
    timings[name] = Math.round((time - checkpoint) * 100) / 100;
    checkpoint = time;
  };
  // Original synthetic descriptors; not generated from the restricted provider spec.
  const catalog = Array.from({ length: 405 }, (_, i) => ({
    name: `synthetic_operation_${i}`,
    inputSchema: {
      type: "object",
      properties: {
        reference: { type: "string" },
        amount: { type: "string", pattern: "^-?[0-9]+[.][0-9]{2}$" },
      },
      required: ["reference"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
  const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog)).length;
  phase("catalogMs");
  let total = new Decimal(0);
  for (let i = 0; i < 5000; i++) total = total.plus("0.01");
  if (!total.eq("50.00")) throw new Error("RUNTIME_DECIMAL_FAILED");
  phase("decimalMs");
  const first = body.subarray(0, bytes),
    second = body.subarray(bytes);
  const expected = [await digest(first), await digest(second)];
  const origin = "https://synthetic.runtime.example.com";
  const files = fileService({
    owner: context.owner,
    company: runtimeCompany,
    secret: context.secret,
    store: context.files,
    validator: context.validator,
    origins: [origin],
    transport: {
      async open(url) {
        const content = url.pathname === "/1" ? first : second;
        let offset = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (offset >= content.length) {
                controller.close();
                return;
              }
              controller.enqueue(content.slice(offset, offset + 64 * 1024));
              offset += 64 * 1024;
            },
          }),
          { headers: { "content-type": "application/pdf" } },
        );
      },
    },
  });
  let workflow: string | undefined;
  try {
    const prepared = await files.ingest({
      files: [1, 2].map((n) => ({
        download_url: `${origin}/${n}`,
        file_id: `synthetic-${n}`,
      })),
    });
    workflow = prepared.workflow;
    phase("validateEncryptStoreMs");
    for (const [i, reference] of prepared.files.entries()) {
      const output = await files.read(reference.id);
      if (output.sha256 !== expected[i] || output.bytes !== bytes)
        throw new Error("RUNTIME_FILE_FAILED");
    }
    phase("decryptReadMs");
    const now = Date.now();
    const intent: ReviewRecord = {
      id: crypto.randomUUID(),
      owner: context.owner,
      company: runtimeCompany,
      proposalHash: "0".repeat(64),
      capabilityHash: await digest(crypto.getRandomValues(new Uint8Array(32))),
      policyVersion: 1,
      expires: now + 10 * 60_000,
    };
    if (!(await context.reviews.insert(intent, now)))
      throw new Error("RUNTIME_STATE_LIMIT");
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, () => context.reviews.consume(intent, now)),
    );
    const winners = outcomes.filter(Boolean).length;
    if (
      winners !== 1 ||
      (await context.reviews.read(intent))?.state !== "consumed"
    )
      throw new Error("RUNTIME_ATOMIC_FAILED");
    phase("atomicStateMs");
    return {
      synthetic: true as const,
      fortnoxEnabled: false as const,
      workload,
      files: 2,
      bytesPerFile: bytes,
      totalFileBytes: body.length,
      sha256: expected,
      catalogTools: 405,
      catalogBytes,
      decimalOperations: 5000,
      decimalTotal: total.toFixed(2),
      concurrentClaims: 16,
      acceptedClaims: winners,
      timings,
      totalMs: Math.round((performance.now() - started) * 100) / 100,
      stateReference: { id: intent.id, expires: intent.expires },
    };
  } finally {
    if (workflow)
      await context.files.removeWorkflow(
        workflow,
        context.owner,
        runtimeCompany,
      );
    body.fill(0);
  }
}
