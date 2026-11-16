import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { payrollWriteProfile } from "@fortnox-mcp/fortnox";
import { z } from "zod";

// Called only by the separately built isolated acceptance entry. Normal product
// startup does not read this path or accept payroll activation from ENV.
const profile = z
  .object({
    schema_version: z.literal(1),
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    operations: z
      .array(
        z.enum([
          "salary_transaction.create",
          "salary_transaction.update",
          "salary_transaction.delete",
        ]),
      )
      .min(1)
      .max(3),
    profiles: z.array(payrollWriteProfile).min(1).max(20),
  })
  .strict();

export async function loadPayrollTestProfile(
  path: string | undefined,
  commit: string,
) {
  if (!path) return undefined;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 32768)
      throw new Error("Private payroll profile required");
    const bytes = Buffer.alloc(32769);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 32768) throw new Error("Payroll profile limit");
    const value = profile.parse(
      JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")),
    );
    if (
      value.source_commit !== commit ||
      new Set(value.operations).size !== value.operations.length
    )
      throw new Error("Payroll profile source mismatch");
    return { operations: value.operations, profiles: value.profiles };
  } finally {
    await file.close();
  }
}
