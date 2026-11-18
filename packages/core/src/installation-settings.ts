import { z } from "zod";
import type { Ciphertext, CredentialVault } from "./connections.js";
import { DomainError } from "./errors.js";
import type { StateStore } from "./ports.js";

const clients = z.array(z.string().min(1).max(256)).max(16);
export const installationValues = z
  .object({
    emailEnabled: z.boolean(),
    emailApiKey: z.string().max(4096),
    emailFrom: z.string().trim().max(254),
    multiUser: z.boolean(),
    membershipProvisioning: z.boolean(),
    restApi: z.boolean(),
    restBridge: z.boolean(),
    restSync: z.boolean(),
    fortnoxEvents: z.boolean(),
    externalAppOnboarding: z.boolean(),
    onboardingClients: clients,
    offlineClientIds: clients,
    financialAnalysisContexts: z.boolean(),
    financialLargeReads: z.boolean(),
  })
  .strict();
export type InstallationValues = z.infer<typeof installationValues>;
export type InstallationKey = keyof InstallationValues;
export const installationKeys = installationValues.keyof();
export const installationChange = z
  .object({
    expected_revision: z.number().int().positive().safe().nullable(),
    changes: installationValues.partial(),
    reset: z.array(installationKeys).max(14).default([]),
  })
  .strict();

export const installationDefaults: InstallationValues = {
  emailEnabled: false,
  emailApiKey: "",
  emailFrom: "",
  multiUser: false,
  membershipProvisioning: false,
  restApi: false,
  restBridge: false,
  restSync: false,
  fortnoxEvents: false,
  externalAppOnboarding: false,
  onboardingClients: [],
  offlineClientIds: [],
  financialAnalysisContexts: false,
  financialLargeReads: false,
};
const ciphertext = z
  .object({ key: z.string(), iv: z.string(), data: z.string() })
  .strict();
const storedSettings = z
  .object({
    schema: z.literal(1),
    overrides: installationValues.omit({ emailApiKey: true }).partial(),
    emailApiKey: ciphertext.optional(),
    emailKeyOwnerApproved: z.boolean().optional(),
  })
  .strict();
export interface InstallationSnapshot {
  ownerEmailTrusted: boolean;
  revision: number | null;
  values: InstallationValues;
  overridden: InstallationKey[];
}
export class SettingsValidationError extends Error {
  constructor(readonly fields: InstallationKey[]) {
    super("VALIDATION_FAILED");
  }
}

// Bounded installation configuration, not financial data. Secrets are always
// sealed separately; neither a missing key nor invalid state permits fallback.
export class InstallationSettings {
  constructor(
    readonly state: StateStore,
    readonly vault: CredentialVault,
    readonly defaults:
      | InstallationValues
      | ((
          overridden: readonly InstallationKey[],
        ) => InstallationValues) = installationDefaults,
  ) {}
  private binding(owner: string) {
    return JSON.stringify(["installation-settings-v1", owner, "emailApiKey"]);
  }
  async snapshot(owner: string): Promise<InstallationSnapshot> {
    const row = await this.state.get("installation-settings-v1", owner);
    const saved = row ? storedSettings.parse(row.value) : undefined;
    const overridden: InstallationKey[] = [
      ...(Object.keys(saved?.overrides ?? {}) as InstallationKey[]),
      ...(saved?.emailApiKey ? ["emailApiKey" as const] : []),
    ];
    const defaults =
      typeof this.defaults === "function"
        ? this.defaults(overridden)
        : this.defaults;
    const values = installationValues.parse({
      ...defaults,
      ...saved?.overrides,
      emailApiKey: saved?.emailApiKey
        ? await this.vault.openData(saved.emailApiKey, this.binding(owner))
        : defaults.emailApiKey,
    });
    return {
      ownerEmailTrusted:
        !saved?.emailApiKey || saved.emailKeyOwnerApproved === true,
      revision: row?.version ?? null,
      values,
      overridden,
    };
  }
  async save(
    owner: string,
    input: unknown,
    validate: (values: InstallationValues) => Promise<void>,
    actor: "owner" | "admin" = "owner",
  ) {
    const change = installationChange.parse(input);
    if (change.reset.some((key) => Object.hasOwn(change.changes, key)))
      throw new SettingsValidationError(change.reset);
    const row = await this.state.get("installation-settings-v1", owner);
    if ((row?.version ?? null) !== change.expected_revision)
      throw new DomainError("CONNECTION_CONFLICT");
    const saved = row
      ? storedSettings.parse(row.value)
      : { schema: 1 as const, overrides: {} };
    const overrides = { ...saved.overrides, ...change.changes };
    const apiKey = change.reset.includes("emailApiKey")
      ? undefined
      : Object.hasOwn(change.changes, "emailApiKey")
        ? await this.vault.sealData(
            change.changes.emailApiKey,
            this.binding(owner),
          )
        : saved.emailApiKey;
    delete overrides.emailApiKey;
    for (const key of change.reset)
      if (key !== "emailApiKey") delete overrides[key];
    const next = storedSettings.parse({
      schema: 1,
      overrides,
      ...(apiKey
        ? {
            emailApiKey: apiKey,
            emailKeyOwnerApproved: Object.hasOwn(change.changes, "emailApiKey")
              ? actor === "owner"
              : saved.emailKeyOwnerApproved === true,
          }
        : {}),
    });
    const overridden = [
      ...(Object.keys(next.overrides) as InstallationKey[]),
      ...(apiKey ? ["emailApiKey" as const] : []),
    ];
    const defaults =
      typeof this.defaults === "function"
        ? this.defaults(overridden)
        : this.defaults;
    const values = installationValues.parse({
      ...defaults,
      ...next.overrides,
      emailApiKey: apiKey
        ? await this.vault.openData(apiKey, this.binding(owner))
        : defaults.emailApiKey,
    });
    await validate(values);
    if (
      !(await this.state.put(
        "installation-settings-v1",
        owner,
        next,
        change.expected_revision,
      ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
  }
  async rotate(owner: string) {
    const row = await this.state.get("installation-settings-v1", owner);
    if (!row) return;
    const saved = storedSettings.parse(row.value);
    if (!saved.emailApiKey) return;
    const apiKey: Ciphertext = await this.vault.sealData(
      await this.vault.openData(saved.emailApiKey, this.binding(owner)),
      this.binding(owner),
    );
    if (
      !(await this.state.put(
        "installation-settings-v1",
        owner,
        { ...saved, emailApiKey: apiKey },
        row.version,
      ))
    )
      throw new DomainError("CONNECTION_CONFLICT");
  }
}
