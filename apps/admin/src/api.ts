import type { BusinessDifference, ProgramStatus } from "@fortnox-mcp/core";
export interface Company {
  company_id: string;
  name: string;
  state: string;
  mode: "service" | "user";
  review: "review_required" | "client_managed";
  read_only: boolean;
  policy_version: number;
  organization_number: string;
  programs: ProgramStatus & { pending?: boolean };
}
export interface Investigation {
  company_id: string;
  proposal_id: string;
  proposal_hash: string;
}
export interface InstallationState {
  owner: { email: string };
  integration: {
    configured: boolean;
    verified: boolean;
    revision: number | null;
    source: "owner" | "operator";
  };
  callback: string;
  mcp_url: string;
  test_mode: boolean;
  restore: {
    reconciled: boolean;
    restore_id: string;
    from: number;
    to: number;
  } | null;
  capabilities: Record<string, boolean>;
  companies: Company[];
  investigations: Investigation[];
  uncertain_outcomes: Array<{
    company_id: string;
    company_name: string;
    kind: "bookkeeping" | "business" | "receipt";
    stage?: string;
    recovery_available?: boolean;
    id: string;
  }>;
  observed_differences?: Array<{
    company_id: string;
    company_name: string;
    id: string;
    operation: string;
    reference: string;
    difference: BusinessDifference;
  }>;
}
export async function api<T = { ok?: boolean; url?: string }>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json().catch(() => {
    // Upstream access gateways can return text/HTML. Never echo their body or
    // expose JSON parser excerpts (which may contain private response content).
    throw new Error(
      response.status === 401 || response.status === 403
        ? "AUTH_REQUIRED"
        : "REQUEST_FAILED",
    );
  });
  const diagnostic =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  if (!response.ok && diagnostic.error === "CONNECTION_REQUEST_FAILED") {
    if (diagnostic.reason === "CONSENT_IN_PROGRESS")
      throw new Error("CONSENT_IN_PROGRESS");
    // Only fixed public codes are shown; never echo arbitrary provider text.
    const reason = [
      "RATE_LIMITED",
      "AUTH_REQUIRED",
      "RECONNECT_REQUIRED",
      "VALIDATION_FAILED",
      "CAPABILITY_UNAVAILABLE",
      "CONNECTION_CONFLICT",
      "OUTCOME_UNKNOWN",
    ].includes(String(diagnostic.reason))
      ? String(diagnostic.reason)
      : null;
    const stage = [
      "consent_start",
      "flow_validation",
      "flow_decryption",
      "authorization_response",
      "code_exchange",
      "code_response",
      "initial_credentials",
      "tenant_verification",
      "service_exchange",
      "service_response",
      "service_credentials",
      "service_tenant_verification",
      "connection_storage",
    ].includes(String(diagnostic.stage))
      ? String(diagnostic.stage)
      : null;
    const provider = [
      "invalid_request",
      "invalid_client",
      "invalid_grant",
      "unauthorized_client",
      "invalid_scope",
      "access_denied",
      "server_error",
      "temporarily_unavailable",
    ].includes(String(diagnostic.provider_error))
      ? String(diagnostic.provider_error)
      : null;
    const details = [reason, stage, provider].filter(Boolean);
    throw new Error(
      `CONNECTION_REQUEST_FAILED${details.length ? ` (${details.join(", ")})` : ""}`,
    );
  }
  if (!response.ok)
    throw new Error(
      value &&
        typeof value === "object" &&
        "error" in value &&
        typeof value.error === "string" &&
        /^[A-Z_]+$/.test(value.error)
        ? value.error
        : "REQUEST_FAILED",
    );
  return value as T;
}
