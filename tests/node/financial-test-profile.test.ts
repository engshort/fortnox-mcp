import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadFinancialTestProfile } from "../../apps/node/src/financial-test-profile.js";

it("binds explicit financial/cash mappings to a private source and unique company/year without model classification", async () => {
  const root = await mkdtemp(join(tmpdir(), "m7-financial-profile-")),
    path = join(root, "profile.json"),
    commit = "a".repeat(40);
  const company = {
    company_id: "b1ebed10-cf85-4d62-9be3-ae56c71cc781",
    financial_year: 7,
    mapping_version: "synthetic/1",
    evidence_sha256: "b".repeat(64),
    accounts: { "1930": "assets", "4000": "expenses" },
    cash_account_numbers: [1930],
  };
  const value = {
    schema_version: 1,
    source_commit: commit,
    companies: [company],
  };
  const save = (v: unknown) =>
    writeFile(path, JSON.stringify(v), { mode: 0o600 });
  try {
    expect(await loadFinancialTestProfile(undefined, commit)).toBeUndefined();
    await save(value);
    const first = await loadFinancialTestProfile(path, commit);
    expect(first?.[0]).toMatchObject({
      company_id: company.company_id,
      financial_year: 7,
      cash_account_numbers: [1930],
      mapping: { version: "synthetic/1", accounts: company.accounts },
    });
    await save({
      ...value,
      companies: [{ ...company, mapping_version: "synthetic/2" }],
    });
    expect(
      (await loadFinancialTestProfile(path, commit))?.[0]?.mapping.sha256,
    ).not.toBe(first?.[0]?.mapping.sha256);
    for (const invalid of [
      { ...value, source_commit: "c".repeat(40) },
      { ...value, companies: [company, company] },
      { ...value, companies: [{ ...company, cash_account_numbers: [4000] }] },
      {
        ...value,
        companies: [
          { ...company, accounts: { "1930": "assets", auto_bas: true } },
        ],
      },
      { ...value, companies: [{ ...company, evidence_sha256: "" }] },
    ]) {
      await save(invalid);
      await expect(loadFinancialTestProfile(path, commit)).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
