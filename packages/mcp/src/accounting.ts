import {
  type AccountingActor,
  AccountingValidationError,
  type Bookkeeping,
  DomainError,
  proposalReference,
  reviewCommitInput,
  voucherInput,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import { voucherReviewHtml } from "@fortnox-mcp/ui";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const resourceUri = "ui://fortnox/voucher-review-v1.html";
const reference = z
  .object({
    financial_year: z.number().int(),
    series: z.string(),
    number: z.number().int(),
  })
  .strict();
const error = z
  .object({
    status: z.literal("error"),
    error: z
      .object({
        code: z.string(),
        reason: z.string(),
        provider_code: z.string().nullable(),
        fields: z.array(
          z.object({ path: z.string(), rule: z.string() }).strict(),
        ),
        correlation_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
const dimensionRule = z.enum(["REQUIRED", "ALLOWED", "NOTALLOWED"]);
export const referencesOutput = z
  .object({
    company_id: z.string().uuid(),
    financial_year: z.number().int(),
    retrieved_at: z.number().int(),
    complete: z.boolean(),
    validation_verified: z.boolean(),
    year: z
      .object({ id: z.number().int(), from: z.string(), to: z.string() })
      .strict(),
    locked_through: z.string().nullable(),
    accounts: z.array(
      z
        .object({
          number: z.number().int(),
          active: z.boolean(),
          cost_center: dimensionRule,
          project: dimensionRule,
          information: dimensionRule,
        })
        .strict(),
    ),
    series: z.array(
      z.object({ code: z.string(), manual: z.boolean() }).strict(),
    ),
    cost_centers: z.array(
      z.object({ code: z.string(), active: z.boolean() }).strict(),
    ),
    projects: z.array(
      z.object({ code: z.string(), active: z.boolean() }).strict(),
    ),
  })
  .strict();
const publicProposal = z
  .object({
    company_id: z.string().uuid(),
    company_name: z.string(),
    proposal_id: z.string().uuid(),
    proposal_hash: z.string(),
    expires_at: z.number().int(),
    review_expires_at: z.number().int(),
    voucher: voucherInput,
    totals: z
      .object({ debit: z.string(), credit: z.string(), difference: z.string() })
      .strict(),
  })
  .strict();
const execution = z
  .object({
    state: z.enum([
      "prepared",
      "review_expired",
      "succeeded",
      "failed",
      "outcome_unknown",
    ]),
    reference: reference.nullable().optional(),
    code: z.string().nullable().optional(),
  })
  .strict();
const envelope = <T extends z.ZodType>(data: T) =>
  z.union([
    z
      .object({
        status: z.literal("ok"),
        company_id: z.string().uuid(),
        data,
        retrieved_at: z.string(),
      })
      .strict(),
    error,
  ]);
export function registerAccounting(
  server: McpServer,
  service: Bookkeeping,
  actor: AccountingActor | null,
) {
  const who = () => {
    if (!actor) throw new DomainError("AUTH_REQUIRED");
    return actor;
  };
  const reply = async <T extends z.ZodType>(
    schema: T,
    company: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      const value = await action();
      const result = schema.parse({
        status: "ok",
        company_id: company,
        data: value,
        retrieved_at: new Date().toISOString(),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (cause) {
      const result = error.parse({
        status: "error",
        error: {
          reason:
            cause instanceof ProviderError ? cause.reason : "request_failed",
          provider_code:
            cause instanceof ProviderError ? cause.providerCode : null,
          code:
            cause instanceof DomainError
              ? cause.code
              : cause instanceof z.ZodError
                ? "VALIDATION_FAILED"
                : "UPSTREAM_UNAVAILABLE",
          fields:
            cause instanceof AccountingValidationError ? cause.fields : [],
          correlation_id: crypto.randomUUID(),
        },
      });
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  };
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const securitySchemes = [
    { type: "oauth2", scopes: ["mcp:read", "offline_access"] },
  ];
  const writeSecurity = [
    { type: "oauth2", scopes: ["mcp:read", "mcp:write", "offline_access"] },
  ];
  const refsSchema = envelope(referencesOutput),
    proposalSchema = envelope(publicProposal),
    executionSchema = envelope(execution);
  const validationSchema = envelope(
    z
      .object({
        voucher: voucherInput,
        totals: z
          .object({
            debit: z.string(),
            credit: z.string(),
            difference: z.string(),
          })
          .strict(),
      })
      .strict(),
  );
  server.registerTool(
    "validate_manual_voucher",
    {
      title: "Validate a manual voucher without storing it",
      description:
        "Pure validation with fresh company/year references and exact totals. Works under read-only access; does not create a proposal or approve anything.",
      inputSchema: voucherInput,
      outputSchema: validationSchema,
      annotations: { ...annotations, openWorldHint: true },
      _meta: { securitySchemes },
    },
    (input) =>
      reply(validationSchema, input.company_id, () =>
        service.validate(who(), input),
      ),
  );
  server.registerTool(
    "get_accounting_references",
    {
      title: "Read company accounting references",
      description:
        "Read bounded accounts, fiscal year, series, locked period and dimensions for an explicit company/year. Incomplete or unverified references cannot validate a booking.",
      inputSchema: z
        .object({
          company_id: z.string().uuid(),
          financial_year: z.number().int().positive().safe(),
        })
        .strict(),
      outputSchema: refsSchema,
      annotations: { ...annotations, openWorldHint: true },
      _meta: { securitySchemes },
    },
    (input) =>
      reply(refsSchema, input.company_id, () =>
        service.references(who(), input.company_id, input.financial_year),
      ),
  );
  server.registerResource(
    "voucher-review",
    resourceUri,
    {
      mimeType: "text/html;profile=mcp-app",
      description:
        "Review one immutable company voucher; unsupported clients cannot execute.",
    },
    async () => {
      who();
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: "text/html;profile=mcp-app",
            text: await voucherReviewHtml(),
            _meta: {
              ui: {
                csp: { connectDomains: [], resourceDomains: [] },
                prefersBorder: true,
              },
            },
          },
        ],
      };
    },
  );
  server.registerTool(
    "prepare_manual_vouchers",
    {
      title: "Prepare one manual voucher for review",
      description:
        "Persist one immutable proposal with exact totals. Does not book or approve it. Unsupported clients may prepare but cannot book in review_required.",
      inputSchema: voucherInput,
      outputSchema: proposalSchema,
      annotations: {
        ...annotations,
        readOnlyHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: { securitySchemes: writeSecurity, ui: { resourceUri } },
    },
    async (input) => {
      let capability: string | undefined;
      const result = await reply(proposalSchema, input.company_id, async () => {
        const prepared = await service.prepare(who(), input);
        const { capability: secret, ...view } = prepared;
        capability = secret;
        return view;
      });
      return {
        ...result,
        ...(capability ? { _meta: { voucherReview: { capability } } } : {}),
      };
    },
  );
  server.registerTool(
    "get_voucher_proposal",
    {
      title: "Read immutable proposal",
      description:
        "Read exactly the referenced proposal without issuing a new approval capability.",
      inputSchema: proposalReference,
      outputSchema: envelope(voucherInput),
      annotations,
      _meta: { securitySchemes },
    },
    (input) =>
      reply(
        envelope(voucherInput),
        input.company_id,
        async () => (await service.proposal(who(), input)).voucher,
      ),
  );
  server.registerTool(
    "get_execution_status",
    {
      title: "Read durable voucher execution status",
      description:
        "An unavailable or unknown status is never permission to submit again.",
      inputSchema: proposalReference,
      outputSchema: executionSchema,
      annotations,
      _meta: { securitySchemes },
    },
    (input) =>
      reply(executionSchema, input.company_id, () =>
        service.status(who(), input),
      ),
  );
  server.registerTool(
    "reconcile_voucher_execution",
    {
      title: "Reconcile by trusted Fortnox reference",
      description:
        "Read an exact provider-issued reference. Does not resend a write or infer identity from amount/date.",
      inputSchema: proposalReference,
      outputSchema: executionSchema,
      annotations: { ...annotations, openWorldHint: true, readOnlyHint: false },
      _meta: { securitySchemes },
    },
    (input) =>
      reply(executionSchema, input.company_id, () =>
        service.reconcile(who(), input),
      ),
  );
  // Execution is absent entirely until operation-specific evidence allows it.
  if (service.gates.writes) {
    server.registerTool(
      "commit_reviewed_vouchers",
      {
        title: "Book reviewed voucher",
        description:
          "App-only one-time execution of the immutable proposal. No replacement rows or confirmed flag.",
        inputSchema: reviewCommitInput,
        outputSchema: executionSchema,
        annotations: {
          ...annotations,
          readOnlyHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        _meta: { securitySchemes: writeSecurity, ui: { visibility: ["app"] } },
      },
      (input) =>
        reply(executionSchema, input.company_id, () =>
          service.commit(who(), input, "review"),
        ),
    );
    server.registerTool(
      "create_manual_voucher",
      {
        title: "Book client-managed voucher",
        description:
          "Execute a prepared immutable voucher only when its owner-selected policy is client_managed. All financial validation and durable intent checks still apply.",
        inputSchema: proposalReference,
        outputSchema: executionSchema,
        annotations: {
          ...annotations,
          readOnlyHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
        _meta: { securitySchemes: writeSecurity },
      },
      (input) =>
        reply(executionSchema, input.company_id, () =>
          service.commit(who(), input, "client"),
        ),
    );
  }
}
