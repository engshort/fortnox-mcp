import { z } from "zod";
import type { Connection } from "./connections.js";
import { DomainError } from "./errors.js";

export const programId = z.enum([
  "bookkeeping",
  "invoicing",
  "order-offer",
  "payroll",
]);
export type ProgramId = z.infer<typeof programId>;
export const featureId = z.enum([
  "references",
  "receipt-files",
  "customer-registers",
  "supplier-registers",
  "payroll-input",
  "financial-analysis",
  "sales-invoices",
  "sales-orders",
  "supplier-invoices",
]);
export type FeatureId = z.infer<typeof featureId>;
export const baseScopes = ["companyinformation", "profile"] as const;
export const featureLabels = {
  "financial-analysis": {
    sv: "Saldon och bokförda transaktioner per datum",
    en: "Dated balances and ledger transactions",
  },
  "sales-invoices": { sv: "Kundfakturor", en: "Customer invoices" },
  "sales-orders": { sv: "Offerter och order", en: "Quotes and orders" },
  "supplier-invoices": {
    sv: "Leverantörsfakturor (läsning)",
    en: "Supplier invoice reads",
  },
  references: {
    sv: "Räkenskapsår, konton och referenser",
    en: "Financial years, accounts and references",
  },
  "receipt-files": {
    sv: "Kvitton och filkopplingar",
    en: "Receipts and file connections",
  },
  "customer-registers": {
    sv: "Kunder, artiklar och nödvändiga referenser",
    en: "Customers, articles and required references",
  },
  "supplier-registers": {
    sv: "Leverantörer och nödvändiga referenser",
    en: "Suppliers and required references",
  },
  "payroll-input": {
    sv: "Löneunderlag och verifierade referenser",
    en: "Payroll input and verified references",
  },
} as const;
const programCapabilities = {
  bookkeeping: [
    {
      ...featureLabels["financial-analysis"],
      feature: "financial-analysis",
      implementation: "implemented_unverified",
    },
    {
      feature: "references",
      ...featureLabels.references,
      implementation: "implemented_unverified",
    },
    {
      feature: "supplier-registers",
      ...featureLabels["supplier-registers"],
      implementation: "implemented_unverified",
    },
    {
      feature: "references",
      sv: "Manuella verifikationer",
      en: "Manual vouchers",
      implementation: "implemented_unverified",
    },
    {
      feature: "receipt-files",
      ...featureLabels["receipt-files"],
      implementation: "implemented_unverified",
    },
  ],
  invoicing: [
    {
      feature: "customer-registers",
      ...featureLabels["customer-registers"],
      implementation: "implemented_unverified",
    },
    {
      feature: "sales-invoices",
      sv: "Kundfakturor",
      en: "Customer invoices",
      implementation: "implemented_unverified",
    },
    {
      sv: "Bokföring av redan genomförda betalningar",
      en: "Recording payments already made",
      implementation: "not_implemented",
    },
  ],
  "order-offer": [
    {
      feature: "sales-orders",
      sv: "Offerter och order",
      en: "Quotes and orders",
      implementation: "implemented_unverified",
    },
  ],
  payroll: [
    {
      feature: "payroll-input",
      sv: "Löneunderlag",
      en: "Payroll input",
      implementation: "implemented_unverified",
    },
  ],
} as const;
export const programManifest = [
  {
    id: "bookkeeping",
    sv: "Bokföring",
    en: "Bookkeeping",
    scopes: ["bookkeeping"],
    implementation: "implemented_unverified",
    features: [
      "references",
      "receipt-files",
      "supplier-registers",
      "supplier-invoices",
      "financial-analysis",
    ],
  },
  {
    id: "invoicing",
    sv: "Fakturering",
    en: "Invoicing",
    scopes: ["invoice", "customer", "article"],
    implementation: "implemented_unverified",
    features: ["customer-registers", "sales-invoices"],
  },
  {
    id: "order-offer",
    sv: "Order & offert",
    en: "Orders & quotes",
    scopes: ["offer", "order"],
    implementation: "implemented_unverified",
    features: ["sales-orders"],
  },
  {
    id: "payroll",
    sv: "Lön",
    en: "Payroll",
    scopes: ["salary"],
    implementation: "implemented_unverified",
    features: ["payroll-input"],
  },
] as const;
export const featureManifest = {
  "financial-analysis": {
    scopes: ["bookkeeping"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "supplier-invoices": {
    scopes: ["supplierinvoice"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "sales-invoices": {
    scopes: ["invoice"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "sales-orders": {
    scopes: ["offer", "order"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "payroll-input": {
    scopes: ["salary"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  references: {
    scopes: ["bookkeeping", "settings", "costcenter", "project"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "customer-registers": {
    scopes: ["customer", "article"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "supplier-registers": {
    scopes: ["supplier"],
    dependsOn: [],
    implementation: "implemented_unverified",
  },
  "receipt-files": {
    scopes: ["inbox", "connectfile"],
    dependsOn: ["references"],
    implementation: "implemented_unverified",
  },
} as const;
export interface ProgramSelection {
  revision: number;
  enabled: ProgramId[];
  features: FeatureId[];
}
export interface ProgramGates {
  references: boolean;
  receiptConsent: boolean;
  registerScopes?: readonly string[];
  // Consent permits evidence collection only; payroll execution has its own gate.
  payrollConsent?: boolean;
}
// Older snapshots already have explicit provider consent. Derivation changes no
// credential, generation, grant or operation activation gate.
export function programSelection(
  c: Pick<Connection, "scopes" | "programs">,
): ProgramSelection {
  return (
    c.programs ?? {
      revision: 0,
      enabled: programManifest
        .filter(
          (p) =>
            p.scopes.some((s) => c.scopes.includes(s)) ||
            (p.id === "bookkeeping" && c.scopes.includes("supplier")),
        )
        .map((p) => p.id),
      features: (Object.keys(featureManifest) as FeatureId[]).filter((id) =>
        id === "references"
          ? c.scopes.includes("bookkeeping")
          : featureManifest[id].scopes.some((s) => c.scopes.includes(s)),
      ),
    }
  );
}
export function assertProgram(c: Connection, id: ProgramId) {
  if (!programSelection(c).enabled.includes(id))
    throw new DomainError("CAPABILITY_UNAVAILABLE");
}
export function assertFeature(c: Connection, id: FeatureId) {
  // Legacy snapshots retain their existing scope-based behavior until the owner
  // makes an explicit program selection. New selections never resurrect features.
  if (c.programs && !c.programs.features.includes(id))
    throw new DomainError("CAPABILITY_UNAVAILABLE");
}
export function assertScopeProgram(c: Connection, scope: string) {
  if (
    ["settings", "costcenter", "project", "currency", "price"].includes(scope)
  ) {
    if (
      !programSelection(c).enabled.some((p) =>
        ["bookkeeping", "invoicing", "order-offer"].includes(p),
      )
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return;
  }
  if (["supplier", "supplierinvoice", "inbox", "connectfile"].includes(scope)) {
    assertProgram(c, "bookkeeping");
    if (scope === "supplier") assertFeature(c, "supplier-registers");
    if (scope === "supplierinvoice") assertFeature(c, "supplier-invoices");
    if (
      ["inbox", "connectfile"].includes(scope) &&
      c.programs &&
      !c.programs.features.includes("receipt-files")
    )
      throw new DomainError("CAPABILITY_UNAVAILABLE");
  }
  if (["customer", "article"].includes(scope))
    assertFeature(c, "customer-registers");
  if (scope === "invoice") assertFeature(c, "sales-invoices");
  if (scope === "offer" || scope === "order") assertFeature(c, "sales-orders");
  for (const p of programManifest)
    if ((p.scopes as readonly string[]).includes(scope)) assertProgram(c, p.id);
}
function featureScopes(id: FeatureId, gates: ProgramGates): string[] {
  if (
    id === "financial-analysis" ||
    id === "sales-invoices" ||
    id === "sales-orders" ||
    id === "supplier-invoices"
  )
    return [...featureManifest[id].scopes];
  if (id === "payroll-input") return gates.payrollConsent ? ["salary"] : [];
  if (id === "references")
    return gates.references ? [...featureManifest.references.scopes] : [];
  if (id === "receipt-files")
    return gates.receiptConsent && gates.references
      ? [...featureManifest["receipt-files"].scopes]
      : [];
  const core =
    id === "customer-registers" ? ["customer", "article"] : ["supplier"];
  const allowed = gates.registerScopes ?? [];
  if (!core.some((s) => allowed.includes(s))) return [];
  return allowed.filter(
    (s) =>
      core.includes(s) ||
      ["settings", "currency", "price", "costcenter", "project"].includes(s),
  );
}
export const programChange = z
  .object({
    program: programId,
    features: z
      .array(featureId)
      .min(1)
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length),
    expected_revision: z.number().int().nonnegative().safe(),
  })
  .strict();
export type ProgramChange = z.infer<typeof programChange>;
export function assertNoUncertainWrites(c: Connection) {
  if (
    [
      ...(c.bookkeeping?.executions ?? []),
      ...(c.business?.executions ?? []),
    ].some((e) => ["submitting", "outcome_unknown"].includes(e.state)) ||
    (c.receiptBatches ?? []).some((b) =>
      b.items.some((i) =>
        Object.values(i.steps).some((s) =>
          ["submitting", "outcome_unknown"].includes(s.state),
        ),
      ),
    )
  )
    throw new DomainError("OUTCOME_UNKNOWN");
}
// An additive payroll consent need not erase or block reconciliation of a
// tenant-bound register/document outcome. In-flight writes, legacy unbound
// outcomes and bookkeeping/receipt/payroll uncertainty still prevent extension.
// This exception affects consent only; BusinessWrites still blocks new writes.
export function assertProgramConsentChange(
  c: Connection,
  input: ProgramChange,
  replaceConnection = true,
) {
  const selected = programSelection(c);
  const added = input.features.filter((id) => !selected.features.includes(id));
  if (
    input.program === "bookkeeping" &&
    selected.enabled.includes("bookkeeping") &&
    added.length > 0 &&
    added.every((id) =>
      ["financial-analysis", "supplier-invoices"].includes(id),
    )
  ) {
    const executions = [
      ...(c.bookkeeping?.executions ?? []),
      ...(c.business?.executions ?? []),
    ];
    if (
      executions.some((e) => e.state === "submitting") ||
      (c.receiptBatches ?? []).some((b) =>
        b.items.some((i) =>
          Object.values(i.steps).some((s) => s.state === "submitting"),
        ),
      )
    )
      throw new DomainError("OUTCOME_UNKNOWN");
    // Local read selection does not replace the connection or alter old intents.
    // Credential replacement additionally requires retained tenant provenance.
    if (
      replaceConnection &&
      ((c.bookkeeping?.executions ?? []).some(
        (e) => e.state === "outcome_unknown",
      ) ||
        (c.business?.executions ?? []).some(
          (e) => e.state === "outcome_unknown" && e.tenant !== c.tenant,
        ) ||
        (c.receiptBatches ?? []).some(
          (b) =>
            b.tenant !== c.tenant &&
            b.items.some((i) =>
              Object.values(i.steps).some((s) => s.state === "outcome_unknown"),
            ),
        ))
    )
      throw new DomainError("OUTCOME_UNKNOWN");
    return;
  }
  if (
    input.program !== "payroll" ||
    input.features.length !== 1 ||
    input.features[0] !== "payroll-input"
  ) {
    assertNoUncertainWrites(c);
    return;
  }
  if (
    (c.bookkeeping?.executions ?? []).some((e) =>
      ["submitting", "outcome_unknown"].includes(e.state),
    ) ||
    (c.receiptBatches ?? []).some((b) =>
      b.items.some((i) =>
        Object.values(i.steps).some((s) =>
          ["submitting", "outcome_unknown"].includes(s.state),
        ),
      ),
    )
  )
    throw new DomainError("OUTCOME_UNKNOWN");
  for (const execution of c.business?.executions ?? []) {
    if (execution.state === "submitting")
      throw new DomainError("OUTCOME_UNKNOWN");
    if (
      execution.state === "outcome_unknown" &&
      (execution.tenant !== c.tenant ||
        !/^(?:customer|supplier|article|offer|order|invoice)\./.test(
          execution.operation,
        ))
    )
      throw new DomainError("OUTCOME_UNKNOWN");
  }
}
export function previewProgram(
  c: Connection,
  input: ProgramChange,
  gates: ProgramGates,
) {
  input = programChange.parse(input);
  const selected = programSelection(c);
  if (c.state !== "active" || selected.revision !== input.expected_revision)
    throw new DomainError("CONNECTION_CONFLICT");
  const manifest = programManifest.find((p) => p.id === input.program);
  if (
    !manifest ||
    input.features.some(
      (id) =>
        !(manifest.features as readonly string[]).includes(id) ||
        !featureScopes(id, gates).length ||
        featureManifest[id].dependsOn.some(
          (dep) =>
            !input.features.includes(dep) && !selected.features.includes(dep),
        ),
    )
  )
    throw new DomainError("CAPABILITY_UNAVAILABLE");
  const features = [...new Set([...selected.features, ...input.features])];
  // Existing access is retained verbatim. Only newly selected functions contribute
  // scopes; unrelated programs and other companies never enter this union.
  const scopes = [
    ...new Set([
      ...baseScopes,
      ...c.scopes,
      ...input.features.flatMap((id) => featureScopes(id, gates)),
    ]),
  ];
  const addedFeatures = input.features.filter(
    (id) => !selected.features.includes(id),
  );
  const addedScopes = scopes.filter((s) => !c.scopes.includes(s));
  const action =
    addedFeatures.length === 0 && selected.enabled.includes(input.program)
      ? ("none" as const)
      : addedScopes.length
        ? ("provider_consent" as const)
        : ("local_selection" as const);
  if (action !== "none")
    assertProgramConsentChange(c, input, action === "provider_consent");
  return {
    company_id: c.id,
    company_name: c.name,
    program: input.program,
    expected_revision: selected.revision,
    connected: selected.enabled,
    enabled: [...new Set([...selected.enabled, input.program])],
    features,
    existing_scopes: c.scopes,
    added_scopes: addedScopes,
    added_features: addedFeatures,
    action,
    scopes,
  };
}
export function programStatus(c: Connection, gates: ProgramGates) {
  const selected = programSelection(c);
  return {
    company_id: c.id,
    revision: selected.revision,
    features: selected.features,
    programs: programManifest.map((p) => ({
      ...p,
      capabilities: programCapabilities[p.id],
      connection_features: p.features
        .filter((id) => featureScopes(id, gates).length > 0)
        .map((id) => ({ id, ...featureLabels[id] })),
      selected: selected.enabled.includes(p.id),
      connection:
        c.state !== "active"
          ? c.state
          : selected.enabled.includes(p.id) &&
              (p.scopes.some((s) => c.scopes.includes(s)) ||
                (p.id === "bookkeeping" && c.scopes.includes("supplier")))
            ? ("connected" as const)
            : ("not_connected" as const),
      availability: "available" as
        | "available"
        | "planned"
        | "verification_pending",
      can_connect:
        c.state === "active" &&
        p.features.some((id) => featureScopes(id, gates).length > 0),
      connect_features: p.features.filter(
        (id) => featureScopes(id, gates).length > 0,
      ),
    })),
    receipt_consent: gates.receiptConsent,
  };
}
export type ProgramStatus = ReturnType<typeof programStatus>;
export type ProgramPreview = ReturnType<typeof previewProgram>;
