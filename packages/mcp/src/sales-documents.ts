import {
  type AccountingActor,
  businessReference,
  DomainError,
  documentRowId,
  type SalesDocuments,
  type SalesResource,
  salesActions,
  salesDocumentId,
  salesHeaderSchemas,
  salesQueries,
  salesRowSchemas,
  salesRowsInput,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const failure = z
  .object({
    status: z.literal("error"),
    error: z
      .object({
        code: z.string(),
        reason: z.string(),
        correlation_id: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
const result = (data: z.ZodType) =>
  z.union([
    z
      .object({ status: z.literal("ok"), company_id: z.string().uuid(), data })
      .strict(),
    failure,
  ]);
const execution = result(
  z
    .object({
      state: z.enum(["prepared", "succeeded", "failed", "outcome_unknown"]),
      reference: salesDocumentId.optional(),
    })
    .strict(),
);
const summaryText = z.string().max(20000).nullable().optional();
const readAmount = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,47})(?:\.\d{1,18})?$/)
  .nullable()
  .optional();
const booleanKeys = new Set(["VATIncluded", "NotCompleted"]);
const readEmail = z
  .object({
    EmailAddressTo: summaryText,
    EmailAddressCC: summaryText,
    EmailAddressBCC: summaryText,
    EmailSubject: summaryText,
    EmailBody: summaryText,
  })
  .strict();
const observes = z
  .object({
    cancelled: z.boolean().nullable(),
    booked: z.boolean().nullable(),
    sent: z.boolean().nullable(),
    credit: z.boolean().nullable(),
    order_reference: salesDocumentId.nullable(),
    invoice_reference: salesDocumentId.nullable(),
    credit_reference: salesDocumentId.nullable(),
    offer_reference: salesDocumentId.nullable().optional(),
  })
  .strict();
const readFields = (resource: SalesResource) =>
  z
    .object(
      Object.fromEntries(
        Object.keys(salesHeaderSchemas[resource].shape).map((key) => [
          key,
          key === "EmailInformation"
            ? readEmail.optional()
            : booleanKeys.has(key)
              ? z.boolean().nullable().optional()
              : summaryText,
        ]),
      ),
    )
    .strict();
const readRows = (resource: SalesResource) =>
  z
    .object(
      Object.fromEntries(
        Object.keys(salesRowSchemas[resource].shape).map((key) => [
          key,
          key === "AccountNumber"
            ? z.number().int().min(1000).max(9999).nullable().optional()
            : summaryText,
        ]),
      ),
    )
    .strict();
const readRecord = (resource: SalesResource) =>
  z
    .object({
      id: salesDocumentId,
      version: z.string().regex(/^[a-f0-9]{64}$/),
      fields: readFields(resource),
      rows: z.array(readRows(resource)).max(100),
      amounts: z
        .object({
          net: readAmount,
          vat: readAmount,
          total: readAmount,
          balance: readAmount,
          rounding: readAmount,
        })
        .strict()
        .optional(),
      editable: z.boolean(),
      complete: z.boolean(),
      observed: observes,
    })
    .strict();
const scopes = (write = false) => ({
  _meta: {
    securitySchemes: [
      {
        type: "oauth2",
        scopes: ["mcp:read", ...(write ? ["mcp:write"] : []), "offline_access"],
      },
    ],
  },
});
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const plurals = {
  offer: "offers",
  order: "orders",
  invoice: "invoices",
} as const;

export function registerSalesDocuments(
  server: McpServer,
  service: SalesDocuments,
  actor: AccountingActor | null,
) {
  const who = () => {
    if (!actor) throw new DomainError("AUTH_REQUIRED");
    return actor;
  };
  const reply = async (
    schema: z.ZodType,
    company: string,
    call: () => Promise<unknown>,
  ) => {
    try {
      const value = schema.parse({
        status: "ok",
        company_id: company,
        data: await call(),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
        structuredContent: value as Record<string, unknown>,
      };
    } catch (cause) {
      const value = failure.parse({
        status: "error",
        error: {
          code:
            cause instanceof DomainError ? cause.code : "UPSTREAM_UNAVAILABLE",
          reason:
            cause instanceof ProviderError ? cause.reason : "request_failed",
          correlation_id: crypto.randomUUID(),
        },
      });
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
        structuredContent: value,
      };
    }
  };
  for (const resource of Object.keys(salesActions) as SalesResource[]) {
    const record = readRecord(resource);
    if (service.enabled.includes(`${resource}.list`)) {
      const output = result(
        z
          .object({
            company_id: z.string().uuid(),
            records: z.array(record).max(500),
            complete: z.boolean(),
            next_page: z.number().int().positive().nullable(),
          })
          .strict(),
      );
      server.registerTool(
        `list_${plurals[resource]}`,
        {
          title: `List ${plurals[resource]}`,
          description:
            "Read only the selected company using reviewed provider filters. Lists are bounded and report incomplete retrieval explicitly. Summary records have complete=false and unknown states where detail is absent; read the exact document before preparing any change.",
          inputSchema: z
            .object({
              company_id: z.string().uuid(),
              query: salesQueries[resource].optional(),
              start_page: z.number().int().min(1).max(10000).optional(),
            })
            .strict(),
          outputSchema: output,
          annotations: readAnnotations,
          ...scopes(),
        },
        (input) =>
          reply(output, input.company_id, () =>
            service.list(
              who(),
              input.company_id,
              resource,
              input.query ?? {},
              input.start_page ?? 1,
            ),
          ),
      );
    }
    if (service.enabled.includes(`${resource}.get`)) {
      const output = result(
        z
          .object({
            company_id: z.string().uuid(),
            record,
            complete: z.boolean(),
          })
          .strict(),
      );
      server.registerTool(
        `get_${resource}`,
        {
          title: `Read ${resource}`,
          description:
            "Read the exact company-bound document ID, current source version, observed state and projected rows. Nullable or missing fields never become invented defaults. editable=false blocks this bounded write profile; it is not provider permission to edit.",
          inputSchema: z
            .object({ company_id: z.string().uuid(), id: salesDocumentId })
            .strict(),
          outputSchema: output,
          annotations: readAnnotations,
          ...scopes(),
        },
        (input) =>
          reply(output, input.company_id, () =>
            service.get(who(), input.company_id, resource, input.id),
          ),
      );
    }
    for (const action of salesActions[resource]) {
      if (
        action === "list" ||
        action === "get" ||
        !service.enabled.includes(`${resource}.${action}`)
      )
        continue;
      const operation = `${resource}.${action}`;
      const writingContent = action === "create" || action === "update";
      const prepareInput = writingContent
        ? z
            .object({
              company_id: z.string().uuid(),
              financial_year: z.number().int().positive().safe(),
              ...(action === "update" ? { id: salesDocumentId } : {}),
              fields:
                action === "create"
                  ? salesHeaderSchemas[resource]
                  : salesHeaderSchemas[resource].partial(),
              rows: salesRowsInput(resource),
              removed_row_ids: z.array(documentRowId).max(20),
            })
            .strict()
        : z
            .object({
              company_id: z.string().uuid(),
              financial_year: z.number().int().positive().safe(),
              id: salesDocumentId,
            })
            .strict();
      const writeRow = salesRowSchemas[resource];
      const preview = writingContent
        ? z
            .object({
              resource: z.literal(resource),
              action: z.literal(action),
              before: z
                .object({
                  fields: readFields(resource),
                  rows: z.array(readRows(resource)).max(100),
                })
                .strict()
                .nullable(),
              intended_fields: salesHeaderSchemas[resource],
              intended_rows: z.array(writeRow).max(20),
              row_diff: z
                .array(
                  z
                    .object({
                      kind: z.enum(["added", "updated", "removed"]),
                      row_id: documentRowId.nullable(),
                      before: writeRow.nullable(),
                      after: writeRow.nullable(),
                    })
                    .strict(),
                )
                .max(40),
              removed_row_ids: z.array(documentRowId).max(20),
              totals: z
                .object({
                  net: z.string(),
                  vat: z.string(),
                  gross: z.string(),
                  rounding: z.literal("unrounded"),
                  provider_total_verified: z.literal(false),
                })
                .strict(),
            })
            .strict()
        : z
            .object({
              resource: z.literal(resource),
              action: z.literal(action),
              provider_id: salesDocumentId,
              observed: observes,
              ...(action === "email" ? { recipient: z.email().max(254) } : {}),
            })
            .strict();
      const prepared = result(
        z
          .object({
            company_id: z.string().uuid(),
            proposal_id: z.string().uuid(),
            proposal_hash: z.string().regex(/^[a-f0-9]{64}$/),
            expires_at: z.number().int(),
            preview,
          })
          .strict(),
      );
      server.registerTool(
        `prepare_${resource}_${action}`,
        {
          title: `Prepare ${resource} ${action}`,
          description: writingContent
            ? "Store an immutable company/client-bound proposal with full intended content and row diff. Every source row ID must be retained or explicitly removed. No implicit account, VAT, currency, date or fiscal year. Changed source content requires new preparation. Standard client approval does not grant manual-voucher approval."
            : "Prepare this separate lifecycle action using the current document version and state. Email uses only explicitly approved test recipients and is an external side effect. Payment initiation, e-invoice, eprint and reminder channels are unavailable.",
          inputSchema: prepareInput,
          outputSchema: prepared,
          annotations: {
            ...readAnnotations,
            readOnlyHint: false,
            idempotentHint: false,
          },
          ...scopes(true),
        },
        (input: z.infer<typeof prepareInput>) => {
          const { company_id, ...body } = input;
          return reply(prepared, company_id, () =>
            service.writes.prepare(who(), company_id, operation, body),
          );
        },
      );
      const effects = {
        ...readAnnotations,
        readOnlyHint: false,
        destructiveHint: action !== "create",
        openWorldHint: action === "email",
      };
      server.registerTool(
        `${action}_${resource}`,
        {
          title: `${action} ${resource}`,
          description:
            "Execute only this immutable prepared intent with current owner/company/grant/scope/program/policy/source checks. Repeated intent calls never dispatch twice. A lost answer is outcome_unknown, not permission to resend. Return the exact observed provider reference and execution status.",
          inputSchema: businessReference,
          outputSchema: execution,
          annotations: effects,
          ...scopes(true),
        },
        (input) =>
          reply(execution, input.company_id, () =>
            service.writes.execute(who(), operation, input),
          ),
      );
      server.registerTool(
        `reconcile_${resource}_${action}`,
        {
          title: `Reconcile ${resource} ${action}`,
          description:
            "Read exact trusted identities and update only durable reconciliation metadata. Never dispatch or resend a provider write. Compare intended content or the exact conversion relationship; missing identity or a Sent flag alone leaves the outcome unknown.",
          inputSchema: businessReference,
          outputSchema: execution,
          annotations: { ...readAnnotations, readOnlyHint: false },
          ...scopes(),
        },
        (input) =>
          reply(execution, input.company_id, () =>
            service.writes.reconcile(who(), operation, input),
          ),
      );
    }
  }
  if (
    service.enabled.some((op) => !op.endsWith(".list") && !op.endsWith(".get"))
  ) {
    server.registerTool(
      "get_sales_document_write_status",
      {
        title: "Read sales document execution status",
        description:
          "Read only the initiating client’s durable proposal or execution; never approves, executes or reconciles.",
        inputSchema: businessReference,
        outputSchema: execution,
        annotations: readAnnotations,
        ...scopes(),
      },
      (input) =>
        reply(execution, input.company_id, () =>
          service.writes.status(who(), input),
        ),
    );
  }
}
