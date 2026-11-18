import {
  type BridgeCatalog,
  DomainError,
  type InstallationKey,
  type InstallationSettings,
  installationChange,
  SettingsValidationError,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { boundedJson, safeResponse } from "./admin.js";
import type { BridgeCatalogStore } from "./bridge-catalog.js";
import {
  settingsProjection,
  validateDependencies,
} from "./installation-settings.js";
import type { ProductSettings } from "./product.js";
import { type ProductAuth, requireAdministrator } from "./product-auth.js";

interface RegisteredClient {
  clientId: string;
  name?: string | null;
  disabled?: boolean | null;
  tokenEndpointAuthMethod?: string | null;
  scopes?: string[] | null;
  grantTypes?: string[] | null;
}
export function clientEligibility(client: RegisteredClient) {
  const backend =
    !client.disabled &&
    client.tokenEndpointAuthMethod === "client_secret_basic" &&
    client.grantTypes?.includes("authorization_code") &&
    client.grantTypes.includes("refresh_token");
  return {
    onboarding: !!backend && !!client.scopes?.includes("mcp:read"),
    offline: !!backend && !!client.scopes?.includes("offline_access"),
  };
}
export function settingsRoutes(config: {
  auth: ProductAuth;
  settings: InstallationSettings;
  base: ProductSettings;
  runtime?: "node" | "worker";
  catalog: BridgeCatalogStore;
  analysisAvailable: boolean;
}) {
  return async (request: Request) => {
    try {
      const session = await requireAdministrator(config.auth, request.headers);
      const url = new URL(request.url);
      const owner = session.principal.ownerId;
      const context = await config.auth.$context;
      if (url.pathname === "/admin/settings/clients") {
        if (request.method !== "GET")
          return safeResponse('{"error":"METHOD_NOT_ALLOWED"}', 405);
        const after = z
          .string()
          .max(256)
          .optional()
          .parse(url.searchParams.get("after") ?? undefined);
        const rows = await context.adapter.findMany<RegisteredClient>({
          model: "oauthClient",
          limit: 51,
          sortBy: { field: "clientId", direction: "asc" },
          select: [
            "clientId",
            "name",
            "disabled",
            "tokenEndpointAuthMethod",
            "scopes",
            "grantTypes",
          ],
          ...(after
            ? {
                where: [
                  { field: "clientId", operator: "gt" as const, value: after },
                ],
              }
            : {}),
        });
        return safeResponse(
          JSON.stringify({
            clients: rows.slice(0, 50).map((c) => ({
              client_id: c.clientId,
              name: c.name ?? c.clientId,
              ...clientEligibility(c),
            })),
            next: rows.length > 50 ? rows[49]?.clientId : null,
          }),
        );
      }
      if (request.method === "POST") {
        if (
          request.headers.get("origin") !== config.base.origin ||
          request.headers.get("content-type")?.split(";")[0] !==
            "application/json"
        )
          return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
        const input = installationChange.parse(await boundedJson(request));
        const prior = await config.settings.snapshot(owner);
        await config.settings.save(
          owner,
          input,
          async (values) => {
            if (session.principal.role !== "owner") {
              if (!(await config.settings.snapshot(owner)).values.multiUser)
                throw new DomainError("AUTH_REQUIRED");
              await config.auth.memberships.principal(
                session.principal.subjectId,
              );
            }
            validateDependencies(values, config.runtime);
            if (values.financialAnalysisContexts && !config.analysisAvailable)
              throw new SettingsValidationError(["financialAnalysisContexts"]);
            for (const key of [
              "onboardingClients",
              "offlineClientIds",
            ] as const) {
              // Retained stale entries can be removed without preventing unrelated
              // edits. New selections and explicit resets are checked in full.
              const ids =
                Object.hasOwn(input.changes, key) || input.reset.includes(key)
                  ? values[key]
                  : values[key].filter((id) => !prior.values[key].includes(id));
              for (const id of ids) {
                const client = await context.adapter.findOne<RegisteredClient>({
                  model: "oauthClient",
                  where: [{ field: "clientId", value: id }],
                });
                if (
                  !client ||
                  !clientEligibility(client)[
                    key === "onboardingClients" ? "onboarding" : "offline"
                  ]
                )
                  throw new SettingsValidationError([key]);
              }
            }
          },
          session.principal.role === "owner" ? "owner" : "admin",
        );
        return safeResponse('{"ok":true}');
      }
      if (request.method !== "GET")
        return safeResponse('{"error":"METHOD_NOT_ALLOWED"}', 405);
      const snapshot = await config.settings.snapshot(owner);
      const v = snapshot.values;
      let catalog: BridgeCatalog | null = null;
      let catalogUnavailable = false;
      try {
        catalog = await config.catalog.current();
      } catch {
        catalogUnavailable = true;
      }
      const catalogReason = catalogUnavailable
        ? "catalog_unavailable"
        : "catalog_required";
      return safeResponse(
        JSON.stringify({
          ...settingsProjection(snapshot, config.base),
          can_install_catalog: session.principal.role === "owner",
          catalog: {
            unavailable: catalogUnavailable,
            revision: catalog?.revision ?? null,
            operations: catalog?.operations.length ?? 0,
          },
          availability: {
            membershipProvisioning: !v.multiUser ? "multi_user_required" : null,
            restBridge: !v.restApi
              ? "rest_api_required"
              : !catalog
                ? catalogReason
                : null,
            restSync:
              !v.restApi || !v.restBridge
                ? "rest_bridge_required"
                : !catalog
                  ? catalogReason
                  : null,
            fortnoxEvents:
              config.runtime !== "node"
                ? "node_required"
                : !v.restSync || !v.restBridge || !v.restApi
                  ? "sync_required"
                  : !catalog
                    ? catalogReason
                    : null,
            financialAnalysisContexts: !config.analysisAvailable
              ? "analysis_storage_required"
              : null,
          },
          runtime: {
            kind: config.runtime ?? "unknown",
            origin: config.base.origin,
            redirects: config.base.redirects,
            file_transport: config.base.receiptSource?.transport ?? "none",
            file_sources_configured:
              (config.base.receiptSource?.origins.length ?? 0) > 0,
          },
        }),
      );
    } catch (error) {
      const fields: InstallationKey[] =
        error instanceof SettingsValidationError
          ? error.fields
          : error instanceof z.ZodError
            ? error.issues.flatMap((issue) =>
                typeof issue.path[1] === "string"
                  ? [issue.path[1] as InstallationKey]
                  : [],
              )
            : [];
      const code =
        error instanceof DomainError
          ? error.code
          : error instanceof z.ZodError ||
              error instanceof SettingsValidationError ||
              error instanceof SyntaxError ||
              (error instanceof Error && error.message === "VALIDATION_FAILED")
            ? "VALIDATION_FAILED"
            : error instanceof Error && error.message === "AUTH_REQUIRED"
              ? "AUTH_REQUIRED"
              : "SETTINGS_UNAVAILABLE";
      return safeResponse(
        JSON.stringify({
          error: code,
          ...(code === "VALIDATION_FAILED" ? { fields } : {}),
        }),
        code === "AUTH_REQUIRED"
          ? 401
          : code === "CONNECTION_CONFLICT"
            ? 409
            : code === "SETTINGS_UNAVAILABLE"
              ? 503
              : 400,
      );
    }
  };
}
