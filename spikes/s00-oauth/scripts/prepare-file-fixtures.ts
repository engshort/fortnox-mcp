import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../src/files.js";
import { pdfFixture, pngFixture } from "../test/file-fixtures.js";

const directory = await mkdtemp(
  join(tmpdir(), "fortnox-s00-synthetic-receipts-"),
);
for (const [name, bytes] of [
  ["synthetic-receipt-1.png", pngFixture()],
  ["synthetic-receipt-2.pdf", await pdfFixture()],
] as const) {
  await writeFile(join(directory, name), bytes, { mode: 0o600, flag: "wx" });
  console.log(
    JSON.stringify({
      path: join(directory, name),
      bytes: bytes.length,
      sha256: await digest(bytes),
      synthetic: true,
    }),
  );
}
