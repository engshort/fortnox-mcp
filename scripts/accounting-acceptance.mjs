import { readFile } from "node:fs/promises";
import {
  accountingChecks,
  validateAccountingEvidence,
} from "./accounting-acceptance-lib.mjs";

// This operator utility only reads. It can never submit a voucher or approve a UI.
try {
  const record = JSON.parse(
    await readFile(
      process.env.ACCEPTANCE_CONFIG ?? ".data/milestone-3-acceptance.json",
      "utf8",
    ),
  );
  if (process.argv[2] === "record") {
    if (!validateAccountingEvidence(record)) throw new Error();
    console.log(
      JSON.stringify({
        status: "manual_record_complete",
        serverCommit: record.serverCommit,
        checks: accountingChecks.length,
        browserOrProviderExecutedByThisCheck: false,
      }),
    );
  } else {
    const origin = new URL(record.origin);
    if (
      process.env.ACCOUNTING_ACCEPTANCE_CONFIRM !== "test-companies-only" ||
      origin.origin !== record.origin ||
      (origin.protocol !== "https:" &&
        !["127.0.0.1", "localhost"].includes(origin.hostname)) ||
      !/^[a-f0-9]{40}$/.test(record.serverCommit ?? "") ||
      typeof record.accessToken !== "string" ||
      !record.accessToken ||
      !Array.isArray(record.companies) ||
      record.companies.length !== 2 ||
      new Set(record.companies.map((c) => c.company_id)).size !== 2 ||
      record.companies.some(
        (c) =>
          !/^[0-9a-f-]{36}$/.test(c.company_id ?? "") ||
          !Number.isSafeInteger(c.financial_year) ||
          c.financial_year < 1,
      )
    )
      throw new Error();
    let verifiedRules = 0;
    for (const company of record.companies) {
      const response = await fetch(`${origin.origin}/mcp`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          authorization: `Bearer ${record.accessToken}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_accounting_references", arguments: company },
        }),
      });
      if (!response.ok) throw new Error();
      let text = "";
      let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 1048576) {
            await reader.cancel();
            throw new Error();
          }
          text += decoder.decode(next.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      const result = JSON.parse(text).result;
      const data = result?.structuredContent?.data;
      if (
        result?.isError ||
        result?.structuredContent?.status !== "ok" ||
        data?.company_id !== company.company_id ||
        data?.financial_year !== company.financial_year ||
        data?.complete !== true
      )
        throw new Error();
      if (data.validation_verified === true) verifiedRules++;
    }
    console.log(
      JSON.stringify({
        status: "two_company_reference_read_passed",
        serverCommit: record.serverCommit,
        companies: 2,
        financialRulesVerified: verifiedRules === 2,
        accountingAcceptanceComplete: false,
        commitSource: "operator supplied; verify deployed source separately",
      }),
    );
  }
} catch {
  console.error(
    "Accounting acceptance incomplete or private configuration unavailable. No private values emitted. See docs/users/manuell-bokforing.sv.md.",
  );
  process.exitCode = 1;
}
