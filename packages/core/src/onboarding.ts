import { z } from "zod";
import type {
  Ciphertext,
  CompanyGrant,
  Connection,
  ConnectionSet,
  Connections,
} from "./connections.js";

export const onboardingVersion = "company-onboarding-v1";
export const onboardingLifetime = 30 * 60_000;
export const onboardingRetention = 24 * 60 * 60_000;
export const onboardingStart = z
  .object({
    action: z.enum(["connect", "reconnect"]),
    redirect_uri: z.url().max(1024),
    state: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[A-Za-z0-9._~-]+$/),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal("S256"),
    scope: z.enum(["mcp:read", "mcp:read offline_access"]),
    expected_company_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => (v.action === "reconnect") === !!v.expected_company_id);
export const onboardingResume = z
  .object({
    expected_attempt_revision: z.number().int().positive().safe(),
    state: onboardingStart.shape.state,
    code_challenge: onboardingStart.shape.code_challenge,
    code_challenge_method: z.literal("S256"),
  })
  .strict();
export type OnboardingRequest = z.infer<typeof onboardingStart>;
export type OnboardingPhase =
  | "pending_owner"
  | "provider_pending"
  | "provider_outcome_unknown"
  | "company_verified"
  | "approval_pending"
  | "authorized"
  | "cancelled"
  | "expired"
  | "failed";
export type RecoveryAction =
  | "none"
  | "wait"
  | "resume"
  | "owner_review"
  | "restart";
export class OnboardingError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
    readonly recovery: RecoveryAction = "none",
  ) {
    super(code);
  }
}
export interface OnboardingBinding {
  id: string;
  revision: number;
  session: string;
  flowId: string;
}
export interface OnboardingApproval {
  id: string;
  revision: number;
  companyId: string;
  completedAt: number;
}
export interface OnboardingAttempt {
  id: string;
  client: string;
  clientName: string;
  revision: number;
  phase: OnboardingPhase;
  expiresAt: number;
  retainUntil: number;
  request: Ciphertext;
  operations: {
    key: string;
    fingerprint: string;
    revision: number;
    expiresAt: number;
  }[];
  session?: string;
  flowId?: string;
  expected?: {
    id: string;
    generation: number;
    accessRevision: number;
    policyVersion: number;
  };
  company?: {
    id: string;
    generation: number;
    accessRevision: number;
    policyVersion: number;
  };
  approval?: {
    queryHash: string;
    grantRevision: number;
    selection: { id: string; generation: number; access_revision: number }[];
  };
  grantId?: string;
  grantRevision?: number;
  completedAt?: number;
}
const companyRevision = (c: Connection) => ({
  id: c.id,
  generation: c.generation,
  accessRevision: c.accessRevision ?? 0,
  policyVersion: c.policyVersion,
});
export async function onboardingHash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function completeOnboardingCompany(
  set: ConnectionSet,
  binding: OnboardingBinding,
  c: Connection,
  now = Date.now(),
) {
  const a = set.onboarding?.find((a) => a.id === binding.id);
  if (
    !a ||
    a.revision !== binding.revision ||
    a.session !== binding.session ||
    a.flowId !== binding.flowId ||
    a.phase !== "provider_pending" ||
    a.retainUntil <= now
  )
    throw new OnboardingError("ATTEMPT_CONFLICT");
  if (a.expected && a.expected.id !== c.id)
    throw new OnboardingError("ATTEMPT_CONFLICT");
  a.company = companyRevision(c);
  a.phase = "company_verified";
  delete a.flowId;
}
export class CompanyOnboarding {
  constructor(
    readonly connections: Connections,
    readonly origin: string,
    readonly clients: readonly string[],
    readonly now: () => number = Date.now,
  ) {}
  private binding(
    owner: string,
    a: Pick<OnboardingAttempt, "id" | "client" | "revision">,
  ) {
    return JSON.stringify([
      this.origin,
      owner,
      "company-onboarding-v1",
      a.id,
      a.client,
      a.revision,
    ]);
  }
  async request(owner: string, a: OnboardingAttempt) {
    return onboardingStart.parse(
      await this.connections.vault.openData(a.request, this.binding(owner, a)),
    );
  }
  private find(set: ConnectionSet, client: string, id: string) {
    const a = set.onboarding?.find(
      (a) => a.id === id && a.client === client && a.retainUntil > this.now(),
    );
    if (!a) throw new OnboardingError("ATTEMPT_NOT_FOUND", 404);
    return a;
  }
  async get(owner: string, client: string, id: string) {
    return this.find(
      (await this.connections.snapshot(owner))?.value ?? { connections: [] },
      client,
      id,
    );
  }
  private async edit<T>(
    owner: string,
    client: string,
    id: string,
    fn: (a: OnboardingAttempt, set: ConnectionSet) => Promise<T> | T,
  ) {
    return this.connections.updateSet(owner, (set) =>
      fn(this.find(set, client, id), set),
    );
  }
  private async ownerEdit<T>(
    owner: string,
    original: OnboardingAttempt,
    session: string,
    fn: (a: OnboardingAttempt, set: ConnectionSet) => Promise<T> | T,
  ) {
    return this.edit(owner, original.client, original.id, (a, set) => {
      if (
        a.revision !== original.revision ||
        a.session !== session ||
        a.expiresAt <= this.now()
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      return fn(a, set);
    });
  }
  publicStart(
    a: OnboardingAttempt,
    operation = a.operations[a.operations.length - 1],
  ) {
    return {
      version: onboardingVersion,
      attempt_id: a.id,
      attempt_revision: operation?.revision ?? a.revision,
      authorization_url: `${this.origin}/connect/company/${a.id}?revision=${operation?.revision ?? a.revision}`,
      expires_at: new Date(operation?.expiresAt ?? a.expiresAt).toISOString(),
      retain_until: new Date(a.retainUntil).toISOString(),
    };
  }
  status(a: OnboardingAttempt) {
    const phase =
      a.expiresAt <= this.now() &&
      !["authorized", "cancelled", "provider_outcome_unknown"].includes(a.phase)
        ? "expired"
        : a.phase;
    const recovery: RecoveryAction =
      phase === "provider_outcome_unknown"
        ? "owner_review"
        : phase === "provider_pending"
          ? "wait"
          : phase === "authorized"
            ? "none"
            : "resume";
    return {
      version: onboardingVersion,
      attempt_id: a.id,
      attempt_revision: a.revision,
      status: phase,
      recovery_action: recovery,
      expires_at: new Date(a.expiresAt).toISOString(),
      retain_until: new Date(a.retainUntil).toISOString(),
    };
  }
  async start(
    owner: string,
    client: string,
    name: string,
    key: string,
    input: OnboardingRequest,
  ) {
    const fingerprint = await onboardingHash(
      JSON.stringify(["start", client, input]),
    );
    return this.connections.updateSet(owner, async (set) => {
      set.onboarding = (set.onboarding ?? []).filter(
        (a) => a.retainUntil > this.now(),
      );
      for (const a of set.onboarding.filter((a) => a.client === client)) {
        const op = a.operations.find((op) => op.key === key);
        if (op) {
          if (op.fingerprint !== fingerprint)
            throw new OnboardingError("IDEMPOTENCY_CONFLICT");
          return this.publicStart(a, op);
        }
      }
      if (
        set.onboarding.length >= 16 ||
        set.onboarding.filter((a) => a.client === client).length >= 8
      )
        throw new OnboardingError("RATE_LIMITED", 429, "wait");
      const target = input.expected_company_id
        ? set.connections.find((c) => c.id === input.expected_company_id)
        : undefined;
      // The identifier is not authorization: no company data is returned until
      // the installation owner explicitly binds the attempt and approves it.

      const a: OnboardingAttempt = {
        id: crypto.randomUUID(),
        client,
        clientName: name.slice(0, 128),
        revision: 1,
        phase: "pending_owner",
        expiresAt: this.now() + onboardingLifetime,
        retainUntil: this.now() + onboardingRetention,
        request: { key: "", iv: "", data: "" },
        operations: [],
        ...(input.expected_company_id
          ? {
              expected: target
                ? companyRevision(target)
                : {
                    id: input.expected_company_id,
                    generation: -1,
                    accessRevision: -1,
                    policyVersion: -1,
                  },
            }
          : {}),
      };
      a.request = await this.connections.vault.sealData(
        input,
        this.binding(owner, a),
      );
      a.operations.push({
        key,
        fingerprint,
        revision: 1,
        expiresAt: a.expiresAt,
      });
      set.onboarding.push(a);
      return this.publicStart(a);
    });
  }
  async resume(
    owner: string,
    client: string,
    id: string,
    key: string,
    input: z.infer<typeof onboardingResume>,
  ) {
    const fingerprint = await onboardingHash(
      JSON.stringify(["resume", id, input]),
    );
    return this.edit(owner, client, id, async (a) => {
      const op = a.operations.find((op) => op.key === key);
      if (op) {
        if (op.fingerprint !== fingerprint)
          throw new OnboardingError("IDEMPOTENCY_CONFLICT");
        return this.publicStart(a, op);
      }
      if (a.revision !== input.expected_attempt_revision)
        throw new OnboardingError("ATTEMPT_CONFLICT");
      if (["provider_pending", "provider_outcome_unknown"].includes(a.phase))
        throw new OnboardingError(
          a.phase === "provider_pending"
            ? "CONSENT_IN_PROGRESS"
            : "OUTCOME_UNKNOWN",
          409,
          "owner_review",
        );
      if (a.operations.length >= 8)
        throw new OnboardingError("RATE_LIMITED", 429, "restart");
      const request = await this.request(owner, a);
      a.revision++;
      a.expiresAt = Math.min(this.now() + onboardingLifetime, a.retainUntil);
      a.request = await this.connections.vault.sealData(
        {
          ...request,
          state: input.state,
          code_challenge: input.code_challenge,
        },
        this.binding(owner, a),
      );
      a.phase = a.company ? "company_verified" : "pending_owner";
      delete a.session;
      delete a.approval;
      delete a.grantId;
      delete a.grantRevision;
      delete a.completedAt;
      a.operations.push({
        key,
        fingerprint,
        revision: a.revision,
        expiresAt: a.expiresAt,
      });
      return this.publicStart(a);
    });
  }
  async ownerAttempt(
    owner: string,
    id: string,
    revision: number,
    session: string,
    claim = false,
  ) {
    const set = (await this.connections.snapshot(owner))?.value;
    const a = set?.onboarding?.find((a) => a.id === id);
    if (!a || a.retainUntil <= this.now())
      throw new OnboardingError("ATTEMPT_NOT_FOUND", 404);
    if (!this.clients.includes(a.client))
      throw new OnboardingError("AUTH_REQUIRED", 401);
    if (a.revision !== revision) throw new OnboardingError("ATTEMPT_CONFLICT");
    if (a.expiresAt <= this.now())
      throw new OnboardingError("ATTEMPT_EXPIRED", 410, "resume");
    if (a.session && a.session !== session)
      throw new OnboardingError("AUTH_REQUIRED", 401);
    if (claim && !a.session)
      return this.edit(owner, a.client, id, (a) => {
        if (a.revision !== revision || (a.session && a.session !== session))
          throw new OnboardingError("ATTEMPT_CONFLICT");
        a.session = session;
        return a;
      });
    return a;
  }
  // Called only after the HTTP adapter has authenticated the installation owner
  // and proved the old session is absent/expired. This changes no provider grant.
  async rebindForReview(
    owner: string,
    id: string,
    revision: number,
    oldSession: string,
    newSession: string,
  ) {
    return this.connections.updateSet(owner, (set) => {
      const a = set.onboarding?.find(
        (a) =>
          a.id === id &&
          a.revision === revision &&
          a.session === oldSession &&
          a.retainUntil > this.now(),
      );
      if (
        !a ||
        !["provider_pending", "provider_outcome_unknown", "failed"].includes(
          a.phase,
        )
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      a.session = newSession;
      if (a.phase === "provider_pending") a.phase = "provider_outcome_unknown";
      a.expiresAt = Math.min(this.now() + onboardingLifetime, a.retainUntil);
      delete a.approval;
      return a;
    });
  }
  async choose(
    owner: string,
    id: string,
    revision: number,
    session: string,
    company: string,
  ) {
    const a = await this.ownerAttempt(owner, id, revision, session, true);
    return this.ownerEdit(owner, a, session, (a, set) => {
      if (
        ![
          "pending_owner",
          "company_verified",
          "failed",
          "provider_outcome_unknown",
        ].includes(a.phase)
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      const c = set.connections.find(
        (c) => c.id === company && c.state === "active",
      );
      if (
        !c ||
        (a.expected && c.id !== a.expected.id) ||
        (a.company && c.id !== a.company.id)
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      a.company = companyRevision(c);
      a.phase = "company_verified";
      delete a.flowId;
      return c;
    });
  }
  async reserveProvider(
    owner: string,
    id: string,
    revision: number,
    session: string,
  ) {
    const a = await this.ownerAttempt(owner, id, revision, session, true);
    return this.ownerEdit(owner, a, session, (a, set) => {
      if (!["pending_owner", "failed"].includes(a.phase) || a.company)
        throw new OnboardingError("CONSENT_IN_PROGRESS");
      if (a.expected) {
        const c = set.connections.find((c) => c.id === a.expected?.id);
        if (
          !c ||
          JSON.stringify(companyRevision(c)) !== JSON.stringify(a.expected)
        )
          throw new OnboardingError("ATTEMPT_CONFLICT");
      }
      a.phase = "provider_pending";
      a.flowId = crypto.randomUUID();
      return { id: a.id, revision: a.revision, session, flowId: a.flowId };
    });
  }
  async providerFailure(owner: string, b: OnboardingBinding, unknown: boolean) {
    await this.connections.updateSet(owner, (set) => {
      const a = set.onboarding?.find((a) => a.id === b.id);
      if (
        a?.revision === b.revision &&
        a.flowId === b.flowId &&
        a.phase === "provider_pending"
      )
        a.phase = unknown ? "provider_outcome_unknown" : "failed";
    });
  }
  async validateQuery(owner: string, session: string, query: URLSearchParams) {
    const id = z.string().uuid().parse(query.get("onboarding_attempt"));
    const revision = z.coerce
      .number()
      .int()
      .positive()
      .parse(query.get("onboarding_revision"));
    const a = await this.ownerAttempt(owner, id, revision, session);
    const input = await this.request(owner, a);
    const fields = {
      client_id: a.client,
      redirect_uri: input.redirect_uri,
      state: input.state,
      scope: input.scope,
      code_challenge: input.code_challenge,
      code_challenge_method: "S256",
      resource: `${this.origin}/mcp`,
      response_type: "code",
    };
    if (
      Object.entries(fields).some(
        ([k, v]) => query.getAll(k).length !== 1 || query.get(k) !== v,
      )
    )
      throw new OnboardingError("ATTEMPT_CONFLICT");
    return a;
  }
  async prepareApproval(
    owner: string,
    id: string,
    revision: number,
    session: string,
    query: string,
  ) {
    const a = await this.ownerAttempt(owner, id, revision, session, true);
    const prior = (
      await this.connections.state.get<CompanyGrant>("company-grants", a.client)
    )?.value;
    const hash = await onboardingHash(query);
    return this.ownerEdit(owner, a, session, (a, set) => {
      if (
        !a.company ||
        !["company_verified", "approval_pending"].includes(a.phase)
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      const c = set.connections.find((c) => c.id === a.company?.id);
      if (
        c?.state !== "active" ||
        JSON.stringify(companyRevision(c)) !== JSON.stringify(a.company)
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      // Preserve only the exact previously approved connection/access versions.
      const selected = set.connections.filter(
        (c) =>
          c.id === a.company?.id ||
          (prior?.companies[c.id] === c.generation &&
            (prior.accessRevisions?.[c.id] ?? 0) === (c.accessRevision ?? 0) &&
            c.state === "active"),
      );
      a.approval = {
        queryHash: hash,
        grantRevision: prior?.revision ?? 0,
        selection: selected.map((c) => ({
          id: c.id,
          generation: c.generation,
          access_revision: c.accessRevision ?? 0,
        })),
      };
      a.phase = "approval_pending";
      return a;
    });
  }
  async approval(
    owner: string,
    id: string,
    revision: number,
    session: string,
    query: string,
  ) {
    const a = await this.ownerAttempt(owner, id, revision, session);
    if (
      a.phase !== "approval_pending" ||
      !a.approval ||
      a.approval.queryHash !== (await onboardingHash(query)) ||
      !a.company
    )
      throw new OnboardingError("ATTEMPT_CONFLICT");
    const c = (await this.connections.list(owner)).find(
      (c) => c.id === a.company?.id,
    );
    if (
      c?.state !== "active" ||
      JSON.stringify(companyRevision(c)) !== JSON.stringify(a.company)
    )
      throw new OnboardingError("ATTEMPT_CONFLICT");
    return a;
  }
  async authorized(owner: string, a: OnboardingAttempt, grant: CompanyGrant) {
    return this.edit(owner, a.client, a.id, (current) => {
      if (
        current.revision !== a.revision ||
        current.phase !== "approval_pending"
      )
        throw new OnboardingError("ATTEMPT_CONFLICT");
      current.phase = "authorized";
      current.grantId = grant.grantId as string;
      current.grantRevision = grant.revision as number;
      current.completedAt = this.now();
    });
  }
  async cancel(owner: string, id: string, revision: number, session: string) {
    const a = await this.ownerAttempt(owner, id, revision, session, true);
    return this.ownerEdit(owner, a, session, (a) => {
      if (
        ["provider_pending", "provider_outcome_unknown", "authorized"].includes(
          a.phase,
        )
      )
        throw new OnboardingError("ATTEMPT_CONFLICT", 409, "owner_review");
      a.phase = "cancelled";
      return a;
    });
  }
  async result(owner: string, client: string, grantId: string, id: string) {
    const a = await this.get(owner, client, id);
    const grant = (
      await this.connections.state.get<CompanyGrant>("company-grants", client)
    )?.value;
    const proof = grant?.onboarding;
    if (
      !a.company ||
      !grant ||
      grant.grantId !== grantId ||
      proof?.id !== a.id ||
      proof.revision !== a.revision ||
      proof.companyId !== a.company.id ||
      !["authorized", "approval_pending"].includes(a.phase)
    )
      throw new OnboardingError("ATTEMPT_CONFLICT", 409, "resume");
    const c = await this.connections.authorize(owner, grantId, a.company.id);
    if (JSON.stringify(companyRevision(c)) !== JSON.stringify(a.company))
      throw new OnboardingError("ATTEMPT_CONFLICT", 409, "resume");
    return {
      version: onboardingVersion,
      attempt_id: a.id,
      attempt_revision: a.revision,
      outcome: "completed",
      company_id: c.id,
      generation: c.generation,
      access_revision: c.accessRevision ?? 0,
      grant_revision: grant.revision,
      connection_status: c.state,
      completed_at: new Date(proof.completedAt).toISOString(),
      retain_until: new Date(a.retainUntil).toISOString(),
    };
  }
}
