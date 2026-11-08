import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
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
