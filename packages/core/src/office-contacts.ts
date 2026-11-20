import { z } from "zod";
import { type Actor, actorResource, hasPermission } from "./actor.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { officeContactSources } from "./installation-access.js";
import { assertScopeProgram } from "./programs.js";

export const officeContactSource = z.enum(officeContactSources);
export type OfficeContactSource = z.infer<typeof officeContactSource>;
export const officeContactRecord = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().trim().min(1).max(1024),
    email: z.string().trim().max(320).nullable(),
  })
  .strict();
export type OfficeContactRecord = z.infer<typeof officeContactRecord>;
export const officeContactsOutput = z
  .object({
    status: z.literal("ok"),
    company_id: z.string().uuid(),
    data: z
      .object({ records: z.array(officeContactRecord).max(1000) })
      .strict(),
    evidence: z.object({ complete: z.boolean() }).strict(),
    continuation: z.string().uuid().nullable(),
  })
  .strict();
export const officeContactsQuery = (source: OfficeContactSource) =>
  source === "customer-register"
    ? z.object({ organisation_number: z.string().regex(/^\d{10}$/) }).strict()
    : z.object({ continuation: z.string().uuid().optional() }).strict();
export interface OfficeContactsProvider {
  read(
    actor: Actor,
    company: string,
    source: OfficeContactSource,
    organisation: string | undefined,
    page: number,
    assertCurrent: () => Promise<void>,
  ): Promise<{ records: OfficeContactRecord[]; next: number | null }>;
}
interface Cursor {
  binding: string;
  next: number;
  expiresAt: number;
}
export class OfficeContacts {
  constructor(
    readonly connections: Connections,
    readonly provider: OfficeContactsProvider,
    readonly enabled: boolean,
    readonly now = Date.now,
  ) {}
  async authorize(actor: Actor, company: string, source: OfficeContactSource) {
    if (!this.enabled) throw new DomainError("RESOURCE_NOT_FOUND");
    if (
      actorResource(actor) !== "api" ||
      !actor.installationGrant ||
      !actor.oauthClientId ||
      !hasPermission(actor, "read") ||
      !hasPermission(actor, "office_contacts_read")
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const c = await this.connections.authorizeActor(actor, company);
    const grant = await this.connections.installationAccess.authorize(
      actor.ownerId,
      actor.oauthClientId,
      actor.installationGrant,
    );
    const consent = grant.officeContacts?.find((v) => v.company_id === company);
    if (
      !consent?.sources.includes(source) ||
      consent.generation !== c.generation ||
      consent.access_revision !== (c.accessRevision ?? 0)
    )
      throw new DomainError("OFFICE_CONTACTS_CONSENT_REQUIRED");
    if (source !== "integration-users") {
      const scope = source === "payroll" ? "salary" : "customer";
      if (!c.scopes.includes(scope))
        throw new DomainError("OFFICE_CONTACTS_SOURCE_UNAVAILABLE");
      try {
        assertScopeProgram(c, scope);
      } catch {
        throw new DomainError("OFFICE_CONTACTS_SOURCE_UNAVAILABLE");
      }
    }
    return c;
  }
  async read(
    actor: Actor,
    company: string,
    source: OfficeContactSource,
    input: unknown,
  ) {
    z.string().uuid().parse(company);
    const query = officeContactsQuery(source).parse(input);
    const c = await this.authorize(actor, company, source);
    const binding = JSON.stringify([
      actor.ownerId,
      actor.oauthClientId,
      actor.clientId,
      actorResource(actor),
      company,
      c.generation,
      c.accessRevision ?? 0,
      source,
    ]);
    const assertCurrent = async () => {
      const current = await this.authorize(actor, company, source);
      if (
        current.generation !== c.generation ||
        current.accessRevision !== c.accessRevision ||
        current.tenant !== c.tenant
      )
        throw new DomainError("COMPANY_FORBIDDEN");
    };
    let page = 1;
    if ("continuation" in query && query.continuation) {
      const cursor = (
        await this.connections.state.get<Record<string, Cursor>>(
          "office-contact-continuations-v1",
          actor.ownerId,
        )
      )?.value[query.continuation];
      if (
        !cursor ||
        cursor.binding !== binding ||
        cursor.expiresAt <= this.now()
      )
        throw new DomainError("OFFICE_CONTACTS_INVALID_CONTINUATION");
      page = cursor.next;
    }
    const result = await this.provider.read(
      actor,
      company,
      source,
      "organisation_number" in query ? query.organisation_number : undefined,
      page,
      assertCurrent,
    );
    await assertCurrent();
    let continuation: string | null = null;
    if (result.next !== null) {
      if (
        !Number.isSafeInteger(result.next) ||
        result.next <= page ||
        result.next > 10000
      )
        throw new DomainError("OFFICE_CONTACTS_INVALID_RESPONSE");
      for (let attempt = 0; attempt < 8; attempt++) {
        const row = await this.connections.state.get<Record<string, Cursor>>(
          "office-contact-continuations-v1",
          actor.ownerId,
        );
        const live = Object.fromEntries(
          Object.entries(row?.value ?? {}).filter(
            ([, v]) => v.expiresAt > this.now(),
          ),
        );
        if (Object.keys(live).length >= 32)
          throw new DomainError("RATE_LIMITED");
        const id = crypto.randomUUID();
        live[id] = {
          binding,
          next: result.next,
          expiresAt: this.now() + 600000,
        };
        if (
          await this.connections.state.put(
            "office-contact-continuations-v1",
            actor.ownerId,
            live,
            row?.version ?? null,
          )
        ) {
          continuation = id;
          break;
        }
      }
      if (!continuation) throw new DomainError("RATE_LIMITED");
    }
    const output = officeContactsOutput.safeParse({
      status: "ok",
      company_id: company,
      data: { records: result.records },
      evidence: { complete: continuation === null },
      continuation,
    });
    if (!output.success)
      throw new DomainError("OFFICE_CONTACTS_INVALID_RESPONSE");
    return output.data;
  }
}
