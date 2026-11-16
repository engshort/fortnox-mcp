import { z } from "zod";
import { DomainError } from "./errors.js";
import type { StateStore } from "./ports.js";

export const membershipInput = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    name: z.string().trim().min(1).max(120),
    role: z.enum(["admin", "member"]),
    active: z.boolean(),
    companies: z.record(z.string().uuid(), z.enum(["read", "read_write"])),
  })
  .strict()
  .refine((v) => Object.keys(v.companies).length <= 50);
export type MembershipInput = z.infer<typeof membershipInput>;
function sameMembership(a: MembershipInput, b: MembershipInput) {
  return (
    a.email === b.email &&
    a.name === b.name &&
    a.role === b.role &&
    a.active === b.active &&
    JSON.stringify(Object.entries(a.companies).sort()) ===
      JSON.stringify(Object.entries(b.companies).sort())
  );
}

export interface Membership extends MembershipInput {
  id: string;
  userId: string | null;
  source: string;
  externalId: string;
  revision: number;
  blocked: boolean;
  invitation?: { hash: string; expiresAt: number; claim?: string };
}
export interface MembershipSource {
  id: string;
  name: string;
  companies: string[];
  allowAdmins: boolean;
  active: boolean;
  tokenHash: string;
  revision: number;
}
interface Directory {
  schema: 1;
  members: Membership[];
  sources: MembershipSource[];
  operations: Array<{
    source: string;
    key: string;
    hash: string;
    expires: number;
    result: unknown;
  }>;
  audit: Array<{
    at: number;
    actor: string;
    source: string;
    target: string;
    action: string;
  }>;
}
export interface MemberPrincipal {
  ownerId: string;
  subjectId: string;
  role: "owner" | "admin" | "member";
  revision: number;
  companies: Record<string, "read" | "read_write">;
}
export function principalGrantKey(
  owner: string,
  subject: string,
  client: string,
) {
  // Preserve every existing owner registration and its token families.
  return subject === owner ? client : `member:${subject}:${client}`;
}
export async function membershipHash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function membershipSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}

/** Bounded identity/authorization state, shared by SQLite and D1 CAS adapters. */
export class Memberships {
  constructor(
    readonly state: StateStore,
    readonly enabled = false,
    readonly now = Date.now,
  ) {}
  async owner() {
    const owner = await this.state.get<{ phase: string; ownerId: string }>(
      "installation",
      "owner",
    );
    if (owner?.value.phase !== "active") throw new DomainError("AUTH_REQUIRED");
    return owner.value.ownerId;
  }
  async directory(owner: string): Promise<Directory> {
    return (
      (await this.state.get<Directory>("memberships", owner))?.value ?? {
        schema: 1,
        members: [],
        sources: [],
        operations: [],
        audit: [],
      }
    );
  }
  async principal(subject: string): Promise<MemberPrincipal> {
    const ownerId = await this.owner();
    if (subject === ownerId)
      return {
        ownerId,
        subjectId: subject,
        role: "owner",
        revision: 0,
        companies: {},
      };
    if (!this.enabled) throw new DomainError("AUTH_REQUIRED");
    const member = (await this.directory(ownerId)).members.find(
      (m) => m.userId === subject,
    );
    if (!member?.active || member.blocked)
      throw new DomainError("AUTH_REQUIRED");
    return {
      ownerId,
      subjectId: subject,
      role: member.role,
      revision: member.revision,
      companies: member.companies,
    };
  }
  async administrator(subject: string) {
    const principal = await this.principal(subject);
    if (principal.role === "member") throw new DomainError("COMPANY_FORBIDDEN");
    return principal;
  }
  private async mutate<T>(
    owner: string,
    change: (directory: Directory) => T | Promise<T>,
  ): Promise<T> {
    if (!this.enabled) throw new DomainError("CAPABILITY_UNAVAILABLE");
    for (let n = 0; n < 8; n++) {
      const row = await this.state.get<Directory>("memberships", owner);
      const directory = row?.value ?? (await this.directory(owner));
      directory.operations = directory.operations.filter(
        (o) => o.expires > this.now(),
      );
      const result = await change(directory);
      directory.audit = directory.audit.slice(-128);
      if (
        directory.members.length > 100 ||
        directory.sources.length > 16 ||
        directory.operations.length > 128 ||
        JSON.stringify(directory).length > 120000
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      if (
        await this.state.put(
          "memberships",
          owner,
          directory,
          row?.version ?? null,
        )
      )
        return result;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  private audit(
    d: Directory,
    actor: string,
    source: string,
    target: string,
    action: string,
  ) {
    d.audit.push({ at: this.now(), actor, source, target, action });
  }
  private async companies(owner: string, input: MembershipInput) {
    const set = await this.state.get<{
      connections: Array<{ id: string; state: string }>;
    }>("connections", owner);
    if (
      Object.keys(input.companies).some(
        (id) =>
          !set?.value.connections.some(
            (c) => c.id === id && c.state !== "disconnected",
          ),
      )
    )
      throw new DomainError("COMPANY_FORBIDDEN");
  }
  async save(
    subject: string,
    id: string | null,
    input: MembershipInput,
    revision: number | null,
  ) {
    const p = await this.administrator(subject);
    const value = membershipInput.parse(input);
    await this.companies(p.ownerId, value);
    return this.mutate(p.ownerId, async (d) => {
      await this.administrator(subject);
      const old = id ? d.members.find((m) => m.id === id) : undefined;
      if (
        (id && !old) ||
        (old?.revision ?? null) !== revision ||
        (old && old.source !== "local")
      )
        throw new DomainError("CONNECTION_CONFLICT");
      if (
        old?.userId === p.ownerId ||
        d.members.some((m) => m.id !== id && m.email === value.email)
      )
        throw new DomainError("CONNECTION_CONFLICT");
      if (old?.userId && old.email !== value.email)
        throw new DomainError("VALIDATION_FAILED");
      if (old && sameMembership(old, value)) return old;
      const member: Membership = {
        ...value,
        id: old?.id ?? crypto.randomUUID(),
        userId: old?.userId ?? null,
        source: "local",
        externalId: old?.externalId ?? crypto.randomUUID(),
        revision: (old?.revision ?? 0) + 1,
        blocked: old?.blocked ?? false,
      };
      d.members = d.members.filter((m) => m.id !== member.id).concat(member);
      this.audit(d, subject, "local", member.id, "save");
      return member;
    });
  }
  async block(subject: string, id: string, revision: number, blocked: boolean) {
    const p = await this.administrator(subject);
    return this.mutate(p.ownerId, async (d) => {
      await this.administrator(subject);
      const m = d.members.find((m) => m.id === id);
      if (!m || m.revision !== revision || m.userId === p.ownerId)
        throw new DomainError("CONNECTION_CONFLICT");
      m.blocked = blocked;
      m.revision++;
      delete m.invitation;
      this.audit(d, subject, "local", id, blocked ? "block" : "unblock");
      return m;
    });
  }
  async link(
    subject: string,
    id: string,
    revision: number,
    userId: string,
    source: string,
    externalId: string,
  ) {
    const p = await this.administrator(subject);
    if (userId === p.ownerId) throw new DomainError("COMPANY_FORBIDDEN");
    return this.mutate(p.ownerId, async (d) => {
      await this.administrator(subject);
      const m = d.members.find((m) => m.id === id);
      if (
        !m ||
        m.revision !== revision ||
        (m.userId && m.userId !== userId) ||
        d.members.some(
          (v) =>
            v.id !== id &&
            (v.userId === userId ||
              (v.source === source && v.externalId === externalId)),
        ) ||
        (source !== "local" &&
          !d.sources.some((s) => s.id === source && s.active))
      )
        throw new DomainError("CONNECTION_CONFLICT");
      const managingSource = d.sources.find((s) => s.id === source);
      if (
        managingSource &&
        ((m.role === "admin" && !managingSource.allowAdmins) ||
          Object.keys(m.companies).some(
            (id) => !managingSource.companies.includes(id),
          ))
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      Object.assign(m, {
        userId,
        source,
        externalId,
        revision: m.revision + 1,
      });
      delete m.invitation;
      this.audit(d, subject, "local", id, "link");
      return m;
    });
  }
  async source(
    subject: string,
    input: { name: string; companies: string[]; allowAdmins: boolean },
  ) {
    input = z
      .object({
        name: z.string().trim().min(1).max(120),
        companies: z.array(z.string().uuid()).max(50),
        allowAdmins: z.boolean(),
      })
      .strict()
      .parse(input);
    const p = await this.administrator(subject);
    if (input.allowAdmins && p.role !== "owner")
      throw new DomainError("COMPANY_FORBIDDEN");
    await this.companies(p.ownerId, {
      email: "source@example.invalid",
      name: input.name,
      role: "member",
      active: true,
      companies: Object.fromEntries(input.companies.map((id) => [id, "read"])),
    });
    const token = membershipSecret();
    const tokenHash = await membershipHash(token);
    const source = await this.mutate(p.ownerId, async (d) => {
      await this.administrator(subject);
      const s: MembershipSource = {
        ...input,
        id: crypto.randomUUID(),
        active: true,
        tokenHash,
        revision: 1,
      };
      d.sources.push(s);
      this.audit(d, subject, s.id, s.id, "source_created");
      return s;
    });
    return { source, token: `${source.id}.${token}` };
  }
  async rotateSource(
    subject: string,
    id: string,
    revision: number,
    active: boolean,
  ) {
    const p = await this.administrator(subject);
    const token = membershipSecret();
    const tokenHash = await membershipHash(token);
    return this.mutate(p.ownerId, async (d) => {
      const actor = await this.administrator(subject);
      const s = d.sources.find((s) => s.id === id);
      if (!s || s.revision !== revision)
        throw new DomainError("CONNECTION_CONFLICT");
      if (s.allowAdmins && actor.role !== "owner")
        throw new DomainError("COMPANY_FORBIDDEN");
      Object.assign(s, { active, tokenHash, revision: s.revision + 1 });
      this.audit(
        d,
        subject,
        id,
        id,
        active ? "source_rotated" : "source_revoked",
      );
      return { source: s, ...(active ? { token: `${id}.${token}` } : {}) };
    });
  }
  async authenticate(token: string) {
    if (!this.enabled || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token))
      throw new DomainError("AUTH_REQUIRED");
    const [id, secret] = token.split(".");
    const owner = await this.owner();
    const source = (await this.directory(owner)).sources.find(
      (s) => s.id === id,
    );
    if (
      !source?.active ||
      source.tokenHash !== (await membershipHash(secret ?? ""))
    )
      throw new DomainError("AUTH_REQUIRED");
    return { owner, source };
  }
  async provision(
    token: string,
    externalId: string,
    input: MembershipInput,
    revision: number | null,
    key: string,
  ) {
    z.string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .parse(externalId);
    z.string().uuid().parse(key);
    z.number().int().positive().safe().nullable().parse(revision);
    const { owner, source } = await this.authenticate(token);
    const value = membershipInput.parse(input);
    await this.companies(owner, value);
    const hash = await membershipHash(
      JSON.stringify([externalId, value, revision]),
    );
    return this.mutate(owner, (d) => {
      const s = d.sources.find((s) => s.id === source.id);
      if (!s?.active || s.tokenHash !== source.tokenHash)
        throw new DomainError("AUTH_REQUIRED");
      const prior = d.operations.find(
        (o) => o.source === s.id && o.key === key,
      );
      if (prior) {
        if (prior.hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT");
        return prior.result as Membership;
      }
      if (
        (value.role === "admin" && !s.allowAdmins) ||
        Object.keys(value.companies).some((id) => !s.companies.includes(id))
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      const old = d.members.find(
        (m) => m.source === s.id && m.externalId === externalId,
      );
      if (
        (old?.revision ?? null) !== revision ||
        d.members.some((m) => m.id !== old?.id && m.email === value.email)
      )
        throw new DomainError("CONNECTION_CONFLICT");
      if (old?.userId && old.email !== value.email)
        throw new DomainError("VALIDATION_FAILED");
      const member: Membership =
        old && sameMembership(old, value)
          ? old
          : {
              ...value,
              id: old?.id ?? crypto.randomUUID(),
              userId: old?.userId ?? null,
              source: s.id,
              externalId,
              revision: (old?.revision ?? 0) + 1,
              blocked: old?.blocked ?? false,
            };
      d.members = d.members.filter((m) => m.id !== member.id).concat(member);
      d.operations.push({
        source: s.id,
        key,
        hash,
        expires: this.now() + 86400000,
        result: member,
      });
      this.audit(d, s.id, s.id, member.id, "provision");
      return member;
    });
  }
  async invite(subject: string, id: string, revision: number) {
    const p = await this.administrator(subject);
    return this.issueInvitation(p.ownerId, id, revision, subject, "local");
  }
  async issueInvitation(
    owner: string,
    id: string,
    revision: number,
    actor: string,
    source: string,
    operation?: {
      key: string;
      hash: string;
      sourceHash: string;
      seal: (value: unknown) => Promise<unknown>;
    },
  ) {
    const token = membershipSecret();
    const hash = await membershipHash(token);
    return this.mutate(owner, async (d) => {
      if (source === "local") await this.administrator(actor);
      if (operation) {
        const activeSource = d.sources.find((s) => s.id === source);
        if (
          !activeSource?.active ||
          activeSource.tokenHash !== operation.sourceHash
        )
          throw new DomainError("AUTH_REQUIRED");
        const prior = d.operations.find(
          (o) => o.source === source && o.key === operation.key,
        );
        if (prior) {
          if (prior.hash !== operation.hash)
            throw new DomainError("IDEMPOTENCY_CONFLICT");
          return { encrypted: prior.result };
        }
      }
      const m = d.members.find((m) => m.id === id);
      if (
        !m ||
        m.revision !== revision ||
        m.userId ||
        !m.active ||
        m.blocked ||
        (source !== "local" && m.source !== source)
      )
        throw new DomainError("CONNECTION_CONFLICT");
      const expiresAt = this.now() + 86400000;
      m.invitation = { hash, expiresAt };
      m.revision++;
      this.audit(d, actor, source, id, "invite");
      const result = { id, token, expiresAt, revision: m.revision };
      if (operation) {
        const encrypted = await operation.seal(result);
        d.operations.push({
          source,
          key: operation.key,
          hash: operation.hash,
          expires: expiresAt,
          result: encrypted,
        });
        return { encrypted };
      }
      return result;
    });
  }
  async claimInvitation(id: string, token: string) {
    const owner = await this.owner();
    const hash = await membershipHash(token);
    return this.mutate(owner, (d) => {
      const m = d.members.find((m) => m.id === id);
      if (
        !m?.invitation ||
        m.invitation.hash !== hash ||
        m.invitation.expiresAt <= this.now() ||
        m.invitation.claim ||
        m.userId ||
        !m.active ||
        m.blocked
      )
        throw new DomainError("AUTH_REQUIRED");
      m.invitation.claim = crypto.randomUUID();
      return { ...m, invitation: { ...m.invitation } };
    });
  }
  async finishInvitation(id: string, claim: string, userId: string) {
    const owner = await this.owner();
    return this.mutate(owner, (d) => {
      const m = d.members.find((m) => m.id === id);
      if (
        !m?.invitation ||
        m.invitation.claim !== claim ||
        m.invitation.expiresAt <= this.now() ||
        !m.active ||
        m.blocked ||
        userId === owner ||
        d.members.some((v) => v.userId === userId)
      )
        throw new DomainError("AUTH_REQUIRED");
      m.userId = userId;
      m.revision++;
      delete m.invitation;
      this.audit(d, userId, m.source, id, "activate");
      return m;
    });
  }
  async maintenance(owner: string, mode: "cleanup" | "rotation" | "restore") {
    if (!(await this.state.get("memberships", owner))) return;
    await this.mutate(owner, (d) => {
      for (const m of d.members) {
        if (
          mode !== "cleanup" ||
          (m.invitation?.expiresAt ?? Infinity) <= this.now()
        )
          delete m.invitation;
        if (mode === "restore") {
          m.blocked = true;
          m.revision++;
        }
      }
      if (mode !== "cleanup") d.operations = [];
      if (mode === "restore")
        for (const source of d.sources) {
          source.active = false;
          source.tokenHash = "";
          source.revision++;
        }
      if (mode !== "cleanup") this.audit(d, "operator", "local", owner, mode);
    });
  }
}
