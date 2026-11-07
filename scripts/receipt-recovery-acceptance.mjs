import { readFile, stat } from "node:fs/promises";
import {
  readReceiptRecoverySnapshots,
  receiptRecoveryScenarios,
  validateReceiptRecoveryRecord,
} from "./receipt-recovery-acceptance-lib.mjs";

// Explicit private operator input. Never print request/response/config/error data.
try {
  const mode = process.argv[2];
  if (!["status", "record"].includes(mode)) throw new Error();
  const path =
    process.env.ACCEPTANCE_CONFIG ?? `.data/m4-recovery-${mode}.json`;
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65536)
    throw new Error();
  const config = JSON.parse(await readFile(path, "utf8"));
  if (mode === "record") {
    if (!validateReceiptRecoveryRecord(config)) throw new Error();
    console.log(
      JSON.stringify({
        status: "operator_recovery_report_structurally_complete",
        serverCommit: config.serverCommit,
        scenarios: receiptRecoveryScenarios.length,
        providerOrBrowserExecutedByThisCheck: false,
        acceptanceGranted: false,
      }),
    );
  } else {
    if (process.env.RECEIPT_ACCEPTANCE_CONFIRM !== "test-companies-only")
      throw new Error();
    console.log(JSON.stringify(await readReceiptRecoverySnapshots(config)));
  }
} catch {
  console.error(
    "Receipt recovery acceptance incomplete or private configuration unavailable. No private values emitted. See docs/implementation/M04-G08-recovery.md.",
  );
  process.exitCode = 1;
}
