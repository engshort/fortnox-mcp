import { mkdir, writeFile } from "node:fs/promises";
import { fileSchema } from "../src/file-sql.js";

// Additive schema only. Never export or reseed OAuth/owner state.
await mkdir(".data", { recursive: true, mode: 0o700 });
await writeFile(".data/files.sql", `${fileSchema};\n`, {
  mode: 0o600,
  flag: "wx",
});
console.log(
  "Wrote ignored .data/files.sql. Apply only to the existing isolated probe database.",
);
