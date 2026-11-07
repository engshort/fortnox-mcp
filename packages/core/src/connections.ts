import { z } from "zod";
import type { BookkeepingState } from "./bookkeeping.js";
import { DomainError } from "./errors.js";
import type { StateStore } from "./ports.js";
import type { ReceiptBatch } from "./receipts.js";

export const connectionCredentials = z
  .object({
    clientId: z.string().min(1).max(128),
    clientSecret: z.string().min(8).max(4096),
    accessToken: z.string().max(8192),
    expiresAt: z.number().int().nonnegative(),
    refreshToken: z.string().max(8192).optional(),
  })
  .strict();
export type Credentials = z.infer<typeof connectionCredentials>;
export interface Ciphertext {
  key: string;
  iv: string;
  data: string;
}
const encode = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export class CredentialVault {
  constructor(
    private readonly keys: Readonly<Record<string, string>>,
    readonly active: string,
  ) {}
  private async key(id: string) {
    try {
      const bytes = decode(this.keys[id] ?? "");
      if (bytes.byteLength !== 32) throw new Error();
      return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
        "encrypt",
        "decrypt",
      ]);
    } catch {
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
  }
  async seal(value: Credentials, binding: string): Promise<Ciphertext> {
    return this.sealData(connectionCredentials.parse(value), binding);
  }
  async sealData(value: unknown, binding: string): Promise<Ciphertext> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(binding),
      },
      await this.key(this.active),
      new TextEncoder().encode(JSON.stringify(value)),
    );
    return {
      key: this.active,
      iv: encode(iv),
      data: encode(new Uint8Array(data)),
    };
  }
  async open(value: Ciphertext, binding: string): Promise<Credentials> {
    return connectionCredentials.parse(await this.openData(value, binding));
  }
  async openData(value: Ciphertext, binding: string): Promise<unknown> {
    try {
      const data = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(value.iv),
          additionalData: new TextEncoder().encode(binding),
        },
        await this.key(value.key),
        decode(value.data),
      );
      return JSON.parse(new TextDecoder().decode(data)) as unknown;
    } catch {
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
  }
}
export interface Connection {
  id: string;
  tenant: string;
  mode: "service" | "user";
  name: string;
  organizationNumber: string;
  scopes: string[];
  generation: number;
  policyVersion: number;
  review: "review_required" | "client_managed";
  readOnly: boolean;
  bookkeeping?: BookkeepingState;
  receiptBatches?: ReceiptBatch[];
  state: "active" | "reconnect_required" | "disconnected";
  secret: Ciphertext | null;
  renewal?: { id: string; until: number; dispatched: boolean };
}
export interface ConnectionSet {
  connections: Connection[];
  keyCheck?: Ciphertext;
}
export interface CompanyGrant {
  ownerId: string;
  companies: Record<string, number>;
}
export class Connections {
  constructor(
    readonly state: StateStore,
    readonly vault: CredentialVault,
  ) {}
  binding(owner: string, c: Pick<Connection, "id" | "generation" | "mode">) {
    return JSON.stringify([owner, c.id, c.generation, c.mode]);
  }
  private keyBinding(owner: string) {
    return JSON.stringify([owner, "connection-set-key-check"]);
  }
  private async save(
    owner: string,
    value: ConnectionSet,
    expected: number | null,
  ) {
    const keyCheck = await this.vault.sealData(
      { purpose: "connection-set-key-check" },
      this.keyBinding(owner),
    );
    return this.state.put(
      "connections",
      owner,
      { ...value, keyCheck },
      expected,
    );
  }
  async snapshot(owner: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.state.get<ConnectionSet>("connections", owner);
      if (!row) return null;
      if (row.value.keyCheck) {
        try {
          z.object({ purpose: z.literal("connection-set-key-check") })
            .strict()
            .parse(
              await this.vault.openData(
                row.value.keyCheck,
                this.keyBinding(owner),
              ),
            );
        } catch {
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        }
        for (const c of row.value.connections)
          if (c.secret) await this.vault.open(c.secret, this.binding(owner, c));
        for (const c of row.value.connections)
          for (const p of c.bookkeeping?.proposals ?? [])
            await this.vault.openData(
              p.body,
              JSON.stringify([
                owner,
                c.id,
                "voucher-proposal",
                p.id,
                p.hash,
                p.generation,
                p.policy,
                ...(p.receipt ? [p.receipt] : []),
              ]),
            );
        return row;
      }
      // Upgrade earlier experimental snapshots only after proving the key.
      const encrypted = row.value.connections.filter((c) => c.secret);
      if (!encrypted.length) throw new DomainError("CAPABILITY_UNAVAILABLE");
      for (const c of encrypted)
        if (c.secret) await this.vault.open(c.secret, this.binding(owner, c));
      if (await this.save(owner, row.value, row.version)) continue;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  async list(owner: string) {
    return (await this.snapshot(owner))?.value.connections ?? [];
  }
  async add(
    owner: string,
    input: Pick<
      Connection,
      "tenant" | "mode" | "name" | "organizationNumber" | "scopes"
    >,
    credentials: Credentials,
  ) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.snapshot(owner);
      const connections = row?.value.connections ?? [];
      if (connections.some((c) => c.tenant === input.tenant))
        throw new DomainError("CONNECTION_CONFLICT");
      if (connections.length >= 20)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const connection: Connection = {
        ...input,
        id: crypto.randomUUID(),
        generation: 1,
        policyVersion: 1,
        review: "review_required",
        readOnly: true,
        state: "active",
        secret: null,
      };
      connection.secret = await this.vault.seal(
        credentials,
        this.binding(owner, connection),
      );
      if (
        await this.save(
          owner,
          { connections: [...connections, connection] },
          row?.version ?? null,
        )
      )
        return connection;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  async authorize(
    owner: string,
    grantId: string,
    company: string,
    active = true,
  ) {
    const grant = await this.state.get<CompanyGrant>("company-grants", grantId);
    const connection = (await this.list(owner)).find((c) => c.id === company);
    if (
      grant?.value.ownerId !== owner ||
      !connection ||
      !Object.hasOwn(grant.value.companies, company)
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    const grantedGeneration = grant.value.companies[company];
    if (
      connection.state === "disconnected" &&
      (grantedGeneration === connection.generation ||
        grantedGeneration === connection.generation - 1)
    )
      throw new DomainError("CONNECTION_DISCONNECTED");
    if (grantedGeneration !== connection.generation)
      throw new DomainError("COMPANY_FORBIDDEN");
    if (active && connection.state !== "active")
      throw new DomainError("RECONNECT_REQUIRED");
    return connection;
  }
  async grant(owner: string, grantId: string, selected: readonly string[]) {
    const companies: Record<string, number> = {};
    const connections = await this.list(owner);
    for (const id of selected) {
      const c = connections.find((c) => c.id === id && c.state === "active");
      if (!c) throw new DomainError("COMPANY_FORBIDDEN");
      companies[id] = c.generation;
    }
    for (let n = 0; n < 8; n++) {
      const prior = await this.state.get<CompanyGrant>(
        "company-grants",
        grantId,
      );
      if (
        prior &&
        (prior.value.ownerId !== owner ||
          JSON.stringify(prior.value.companies) !== JSON.stringify(companies))
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      if (
        await this.state.put(
          "company-grants",
          grantId,
          { ownerId: owner, companies },
          prior?.version ?? null,
        )
      )
        return;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  async credentials(owner: string, c: Connection) {
    const current = (await this.list(owner)).find((x) => x.id === c.id);
    if (
      !current ||
      current.generation !== c.generation ||
      current.state !== "active" ||
      !current.secret
    )
      throw new DomainError("RECONNECT_REQUIRED");
    return this.vault.open(current.secret, this.binding(owner, current));
  }
  async mutate(
    owner: string,
    id: string,
    change: (connection: Connection) => Promise<void> | void,
  ) {
    for (let n = 0; n < 8; n++) {
      const row = await this.snapshot(owner);
      const c = row?.value.connections.find((c) => c.id === id);
      if (!row || !c) throw new DomainError("COMPANY_FORBIDDEN");
      await change(c);
      if (await this.save(owner, row.value, row.version)) return c;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  async renew(
    owner: string,
    id: string,
    generation: number,
    exchange: (credentials: Credentials, c: Connection) => Promise<Credentials>,
    force = false,
    now = Date.now(),
  ) {
    const first = (await this.list(owner)).find((c) => c.id === id);
    if (!first || first.generation !== generation)
      throw new DomainError("RECONNECT_REQUIRED");
    if (
      first.mode === "user" &&
      first.renewal?.dispatched &&
      first.renewal.until <= now
    ) {
      await this.mutate(owner, id, (c) => {
        if (
          c.generation === generation &&
          c.renewal?.id === first.renewal?.id
        ) {
          c.state = "reconnect_required";
          c.secret = null;
          delete c.renewal;
        }
      });
      throw new DomainError("RECONNECT_REQUIRED");
    }
    const credentials = await this.credentials(owner, first);
    if (!force && credentials.expiresAt > now + 60000) return credentials;
    const lock = crypto.randomUUID();
    const reserved = await this.mutate(owner, id, (c) => {
      if (c.generation !== generation || c.state !== "active")
        throw new DomainError("RECONNECT_REQUIRED");
      if (c.renewal && c.renewal.until > now)
        throw new DomainError("RATE_LIMITED");
      c.renewal = { id: lock, until: now + 30000, dispatched: true };
    });
    try {
      const next = connectionCredentials.parse(
        await exchange(await this.credentials(owner, reserved), reserved),
      );
      await this.mutate(owner, id, async (c) => {
        if (
          c.generation !== generation ||
          c.state !== "active" ||
          c.renewal?.id !== lock
        )
          throw new DomainError("RECONNECT_REQUIRED");
        c.secret = await this.vault.seal(next, this.binding(owner, c));
        delete c.renewal;
      });
      return next;
    } catch {
      await this.mutate(owner, id, (c) => {
        if (c.generation === generation && c.renewal?.id === lock) {
          c.state = "reconnect_required";
          c.secret = null;
          delete c.renewal;
        }
      }).catch(() => {});
      throw new DomainError("RECONNECT_REQUIRED");
    }
  }
  async rotateKey(owner: string) {
    for (let n = 0; n < 8; n++) {
      const row = await this.snapshot(owner);
      if (!row) return;
      for (const c of row.value.connections) {
        if (c.secret)
          c.secret = await this.vault.seal(
            await this.vault.open(c.secret, this.binding(owner, c)),
            this.binding(owner, c),
          );
        for (const p of c.bookkeeping?.proposals ?? []) {
          const binding = JSON.stringify([
            owner,
            c.id,
            "voucher-proposal",
            p.id,
            p.hash,
            p.generation,
            p.policy,
            ...(p.receipt ? [p.receipt] : []),
          ]);
          p.body = await this.vault.sealData(
            await this.vault.openData(p.body, binding),
            binding,
          );
        }
      }
      if (await this.save(owner, row.value, row.version)) return;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  async disconnect(owner: string, id: string) {
    return this.mutate(owner, id, (c) => {
      c.state = "disconnected";
      c.generation++;
      c.policyVersion++;
      c.secret = null;
      delete c.renewal;
      if (c.bookkeeping) c.bookkeeping.proposals = [];
    });
  }
  async reconnect(
    owner: string,
    id: string,
    generation: number,
    input: Pick<
      Connection,
      "tenant" | "mode" | "name" | "organizationNumber" | "scopes"
    >,
    credentials: Credentials,
  ) {
    return this.mutate(owner, id, async (c) => {
      if (
        c.generation !== generation ||
        c.state === "active" ||
        c.tenant !== input.tenant
      )
        throw new DomainError("CONNECTION_CONFLICT");
      c.generation++;
      c.policyVersion++;
      c.mode = input.mode;
      c.name = input.name;
      c.organizationNumber = input.organizationNumber;
      c.scopes = input.scopes;
      c.state = "active";
      c.readOnly = true;
      c.review = "review_required";
      delete c.renewal;
      c.secret = await this.vault.seal(credentials, this.binding(owner, c));
    });
  }

  // Called only from owner-session administration; never exposed as an MCP tool.
  async setAccountingPolicy(
    owner: string,
    id: string,
    expectedVersion: number,
    review: Connection["review"],
    readOnly: boolean,
  ) {
    if (
      !["review_required", "client_managed"].includes(review) ||
      typeof readOnly !== "boolean"
    )
      throw new DomainError("VALIDATION_FAILED");
    return this.mutate(owner, id, (c) => {
      if (c.state !== "active" || c.policyVersion !== expectedVersion)
        throw new DomainError("CONNECTION_CONFLICT");
      c.policyVersion++;
      c.review = review;
      c.readOnly = readOnly;
      if (c.bookkeeping) c.bookkeeping.proposals = [];
    });
  }
}
