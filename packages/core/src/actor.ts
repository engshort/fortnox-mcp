import { DomainError } from "./errors.js";

export type Permission =
  | "office_contacts_read"
  | "read"
  | "finance_read"
  | "write"
  | "files"
  | "bridge";
export type ApiResource = "mcp" | "api";
export interface RequestActor {
  readonly installationGrant?: string;
  readonly oauthClientId?: string;
  readonly subjectId?: string;
  ownerId: string;
  clientId: string;
  resource: ApiResource;
  permissions: readonly Permission[];
}
// Compatibility for internal callers of the prerelease domain API. Network
// adapters always construct RequestActor after validating their own resource.
export interface LegacyMcpActor {
  readonly installationGrant?: string;
  readonly oauthClientId?: string;
  readonly subjectId?: string;
  ownerId: string;
  clientId: string;
  scopes: readonly string[];
}
export type Actor = RequestActor | LegacyMcpActor;
export function requestActor(
  identity: LegacyMcpActor,
  resource: ApiResource,
): RequestActor {
  const prefix = resource === "api" ? "api" : "mcp";
  const permissions: Permission[] = [];
  if (identity.scopes.includes(`${prefix}:read`)) permissions.push("read");
  if (identity.scopes.includes(`${prefix}:finance:read`))
    permissions.push("finance_read");
  if (identity.scopes.includes(`${prefix}:write`)) permissions.push("write");
  if (identity.scopes.includes(`${prefix}:files`)) permissions.push("files");
  if (resource === "api" && identity.scopes.includes("api:bridge"))
    permissions.push("bridge");
  if (
    resource === "api" &&
    identity.scopes.includes("api:office:contacts:read")
  )
    permissions.push("office_contacts_read");
  return {
    ...(identity.installationGrant
      ? { installationGrant: identity.installationGrant }
      : {}),
    ...(identity.oauthClientId
      ? { oauthClientId: identity.oauthClientId }
      : {}),
    ...(identity.subjectId ? { subjectId: identity.subjectId } : {}),
    ownerId: identity.ownerId,
    clientId: identity.clientId,
    resource,
    permissions,
  };
}
export function actorResource(actor: Actor): ApiResource {
  return "resource" in actor ? actor.resource : "mcp";
}
export function hasPermission(actor: Actor, permission: Permission): boolean {
  if (actorResource(actor) === "api" && !("permissions" in actor)) return false;
  const normalized =
    "permissions" in actor ? actor : requestActor(actor, "mcp");
  return normalized.permissions.includes(permission);
}
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor, permission)) throw new DomainError("AUTH_REQUIRED");
}
