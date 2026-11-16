import { type Actor, requirePermission } from "./actor.js";
import type { Bookkeeping } from "./bookkeeping.js";
import type { Connection, Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import type { FinancialReads } from "./financial-reads.js";
import { assertFeature, assertScopeProgram } from "./programs.js";
import {
  type ReadDefinition,
  type ReadOperation,
  readDefinitions,
  readOperationNames,
  readOutput,
} from "./read-contracts.js";

export interface CompanyReadProvider {
  profile(
    actor: Actor,
    company: string,
  ): Promise<{ name: string; organization_number: string }>;
}
export const describeCompany = (c: Connection) => ({
  company_id: c.id,
  name: c.name,
  state: c.state,
  mode: c.mode,
  read_only: c.readOnly,
  manual_vouchers: c.review,
});
export class CompanyReads {
  constructor(
    readonly connections: Connections,
    readonly provider: CompanyReadProvider,
    readonly profiles: boolean,
  ) {}
  async companies(actor: Actor) {
    requirePermission(actor, "read");
    const companies = [];
    for (const c of await this.connections.list(actor.ownerId)) {
      try {
        await this.connections.authorizeActor(actor, c.id, false);
        companies.push(describeCompany(c));
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          !["COMPANY_FORBIDDEN", "CONNECTION_DISCONNECTED"].includes(error.code)
        )
          throw error;
      }
    }
    return { companies, count: companies.length };
  }
  async status(actor: Actor, company: string) {
    requirePermission(actor, "read");
    return describeCompany(
      await this.connections.authorizeActor(actor, company, false),
    );
  }
  async profile(actor: Actor, company: string) {
    requirePermission(actor, "read");
    const before = await this.connections.authorizeActor(actor, company);
    if (!this.profiles) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const result = await this.provider.profile(actor, company);
    const after = await this.connections.authorizeActor(actor, company);
    if (before.generation !== after.generation)
      throw new DomainError("COMPANY_FORBIDDEN");
    return result;
  }
}
export class ReadServices {
  constructor(
    readonly companies: CompanyReads,
    readonly bookkeeping: Bookkeeping,
    readonly financial: FinancialReads,
  ) {}
  async available(actor: Actor) {
    requirePermission(actor, "read");
    const granted: Connection[] = [];
    for (const c of await this.companies.connections.list(actor.ownerId)) {
      try {
        granted.push(
          await this.companies.connections.authorizeActor(actor, c.id),
        );
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          ![
            "COMPANY_FORBIDDEN",
            "CONNECTION_DISCONNECTED",
            "RECONNECT_REQUIRED",
          ].includes(error.code)
        )
          throw error;
      }
    }
    return readOperationNames.filter((operation) => {
      const d: ReadDefinition = readDefinitions[operation];
      if (operation === "get_company_profile" && !this.companies.profiles)
        return false;
      if (
        ["list_financial_years", "get_accounting_references"].includes(
          operation,
        ) &&
        !this.bookkeeping.gates.references
      )
        return false;
      if (d.module && !this.financial.available(actor, operation)) return false;
      const scopes =
        operation === "get_accounting_references"
          ? ["bookkeeping", "settings", "costcenter", "project"]
          : d.scope
            ? [d.scope]
            : [];
      return (
        scopes.length === 0 ||
        granted.some((c) => {
          try {
            for (const scope of scopes) assertScopeProgram(c, scope);
            if (
              ["accounts", "vouchers"].includes(d.module ?? "") ||
              ["list_financial_years", "get_accounting_references"].includes(
                operation,
              )
            )
              assertFeature(c, "references");
            return scopes.every((scope) => c.scopes.includes(scope));
          } catch (error) {
            if (
              error instanceof DomainError &&
              error.code === "CAPABILITY_UNAVAILABLE"
            )
              return false;
            throw error;
          }
        })
      );
    });
  }
  async execute(actor: Actor, operation: ReadOperation, input: unknown) {
    requirePermission(actor, "read");
    const d: ReadDefinition = readDefinitions[operation];
    if (d.module) return this.financial.read(actor, operation, input);
    const parsed = d.input.parse(input) as {
      company_id?: string;
      financial_year?: number;
      account_numbers?: number[];
    };
    const started = new Date().toISOString();
    let data: unknown;
    let complete = true;
    const sources: string[] = [];
    switch (operation) {
      case "get_capabilities":
        data = { operations: await this.available(actor) };
        break;
      case "list_companies":
        data = await this.companies.companies(actor);
        break;
      case "get_connection_status":
        data = await this.companies.status(actor, parsed.company_id ?? "");
        break;
      case "get_company_profile":
        data = await this.companies.profile(actor, parsed.company_id ?? "");
        sources.push("Fortnox GET /3/companyinformation");
        break;
      case "list_financial_years": {
        const result = await this.bookkeeping.years(
          actor,
          parsed.company_id ?? "",
        );
        data = result;
        complete = result.complete;
        sources.push("Fortnox GET /3/financialyears");
        break;
      }
      case "get_accounting_references": {
        const result = await this.bookkeeping.references(
          actor,
          parsed.company_id ?? "",
          parsed.financial_year ?? 0,
          parsed.account_numbers,
        );
        data = result;
        complete = result.complete;
        sources.push("Fortnox accounting references");
        break;
      }
      default:
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    }
    const result = readOutput(d.data).safeParse({
      status: "ok",
      ...(parsed.company_id ? { company_id: parsed.company_id } : {}),
      data,
      evidence: {
        retrieved_at: new Date().toISOString(),
        retrieval_started_at: started,
        complete,
        sources,
        warnings: sources.length
          ? ["Experimental provider reads; live acceptance remains scoped."]
          : [],
      },
      continuation: null,
    });
    if (!result.success) throw new DomainError("UPSTREAM_UNAVAILABLE");
    return result.data;
  }
}
