import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

try {
  const [directory, publicOrigin] = process.argv.slice(2);
  if (!directory || !publicOrigin) throw new Error();
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.href !== `${origin.origin}/`) throw new Error();
  const target = resolve(directory);
  await mkdir(target, { recursive: true, mode: 0o700 });
  await chmod(target, 0o700);
  if ((await readdir(target)).length) throw new Error();
  const secrets = {
    "auth-secret": randomBytes(48).toString("base64url"),
    "credential-keys.json": JSON.stringify({ v1: randomBytes(32).toString("base64") }),
    "backup-key": randomBytes(32).toString("base64"),
  };
  // Parent stays 0700 on the host. Read-only secret-file mounts are readable by
  // the dedicated non-root container UID, independent of the operator's UID.
  for (const [name, value] of Object.entries(secrets)) {
    await writeFile(resolve(target, name), `${value}\n`, { mode: 0o444, flag: "wx" });
    // Restrictive umasks/default ACLs must not make Compose secrets unreadable
    // to UID 10001. The host parent remains 0700; mounts are read-only.
    await chmod(resolve(target, name), 0o444);
  }
  await writeFile(resolve(target, "installation.env"), `PRODUCT_ENABLED=true\nPUBLIC_ORIGIN=${origin.origin}\nCREDENTIAL_ACTIVE_KEY=v1\nMCP_REDIRECT_URIS=["https://chatgpt.com/connector_platform_oauth_redirect"]\nFORTNOX_TEST_MODE=false\nACCOUNTING_REFERENCES_ENABLED=false\nFORTNOX_RECEIPT_CONSENT=false\nRECEIPT_FILE_TRANSPORT=none\n`, { mode: 0o600, flag: "wx" });
  console.log("installation_configuration_created; keep the private directory and an independent key backup");
} catch {
  console.error("installation_initialization_failed; require an empty private directory and an HTTPS origin");
  process.exitCode = 1;
}
