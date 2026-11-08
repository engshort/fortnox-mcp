export interface Company {
  company_id: string;
  name: string;
  state: string;
  mode: "service" | "user";
  review: "review_required" | "client_managed";
  read_only: boolean;
  policy_version: number;
}
export interface Investigation {
  company_id: string;
  proposal_id: string;
  proposal_hash: string;
}
export interface InstallationState {
  owner: { email: string };
  integration: { configured: boolean; source: "owner" | "operator" };
  callback: string;
  mcp_url: string;
  test_mode: boolean;
  capabilities: Record<string, boolean>;
  companies: Company[];
  investigations: Investigation[];
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
  const value = await response.json();
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
