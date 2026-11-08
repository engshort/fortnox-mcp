import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Bookkeeping,
  Connections,
  CredentialVault,
  ReceiptFiles,
} from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { installationLock } from "../../apps/node/src/installation-lock.js";
import { openProductDatabase } from "../../apps/node/src/product-database.js";
import {
  backupDatabase,
  issueOwnerCode,
  reconcileRestore,
  restoreDatabase,
  rotateCredentials,
} from "../../apps/node/src/product-operations.js";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteReceiptFiles } from "../../apps/node/src/receipt-storage.js";
import { IntegrationSettings } from "../../apps/shared/integration-settings.js";
import { createProductAuth } from "../../apps/shared/product-auth.js";
import { accountingFixture } from "../shared/accounting.js";
import { keyA, keyB, syntheticCredentials } from "../shared/connections.js";
import { fileFixture } from "../shared/receipt-files.js";

const migrations = resolve("apps/worker/migrations");
const backupKey = Buffer.alloc(32, 9).toString("base64");
const vault = new CredentialVault({ a: keyA }, "a");
it("excludes runtime/operator concurrency and releases its lock for a subsequent process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m5-lock-"));
  try {
    const path = join(dir, "product.sqlite");
    const unlock = await installationLock(path);
    try {
      await expect(installationLock(path)).rejects.toThrow("running or locked");
    } finally {
      await unlock();
    }
    await (await installationLock(path))();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
for (const stage of ["prepared", "succeeded", "outcome_unknown"] as const) {
  it(`restores ${stage} encrypted backup without old grants/approvals or automatic dispatch`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "m5-restore-"));
    const path = join(dir, "product.sqlite"),
      output = join(dir, "backup.enc");
    let db = await openProductDatabase(path, migrations);
    let closed = false;
    try {
      const state = sqliteState(db),
        f = await accountingFixture(state);
      await state.put(
        "installation",
        "owner",
        {
          phase: "active",
          ownerId: f.actor.ownerId,
          tokenHash: "",
          expiresAt: 0,
        },
        null,
      );
      const proposal = await f.service.prepare(f.actor, f.voucher);
      db.prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      ).run(f.actor.ownerId, "Synthetic owner", "ops@example.invalid", 0, 1, 1);
      db.prepare(
        "INSERT INTO session(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)",
      ).run(
        "synthetic-session",
        "synthetic-session-token",
        f.actor.ownerId,
        Date.now() + 600000,
        1,
        1,
      );
      db.prepare(
        "INSERT INTO oauthClient(id,clientId,redirectUris) VALUES(?,?,?)",
      ).run("synthetic-client", f.actor.clientId, "[]");
      db.prepare(
        "INSERT INTO oauthAccessToken(id,token,clientId,userId,expiresAt,createdAt,scopes) VALUES(?,?,?,?,?,?,?)",
      ).run(
        "synthetic-access",
        "synthetic-access-token",
        f.actor.clientId,
        f.actor.ownerId,
        Date.now() + 600000,
        1,
        "mcp:read",
      );
      if (stage === "outcome_unknown")
        f.provider.submit = async (_a, _v, dispatch) => {
          await dispatch();
          throw new Error("Synthetic lost answer");
        };
      if (stage !== "prepared")
        await f.service.commit(
          f.actor,
          {
            company_id: proposal.company_id,
            proposal_id: proposal.proposal_id,
            proposal_hash: proposal.proposal_hash,
            capability: proposal.capability,
          },
          "review",
        );
      await backupDatabase(db, backupKey, output);
      if (stage === "prepared") {
        // This later write is absent from the older snapshot being restored.
        await f.service.commit(
          f.actor,
          {
            company_id: proposal.company_id,
            proposal_id: proposal.proposal_id,
            proposal_hash: proposal.proposal_hash,
            capability: proposal.capability,
          },
          "review",
        );
        expect(f.calls()).toBe(1);
      }
      await f.connections.renew(
        f.actor.ownerId,
        f.a.id,
        f.a.generation,
        async () => ({
          ...syntheticCredentials,
          refreshToken: "synthetic-rotated-after-backup",
        }),
        true,
      );
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect(
        (await readFile(output)).includes(
          Buffer.from(syntheticCredentials.refreshToken),
        ),
      ).toBe(false);
      db.close();
      closed = true;
      const restored = await restoreDatabase({
        input: output,
        backupKey,
        database: path,
        migrations,
        vault,
      });
      db = await openProductDatabase(path, migrations);
      closed = false;
      const after = new Connections(sqliteState(db), vault);
      const companies = await after.list(f.actor.ownerId),
        company = companies.find((c) => c.id === f.a.id);
      expect(company?.bookkeeping?.proposals).toEqual([]);
      expect(company?.secret).toBeNull();
      expect(await sqliteState(db).list("company-grants", 100)).toEqual([]);
      expect(db.prepare("SELECT count(*) AS n FROM session").get()?.n).toBe(0);
      expect(
        db.prepare("SELECT count(*) AS n FROM oauthAccessToken").get()?.n,
      ).toBe(0);
      expect(company?.bookkeeping?.executions[0]?.state ?? "prepared").toBe(
        stage,
      );
      await expect(after.assertWritesAllowed()).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      await after.reconnect(
        f.actor.ownerId,
        f.a.id,
        company?.generation ?? 0,
        { ...f.a, mode: f.a.mode },
        syntheticCredentials,
      );
      await after.grant(f.actor.ownerId, f.actor.clientId, [f.a.id]);
      const service = new Bookkeeping(
        after,
        {
          ...f.provider,
          submit: async () => {
            throw new Error("Unexpected resend");
          },
        },
        f.gates,
      );
      await expect(
        service.commit(
          f.actor,
          {
            company_id: proposal.company_id,
            proposal_id: proposal.proposal_id,
            proposal_hash: proposal.proposal_hash,
            capability: proposal.capability,
          },
          "review",
        ),
      ).rejects.toThrow();
      const active = (await after.list(f.actor.ownerId)).find(
        (c) => c.id === f.a.id,
      );
      if (!active) throw new Error("Missing active fixture");
      await after.setAccountingPolicy(
        f.actor.ownerId,
        active.id,
        active.policyVersion,
        "review_required",
        false,
      );
      const fresh = await service.prepare(f.actor, {
        ...f.voucher,
        description: "Synthetic distinct post-restore proposal",
      });
      await expect(
        service.commit(
          f.actor,
          {
            company_id: fresh.company_id,
            proposal_id: fresh.proposal_id,
            proposal_hash: fresh.proposal_hash,
            capability: fresh.capability,
          },
          "review",
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        reconcileRestore(db, {
          ...restored,
          reconciled: undefined,
          restore_id: crypto.randomUUID(),
        }),
      ).rejects.toThrow();
      await reconcileRestore(db, {
        restore_id: restored.restore_id,
        from: restored.from,
        to: restored.to,
        evidence_sha256: "a".repeat(64),
      });
      await expect(after.assertWritesAllowed()).resolves.toBeUndefined();
      await expect(
        service.commit(
          f.actor,
          {
            company_id: proposal.company_id,
            proposal_id: proposal.proposal_id,
            proposal_hash: proposal.proposal_hash,
            capability: proposal.capability,
          },
          "review",
        ),
      ).rejects.toThrow();
      // A forged/wrong-key backup cannot replace the current database.
      await expect(
        restoreDatabase({
          input: output,
          backupKey: keyB,
          database: path,
          migrations,
          vault,
        }),
      ).rejects.toThrow();
      expect((await after.list(f.actor.ownerId)).length).toBe(2);
    } finally {
      if (!closed) db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
it("rotates connection/configuration/proposal/file ciphertext transactionally and reads with only the new key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m5-rotate-"));
  const db = await openProductDatabase(join(dir, "product.sqlite"), migrations);
  try {
    const state = sqliteState(db),
      files = sqliteReceiptFiles(db);
    const f = await fileFixture({ state, files, raw: async () => "" });
    await state.put(
      "installation",
      "owner",
      {
        phase: "active",
        ownerId: f.actor.ownerId,
        tokenHash: "",
        expiresAt: 0,
      },
      null,
    );
    const integration = new IntegrationSettings(state, vault, {
      clientId: "",
      clientSecret: "",
    });
    await integration.save(f.actor.ownerId, {
      client_id: "synthetic-managed-client",
      client_secret: "synthetic-managed-secret",
    });
    const staged = await f.service.ingest(f.actor, f.a.id, f.files);
    const newVault = new CredentialVault({ a: keyA, b: keyB }, "b");
    await rotateCredentials(db, newVault);
    const onlyNew = new CredentialVault({ b: keyB }, "b");
    expect(
      (await new Connections(state, onlyNew).list(f.actor.ownerId)).length,
    ).toBe(2);
    expect(
      (
        await new IntegrationSettings(state, onlyNew, {
          clientId: "",
          clientSecret: "",
        }).status(f.actor.ownerId)
      ).configured,
    ).toBe(true);
    const file = staged.files[0];
    if (!file) throw new Error("Missing staged fixture");
    const rotatedFiles = new ReceiptFiles(
      new Connections(state, onlyNew),
      files,
      f.sourceFile,
      f.service.validator,
      true,
    );
    expect(
      (
        await rotatedFiles.read(f.actor, {
          company_id: f.a.id,
          workflow_id: staged.workflow_id,
          file_id: file.file_id,
        })
      ).bytes.length,
    ).toBeGreaterThan(0);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM receipt_chunks WHERE key!='b'")
        .get()?.n,
    ).toBe(0);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
it("issues a private library reset for the same owner and cannot replace an active owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "m5-owner-code-"));
  const db = await openProductDatabase(join(dir, "product.sqlite"), migrations);
  try {
    const state = sqliteState(db),
      origin = "https://ops.invalid",
      secret = "synthetic-operations-auth-secret-at-least-32-characters";
    const auth = createProductAuth({ database: db, state, origin, secret });
    const owner = await auth.api.signUpEmail({
      body: {
        email: "ops-reset@example.invalid",
        name: "Synthetic",
        password: "synthetic-original-password",
      },
      returnHeaders: true,
    });
    await state.put(
      "installation",
      "owner",
      {
        phase: "active",
        ownerId: owner.response.user.id,
        tokenHash: "",
        expiresAt: 0,
      },
      null,
    );
    await expect(
      issueOwnerCode(db, origin, secret, join(dir, "bootstrap.txt"), false),
    ).rejects.toThrow("cannot be replaced");
    const output = join(dir, "reset.txt");
    await issueOwnerCode(db, origin, secret, output, true);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await auth.api.resetPassword({
      body: {
        token: await readFile(output, "utf8"),
        newPassword: "synthetic-replacement-password",
      },
    });
    expect(db.prepare("SELECT count(*) AS n FROM session").get()?.n).toBe(0);
    expect(
      (await state.get<{ ownerId: string }>("installation", "owner"))?.value
        .ownerId,
    ).toBe(owner.response.user.id);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
