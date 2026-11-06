import { constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  prepareD1Recovery,
  recoveryInput,
} from "../apps/node/src/product-recovery.js";

try {
  const config = recoveryInput.parse({
    secret: process.env.AUTH_SECRET,
    ...JSON.parse(
      await readFile(process.argv[2] ?? ".data/product-recovery.json", "utf8"),
    ),
  });
  const prepared = await prepareD1Recovery(config);
  await mkdir(resolve(".data"), { recursive: true, mode: 0o700 });
  for (const [name, content] of [
    ["product-recovery-code.txt", prepared.token],
    ["product-recovery.sql", prepared.sql],
  ]) {
    const file = await open(
      resolve(".data", name),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.chmod(0o600);
      await file.writeFile(content);
    } finally {
      await file.close();
    }
  }
  console.log(
    "Private library-issued ten-minute recovery code and owner-guarded SQL prepared in .data. Apply only to the matching installation; require one changed row. Use /reset-password. No owner, password or code was printed.",
  );
} catch {
  console.error(
    "Recovery preparation failed. Check the private operator configuration; no private values were emitted.",
  );
  process.exitCode = 1;
}
