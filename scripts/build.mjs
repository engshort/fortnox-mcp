import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { build as buildAdmin } from "vite";

await buildAdmin({ configFile: "apps/admin/vite.config.ts" });

await build({
  entryPoints: ["scripts/product-ops.ts"],
  outfile: "dist/product-ops.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
});

const sourceCommit =
  process.env.SOURCE_COMMIT ??
  (await promisify(execFile)("git", ["rev-parse", "HEAD"])).stdout.trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit) || /^0+$/.test(sourceCommit))
  throw new Error("A real SOURCE_COMMIT is required");

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

await build({
  entryPoints: ["apps/node/src/product-main.ts"],
  outfile: "dist/product-node.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
});
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
