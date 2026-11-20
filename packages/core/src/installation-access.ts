import { z } from "zod";
import { DomainError } from "./errors.js";
import type { StateStore } from "./ports.js";

export const agencyProfile = "agency_finance_v1" as const;
export const agencyScopes = [
  "companyinformation",
  "profile",
  "bookkeeping",
  "settings",
  "costcenter",
  "project",
  "invoice",
  "supplierinvoice",
] as const;
export const agencySelection = {
  revision: 1,
  enabled: ["bookkeeping", "invoicing"] as ("bookkeeping" | "invoicing")[],
  features: [
    "references",
    "financial-analysis",
    "sales-invoices",
    "supplier-invoices",
  ] as (
    | "references"
    | "financial-analysis"
    | "sales-invoices"
    | "supplier-invoices"
  )[],
};
export const officeContactSources = [
  "customer-register",
  "payroll",
  "integration-users",
] as const;
export const officeContactConsent = z
  .object({
    company_id: z.string().uuid(),
    sources: z.array(z.enum(officeContactSources)).min(1).max(3),
    generation: z.number().int().positive(),
    access_revision: z.number().int().nonnegative(),
  })
  .strict();
export const officeContactConsents = z.array(officeContactConsent).max(20);
export const installationScopes = (writes: boolean, contacts = false) => [
  "api:read",
  "api:finance:read",
  "api:bridge",
  ...(writes ? ["api:write"] : []),
  ...(contacts ? ["api:office:contacts:read"] : []),
];
const entry = z
  .object({
    id: z.string().uuid(),
    clientId: z.string().min(1).max(256),
    name: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    active: z.boolean(),
    writes: z.boolean(),
    officeContacts: officeContactConsents.optional(),
    profile: z.literal(agencyProfile),
    onboardingClientId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type InstallationGrant = z.infer<typeof entry>;
const directory = z.array(entry).max(16);
export const installationReference = (g: InstallationGrant) =>
  `installation-grant:${g.id}:${g.revision}`;

// Separate from browser subjects, OAuth approvals and refresh-token families.
// A single bounded CAS directory makes revocation and replacement authoritative.
export class InstallationAccess {
  constructor(
    readonly state: StateStore,
    readonly enabled = false,
  ) {}
  async list(owner: string) {
    return directory.parse(
      (await this.state.get("installation-access-v1", owner))?.value ?? [],
    );
  }
  async save(owner: string, value: InstallationGrant, expected: number | null) {
    if (!this.enabled && value.active)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    value = entry.parse(value);
    for (let n = 0; n < 8; n++) {
      const row = await this.state.get("installation-access-v1", owner);
      const entries = directory.parse(row?.value ?? []);
      const previous = entries.find((g) => g.id === value.id);
      if (
        (previous?.revision ?? null) !== expected ||
        value.revision !== (expected ?? 0) + 1 ||
        entries.some(
          (g) =>
            g.id !== value.id &&
            (g.clientId === value.clientId ||
              (value.active &&
                value.onboardingClientId &&
                g.active &&
                g.onboardingClientId === value.onboardingClientId)),
        )
      )
        throw new DomainError("CONNECTION_CONFLICT");
      if (previous && previous.clientId !== value.clientId)
        throw new DomainError("COMPANY_FORBIDDEN");
      const next = directory.parse([
        ...entries.filter((g) => g.id !== value.id),
        value,
      ]);
      if (
        await this.state.put(
          "installation-access-v1",
          owner,
          next,
          row?.version ?? null,
        )
      )
        return value;
    }
    throw new DomainError("CONNECTION_CONFLICT");
  }
  async authorize(owner: string, client: string, reference?: string) {
    if (!this.enabled) throw new DomainError("AUTH_REQUIRED");
    const grant = (await this.list(owner)).find(
      (g) => g.clientId === client && g.active,
    );
    if (
      !grant ||
      (reference !== undefined && installationReference(grant) !== reference)
    )
      throw new DomainError("AUTH_REQUIRED");
    return grant;
  }
  async profileFor(owner: string, client: string) {
    if (!this.enabled) return undefined;
    return (await this.list(owner)).find(
      (g) => g.active && g.onboardingClientId === client,
    )?.profile;
  }
}
