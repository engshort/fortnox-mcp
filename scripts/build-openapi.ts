import { mkdir, writeFile } from "node:fs/promises";
import { openApiDocument } from "../packages/rest/src/openapi.js";

await mkdir("dist", { recursive: true });
await writeFile(
  "dist/openapi.json",
  `${JSON.stringify(openApiDocument(), null, 2)}\n`,
);
