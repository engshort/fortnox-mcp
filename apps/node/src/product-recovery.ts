import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createProductAuth } from "../../shared/product-auth.js";
import { sqliteState } from "./product-storage.js";

export const recoveryInput = z
  .object({
    origin: z.url(),
    secret: z.string().min(32),
    ownerId: z.string().min(1).max(128),
    email: z.email().max(254),
  })
  .strict();
const verification = z
  .object({
    id: z.string(),
    identifier: z.string(),
    value: z.string(),
    expiresAt: z.union([z.string(), z.number()]),
    createdAt: z.union([z.string(), z.number()]),
    updatedAt: z.union([z.string(), z.number()]),
  })
  .strict();
const literal = (value: string | number) =>
  typeof value === "number"
    ? String(value)
    : `'${value.replaceAll("'", "''")}'`;

// Operator-only: let the pinned library issue its own record in an ephemeral
// owner projection. Import only that record into D1, guarded by its actual owner.
// No account/password/session or company data is copied or replaced.
export async function prepareD1Recovery(input: z.infer<typeof recoveryInput>) {
  const config = recoveryInput.parse(input);
  const origin = new URL(config.origin);
  if (
    origin.origin !== config.origin ||
    (origin.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
  )
    throw new Error("Invalid recovery configuration");
  const database = new DatabaseSync(":memory:");
  try {
    for (const file of [
      "0002_product_state.sql",
      "0003_product_auth.sql",
      "0004_product_oauth.sql",
    ])
      database.exec(
        readFileSync(
          resolve(
            process.env.PRODUCT_MIGRATIONS_DIR ?? "apps/worker/migrations",
            file,
          ),
          "utf8",
        ),
      );
    const now = new Date().toISOString();
    database
      .prepare(
        'INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,0,?,?)',
      )
      .run(config.ownerId, "Installation owner", config.email, now, now);
    let token = "";
    const auth = createProductAuth({
      ...config,
      database,
      state: sqliteState(database),
      onReset: async (value) => {
        token = value;
      },
    });
    await auth.api.requestPasswordReset({ body: { email: config.email } });
    const rows = database
      .prepare(
        'SELECT id,identifier,value,expiresAt,createdAt,updatedAt FROM "verification"',
      )
      .all();
    if (rows.length !== 1 || token.length < 20)
      throw new Error("Recovery record unavailable");
    const row = verification.parse(rows[0]);
    const expiry =
      typeof row.expiresAt === "number"
        ? row.expiresAt
        : Date.parse(row.expiresAt);
    if (
      row.value !== config.ownerId ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      expiry > Date.now() + 601000
    )
      throw new Error("Invalid recovery record");
    const values = [
      row.id,
      row.identifier,
      row.value,
      row.expiresAt,
      row.createdAt,
      row.updatedAt,
    ].map(literal);
    const sql = `INSERT INTO "verification" (id,identifier,value,expiresAt,createdAt,updatedAt) SELECT ${values.join(",")} WHERE EXISTS (SELECT 1 FROM product_state p JOIN "user" u ON u.id=json_extract(p.value,'$.ownerId') WHERE p.space='installation' AND p.id='owner' AND json_extract(p.value,'$.phase')='active' AND u.id=${literal(config.ownerId)} AND lower(u.email)=lower(${literal(config.email)})) AND unixepoch()*1000 < ${expiry} ON CONFLICT(id) DO NOTHING;\n`;
    return { token, sql, expiresAt: expiry };
  } finally {
    database.close();
  }
}
