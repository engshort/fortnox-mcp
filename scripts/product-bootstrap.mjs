import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(".data");
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = randomBytes(32).toString("base64url");
const value = JSON.stringify({
  phase: "ready",
  ownerId: "",
  tokenHash: createHash("sha256").update(token).digest("hex"),
  expiresAt: Date.now() + 600000,
});
const sql = `INSERT INTO product_state(space,id,version,value) VALUES('installation','owner',1,'${value}') ON CONFLICT(space,id) DO UPDATE SET value=excluded.value,version=product_state.version+1 WHERE json_extract(product_state.value,'$.phase')='ready' AND json_extract(product_state.value,'$.ownerId')='';\n`;
for (const [name, content] of [
  ["product-bootstrap-code.txt", token],
  ["product-bootstrap.sql", sql],
]) {
  const file = await open(
    resolve(directory, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.chmod(0o600);
    await file.writeFile(content);
  } finally {
    await file.close();
  }
}
console.log(
  "Private ten-minute bootstrap code and conditional SQL prepared in .data. Apply SQL only to the selected test DB; require one changed row. Existing active/claiming owners cannot be replaced.",
);
