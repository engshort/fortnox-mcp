import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-owner",
  outputDir: join(tmpdir(), "fortnox-owner-browser-results"),
  workers: 1,
  reporter: "list",
  use: { headless: true },
  projects: [
    { name: "desktop", use: { viewport: { width: 1487, height: 1058 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
