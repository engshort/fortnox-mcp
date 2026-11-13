import { z } from "zod";
import type { BookkeepingState } from "./bookkeeping.js";
import { type BusinessState, businessBinding } from "./business-writes.js";
import { DomainError } from "./errors.js";
import type { StateStore } from "./ports.js";
import {
  assertNoUncertainWrites,
  assertProgramConsentChange,
  type ProgramChange,
  type ProgramGates,
  type ProgramId,
  type ProgramSelection,
  previewProgram,
  programManifest,
  programSelection,
} from "./programs.js";
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
  programs?: ProgramSelection;
  generation: number;
  accessRevision?: number;
  policyVersion: number;
  review: "review_required" | "client_managed";
  readOnly: boolean;
  bookkeeping?: BookkeepingState;
  business?: BusinessState;
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
  accessRevisions?: Record<string, number>;
  revision?: number;
  grantId?: string;
  expiresAt?: number;
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
        for (const c of row.value.connections)
          for (const p of c.business?.proposals ?? [])
            await this.vault.openData(p.body, businessBinding(owner, c.id, p));
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
  async assertWritesAllowed() {
    const recovery = await this.state.get<{ reconciled: boolean }>(
      "installation",
      "restore",
    );
    if (recovery && recovery.value.reconciled !== true)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
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
    const approved = grantId.startsWith("oauth-grant:")
      ? (
          await this.state.get<Record<string, CompanyGrant>>(
            "oauth-approval-grants",
            owner,
          )
        )?.value[grantId]
      : undefined;
    const grant = grantId.startsWith("oauth-grant:")
      ? approved
        ? { value: approved }
        : null
      : await this.state.get<CompanyGrant>("company-grants", grantId);
    const connection = (await this.list(owner)).find((c) => c.id === company);
    // A request authenticated under a legacy client ID cannot cross the first
    // renewal into the mutable registration's new permissions.
    if (!grantId.startsWith("oauth-grant:") && grant?.value.revision)
      throw new DomainError("COMPANY_FORBIDDEN");
    if (
      grant?.value.ownerId !== owner ||
      (grant.value.expiresAt !== undefined &&
        grant.value.expiresAt <= Date.now()) ||
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
    if (
      (grant.value.accessRevisions?.[company] ?? 0) !==
      (connection.accessRevision ?? 0)
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    if (active && connection.state !== "active")
      throw new DomainError("RECONNECT_REQUIRED");
    return connection;
  }
  async grant(owner: string, grantId: string, selected: readonly string[]) {
    if (
      grantId.startsWith("owner-recovery:") ||
      grantId.startsWith("oauth-grant:")
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    const companies: Record<string, number> = {};
    const accessRevisions: Record<string, number> = {};
    const connections = await this.list(owner);
    for (const id of selected) {
      const c = connections.find((c) => c.id === id && c.state === "active");
      if (!c) throw new DomainError("COMPANY_FORBIDDEN");
      companies[id] = c.generation;
      accessRevisions[id] = c.accessRevision ?? 0;
    }
    for (let n = 0; n < 8; n++) {
      const prior = await this.state.get<CompanyGrant>(
        "company-grants",
        grantId,
      );
      if (
        prior &&
        (prior.value.revision ||
          prior.value.ownerId !== owner ||
          JSON.stringify(prior.value.companies) !== JSON.stringify(companies) ||
          Object.entries(accessRevisions).some(
            ([id, revision]) =>
              (prior.value.accessRevisions?.[id] ?? 0) !== revision,
          ))
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      if (
        await this.state.put(
          "company-grants",
          grantId,
          { ownerId: owner, companies, accessRevisions },
          prior?.version ?? null,
        )
      )
        return;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  // Explicit owner OAuth consent only. Existing token families keep their revision.
  async renewGrant(
    owner: string,
    client: string,
    selected: Array<{
      id: string;
      generation: number;
      access_revision: number;
    }>,
  ) {
    if (
      client.startsWith("owner-recovery:") ||
      client.startsWith("oauth-grant:") ||
      new Set(selected.map((c) => c.id)).size !== selected.length
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    const current = await this.list(owner);
    for (const s of selected) {
      const c = current.find((c) => c.id === s.id);
      if (
        c?.state !== "active" ||
        c.generation !== s.generation ||
        (c.accessRevision ?? 0) !== s.access_revision
      )
        throw new DomainError("CONNECTION_CONFLICT");
    }
    const prior = await this.state.get<CompanyGrant>("company-grants", client);
    if (prior && prior.value.ownerId !== owner)
      throw new DomainError("COMPANY_FORBIDDEN");
    const grant: CompanyGrant = {
      ownerId: owner,
      companies: Object.fromEntries(selected.map((s) => [s.id, s.generation])),
      accessRevisions: Object.fromEntries(
        selected.map((s) => [s.id, s.access_revision]),
      ),
      revision: (prior?.value.revision ?? 0) + 1,
      grantId: `oauth-grant:${crypto.randomUUID()}`,
    };
    // Immutable authorization identity for each explicit approval. In-flight
    // requests cannot acquire the permissions of a later client approval.
    let saved = false;
    for (let attempt = 0; attempt < 8 && !saved; attempt++) {
      const previous = await this.state.get<Record<string, CompanyGrant>>(
        "oauth-approval-grants",
        owner,
      );
      const live = Object.fromEntries(
        Object.entries(previous?.value ?? {}).filter(
          ([, g]) => (g.expiresAt ?? 0) > Date.now(),
        ),
      );
      if (Object.keys(live).length >= 128)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      live[grant.grantId as string] = {
        ...grant,
        expiresAt: Date.now() + 600000,
      };
      saved = await this.state.put(
        "oauth-approval-grants",
        owner,
        live,
        previous?.version ?? null,
      );
    }
    if (!saved) throw new DomainError("CONNECTION_CONFLICT");
    if (
      !(await this.state.put(
        "company-grants",
        client,
        grant,
        prior?.version ?? null,
      ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return grant;
  }

  async selectProgram(
    owner: string,
    company: string,
    input: ProgramChange,
    gates: ProgramGates,
  ) {
    return this.mutate(owner, company, (c) => {
      const preview = previewProgram(c, input, gates);
      if (preview.action !== "local_selection")
        throw new DomainError("CONNECTION_CONFLICT");
      c.programs = {
        enabled: preview.enabled,
        features: preview.features,
        revision: input.expected_revision + 1,
      };
      c.accessRevision = (c.accessRevision ?? 0) + 1;
    });
  }
  // Owner administration only. No bearer token is ever issued for this reserved
  // internal client. One bounded row per company is revoked after the read.
  // Original MCP grants and originating execution identities remain immutable.
  async ownerRecoveryRead<T>(
    owner: string,
    company: string,
    read: (actor: {
      ownerId: string;
      clientId: string;
      scopes: readonly string[];
    }) => Promise<T>,
    fileAccess = false,
  ): Promise<T> {
    const c = (await this.list(owner)).find((value) => value.id === company);
    if (c?.state !== "active") throw new DomainError("COMPANY_FORBIDDEN");
    const clientId = `owner-recovery:${owner}:${company}`;
    const prior = await this.state.get<CompanyGrant>(
      "company-grants",
      clientId,
    );
    if (
      prior &&
      Object.keys(prior.value.companies).length &&
      (prior.value.expiresAt ?? Infinity) > Date.now()
    )
      throw new DomainError("CONNECTION_CONFLICT");
    if (
      !(await this.state.put(
        "company-grants",
        clientId,
        {
          ownerId: owner,
          companies: { [company]: c.generation },
          accessRevisions: { [company]: c.accessRevision ?? 0 },
          expiresAt: Date.now() + 60000,
        },
        prior?.version ?? null,
      ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
    try {
      return await read({
        ownerId: owner,
        clientId,
        scopes: ["mcp:read", ...(fileAccess ? ["mcp:files"] : [])],
      });
    } finally {
      const current = await this.state.get<CompanyGrant>(
        "company-grants",
        clientId,
      );
      if (current?.value.ownerId === owner)
        await this.state.put(
          "company-grants",
          clientId,
          { ownerId: owner, companies: {} },
          current.version,
        );
    }
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
        for (const p of c.business?.proposals ?? []) {
          const binding = businessBinding(owner, c.id, p);
          p.body = await this.vault.sealData(
            await this.vault.openData(p.body, binding),
            binding,
          );
        }
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
      if (c.business) c.business.proposals = [];
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

  async extendPrograms(
    owner: string,
    id: string,
    expected: { generation: number; revision: number; policy: number },
    input: Pick<
      Connection,
      "tenant" | "mode" | "name" | "organizationNumber" | "scopes"
    >,
    selection: Omit<ProgramSelection, "revision">,
    credentials: Credentials,
    change: ProgramChange,
  ) {
    return this.mutate(owner, id, async (c) => {
      if (
        c.state !== "active" ||
        c.generation !== expected.generation ||
        programSelection(c).revision !== expected.revision ||
        c.policyVersion !== expected.policy ||
        c.tenant !== input.tenant ||
        c.mode !== input.mode ||
        c.scopes.some((s) => !input.scopes.includes(s)) ||
        c.renewal
      )
        throw new DomainError("CONNECTION_CONFLICT");
      assertProgramConsentChange(c, change);
      const selected = programSelection(c);
      const sameSet = (a: readonly string[], b: readonly string[]) =>
        JSON.stringify([...new Set(a)].sort()) ===
        JSON.stringify([...new Set(b)].sort());
      if (
        change.expected_revision !== expected.revision ||
        !sameSet(selection.enabled, [...selected.enabled, change.program]) ||
        !sameSet(selection.features, [
          ...selected.features,
          ...change.features,
        ]) ||
        (change.program === "payroll" &&
          input.scopes.some(
            (scope) =>
              ![
                ...c.scopes,
                "salary",
                "companyinformation",
                "profile",
              ].includes(scope),
          ))
      )
        throw new DomainError("CONNECTION_CONFLICT");
      c.generation++;
      c.policyVersion++;
      c.name = input.name;
      c.organizationNumber = input.organizationNumber;
      c.scopes = input.scopes;
      c.programs = { ...selection, revision: expected.revision + 1 };
      if (c.bookkeeping) c.bookkeeping.proposals = [];
      if (c.business) c.business.proposals = [];
      c.secret = await this.vault.seal(credentials, this.binding(owner, c));
    });
  }

  async disableProgram(
    owner: string,
    id: string,
    program: ProgramId,
    expected: number,
  ) {
    return this.mutate(owner, id, (c) => {
      const selected = programSelection(c);
      if (selected.revision !== expected || c.state !== "active")
        throw new DomainError("CONNECTION_CONFLICT");
      assertNoUncertainWrites(c);
      c.programs = {
        revision: selected.revision + 1,
        enabled: selected.enabled.filter((p) => p !== program),
        features: selected.features.filter(
          (id) =>
            !(
              (programManifest.find((p) => p.id === program)?.features ??
                []) as readonly string[]
            ).includes(id),
        ),
      };
      c.policyVersion++;
      if (c.bookkeeping) c.bookkeeping.proposals = [];
      if (c.business) c.business.proposals = [];
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
      if (c.business) c.business.proposals = [];
    });
  }
}
