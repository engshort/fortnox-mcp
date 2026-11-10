import {
  type AccountingActor,
  businessDifference,
  businessReference,
  DomainError,
  priceSelection,
  type RegisterResource,
  type Registers,
  referenceScopes,
  registerId,
  registerQueries,
  type WritableRegister,
  writableRegisters,
} from "@fortnox-mcp/core";
import { ProviderError, registerOutputFields } from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const plurals = {
  customer: "customers",
  supplier: "suppliers",
  article: "articles",
  terms_of_payment: "terms_of_payment",
  terms_of_delivery: "terms_of_delivery",
  way_of_delivery: "ways_of_delivery",
  currency: "currencies",
  unit: "units",
  cost_center: "cost_centers",
  project: "projects",
  price_list: "price_lists",
  price: "prices",
  mode_of_payment: "modes_of_payment",
} as const;
const error = z
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
const envelope = (data: z.ZodType) =>
  z.union([
    z
      .object({ status: z.literal("ok"), company_id: z.string().uuid(), data })
      .strict(),
    error,
  ]);
const execution = envelope(
  z
    .object({
      state: z.enum([
        "prepared",
        "succeeded",
        "failed",
        "outcome_unknown",
        "applied_different",
      ]),
      difference: businessDifference.optional(),
      reference: z.string().optional(),
    })
    .strict(),
);
export function registerRegisters(
  server: McpServer,
  service: Registers,
  actor: AccountingActor | null,
) {
  const who = () => {
    if (!actor) throw new DomainError("AUTH_REQUIRED");
    return actor;
  };
  const reply = async (
    schema: z.ZodType,
    company: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      const data = await action();
      const result = schema.parse({ status: "ok", company_id: company, data });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (cause) {
      const result = error.parse({
        status: "error",
        error: {
          code:
            cause instanceof DomainError
              ? cause.code
              : cause instanceof z.ZodError
                ? "VALIDATION_FAILED"
                : "UPSTREAM_UNAVAILABLE",
          reason:
            cause instanceof ProviderError ? cause.reason : "request_failed",
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
    openWorldHint: true,
  };
  const security = (write = false) => ({
    _meta: {
      securitySchemes: [
        {
          type: "oauth2",
          scopes: [
            "mcp:read",
            ...(write ? ["mcp:write"] : []),
            "offline_access",
          ],
        },
      ],
    },
  });
  for (const resource of [
    ...Object.keys(writableRegisters),
    ...Object.keys(referenceScopes),
  ] as RegisterResource[]) {
    const record = z
      .object({
        id: registerId,
        fields: registerOutputFields[resource].strict(),
        version: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict();
    const query =
      resource in registerQueries
        ? registerQueries[resource as WritableRegister]
        : resource === "price"
          ? priceSelection
          : z.object({}).strict();
    const listOutput = envelope(
      z
        .object({
          company_id: z.string().uuid(),
          records: z.array(record).max(500),
          complete: z.boolean(),
          next_page: z.number().int().positive().nullable(),
        })
        .strict(),
    );
    if (service.enabled.includes(`${resource}.list`))
      server.registerTool(
        `list_${plurals[resource]}`,
        {
          title: `List ${plurals[resource]}`,
          description:
            "Read only this company's register. Filters are provider filters, not local guesses. Bounded retrieval returns complete=false when partial; next_page resumes the same explicit query and company. No global current company.",
          inputSchema: z
            .object({
              company_id: z.string().uuid(),
              query: resource === "price" ? query : query.optional(),
              start_page: z.number().int().min(1).max(10000).optional(),
            })
            .strict(),
          outputSchema: listOutput,
          annotations,
          ...security(),
        },
        (input) =>
          reply(listOutput, input.company_id, () =>
            service.list(
              who(),
              input.company_id,
              resource,
              input.query ?? {},
              input.start_page ?? 1,
            ),
          ),
      );
    const getOutput = envelope(
      z
        .object({
          company_id: z.string().uuid(),
          record,
          complete: z.literal(true),
        })
        .strict(),
    );
    if (service.enabled.includes(`${resource}.get`))
      server.registerTool(
        `get_${resource}`,
        {
          title: `Read ${resource}`,
          description:
            "Read one exact company-bound register identity and its source version. Missing records differ from inaccessible provider data. Price reads select the base quantity (0) for an explicit price list and article.",
          inputSchema: z
            .object({
              company_id: z.string().uuid(),
              id: registerId,
              ...(resource === "price" ? { selection: priceSelection } : {}),
            })
            .strict(),
          outputSchema: getOutput,
          annotations,
          ...security(),
        },
        (input) =>
          reply(getOutput, input.company_id, () =>
            service.get(
              who(),
              input.company_id,
              resource,
              input.id,
              "selection" in input
                ? priceSelection.parse(input.selection)
                : undefined,
            ),
          ),
      );
  }
  for (const resource of Object.keys(writableRegisters) as WritableRegister[]) {
    const definition = writableRegisters[resource];
    for (const action of ["create", "update"] as const) {
      const operation = `${resource}.${action}` as const;
      if (!service.enabled.includes(operation)) continue;
      const fields =
        action === "create" ? definition.schema : definition.schema.partial();
      const preview = z
        .object({
          resource: z.literal(resource),
          action: z.literal(action),
          id: registerId.nullable(),
          before: registerOutputFields[resource].strict().nullable(),
          after: registerOutputFields[resource].partial().strict(),
          diff: z.array(
            z
              .object({
                field: z.string(),
                before: z.union([z.string(), z.boolean(), z.null()]),
                after: z.union([z.string(), z.boolean()]),
              })
              .strict(),
          ),
        })
        .strict();
      const prepared = envelope(
        z
          .object({
            company_id: z.string().uuid(),
            proposal_id: z.string().uuid(),
            proposal_hash: z.string(),
            expires_at: z.number().int(),
            preview,
          })
          .strict(),
      );
      const inputSchema = z
        .object({
          company_id: z.string().uuid(),
          id: action === "create" ? registerId.optional() : registerId,
          fields,
        })
        .strict();
      server.registerTool(
        `prepare_${resource}_${action}`,
        {
          title: `Prepare ${resource} ${action}`,
          description:
            "Prepare an immutable register change and show before/after/diff. Omitted fields remain unchanged on updates. Empty strings, API_BLANK and unsupported fields are rejected; field clearing requires separate verification. Company references are resolved without creating defaults.",
          inputSchema,
          outputSchema: prepared,
          annotations: {
            ...annotations,
            readOnlyHint: false,
            idempotentHint: false,
          },
          ...security(true),
        },
        (input) =>
          reply(prepared, input.company_id, () =>
            service.writes.prepare(who(), input.company_id, operation, {
              ...(input.id ? { id: input.id } : {}),
              fields: input.fields,
            }),
          ),
      );
      server.registerTool(
        `${action}_${resource}`,
        {
          title: `${action} ${resource}`,
          description:
            "Execute this exact prepared change once. Rechecks current permissions and source version before dispatch. A lost response is outcome_unknown; do not prepare another attempt until reconciled.",
          inputSchema: businessReference,
          outputSchema: execution,
          annotations: {
            ...annotations,
            readOnlyHint: false,
            destructiveHint: action === "update",
          },
          ...security(true),
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
            "Read the exact trusted provider identity and compare the intended field digest. Never sends a write. Missing or ambiguous identity stays outcome_unknown; absence does not authorize resending.",
          inputSchema: businessReference,
          outputSchema: execution,
          annotations,
          ...security(),
        },
        (input) =>
          reply(execution, input.company_id, () =>
            service.writes.reconcile(who(), operation, input),
          ),
      );
    }
  }
  if (
    service.enabled.some(
      (op) => op.endsWith(".create") || op.endsWith(".update"),
    )
  )
    server.registerTool(
      "get_register_write_status",
      {
        title: "Read prepared register write status",
        description:
          "Read only the initiating client's durable proposal/execution state. Does not execute, approve, reconcile or resend anything.",
        inputSchema: businessReference,
        outputSchema: execution,
        annotations: { ...annotations, openWorldHint: false },
        ...security(),
      },
      (input) =>
        reply(execution, input.company_id, () =>
          service.writes.status(who(), input),
        ),
    );
}
