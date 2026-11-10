import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("creates private operator configuration without stdout secrets and refuses to overwrite it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m5-init-"));
  const run = promisify(execFile);
  try {
    const args = [
      "--input-type=module",
      "--eval",
      'process.umask(0o077); await import("./deploy/docker/initialize.mjs");',
      "initializer",
      dir,
      "https://installation.example.invalid",
    ];
    const result = await run(process.execPath, args);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    for (const name of ["auth-secret", "credential-keys.json", "backup-key"])
      expect((await stat(join(dir, name))).mode & 0o777).toBe(0o444);
    const secret = await readFile(join(dir, "auth-secret"), "utf8");
    expect(secret.trim().length).toBeGreaterThan(32);
    expect(result.stdout + result.stderr).not.toContain(secret.trim());
    const keys = JSON.parse(
      await readFile(join(dir, "credential-keys.json"), "utf8"),
    );
    expect(Buffer.from(keys.v1, "base64").length).toBe(32);
    const settings = await readFile(join(dir, "installation.env"), "utf8");
    expect(settings).toContain("FORTNOX_TEST_MODE=false");
    expect(settings).not.toContain(secret.trim());
    await expect(run(process.execPath, args)).rejects.toMatchObject({
      code: 1,
    });
    expect(await readFile(join(dir, "auth-secret"), "utf8")).toBe(secret);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
