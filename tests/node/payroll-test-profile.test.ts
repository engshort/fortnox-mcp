import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadPayrollTestProfile } from "../../apps/node/src/payroll-test-profile.js";

it("loads only a bounded private source-bound payroll test profile and rejects links, permissions and arbitrary operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "m7-payroll-profile-"));
  const path = join(root, "profile.json"),
    commit = "a".repeat(40);
  const value = {
    schema_version: 1,
    source_commit: commit,
    operations: ["salary_transaction.create"],
    profiles: [
      {
        company_id: "b1ebed10-cf85-4d62-9be3-ae56c71cc781",
        employee_id: "SYNTHETIC",
        code: "11",
        from: "2026-01-01",
        to: "2026-01-31",
        hourly_pay: "1.00",
        quantity_scale: 0,
        evidence: { create: "b".repeat(64) },
      },
    ],
  };
  const save = (data: unknown) =>
    writeFile(path, JSON.stringify(data), { mode: 0o600 });
  try {
    expect(await loadPayrollTestProfile(undefined, commit)).toBeUndefined();
    await save(value);
    expect(await loadPayrollTestProfile(path, commit)).toMatchObject({
      operations: value.operations,
    });
    await expect(loadPayrollTestProfile(path, "c".repeat(40))).rejects.toThrow(
      "source mismatch",
    );
    await chmod(path, 0o644);
    await expect(loadPayrollTestProfile(path, commit)).rejects.toThrow(
      "Private payroll profile",
    );
    await chmod(path, 0o600);
    const link = join(root, "link.json");
    await symlink(path, link);
    await expect(loadPayrollTestProfile(link, commit)).rejects.toThrow();
    for (const invalid of [
      { ...value, operations: ["payroll_employee.create"] },
      { ...value, operations: [...value.operations, ...value.operations] },
      { ...value, profiles: [{ ...value.profiles[0], evidence: {} }] },
      { ...value, profiles: [{ ...value.profiles[0], code: "12" }] },
      { ...value, confirmed: true },
    ]) {
      await save(invalid);
      await expect(loadPayrollTestProfile(path, commit)).rejects.toThrow();
    }
    await writeFile(path, " ".repeat(32769));
    await expect(loadPayrollTestProfile(path, commit)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
