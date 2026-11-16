import { DomainError } from "./errors.js";

export type Permission = "read" | "finance_read" | "write" | "files";
export type ApiResource = "mcp" | "api";
export interface RequestActor {
  readonly subjectId?: string;
  ownerId: string;
  clientId: string;
  resource: ApiResource;
  permissions: readonly Permission[];
}
// Compatibility for internal callers of the prerelease domain API. Network
// adapters always construct RequestActor after validating their own resource.
export interface LegacyMcpActor {
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
  if (resource === "mcp") {
    if (identity.scopes.includes("mcp:write")) permissions.push("write");
    if (identity.scopes.includes("mcp:files")) permissions.push("files");
  }
  return {
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
  // An API identity cannot be used to obtain file/write capabilities, even by
  // an incorrectly composed internal adapter.
  if (normalized.resource === "api" && ["write", "files"].includes(permission))
    return false;
  return normalized.permissions.includes(permission);
}
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor, permission)) throw new DomainError("AUTH_REQUIRED");
}
