import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseFileOrigins } from "@fortnox-mcp/files";

// Create locally, never print the session credential or overwrite a live session.
try {
  const origins = parseFileOrigins(process.env.RECEIPT_FILE_ORIGINS);
  if (!origins.length) throw new Error();
  const path = resolve(process.argv[2] ?? ".data/product-file-relay.json");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify({
      token: randomBytes(32).toString("hex"),
      until: new Date(Date.now() + 15 * 60000).toISOString(),
      origins: origins.join(","),
    }),
    { mode: 0o600, flag: "wx" },
  );
  console.log("receipt_relay_session_created; private configuration only");
} catch {
  throw new Error(
    "Receipt relay session preparation failed; require reviewed origins and a new private file",
  );
}
