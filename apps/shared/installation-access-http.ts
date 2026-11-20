import {
  agencyProfile,
  agencyScopes,
  agencySelection,
  type Connections,
  DomainError,
  InstallationAccess,
  installationScopes,
  officeContactSources,
  programSelection,
} from "@fortnox-mcp/core";
import { z } from "zod";
import { boundedJson, safeResponse } from "./admin.js";
import { type ProductAuth, requireOwner } from "./product-auth.js";

const contactSelection = z
  .array(
    z
      .object({
        company_id: z.string().uuid(),
        sources: z.array(z.enum(officeContactSources)).min(1).max(3),
      })
      .strict(),
  )
  .max(20);
const mutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: z.string().trim().min(1).max(128),
      allow_writes: z.boolean(),
      onboarding_client_id: z.string().min(1).max(256).optional(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["change", "revoke", "rotate"]),
      id: z.string().uuid(),
      expected_revision: z.number().int().positive(),
      allow_writes: z.boolean().optional(),
      office_contacts: contactSelection.optional(),
    })
    .strict(),
]);

export function installationAccessRoutes(config: {
  auth: ProductAuth;
  origin: string;
  enabled: boolean;
  rest: boolean;
  connections: Connections;
  offlineClientIds: readonly string[];
  officeContacts?: boolean;
}) {
  const access = new InstallationAccess(
    config.connections.state,
    config.enabled,
  );
  return async (request: Request) => {
    try {
      const session = await requireOwner(
        config.auth,
        config.connections.state,
        request.headers,
      );
      const owner = session.user.id;
      if (request.method === "GET") {
        return safeResponse(
          JSON.stringify({
            enabled: config.enabled,
            available: config.rest,
            office_contacts_available: config.officeContacts === true,
            integrations: await access.list(owner),
            offline_client_ids: config.offlineClientIds,
            companies: (await config.connections.list(owner)).map((c) => ({
              company_id: c.id,
              name: c.name,
              mode: c.mode,
              state: c.state,
              missing_scopes: agencyScopes.filter((s) => !c.scopes.includes(s)),
              missing_features: agencySelection.features.filter(
                (f) => !programSelection(c).features.includes(f),
              ),
              read_only: c.readOnly,
              manual_vouchers: c.review,
            })),
          }),
        );
      }
      if (request.method !== "POST")
        return safeResponse('{"error":"METHOD_NOT_ALLOWED"}', 405);
      if (request.headers.get("origin") !== config.origin)
        return safeResponse('{"error":"ORIGIN_FORBIDDEN"}', 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return safeResponse('{"error":"VALIDATION_FAILED"}', 400);
      const input = mutation.parse(await boundedJson(request));
      if (input.action !== "revoke" && (!config.enabled || !config.rest))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      if (input.action === "create") {
        if ((await access.list(owner)).length >= 16)
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        if (input.onboarding_client_id)
          await config.auth.api.getOnboardingClient({
            body: { client: input.onboarding_client_id },
          });
        const client = await config.auth.api.adminCreateOAuthClient({
          headers: request.headers,
          body: {
            client_name: input.name,
            token_endpoint_auth_method: "client_secret_basic",
            grant_types: ["client_credentials"],
            scope: installationScopes(input.allow_writes).join(" "),
            client_credentials_scopes: installationScopes(input.allow_writes),
            resources: [`${config.origin}/api/v1`],
          },
        });
        // An orphan library client after a failed CAS has no domain grant and
        // therefore cannot acquire product access. Never return its secret.
        const grant = await access.save(
          owner,
          {
            id: crypto.randomUUID(),
            clientId: client.client_id,
            name: input.name,
            revision: 1,
            active: true,
            writes: input.allow_writes,
            profile: agencyProfile,
            ...(input.onboarding_client_id
              ? { onboardingClientId: input.onboarding_client_id }
              : {}),
          },
          null,
        );
        return safeResponse(
          JSON.stringify({
            integration: grant,
            client_id: client.client_id,
            client_secret: client.client_secret,
          }),
          201,
        );
      }
      const existing = (await access.list(owner)).find(
        (g) => g.id === input.id,
      );
      if (!existing || existing.revision !== input.expected_revision)
        throw new DomainError("CONNECTION_CONFLICT");
      if (input.action !== "change" && input.office_contacts !== undefined)
        throw new DomainError("VALIDATION_FAILED");
      if (
        input.action === "change" &&
        input.allow_writes === undefined &&
        input.office_contacts === undefined
      )
        throw new DomainError("VALIDATION_FAILED");
      let officeContacts = existing.officeContacts;
      if (input.action === "revoke") officeContacts = [];
      if (input.office_contacts !== undefined) {
        if (input.office_contacts.length && !config.officeContacts)
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        if (
          new Set(input.office_contacts.map((c) => c.company_id)).size !==
          input.office_contacts.length
        )
          throw new DomainError("VALIDATION_FAILED");
        const companies = await config.connections.list(owner);
        officeContacts = input.office_contacts.map((selection) => {
          const c = companies.find((c) => c.id === selection.company_id);
          if (
            c?.state !== "active" ||
            new Set(selection.sources).size !== selection.sources.length
          )
            throw new DomainError("VALIDATION_FAILED");
          return {
            ...selection,
            generation: c.generation,
            access_revision: c.accessRevision ?? 0,
          };
        });
      }
      // Fence old tokens before library changes. Partial/unknown rotation stays
      // disabled until the owner performs another explicit management action.
      const next = await access.save(
        owner,
        {
          ...existing,
          ...(officeContacts ? { officeContacts } : {}),
          revision: existing.revision + 1,
          active: input.action === "change",
          writes:
            input.action === "revoke"
              ? false
              : (input.allow_writes ?? existing.writes),
        },
        existing.revision,
      );
      if (input.action === "revoke") return safeResponse('{"ok":true}');
      if (input.action === "rotate") {
        const credentials = await config.auth.api.rotateClientSecret({
          headers: request.headers,
          body: { client_id: existing.clientId },
        });
        await config.auth.api.adminUpdateOAuthClient({
          headers: request.headers,
          body: {
            client_id: existing.clientId,
            update: {
              scope: installationScopes(
                next.writes,
                !!next.officeContacts?.length,
              ).join(" "),
              client_credentials_scopes: installationScopes(
                next.writes,
                !!next.officeContacts?.length,
              ),
            },
          },
        });
        const grant = await access.save(
          owner,
          { ...next, active: true, revision: next.revision + 1 },
          next.revision,
        );
        return safeResponse(
          JSON.stringify({
            integration: grant,
            client_id: existing.clientId,
            client_secret: credentials.client_secret,
          }),
        );
      }
      await config.auth.api.adminUpdateOAuthClient({
        headers: request.headers,
        body: {
          client_id: existing.clientId,
          update: {
            scope: installationScopes(
              next.writes,
              !!next.officeContacts?.length,
            ).join(" "),
            client_credentials_scopes: installationScopes(
              next.writes,
              !!next.officeContacts?.length,
            ),
          },
        },
      });
      return safeResponse('{"ok":true}');
    } catch (error) {
      const unauthorized =
        (error instanceof Error && error.message === "AUTH_REQUIRED") ||
        (error !== null &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 401);
      const code =
        error instanceof DomainError
          ? error.code
          : error instanceof z.ZodError
            ? "VALIDATION_FAILED"
            : unauthorized
              ? "AUTH_REQUIRED"
              : "UPSTREAM_UNAVAILABLE";
      return safeResponse(
        JSON.stringify({ error: code }),
        code === "AUTH_REQUIRED"
          ? 401
          : code === "CONNECTION_CONFLICT"
            ? 409
            : code === "UPSTREAM_UNAVAILABLE"
              ? 503
              : 400,
      );
    }
  };
}
