import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileCodec } from "../src/file-codec.js";
import { fileSchema } from "../src/file-sql.js";
import { sqliteFileStore } from "../src/file-sqlite.js";
import { fileValidator } from "../src/file-validation.js";
import { digest } from "../src/files.js";
import { reviewSchema } from "../src/review.js";
import { sqliteReviewStore } from "../src/review-sqlite.js";
import {
  type RuntimeWorkload,
  runRuntimeProbe,
  runtimeFile,
  runtimeWorkloads,
} from "../src/runtime-probe.js";

// Optional private JSON: {origin, token}. Never put token values in argv/stdout.
const privatePath = process.argv[2];
const remote = privatePath
  ? (JSON.parse(await readFile(privatePath, "utf8")) as {
      origin: string;
      token: string;
    })
  : undefined;
if (
  remote &&
  (!/^https:\/\/[a-z0-9.-]+$/.test(remote.origin) ||
    !/^[0-9a-f]{64}$/.test(remote.token))
)
  throw new Error("Invalid private benchmark config");
const directory = await mkdtemp(join(tmpdir(), "s00-runtime-"));
const db = new DatabaseSync(join(directory, "state.sqlite"));
db.exec(fileSchema);
db.exec(reviewSchema);
const context = {
  owner: "synthetic-runtime-owner",
  secret: randomBytes(48).toString("base64url"),
  files: sqliteFileStore(db),
  reviews: sqliteReviewStore(db),
  validator: fileValidator,
  codec: fileCodec,
};
const results: unknown[] = [];
try {
  for (const [workload, size] of Object.entries(runtimeWorkloads)) {
    const file = runtimeFile(size);
    const body = new Uint8Array(size * 2);
    body.set(file);
    body.set(file, size);
    const expectedHash = await digest(file);
    const started = performance.now(),
      cpu = process.cpuUsage();
    if (remote) {
      try {
        const response = await fetch(
          `${remote.origin}/s00-runtime/${workload}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${remote.token}`,
              "content-type": "application/octet-stream",
            },
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(60_000),
          },
        );
        const text = await response.text();
        let result: Record<string, unknown> = {};
        try {
          result = JSON.parse(text);
        } catch {
          result = { error: "NON_JSON_RUNTIME_RESPONSE" };
        }
        const hashes = result.sha256;
        const verified =
          response.ok &&
          result.synthetic === true &&
          result.fortnoxEnabled === false &&
          result.bytesPerFile === size &&
          result.totalFileBytes === size * 2 &&
          result.acceptedClaims === 1 &&
          result.decimalTotal === "50.00" &&
          Array.isArray(hashes) &&
          hashes.length === 2 &&
          hashes.every((h) => h === expectedHash);
        if (!verified) process.exitCode = 1;
        const evidence = {
          runtime: "hosted-worker",
          workload,
          httpStatus: response.status,
          roundTripMs: Math.round(performance.now() - started),
          ...result,
          independentlyVerified: verified,
        };
        results.push(evidence);
        console.log(JSON.stringify(evidence));
        if (response.ok && result.stateReference) {
          const ref = result.stateReference as { id: string; expires: number };
          const state = await fetch(
            `${remote.origin}/s00-runtime/state?${new URLSearchParams({ id: ref.id, expires: String(ref.expires) })}`,
            {
              headers: { authorization: `Bearer ${remote.token}` },
              redirect: "manual",
              signal: AbortSignal.timeout(15_000),
            },
          );
          const stateResult = await state.json();
          console.log(
            JSON.stringify({
              runtime: "hosted-worker",
              workload,
              stateCheck: stateResult,
            }),
          );
        }
      } catch {
        process.exitCode = 1;
        const result = {
          runtime: "hosted-worker",
          workload,
          error: "REMOTE_RUNTIME_FAILED",
        };
        results.push(result);
        console.log(JSON.stringify(result));
      }
    } else {
      const result = await runRuntimeProbe(
        context,
        workload as RuntimeWorkload,
        body,
      );
      const used = process.cpuUsage(cpu),
        memory = process.memoryUsage();
      const evidence = {
        ...result,
        runtime: "node",
        node: process.version,
        cpuMs: (used.user + used.system) / 1000,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        roundTripMs: Math.round(performance.now() - started),
      };
      results.push(evidence);
      console.log(JSON.stringify(evidence));
    }
    body.fill(0);
    file.fill(0);
  }
  await writeFile(
    join(directory, "results.json"),
    JSON.stringify(results, null, 2),
    { mode: 0o600 },
  );
  console.log(
    `Synthetic benchmark evidence: ${join(directory, "results.json")}`,
  );
} finally {
  db.close();
  await rm(join(directory, "state.sqlite"), { force: true });
}
