import {
  type Actor,
  type Connections,
  DomainError,
  type OfficeContactRecord,
  type OfficeContactSource,
  type OfficeContactsProvider,
  officeContactRecord,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { type ProviderContext, ProviderError } from "./http.js";

// Operator-verified published integration binding, never supplied by an API caller.
export const officeDeveloperBinding = z
  .object({
    company_id: z.string().uuid(),
    generation: z.number().int().positive(),
    provider_client_id: z.string().min(5).max(128),
    integration_id: z.string().regex(/^[1-9]\d{0,18}$/),
  })
  .strict();
export type OfficeDeveloperBinding = z.infer<typeof officeDeveloperBinding>;
const text = z.string().max(1024).nullish();
const id = z.string().min(1).max(256);
const metadata = z.object({
  "@CurrentPage": z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform(Number),
  "@TotalPages": z
    .union([z.string().regex(/^\d+$/), z.number().int()])
    .transform(Number),
});
function nextPage(raw: unknown, page: number, count: number) {
  const parsed = metadata.safeParse(raw);
  if (!parsed.success)
    throw new DomainError(
      raw === undefined
        ? "OFFICE_CONTACTS_INCOMPLETE"
        : "OFFICE_CONTACTS_INVALID_RESPONSE",
    );
  const current = parsed.data["@CurrentPage"],
    total = parsed.data["@TotalPages"];
  if (
    total === 0 &&
    count === 0 &&
    page === 1 &&
    (current === 0 || current === 1)
  )
    return null;
  if (current !== page || total < page || total > 10000)
    throw new DomainError("OFFICE_CONTACTS_INVALID_RESPONSE");
  return total === page ? null : page + 1;
}
function organisation(value: string | null | undefined) {
  const normalized = value?.replace(/[\s-]/g, "");
  return normalized && /^\d{10}$/.test(normalized) ? normalized : null;
}
function record(value: unknown) {
  const parsed = officeContactRecord.safeParse(value);
  if (!parsed.success)
    throw new DomainError("OFFICE_CONTACTS_INVALID_RESPONSE");
  return parsed.data;
}
function email(value: string | null | undefined) {
  return value?.trim() || null;
}
export class FortnoxOfficeContacts implements OfficeContactsProvider {
  readonly http: DocumentHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly developer?: OfficeDeveloperBinding,
    readonly now = Date.now,
  ) {
    this.http = new DocumentHttp(connections, provider, [], () => true, now);
    if (developer) officeDeveloperBinding.parse(developer);
  }
  private async context(
    actor: Actor,
    company: string,
    assertCurrent: () => Promise<void>,
  ): Promise<ProviderContext> {
    const c = await this.connections.authorizeActor(actor, company);
    if (!this.provider.allowsTenant(c.tenant))
      throw new DomainError("COMPANY_FORBIDDEN");
    return {
      owner: actor.ownerId,
      company,
      tenant: c.tenant,
      generation: c.generation,
      clientId: (await this.connections.credentials(actor.ownerId, c)).clientId,
      token: (force) => this.provider.token(actor.ownerId, c, force),
      assertActive: assertCurrent,
    };
  }
  async read(
    actor: Actor,
    company: string,
    source: OfficeContactSource,
    org: string | undefined,
    page: number,
    assertCurrent: () => Promise<void>,
  ) {
    try {
      const context = await this.context(actor, company, assertCurrent);
      if (source === "customer-register")
        return await this.customers(context, org ?? "");
      if (source === "payroll") return await this.payroll(context, page);
      return await this.users(actor, context, page, assertCurrent);
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new DomainError("OFFICE_CONTACTS_INVALID_RESPONSE");
      if (
        error instanceof ProviderError &&
        (error.code === "CAPABILITY_UNAVAILABLE" ||
          (source === "integration-users" &&
            error.reason === "record_not_found"))
      )
        throw new DomainError("OFFICE_CONTACTS_SOURCE_UNAVAILABLE");
      throw error;
    }
  }
  private async customers(context: ProviderContext, org: string) {
    const until = this.now() + 15000;
    const matches = new Set<string>();
    // Inspect every filtered page before declaring uniqueness. No contact payload
    // is retained between public requests or before this search completes.
    for (let page = 1; page <= 5; page++) {
      const url = new URL("https://api.fortnox.se/3/customers");
      url.search = new URLSearchParams({
        organisationnumber: org,
        page: String(page),
        limit: "100",
      }).toString();
      const raw = await this.http.read(context, url, until);
      const rows = z
        .array(z.object({ CustomerNumber: id, OrganisationNumber: text }))
        .max(100)
        .parse(raw.Customers);
      for (const row of rows)
        if (organisation(row.OrganisationNumber) === org)
          matches.add(row.CustomerNumber);
      if (matches.size > 1)
        throw new DomainError("OFFICE_CONTACTS_AMBIGUOUS_CUSTOMER");
      const next = nextPage(raw.MetaInformation, page, rows.length);
      if (next !== null) continue;
      const number = [...matches][0];
      if (!number) return { records: [], next: null };
      const detail = await this.http.read(
        context,
        new URL(
          `https://api.fortnox.se/3/customers/${encodeURIComponent(number)}`,
        ),
        until,
      );
      const c = z
        .object({
          CustomerNumber: id,
          OrganisationNumber: text,
          Active: z.boolean(),
          YourReference: text,
          Email: text,
        })
        .parse(detail.Customer);
      if (
        c.CustomerNumber !== number ||
        organisation(c.OrganisationNumber) !== org
      )
        throw new DomainError("OFFICE_CONTACTS_INVALID_RESPONSE");
      const records =
        c.Active && c.YourReference?.trim()
          ? [
              record({
                id: c.CustomerNumber,
                name: c.YourReference.trim(),
                email: email(c.Email),
              }),
            ]
          : [];
      return { records, next: null };
    }
    throw new DomainError("OFFICE_CONTACTS_INCOMPLETE");
  }
  private async payroll(context: ProviderContext, page: number) {
    const url = new URL("https://api.fortnox.se/3/employees");
    url.search = new URLSearchParams({
      page: String(page),
      limit: "100",
    }).toString();
    const raw = await this.http.read(context, url);
    const rows = z
      .array(
        z.object({
          EmployeeId: id,
          Inactive: z.boolean(),
          FullName: text,
          FirstName: text,
          LastName: text,
          Email: text,
        }),
      )
      .max(100)
      .parse(raw.Employees);
    const records: OfficeContactRecord[] = [];
    for (const row of rows)
      if (!row.Inactive)
        records.push(
          record({
            id: row.EmployeeId,
            name:
              row.FullName?.trim() ||
              [row.FirstName?.trim(), row.LastName?.trim()]
                .filter(Boolean)
                .join(" "),
            email: email(row.Email),
          }),
        );
    return { records, next: nextPage(raw.MetaInformation, page, rows.length) };
  }
  private async users(
    actor: Actor,
    target: ProviderContext,
    page: number,
    assertCurrent: () => Promise<void>,
  ) {
    const binding = this.developer;
    if (!binding) throw new DomainError("OFFICE_CONTACTS_SOURCE_UNAVAILABLE");
    // The Developer API credential belongs to a verified developer-company
    // connection. It is never borrowed from an unrelated tenant or client.
    const dev = (await this.connections.list(actor.ownerId)).find(
      (c) => c.id === binding.company_id,
    );
    const check = async () => {
      await assertCurrent();
      const current = (await this.connections.list(actor.ownerId)).find(
        (c) => c.id === binding.company_id,
      );
      if (
        !dev ||
        current?.state !== "active" ||
        current.generation !== binding.generation ||
        current.tenant !== dev.tenant ||
        !current.scopes.includes("developerapi") ||
        !this.provider.allowsTenant(current.tenant) ||
        (await this.connections.credentials(actor.ownerId, current))
          .clientId !== binding.provider_client_id ||
        target.clientId !== binding.provider_client_id
      )
        throw new DomainError("OFFICE_CONTACTS_SOURCE_UNAVAILABLE");
    };
    await check();
    if (!dev) throw new DomainError("OFFICE_CONTACTS_SOURCE_UNAVAILABLE");
    if (page !== 1)
      throw new DomainError("OFFICE_CONTACTS_INVALID_CONTINUATION");
    const context: ProviderContext = {
      ...target,
      company: dev.id,
      tenant: dev.tenant,
      generation: dev.generation,
      assertActive: check,
      token: (force) => this.provider.token(actor.ownerId, dev, force),
    };
    // users-v1 has an array envelope and no documented paging parameters.
    // DocumentHttp's bounded authenticated transport also handles arrays here.
    const raw = await this.http.readArray(
      context,
      new URL(
        `https://api.fortnox.se/api/integration-developer/users/users-v1/${binding.integration_id}/${target.tenant}`,
      ),
    );
    const rows = z
      .array(
        z.object({
          externalSourceId: id,
          name: z.string().max(1024),
          email: text,
        }),
      )
      .max(1000)
      .parse(raw);
    await check();
    return {
      records: rows.map((v) =>
        record({ id: v.externalSourceId, name: v.name, email: email(v.email) }),
      ),
      next: null,
    };
  }
}
