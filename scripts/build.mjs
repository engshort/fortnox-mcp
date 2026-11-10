import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { build } from "esbuild";
import { build as buildAdmin } from "vite";
import { prepareRuntimeNotices } from "./prepare-release.mjs";

await buildAdmin({ configFile: "apps/admin/vite.config.ts" });

const operationsBuild = await build({
  entryPoints: ["scripts/product-ops.ts"],
  outfile: "dist/product-ops.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  metafile: true,
});
await writeFile(
  "dist/product-ops.meta.json",
  JSON.stringify(operationsBuild.metafile),
);

const sourceCommit =
  process.env.SOURCE_COMMIT ??
  (await promisify(execFile)("git", ["rev-parse", "HEAD"])).stdout.trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit) || /^0+$/.test(sourceCommit))
  throw new Error("A real SOURCE_COMMIT is required");

await build({
  entryPoints: ["apps/node/src/register-test-main.ts"],
  outfile: "dist/register-test-node.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  define: { __REGISTER_TEST_SOURCE_COMMIT__: JSON.stringify(sourceCommit) },
});

await build({
  entryPoints: ["apps/node/src/receipt-test-main.ts"],
  outfile: "dist/receipt-test-node.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  define: { __M14_TEST_SOURCE_COMMIT__: JSON.stringify(sourceCommit) },
});

await build({
  entryPoints: ["apps/node/src/product-recovery.ts"],
  outfile: "dist/product-recovery.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
});

await build({
  entryPoints: ["apps/node/src/docs-main.ts"],
  outfile: "dist/docs-node.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
});

await build({
  entryPoints: ["apps/node/src/main.ts"],
  outfile: "dist/node.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
});
await build({
  entryPoints: ["apps/worker/src/index.ts"],
  outfile: "dist/worker.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2023",
  conditions: ["workerd", "worker", "browser"],
  sourcemap: true,
});
await build({
  entryPoints: ["apps/worker/src/installation.ts"],
  outfile: "dist/installation.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2023",
  conditions: ["workerd", "worker", "browser"],
  sourcemap: true,
});
await build({
  entryPoints: ["packages/ui/src/index.ts"],
  outfile: "dist/ui.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2023",
});

const productBuild = await build({
  entryPoints: ["apps/node/src/product-main.ts"],
  outfile: "dist/product-node.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  metafile: true,
});
await writeFile(
  "dist/product-node.meta.json",
  JSON.stringify(productBuild.metafile),
);
await build({
  entryPoints: ["apps/worker/src/product.ts"],
  outfile: "dist/product-worker.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2023",
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*"],
  sourcemap: true,
});

await build({
  entryPoints: ["apps/worker/src/receipt-test.ts"],
  outfile: "dist/receipt-test-worker.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2023",
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*"],
  define: {
    __M14_TEST_SOURCE_COMMIT__: JSON.stringify(sourceCommit),
  },
  sourcemap: true,
});

const artifacts = {};
for (const path of [
  "product-node.js",
  "product-ops.js",
  "admin/admin.js",
  "admin/admin.css",
])
  artifacts[path] = createHash("sha256")
    .update(await readFile(`dist/${path}`))
    .digest("hex");
await writeFile(
  "dist/build-info.json",
  JSON.stringify({ source_commit: sourceCommit, artifacts }),
);
await writeFile(
  "dist/runtime-components.json",
  JSON.stringify(await prepareRuntimeNotices("dist")),
);
