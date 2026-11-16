import {
  accountingHash,
  assertScopeProgram,
  type Connection,
  type Connections,
  type FortnoxBridge,
  programSelection,
  type RealtimeStatus,
  type SyncJournal,
  syncResources,
} from "@fortnox-mcp/core";
import type { FortnoxConnections } from "@fortnox-mcp/fortnox";
import { normalizeFortnoxEvent } from "../../../packages/fortnox/src/events.js";
import { parseExactProviderJson } from "../../../packages/fortnox/src/http.js";

export interface EventSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: string,
    handler: (event: { data?: unknown }) => void,
  ): void;
}
interface Group {
  signature: string;
  socket: EventSocket;
  companies: Connection[];
  status: RealtimeStatus;
  started: number;
  task: Promise<void>;
  pending: number;
  renewing: boolean;
}
// Node's installation-wide lock guarantees one collector per database. No
// socket is created by a request handler or by a Worker isolate.
export class FortnoxEvents {
  private groups = new Map<string, Group>();
  private stopping = false;
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly bridge: FortnoxBridge,
    readonly journal: SyncJournal,
    readonly owner: () => Promise<string | undefined>,
    readonly socket: (url: string) => EventSocket = (url) => new WebSocket(url),
    readonly now = Date.now,
  ) {}
  status = (company: string): RealtimeStatus =>
    [...this.groups.values()].find((g) =>
      g.companies.some((c) => c.id === company),
    )?.status ?? "connecting";
  start() {
    const tick = () => {
      if (!this.running)
        this.running = this.refresh()
          .catch(() => {
            for (const g of this.groups.values()) {
              g.status = "disconnected";
              g.socket.close();
            }
          })
          .finally(() => {
            this.running = undefined;
          });
    };
    tick();
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
  }
  async refresh() {
    const owner = await this.owner();
    if (this.stopping || !owner) return;
    await this.journal.cleanup(this.now());
    const catalog = await this.bridge.catalog();
    const readable = (
      c: Connection,
      resource: (typeof syncResources)[number],
    ) => {
      const operation = catalog?.operations.find(
        (o) =>
          o.path === resource.path &&
          o.method === "GET" &&
          o.effect === "read" &&
          !o.unavailable,
      );
      if (!operation || !c.scopes.includes(resource.scope)) return false;
      try {
        for (const scope of operation.scopes) {
          if (!c.scopes.includes(scope)) return false;
          assertScopeProgram(c, scope);
        }
        assertScopeProgram(c, resource.scope);
        return true;
      } catch {
        return false;
      }
    };
    const companies = (await this.connections.list(owner)).filter(
      (c) =>
        c.state === "active" &&
        this.provider.allowsTenant(c.tenant) &&
        syncResources.some((r) => r.topic && readable(c, r)),
    );
    const desired = new Map<string, Connection[]>();
    for (const c of companies) {
      const credentials = await this.connections.credentials(owner, c);
      const key = await accountingHash([owner, credentials.clientId]);
      desired.set(key, [...(desired.get(key) ?? []), c]);
    }
    for (const [key, g] of this.groups)
      if (!desired.has(key)) {
        g.socket.close();
        await g.task;
        this.groups.delete(key);
      }
    for (const [key, list] of desired) {
      const first = list[0];
      if (!first) continue;
      const credentials = await this.connections.credentials(owner, first);
      const signature = await accountingHash([
        catalog?.revision,
        credentials.clientSecret,
        list.map((c) => [
          c.id,
          c.generation,
          c.accessRevision,
          c.scopes,
          programSelection(c).revision,
        ]),
      ]);
      const old = this.groups.get(key);
      if (old && old.signature === signature && old.socket.readyState < 2) {
        if (
          (old.status === "connecting" || old.renewing) &&
          this.now() - old.started >= 30000
        ) {
          old.socket.close();
        } else if (
          old.status === "connected" &&
          !old.renewing &&
          this.now() - old.started >= 15 * 60000
        ) {
          const tokens = [];
          for (const c of list)
            tokens.push(`Bearer ${await this.provider.token(owner, c)}`);
          old.renewing = true;
          old.started = this.now();
          old.socket.send(
            JSON.stringify({
              command: "add-tenants-v1",
              includeChildTenants: false,
              clientSecret: credentials.clientSecret,
              accessTokens: tokens,
            }),
          );
          continue;
        } else continue;
      }
      if (old) {
        old.socket.close();
        await old.task;
        this.groups.delete(key);
      }
      const offsets = await this.journal.offsets(key);
      const requestedTopics = [
        ...new Set(
          syncResources
            .filter((r) => r.topic && list.some((c) => readable(c, r)))
            .map((r) => r.topic),
        ),
      ];
      // New tenant membership also needs a fresh baseline; an integration-wide
      // offset says nothing about a newly added tenant's earlier events.
      if (
        !offsets.length ||
        requestedTopics.some(
          (topic) => !offsets.some((o) => o.topic === topic),
        ) ||
        offsets.some((o) => o.received <= this.now() - 14 * 86400000) ||
        (old && old.signature !== signature)
      )
        for (const c of list)
          await this.journal.reset(owner, c.id, c.generation);
      if (this.stopping) return;
      const socket = this.socket("wss://ws.fortnox.se/topics-v1");
      const group: Group = {
        socket,
        signature,
        companies: list,
        status: "connecting",
        started: this.now(),
        task: Promise.resolve(),
        pending: 0,
        renewing: false,
      };
      this.groups.set(key, group);
      const fail = () => {
        group.status = "disconnected";
        socket.close();
      };
      const enqueue = (action: () => Promise<void>) => {
        if (++group.pending > 128) {
          fail();
          return;
        }
        group.task = group.task
          .then(async () => {
            if (this.stopping || this.groups.get(key) !== group) return;
            await action();
          })
          .catch(async () => {
            fail();
            for (const c of list)
              await this.journal.reset(owner, c.id, c.generation);
          })
          .finally(() => {
            group.pending--;
          });
      };
      socket.addEventListener("open", () =>
        enqueue(async () => {
          const tokens = [];
          for (const c of list)
            tokens.push(`Bearer ${await this.provider.token(owner, c)}`);
          if (socket.readyState === 1)
            socket.send(
              JSON.stringify({
                command: "add-tenants-v1",
                includeChildTenants: false,
                clientSecret: credentials.clientSecret,
                accessTokens: tokens,
              }),
            );
        }),
      );
      socket.addEventListener("message", (message) =>
        enqueue(async () => {
          if (
            typeof message.data !== "string" ||
            new TextEncoder().encode(message.data).length > 16384
          )
            throw new Error("Invalid event frame");
          const raw = parseExactProviderJson(message.data) as Record<
            string,
            unknown
          >;
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new Error("Invalid event frame");
          // Provider command replies can echo access tokens. They are never
          // persisted, returned, or logged, including error replies.
          if (typeof raw.response === "string") {
            if (raw.result !== "ok") throw new Error("Event command failed");
            if (raw.response === "add-tenants-v1") {
              const tenants = raw.tenantIds;
              if (
                !tenants ||
                typeof tenants !== "object" ||
                Array.isArray(tenants) ||
                Object.values(tenants).length !== list.length ||
                Object.values(tenants).some(
                  (v) => !list.some((c) => c.tenant === String(v)),
                )
              )
                throw new Error("Event tenant mismatch");
              if (group.renewing) {
                group.renewing = false;
                return;
              }
              const topics = requestedTopics.map((topic) => ({
                topic,
                ...(offsets.find((o) => o.topic === topic)
                  ? { offset: offsets.find((o) => o.topic === topic)?.offset }
                  : {}),
              }));
              socket.send(JSON.stringify({ command: "add-topics-v1", topics }));
            } else if (raw.response === "add-topics-v1")
              socket.send(JSON.stringify({ command: "subscribe-v1" }));
            else if (raw.response === "subscribe-v1")
              group.status = "connected";
            else throw new Error("Unknown event response");
            return;
          }
          const c = list.find((v) => v.tenant === String(raw.tenantId));
          if (!c) throw new Error("Unregistered event tenant");
          const current = (await this.connections.list(owner)).find(
            (v) => v.id === c.id,
          );
          if (
            current?.state !== "active" ||
            current.generation !== c.generation ||
            current.accessRevision !== c.accessRevision
          )
            throw new Error("Changed event connection");
          const normalized = await normalizeFortnoxEvent(raw, key, c);
          if (!requestedTopics.some((topic) => topic === normalized.topic))
            throw new Error("Unknown event topic");
          await this.journal.append(
            owner,
            c.id,
            c.generation,
            key,
            normalized.topic,
            normalized.offset,
            normalized.events.filter((event) =>
              syncResources.some(
                (r) => r.id === event.resource && readable(current, r),
              ),
            ),
            this.now(),
          );
        }),
      );
      socket.addEventListener("error", fail);
      socket.addEventListener("close", () => {
        group.status = "disconnected";
      });
    }
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
    for (const g of this.groups.values()) g.socket.close();
    await Promise.all([...this.groups.values()].map((g) => g.task));
    this.groups.clear();
  }
}
