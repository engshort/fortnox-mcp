import {
  type Connection,
  type Connections,
  DomainError,
  programId,
  programStatus,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { companyInformation, type FortnoxConnections } from "./connections.js";
import { FortnoxHttp, ProviderError } from "./http.js";

export const diagnosisInput = z
  .object({ company_id: z.string().uuid() })
  .strict();
const status = z.enum([
  "available",
  "disconnected",
  "missing_permission",
  "upstream_error",
  "not_implemented",
  "verification_blocked",
  "unknown",
]);
export const diagnosisOutput = z
  .object({
    company_id: z.string().uuid(),
    status,
    reason: z.enum([
      "connection_disconnected",
      "reconnect_required",
      "missing_scope",
      "provider_unavailable",
      "provider_rate_limited",
      "permission_or_license_unknown",
      "verification_pending",
      "bounded_read_verified",
      "feature_not_implemented",
      "provider_access_not_checked",
    ]),
    correlation_id: z.string().uuid(),
    checked_at: z.string().datetime(),
    programs: z.array(
      z
        .object({
          id: programId,
          selected: z.boolean(),
          connection: z.enum([
            "connected",
            "not_connected",
            "disconnected",
            "reconnect_required",
          ]),
          availability: z.enum([
            "available",
            "planned",
            "verification_pending",
          ]),
        })
        .strict(),
    ),
    capabilities: z.array(
      z
        .object({
          id: z.enum([
            "company_information",
            "manual_vouchers",
            "provider_files",
            "payroll",
          ]),
          status,
          reason: z.enum([
            "bounded_read_verified",
            "verification_pending",
            "feature_not_implemented",
            "provider_access_not_checked",
          ]),
        })
        .strict(),
    ),
  })
  .strict();
export type ConnectionDiagnosis = z.infer<typeof diagnosisOutput>;

// The caller supplies the same server-side authorization used by its entry point.
// No company data, credential, raw provider body or guessed license diagnosis leaves here.
export async function diagnoseConnection(
  context: {
    owner: string;
    connections: Connections;
    provider: FortnoxConnections;
    testMode: boolean;
    authorize: (company: string) => Promise<Connection>;
  },
  company: string,
): Promise<ConnectionDiagnosis> {
  diagnosisInput.parse({ company_id: company });
  const result: ConnectionDiagnosis = {
    company_id: company,
    status: "verification_blocked",
    reason: "verification_pending",
    correlation_id: crypto.randomUUID(),
    checked_at: new Date().toISOString(),
    programs: [],
    capabilities: [
      {
        id: "company_information",
        status: "verification_blocked",
        reason: "verification_pending",
      },
      {
        id: "manual_vouchers",
        status: "unknown",
        reason: "provider_access_not_checked",
      },
      {
        id: "provider_files",
        status: "unknown",
        reason: "provider_access_not_checked",
      },
      {
        id: "payroll",
        status: "unknown",
        reason: "provider_access_not_checked",
      },
    ],
  };
  try {
    const c = await context.authorize(company);
    result.programs = programStatus(c, {
      references: false,
      receiptConsent: false,
    }).programs.map(({ id, selected, connection, availability }) => ({
      id,
      selected,
      connection,
      availability,
    }));
    if (c.state !== "active") {
      result.status = "disconnected";
      result.reason =
        c.state === "disconnected"
          ? "connection_disconnected"
          : "reconnect_required";
    } else if (!c.scopes.includes("companyinformation")) {
      result.status = "missing_permission";
      result.reason = "missing_scope";
    } else {
      const assertActive = async () => {
        const current = await context.authorize(company);
        if (current.state !== "active" || current.generation !== c.generation)
          throw new DomainError("CONNECTION_DISCONNECTED");
      };
      const http = new FortnoxHttp({
        fetch: context.provider.config.fetch,
        state: context.connections.state,
      });
      const raw = await http.read(
        {
          owner: context.owner,
          company: c.id,
          generation: c.generation,
          tenant: c.tenant,
          clientId: (await context.connections.credentials(context.owner, c))
            .clientId,
          assertActive,
          token: (force) => context.provider.token(context.owner, c, force),
        },
        "company_information",
      );
      const parsed = companyInformation.safeParse(raw);
      if (!parsed.success)
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_schema");
      if (String(parsed.data.CompanyInformation.DatabaseNumber) !== c.tenant)
        throw new DomainError("COMPANY_FORBIDDEN");
      await assertActive();
      result.status = "available";
      result.reason = "bounded_read_verified";
      result.capabilities[0] = {
        id: "company_information",
        status: "available",
        reason: "bounded_read_verified",
      };
    }
  } catch (error) {
    if (
      error instanceof DomainError &&
      ["CONNECTION_DISCONNECTED", "RECONNECT_REQUIRED"].includes(error.code)
    ) {
      result.status = "disconnected";
      result.reason =
        error.code === "CONNECTION_DISCONNECTED"
          ? "connection_disconnected"
          : "reconnect_required";
    } else if (error instanceof ProviderError) {
      result.status =
        error.code === "CAPABILITY_UNAVAILABLE" ? "unknown" : "upstream_error";
      result.reason =
        error.code === "CAPABILITY_UNAVAILABLE"
          ? "permission_or_license_unknown"
          : error.code === "RATE_LIMITED"
            ? "provider_rate_limited"
            : "provider_unavailable";
    } else throw error;
  }
  return diagnosisOutput.parse(result);
}
