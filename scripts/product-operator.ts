import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { sqliteState } from "../apps/node/src/product-storage.js";
import {
  createProductAuth,
  hashToken,
  type Owner,
} from "../apps/shared/product-auth.js";

// Private local operator input. Never pass secrets as argv or print generated codes.
const config = z
  .object({
    origin: z.url(),
    secret: z.string().min(32),
    database: z.string(),
    output: z.string(),
    action: z.enum(["bootstrap", "reset"]),
    email: z.email().optional(),
  })
  .strict()
  .parse(
    JSON.parse(
      await readFile(process.argv[2] ?? ".data/operator.json", "utf8"),
    ),
  );
const db = new DatabaseSync(config.database);
try {
  const state = sqliteState(db);
  const auth = createProductAuth({
    ...config,
    database: db,
    state,
    onReset: async (token) => {
      await writeFile(config.output, token, { mode: 0o600, flag: "wx" });
    },
  });
  if (config.action === "bootstrap") {
    const token = randomBytes(32).toString("base64url");
    if (
      !(await state.put<Owner>(
        "installation",
        "owner",
        {
          phase: "ready",
          ownerId: "",
          tokenHash: await hashToken(token),
          expiresAt: Date.now() + 600000,
        },
        null,
      ))
    )
      throw new Error(
        "Owner already provisioned; never reseed an installation",
      );
    await writeFile(config.output, token, { mode: 0o600, flag: "wx" });
  } else {
    const owner = await state.get<Owner>("installation", "owner");
    const user =
      owner &&
      db
        .prepare('SELECT email FROM "user" WHERE id = ?')
        .get(owner.value.ownerId);
    if (!user || user.email !== config.email) throw new Error("Owner mismatch");
    await auth.api.requestPasswordReset({
      body: { email: config.email ?? "" },
    });
  }
  console.log(
    "Private operator output written. Codes expire; no owner or credentials were printed.",
  );
} finally {
  db.close();
}
