import {
  type InstallationKey,
  type InstallationSnapshot,
  type InstallationValues,
  installationDefaults,
  SettingsValidationError,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { ProductSettings } from "./product.js";

export const settingEnvironment = {
  emailEnabled: "RESEND_ENABLED",
  emailApiKey: "RESEND_API_KEY",
  emailFrom: "RESEND_FROM",
  multiUser: "MULTI_USER_ENABLED",
  membershipProvisioning: "MEMBERSHIP_PROVISIONING_ENABLED",
  restApi: "REST_API_ENABLED",
  restBridge: "REST_BRIDGE_ENABLED",
  restSync: "REST_SYNC_ENABLED",
  fortnoxEvents: "FORTNOX_EVENTS_ENABLED",
  externalAppOnboarding: "EXTERNAL_APP_ONBOARDING_ENABLED",
  onboardingClients: "EXTERNAL_APP_ONBOARDING_CLIENT_IDS",
  offlineClientIds: "MCP_OFFLINE_CLIENT_IDS",
  financialAnalysisContexts: "FINANCIAL_ANALYSIS_CONTEXTS_ENABLED",
  financialLargeReads: "FINANCIAL_LARGE_READS_ENABLED",
} as const satisfies Record<InstallationKey, string>;

export function settingsDefaults(
  settings: ProductSettings,
  overridden: readonly InstallationKey[] = [],
): InstallationValues {
  const values: InstallationValues = {
    ...installationDefaults,
    ...Object.fromEntries(
      Object.keys(installationDefaults)
        .filter((key) => Object.hasOwn(settings, key))
        .map((key) => [key, settings[key as keyof ProductSettings]]),
    ),
    emailEnabled: !!settings.email,
    emailApiKey: settings.email?.apiKey ?? "",
    emailFrom: settings.email?.from ?? "",
    ...settings.installationDefaults,
  };
  for (const key of Object.keys(
    settings.installationEnvironment ?? {},
  ) as InstallationKey[]) {
    if (overridden.includes(key)) continue;
    const raw = settings.installationEnvironment?.[key];
    if (raw === undefined) continue;
    const value =
      typeof installationDefaults[key] === "boolean"
        ? raw === "true"
        : Array.isArray(installationDefaults[key])
          ? JSON.parse(raw)
          : raw.trim();
    Object.assign(values, { [key]: value });
  }
  return values;
}
export function applySettings(
  base: ProductSettings,
  values: InstallationValues,
): ProductSettings {
  const { emailEnabled, emailApiKey, emailFrom, ...features } = values;
  const { email: _email, ...rest } = base;
  return {
    ...rest,
    ...features,
    ...(emailEnabled
      ? { email: { apiKey: emailApiKey, from: emailFrom } }
      : {}),
  };
}
export function validateEmail(values: InstallationValues) {
  if (!values.emailEnabled) return;
  const fields: InstallationKey[] = [];
  if (
    (values.emailEnabled || values.emailApiKey) &&
    !/^re_[A-Za-z0-9_-]+$/.test(values.emailApiKey)
  )
    fields.push("emailApiKey");
  if (
    (values.emailEnabled || values.emailFrom) &&
    !z.email().safeParse(values.emailFrom).success
  )
    fields.push("emailFrom");
  if (fields.length) throw new SettingsValidationError(fields);
}
export function validateDependencies(
  values: InstallationValues,
  runtime: "node" | "worker" | undefined,
) {
  const fields: InstallationKey[] = [];
  if (values.membershipProvisioning && !values.multiUser)
    fields.push("membershipProvisioning", "multiUser");
  if (values.restBridge && !values.restApi)
    fields.push("restBridge", "restApi");
  if (values.restSync && (!values.restApi || !values.restBridge))
    fields.push("restSync", "restApi", "restBridge");
  if (
    values.fortnoxEvents &&
    (!values.restSync ||
      !values.restBridge ||
      !values.restApi ||
      runtime !== "node")
  )
    fields.push("fortnoxEvents");
  if (fields.length) throw new SettingsValidationError([...new Set(fields)]);
  validateEmail(values);
}
export function settingsProjection(
  snapshot: InstallationSnapshot,
  base: ProductSettings,
) {
  const { emailApiKey, ...values } = snapshot.values;
  return {
    revision: snapshot.revision,
    owner_recovery_email:
      snapshot.values.emailEnabled && snapshot.ownerEmailTrusted,
    values: { ...values, emailApiKey: !!emailApiKey },
    sources: Object.fromEntries(
      Object.keys(settingEnvironment).map((key) => [
        key,
        snapshot.overridden.includes(key as InstallationKey)
          ? "app"
          : base.installationSources?.includes(key as InstallationKey)
            ? "server"
            : "default",
      ]),
    ),
  };
}

// A stale request must not perform more provider I/O or expose a result after
// a feature/policy has been removed. Already dispatched effects stay in the
// existing domain execution ledger; this fence never retries a request.
export function settingsRestricted(
  before: InstallationValues,
  after: InstallationValues,
) {
  for (const key of [
    "multiUser",
    "membershipProvisioning",
    "restApi",
    "restBridge",
    "restSync",
    "fortnoxEvents",
    "externalAppOnboarding",
    "financialAnalysisContexts",
    "financialLargeReads",
  ] as const)
    if (before[key] && !after[key]) return true;
  return (
    before.offlineClientIds.some(
      (id) => !after.offlineClientIds.includes(id),
    ) ||
    before.onboardingClients.some((id) => !after.onboardingClients.includes(id))
  );
}
