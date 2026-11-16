import { open, readFile, stat } from "node:fs/promises";
import { MAX_SPEC_BYTES } from "../packages/docs/src/contracts.js";
import { parseOpenApi } from "../packages/docs/src/openapi.js";

// Operator-only preparation. The private source and derived review template must
// never be included in source control, logs, release packets or public builds.
const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) {
  process.stderr.write(
    "Usage: npm run prepare:bridge-catalog -- /private/openapi.json /private/bridge-review.json\n",
  );
  process.exitCode = 1;
} else {
  try {
    if ((await stat(input)).size > MAX_SPEC_BYTES)
      throw new Error("Oversized private input");
    const specification = await readFile(input, "utf8");
    const source = await parseOpenApi(specification, new Date().toISOString());
    const operations = [...source.operations.values()].map((op) => ({
      operation_id: op.id,
      method: op.method,
      path: op.path,
      scopes: [],
      effect: "write",
      reconciliation: "none",
      finance: true,
      manual_vouchers: true,
      files: true,
      credentials: "specialist",
      unavailable: "domain_validation_required",
    }));
    const bundle = {
      version: "fortnox-bridge-catalog-v1",
      specification,
      source_sha256: source.source.sha256,
      operations,
    };
    const file = await open(output, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(bundle, null, 2)}\n`);
    } finally {
      await file.close();
    }
    process.stdout.write(
      `Prepared ${operations.length} disabled operations for explicit operator review. No capability was enabled.\n`,
    );
  } catch {
    process.stderr.write(
      "Catalogue preparation failed; check the private input and a new output path.\n",
    );
    process.exitCode = 1;
  }
}
