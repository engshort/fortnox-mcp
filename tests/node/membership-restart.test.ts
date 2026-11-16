import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Memberships } from "@fortnox-mcp/core";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { openProductDatabase } from "../../apps/node/src/product-database.js";
import { rotateCredentials } from "../../apps/node/src/product-operations.js";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { d1State } from "../../apps/worker/src/product-storage.js";
import { Connections, CredentialVault } from "../../packages/core/src/index.js";
import {
  keyA,
  keyB,
  syntheticCompany,
  syntheticCredentials,
} from "../shared/connections.js";

it("retains source ownership, revision conflicts and idempotent results after closing SQLite, and safely rotates temporary state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "membership-restart-"));
  const path = join(directory, "product.sqlite");
  let db = await openProductDatabase(path, resolve("apps/worker/migrations"));
  try {
    let state = sqliteState(db);
    await state.put(
      "installation",
      "owner",
      {
        phase: "active",
        ownerId: "synthetic-owner",
        tokenHash: "",
        expiresAt: 0,
      },
      null,
    );
    const vault = new CredentialVault({ a: keyA }, "a");
    const connections = new Connections(state, vault);
    const company = await connections.add(
      "synthetic-owner",
      syntheticCompany,
      syntheticCredentials,
    );
    let members = new Memberships(state, true);
    const source = await members.source("synthetic-owner", {
      name: "Generic consumer",
      allowAdmins: false,
      companies: [company.id],
    });
    const key = crypto.randomUUID();
    const input = {
      email: "restart@example.invalid",
      name: "Restart",
      role: "member" as const,
      active: true,
      companies: { [company.id]: "read" as const },
    };
    const original = await members.provision(
      source.token,
      "external-user",
      input,
      null,
      key,
    );
    const invitation = await members.invite(
      "synthetic-owner",
      original.id,
      original.revision,
    );
    if (!("token" in invitation))
      throw new Error("Missing synthetic invitation");
    db.close();
    db = await openProductDatabase(path, resolve("apps/worker/migrations"));
    state = sqliteState(db);
    members = new Memberships(state, true);
    expect(
      await members.provision(source.token, "external-user", input, null, key),
    ).toEqual(original);
    expect(
      (await members.directory("synthetic-owner")).members[0]?.revision,
    ).toBe(invitation.revision);
    await expect(
      members.provision(
        source.token,
        "external-user",
        { ...input, active: false },
        original.revision,
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("CONNECTION_CONFLICT");
    await rotateCredentials(db, new CredentialVault({ a: keyA, b: keyB }, "b"));
    await expect(
      members.claimInvitation(original.id, invitation.token),
    ).rejects.toThrow("AUTH_REQUIRED");
    expect((await members.authenticate(source.token)).source.id).toBe(
      source.source.id,
    );
    expect(
      (
        await new Connections(
          state,
          new CredentialVault({ a: keyA, b: keyB }, "b"),
        ).list("synthetic-owner")
      )[0]?.id,
    ).toBe(company.id);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("retains a local emergency block and the original source operation after restarting actual workerd/D1", async () => {
  const directory = await mkdtemp(join(tmpdir(), "membership-d1-restart-"));
  const options = convertV4MiniflareOptions({
    name: "membership-restart",
    modules: true,
    script: "export default { fetch() { return new Response('synthetic'); } }",
    compatibilityDate: "2026-10-18",
    d1Databases: { DB: "membership-restart" },
    resourcePersistencePath: directory,
  });
  let runtime = new Miniflare(options);
  try {
    let db = await runtime.getD1Database("DB");
    await db.exec(
      (
        await readFile(
          new URL(
            "../../apps/worker/migrations/0002_product_state.sql",
            import.meta.url,
          ),
          "utf8",
        )
      ).replace(/\n/g, " "),
    );
    let state = d1State(db);
    await state.put(
      "installation",
      "owner",
      { phase: "active", ownerId: "synthetic-owner" },
      null,
    );
    let members = new Memberships(state, true);
    const source = await members.source("synthetic-owner", {
      name: "Generic consumer",
      companies: [],
      allowAdmins: false,
    });
    const key = crypto.randomUUID();
    const input = {
      email: "d1-restart@example.invalid",
      name: "D1 restart",
      role: "member" as const,
      active: true,
      companies: {},
    };
    const original = await members.provision(
      source.token,
      "external-user",
      input,
      null,
      key,
    );
    const linked = await members.link(
      "synthetic-owner",
      original.id,
      original.revision,
      "synthetic-member",
      source.source.id,
      "external-user",
    );
    await members.block("synthetic-owner", linked.id, linked.revision, true);
    await runtime.dispose();
    runtime = new Miniflare(options);
    db = await runtime.getD1Database("DB");
    state = d1State(db);
    members = new Memberships(state, true);
    expect(
      await members.provision(source.token, "external-user", input, null, key),
    ).toEqual(original);
    expect(
      (await members.directory("synthetic-owner")).members[0]?.blocked,
    ).toBe(true);
    await expect(members.principal("synthetic-member")).rejects.toThrow(
      "AUTH_REQUIRED",
    );
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
