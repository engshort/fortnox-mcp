import {
  type Actor,
  type CompanyReadProvider,
  type Connections,
  DomainError,
  requirePermission,
} from "@fortnox-mcp/core";
import { companyInformation, type FortnoxConnections } from "./connections.js";
import { FortnoxHttp, ProviderError } from "./http.js";

export class FortnoxCompanyReads implements CompanyReadProvider {
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
  ) {}
  async profile(actor: Actor, company: string) {
    requirePermission(actor, "read");
    const c = await this.connections.authorizeActor(actor, company);
    if (!this.provider.config.testTenants.includes(c.tenant))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (!c.scopes.includes("companyinformation"))
      throw new ProviderError("CAPABILITY_UNAVAILABLE", "missing_scope");
    const active = async () => {
      const after = await this.connections.authorizeActor(actor, company);
      if (after.generation !== c.generation)
        throw new DomainError("COMPANY_FORBIDDEN");
    };
    const http = new FortnoxHttp({
      fetch: this.provider.config.fetch,
      state: this.connections.state,
    });
    const raw = await http.read(
      {
        owner: actor.ownerId,
        company,
        generation: c.generation,
        tenant: c.tenant,
        clientId: (await this.connections.credentials(actor.ownerId, c))
          .clientId,
        assertActive: active,
        token: (force) => this.provider.token(actor.ownerId, c, force),
      },
      "company_information",
    );
    const parsed = companyInformation.safeParse(raw);
    if (!parsed.success)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invalid_company_information_response",
      );
    const data = parsed.data.CompanyInformation;
    if (String(data.DatabaseNumber) !== c.tenant)
      throw new DomainError("COMPANY_FORBIDDEN");
    await active();
    return {
      name: data.CompanyName,
      organization_number: data.OrganizationNumber ?? "",
    };
  }
}
