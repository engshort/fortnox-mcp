import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import type { Duplex } from "node:stream";
import { accountingHash, CompanySync, requestActor } from "@fortnox-mcp/core";
import { expect, it } from "vitest";
import { FortnoxEvents } from "../../apps/node/src/fortnox-events.js";
import { sqliteState } from "../../apps/node/src/product-storage.js";
import { sqliteSyncJournal } from "../../apps/node/src/sync-storage.js";
import { createProductApplication } from "../../apps/shared/product.js";
import { syntheticSyncCatalog } from "../shared/company-sync.js";
import {
  keyA,
  syntheticCompany,
  syntheticCredentials,
} from "../shared/connections.js";

const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Synthetic socket deadline");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
function frame(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const head =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, payload]);
}
it("uses an actual Node WebSocket, resumes opaque offsets and stops before database close", async () => {
  const db = new DatabaseSync(":memory:");
  for (const file of [
    "0002_product_state.sql",
    "0003_product_auth.sql",
    "0004_product_oauth.sql",
    "0010_company_sync.sql",
  ])
    db.exec(readFileSync(`apps/worker/migrations/${file}`, "utf8"));
  const journal = sqliteSyncJournal(db),
    state = sqliteState(db);
  const app = createProductApplication(
    {
      origin: "https://events.example.invalid",
      secret: "synthetic-events-secret-at-least-32-characters",
      keys: { a: keyA },
      activeKey: "a",
      redirects: [],
      testMode: false,
      testTenants: [],
      clientId: syntheticCredentials.clientId,
      clientSecret: syntheticCredentials.clientSecret,
      restApi: true,
      restBridge: true,
    },
    { database: db, state },
    async () => {
      throw new Error("Unexpected provider request");
    },
  );
  const owner = "synthetic-events-owner";
  await state.put(
    "installation",
    "owner",
    { phase: "active", ownerId: owner, tokenHash: "", expiresAt: 0 },
    null,
  );
  const company = await app.connections.add(
    owner,
    {
      ...syntheticCompany,
      scopes: [
        "companyinformation",
        "profile",
        "invoice",
        "customer",
        "bookkeeping",
      ],
    },
    syntheticCredentials,
  );
  await app.bridgeCatalog.install(owner, await syntheticSyncCatalog());
  const actor = requestActor(
    {
      ownerId: owner,
      clientId: "event-client",
      scopes: ["api:read", "api:bridge", "api:finance:read"],
    },
    "api",
  );
  await app.connections.grant(owner, actor.clientId, [company.id], "api");
  const commands: Record<string, unknown>[] = [];
  const sockets: Duplex[] = [];
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    sockets.push(socket);
    const accept = createHash("sha1")
      .update(
        `${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 6) {
        if ((buffered[0] ?? 0) === 0x88) {
          socket.end();
          return;
        }
        const length = (buffered[1] ?? 0) & 127;
        const start = length === 126 ? 4 : 2;
        const size =
          length === 126
            ? buffered.length >= 4
              ? buffered.readUInt16BE(2)
              : 65536
            : length;
        if (buffered.length < start + 4 + size) return;
        const mask = buffered.subarray(start, start + 4),
          payload = Buffer.from(buffered.subarray(start + 4, start + 4 + size));
        for (let i = 0; i < payload.length; i++)
          payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
        buffered = buffered.subarray(start + 4 + size);
        const command = JSON.parse(payload.toString()) as Record<
          string,
          unknown
        >;
        commands.push(command);
        socket.write(
          frame({
            response: command.command,
            result: "ok",
            ...(command.command === "add-tenants-v1"
              ? { tenantIds: { "Bearer synthetic-access-token": 100001 } }
              : {}),
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test listener");
  let now = Date.now();
  const collector = new FortnoxEvents(
    app.connections,
    app.provider,
    app.bridge,
    journal,
    async () => owner,
    () => new WebSocket(`ws://127.0.0.1:${address.port}`),
    () => now,
  );
  try {
    await collector.refresh();
    await waitFor(() => collector.status(company.id) === "connected");
    expect(commands[0]).toMatchObject({
      command: "add-tenants-v1",
      includeChildTenants: false,
    });
    const sync = new CompanySync(app.bridge, journal, collector.status);
    const bootstrap = await sync.changes(
      actor,
      company.id,
      {},
      async () => actor,
    );
    sockets[0]?.write(
      frame({
        topic: "invoices",
        offset: "opaque-a",
        type: "invoice-updated-v1",
        tenantId: 100001,
        entityId: "42",
        timestamp: new Date().toISOString(),
      }),
    );
    await waitFor(
      () => db.prepare("SELECT count(*) AS n FROM sync_events").get()?.n === 1,
    );
    const changed = await sync.changes(
      actor,
      company.id,
      { cursor: bootstrap.next_cursor },
      async () => actor,
    );
    expect(changed.events[0]?.identity).toEqual({ DocumentNumber: "42" });
    now += 16 * 60000;
    await collector.refresh();
    await waitFor(
      () => commands.filter((c) => c.command === "add-tenants-v1").length === 2,
    );
    expect(sockets).toHaveLength(1);
    expect(
      (
        await sync.changes(
          actor,
          company.id,
          { cursor: changed.next_cursor },
          async () => actor,
        )
      ).resync_required,
    ).toBe(false);
    sockets[0]?.destroy();
    await waitFor(() => collector.status(company.id) === "disconnected");
    await collector.refresh();
    await waitFor(() => collector.status(company.id) === "connected");
    expect(
      commands.filter((c) => c.command === "add-topics-v1").at(-1)?.topics,
    ).toContainEqual({ topic: "invoices", offset: "opaque-a" });
    // Missing offsets for the other topics are explicit loss of continuity.
    expect(
      (
        await sync.changes(
          actor,
          company.id,
          { cursor: changed.next_cursor },
          async () => actor,
        )
      ).resync_required,
    ).toBe(true);
    expect(
      await journal.offsets(
        await accountingHash([owner, syntheticCredentials.clientId]),
      ),
    ).toHaveLength(1);
    await app.connections.disableProgram(owner, company.id, "invoicing", 0);
    await collector.refresh();
    await waitFor(() => collector.status(company.id) === "connected");
    const finalTopics = commands
      .filter((c) => c.command === "add-topics-v1")
      .at(-1)?.topics;
    expect(finalTopics).toEqual(
      expect.arrayContaining([
        { topic: "financial-years" },
        { topic: "vouchers" },
      ]),
    );
    expect(finalTopics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ topic: "invoices" })]),
    );
  } finally {
    await collector.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}, 15000);
