import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { accountCategory, accountingHash } from "@fortnox-mcp/core";
import { z } from "zod";

const item = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int().positive().safe(),
    mapping_version: z.string().min(1).max(128),
    evidence_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    accounts: z.record(z.string().regex(/^[1-9]\d{0,7}$/), accountCategory),
    cash_account_numbers: z
      .array(z.number().int().min(1).max(99999999))
      .max(20),
  })
  .strict()
  .refine(
    (v) =>
      Object.keys(v.accounts).length > 0 &&
      Object.keys(v.accounts).length <= 10000 &&
      new Set(v.cash_account_numbers).size === v.cash_account_numbers.length &&
      v.cash_account_numbers.every((n) => v.accounts[String(n)] === "assets"),
  );
const schema = z
  .object({
    schema_version: z.literal(1),
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    companies: z.array(item).min(1).max(10),
  })
  .strict();
// Explicit owner/operator classification, not a model-selected BAS heuristic.
// This loader is imported only by the isolated acceptance entry.
export async function loadFinancialTestProfile(
  path: string | undefined,
  commit: string,
) {
  if (!path) return undefined;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 32768)
      throw Error("Private financial profile required");
    const bytes = Buffer.alloc(32769),
      { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32768) throw Error("Financial profile limit");
    const value = schema.parse(
      JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")),
    );
    if (
      value.source_commit !== commit ||
      new Set(value.companies.map((c) => `${c.company_id}/${c.financial_year}`))
        .size !== value.companies.length
    )
      throw Error("Financial profile source or company/year mismatch");
    return Promise.all(
      value.companies.map(async (c) => ({
        company_id: c.company_id,
        financial_year: c.financial_year,
        mapping: {
          version: c.mapping_version,
          sha256: await accountingHash({
            version: c.mapping_version,
            accounts: c.accounts,
            evidence_sha256: c.evidence_sha256,
          }),
          accounts: c.accounts,
        },
        cash_account_numbers: c.cash_account_numbers,
      })),
    );
  } finally {
    await file.close();
  }
}
