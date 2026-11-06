import { readFile } from "node:fs/promises";
import { clientChecks, validateClientEvidence } from "./acceptance-lib.mjs";

// Operator-supplied private MCP credentials, never argv, logs or public artifacts.
try {
  const target = process.argv[2];
  const record = JSON.parse(
    await readFile(
      process.env.ACCEPTANCE_CONFIG ?? ".data/acceptance.json",
      "utf8",
    ),
  );
  if (target === "clients") {
    if (!validateClientEvidence(record)) throw new Error();
    console.log(
      JSON.stringify({
        status: "manual_evidence_record_complete",
        serverCommit: record.serverCommit,
        checks: clientChecks.length,
        browserExecutedByThisScript: false,
      }),
    );
  } else if (target === "fortnox") {
    if (
      process.env.FORTNOX_ACCEPTANCE_CONFIRM !== "test-companies-only" ||
      !/^[a-f0-9]{40}$/.test(record.serverCommit ?? "")
    )
      throw new Error();
    const origin = new URL(record.origin);
    if (
      origin.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(origin.hostname)
    )
      throw new Error();
    if (
      origin.origin !== record.origin ||
      !Array.isArray(record.companyIds) ||
      record.companyIds.length !== 2 ||
      new Set(record.companyIds).size !== 2 ||
      typeof record.accessToken !== "string"
    )
      throw new Error();
    const call = async (name, args) => {
      const r = await fetch(`${record.origin}/mcp`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
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
          params: { name, arguments: args },
        }),
      });
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (
        body.result?.isError ||
        body.result?.structuredContent?.status !== "ok"
      )
        throw new Error();
      return body.result.structuredContent;
    };
    const companies = await call("list_companies", {});
    if (
      !record.companyIds.every((id) =>
        companies.data.companies.some((c) => c.company_id === id),
      )
    )
      throw new Error();
    for (const id of record.companyIds) {
      const profile = await call("get_company_profile", { company_id: id });
      if (profile.company_id !== id || !profile.evidence.complete)
        throw new Error();
    }
    console.log(
      JSON.stringify({
        status: "two_company_read_passed",
        serverCommit: record.serverCommit,
        profiles: 2,
        commitSource: "operator_supplied; verify deployment separately",
      }),
    );
  } else throw new Error();
} catch {
  console.error(
    "Acceptance incomplete or private configuration unavailable. No private values were emitted. See docs/users/env.sv.md and docs/implementation/M02-connections-evidence.md.",
  );
  process.exitCode = 1;
}
