import { readFile, stat } from "node:fs/promises";
import { readReceiptProviderAttachments } from "./receipt-provider-acceptance-lib.mjs";

try {
  if (process.env.RECEIPT_ACCEPTANCE_CONFIRM !== "test-companies-only")
    throw new Error();
  const path =
    process.env.ACCEPTANCE_CONFIG ?? ".data/m4-provider-attachments.json";
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65536)
    throw new Error();
  console.log(
    JSON.stringify(
      await readReceiptProviderAttachments(
        JSON.parse(await readFile(path, "utf8")),
      ),
    ),
  );
} catch {
  console.error(
    "Receipt provider readback incomplete or private configuration unavailable. No private values emitted. See docs/implementation/M04-G06-files.md.",
  );
  process.exitCode = 1;
}
