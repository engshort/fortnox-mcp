import { relative, resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "record-runtime-inputs",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "admin-inputs.json",
          source: JSON.stringify(
            [...this.getModuleIds()]
              .map((id) => relative(resolve("."), id))
              .filter((id) => id.startsWith("node_modules/")),
          ),
        });
      },
    },
  ],
  root: resolve("apps/admin"),
  base: "/admin-assets/",
  build: {
    outDir: resolve("dist/admin"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: { entryFileNames: "admin.js", assetFileNames: "admin.[ext]" },
    },
  },
});
