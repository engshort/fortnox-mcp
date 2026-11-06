import { z } from "zod";
import { DomainError } from "./errors.js";
import type { StateStore } from "./ports.js";

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
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(binding),
      },
      await this.key(this.active),
      new TextEncoder().encode(
        JSON.stringify(connectionCredentials.parse(value)),
      ),
    );
    return {
      key: this.active,
      iv: encode(iv),
      data: encode(new Uint8Array(data)),
    };
  }
  async open(value: Ciphertext, binding: string): Promise<Credentials> {
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
      return connectionCredentials.parse(
        JSON.parse(new TextDecoder().decode(data)),
      );
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
  review: "review_required";
  readOnly: true;
  state: "active" | "reconnect_required" | "disconnected";
  secret: Ciphertext | null;
  renewal?: { id: string; until: number; dispatched: boolean };
}
export interface ConnectionSet {
  connections: Connection[];
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
  async snapshot(owner: string) {
    return await this.state.get<ConnectionSet>("connections", owner);
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
        await this.state.put(
          "connections",
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
      grant.value.companies[company] !== connection.generation
    )
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
  async rotateKey(owner: string) {
    for (let n = 0; n < 8; n++) {
      const row = await this.snapshot(owner);
      if (!row) return;
      for (const c of row.value.connections)
        if (c.secret)
          c.secret = await this.vault.seal(
            await this.vault.open(c.secret, this.binding(owner, c)),
            this.binding(owner, c),
          );
      if (await this.state.put("connections", owner, row.value, row.version))
        return;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
}
