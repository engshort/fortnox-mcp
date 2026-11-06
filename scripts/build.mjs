import { build } from "esbuild";

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
