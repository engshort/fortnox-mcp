import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  Connections,
  type CredentialVault,
  receiptFileBinding,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { IntegrationSettings } from "../../shared/integration-settings.js";
import {
  createProductAuth,
  hashToken,
  type Owner,
} from "../../shared/product-auth.js";
import { openProductDatabase } from "./product-database.js";
import { sqliteState } from "./product-storage.js";
import { sqliteReceiptFiles } from "./receipt-storage.js";

const maxBytes = 64 * 1024 * 1024;
const magic = Buffer.from("M5BACKUP1");
const envelope = z
  .object({
    version: z.literal(1),
    created_at: z.number().int().positive(),
    database: z.string().max(maxBytes * 2),
  })
  .strict();
export const reconciliationInput = z
  .object({
    restore_id: z.string().uuid(),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
    evidence_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
interface RestoreState {
  restore_id: string;
  from: number;
  to: number;
  reconciled: boolean;
  evidence_sha256?: string;
}
function key(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value)
    throw new Error("Invalid backup key");
  return bytes;
}
async function privateWrite(path: string, bytes: Uint8Array | string) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function backupDatabase(
  db: DatabaseSync,
  backupKey: string,
  output: string,
) {
  const encryptionKey = key(backupKey);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = join(
    dirname(output),
    `.snapshot-${crypto.randomUUID()}.sqlite`,
  );
  try {
    await privateWrite(temporary, "");
    await backup(db, temporary);
    if ((await stat(temporary)).size > maxBytes)
      throw new Error("Backup exceeds bounded state limit");
    const input = Buffer.from(
      JSON.stringify({
        version: 1,
        created_at: Date.now(),
        database: (await readFile(temporary)).toString("base64"),
      }),
    );
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(magic);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    await privateWrite(
      output,
      Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]),
    );
  } finally {
    await rm(temporary, { force: true });
  }
}
async function readBackup(path: string, backupKey: string) {
  if ((await stat(path)).size > maxBytes * 2)
    throw new Error("Backup exceeds bounded state limit");
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 9).equals(magic))
    throw new Error("Invalid backup format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(backupKey),
    bytes.subarray(9, 21),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(21, 37));
  const payload = envelope.parse(
    JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(37)),
        decipher.final(),
      ]).toString("utf8"),
    ),
  );
  const database = Buffer.from(payload.database, "base64");
  if (
    database.length > maxBytes ||
    !database.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))
  )
    throw new Error("Invalid backup database");
  return { database, created: payload.created_at };
}
export async function restoreDatabase(options: {
  input: string;
  backupKey: string;
  database: string;
  migrations: string;
  vault: CredentialVault;
}) {
  const payload = await readBackup(options.input, options.backupKey);
  if (payload.created > Date.now())
    throw new Error("Backup timestamp is in the future");
  await mkdir(dirname(options.database), { recursive: true, mode: 0o700 });
  const candidate = `${options.database}.restore-${crypto.randomUUID()}`;
  const recovery: RestoreState = {
    restore_id: crypto.randomUUID(),
    from: payload.created,
    to: Date.now(),
    reconciled: false,
  };
  try {
    await privateWrite(candidate, payload.database);
    const db = await openProductDatabase(candidate, options.migrations);
    try {
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
        throw new Error("Invalid database integrity");
      const state = sqliteState(db);
      const installation = await state.get<Owner>("installation", "owner");
      if (installation?.value.phase === "active") {
        const owner = installation.value.ownerId;
        const connections = new Connections(state, options.vault);
        const snapshot = await connections.snapshot(owner); // Authenticate encryption before changing anything.
        if (snapshot) {
          for (const c of snapshot.value.connections) {
            if (c.state !== "disconnected") c.state = "reconnect_required";
            c.secret = null;
            c.generation++;
            c.policyVersion++;
            delete c.renewal;
            if (c.business) {
              c.business.proposals = [];
              for (const execution of c.business.executions)
                if (execution.state === "submitting")
                  execution.state = "outcome_unknown";
            }
            if (c.bookkeeping) {
              c.bookkeeping.proposals = [];
              for (const execution of c.bookkeeping.executions)
                if (execution.state === "submitting")
                  execution.state = "outcome_unknown";
            }
            for (const batch of c.receiptBatches ?? [])
              for (const item of batch.items) {
                for (const kind of ["upload", "voucher", "link"] as const)
                  if (item.steps[kind].state === "submitting")
                    item.steps[kind] = { state: "outcome_unknown" };
              }
          }
          if (
            !(await state.put(
              "connections",
              owner,
              snapshot.value,
              snapshot.version,
            ))
          )
            throw new Error("Restore conflict");
        }
      } else
        db.prepare(
          "DELETE FROM product_state WHERE space='installation' AND id='owner'",
        ).run();
      // Library-validated owner identity/password remain; all old access paths are revoked.
      db.exec(`DELETE FROM oauthAccessToken; DELETE FROM oauthRefreshToken; DELETE FROM oauthConsent;
        DELETE FROM verification; DELETE FROM session; DELETE FROM receipt_chunks; DELETE FROM receipt_files;
        DELETE FROM product_state WHERE space IN ('company-grants','fortnox-flows','continuations');`);
      const previous = await state.get("installation", "restore");
      if (
        !(await state.put(
          "installation",
          "restore",
          recovery,
          previous?.version ?? null,
        ))
      )
        throw new Error("Restore conflict");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    // Runtime and operator share the flock. Clear old WAL only after closing its database.
    try {
      const existing = new DatabaseSync(options.database);
      existing.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      existing.close();
    } catch (error) {
      if ((await stat(options.database).catch(() => null))?.size) throw error;
    }
    for (const suffix of ["-wal", "-shm"])
      await rm(options.database + suffix, { force: true });
    await rename(candidate, options.database);
    const directory = await open(dirname(options.database), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    await chmod(options.database, 0o600);
    await rm(join(dirname(options.database), "bootstrap-code.txt"), {
      force: true,
    });
    return recovery;
  } finally {
    for (const suffix of ["", "-wal", "-shm"])
      await rm(candidate + suffix, { force: true });
  }
}
export async function rotateCredentials(
  db: DatabaseSync,
  vault: CredentialVault,
) {
  const state = sqliteState(db);
  const installation = await state.get<Owner>("installation", "owner");
  if (installation?.value.phase !== "active")
    throw new Error("Owner unavailable");
  const owner = installation.value.ownerId;
  const connections = new Connections(state, vault);
  db.exec("BEGIN IMMEDIATE");
  try {
    await connections.rotateKey(owner);
    await new IntegrationSettings(state, vault, {
      clientId: "",
      clientSecret: "",
    }).rotate(owner);
    const files = sqliteReceiptFiles(db);
    for (const row of db
      .prepare("SELECT id,company FROM receipt_files WHERE owner=?")
      .all(owner)) {
      const file = await files.get(String(row.id), owner, String(row.company));
      if (!file) throw new Error("Missing file during rotation");
      for (const chunk of file.chunks) {
        const binding = receiptFileBinding(file.record, chunk.index);
        const next = await vault.sealData(
          await vault.openData(chunk, binding),
          binding,
        );
        db.prepare(
          "UPDATE receipt_chunks SET key=?,iv=?,data=? WHERE file_id=? AND idx=?",
        ).run(next.key, next.iv, next.data, file.record.id, chunk.index);
      }
    }
    db.prepare("DELETE FROM product_state WHERE space='fortnox-flows'").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export async function reconcileRestore(db: DatabaseSync, input: unknown) {
  const value = reconciliationInput.parse(input);
  const state = sqliteState(db);
  const row = await state.get<RestoreState>("installation", "restore");
  if (
    !row ||
    row.value.reconciled ||
    row.value.restore_id !== value.restore_id ||
    row.value.from !== value.from ||
    row.value.to !== value.to
  )
    throw new Error("Reconciliation does not match blocked interval");
  if (
    !(await state.put(
      "installation",
      "restore",
      {
        ...row.value,
        reconciled: true,
        evidence_sha256: value.evidence_sha256,
      },
      row.version,
    ))
  )
    throw new Error("Reconciliation conflict");
}

export async function issueOwnerCode(
  db: DatabaseSync,
  origin: string,
  secret: string,
  output: string,
  reset: boolean,
) {
  const state = sqliteState(db);
  const row = await state.get<Owner>("installation", "owner");
  if (reset) {
    if (row?.value.phase !== "active") throw new Error("Owner unavailable");
    const owner = db
      .prepare("SELECT email FROM user WHERE id=?")
      .get(row.value.ownerId);
    if (!owner || typeof owner.email !== "string")
      throw new Error("Owner unavailable");
    let issued = false;
    const auth = createProductAuth({
      database: db,
      state,
      origin,
      secret,
      onReset: async (token) => {
        await privateWrite(output, token);
        issued = true;
      },
    });
    await auth.api.requestPasswordReset({ body: { email: owner.email } });
    if (!issued) throw new Error("Reset not issued");
  } else {
    if (row?.value.phase === "active" || row?.value.phase === "claiming")
      throw new Error("Owner cannot be replaced");
    const token = crypto.randomUUID() + crypto.randomUUID();
    await privateWrite(output, token);
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
        row?.version ?? null,
      ))
    ) {
      await rm(output, { force: true });
      throw new Error("Bootstrap conflict");
    }
  }
}
