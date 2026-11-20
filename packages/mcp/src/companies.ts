import {
  type Bookkeeping,
  CompanyReads,
  type Connections,
  DomainError,
  type FinancialAnalysis,
  type LiquidityAnalysis,
  type OpenItems,
  type PayrollInputs,
  type ReadServices,
  type ReceiptAttachments,
  type ReceiptFiles,
  type Receipts,
  type ReceiptWorkflow,
  type Registers,
  requestActor,
  requirePermission,
  type SalesDocuments,
} from "@fortnox-mcp/core";
import {
  diagnoseConnection,
  diagnosisInput,
  diagnosisOutput,
  FortnoxCompanyReads,
  type FortnoxConnections,
  type FortnoxFinancialReads,
  ProviderError,
} from "@fortnox-mcp/fortnox";
import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { z } from "zod";
import { registerAccounting } from "./accounting.js";
import { registerFinancialReads } from "./analytics.js";
import { registerLiquidity } from "./liquidity.js";
import { registerOpenItems } from "./open-items.js";
import { registerPayrollTools } from "./payroll.js";
import { registerReads } from "./reads.js";
import { registerReceiptAttachments } from "./receipt-attachments.js";
import { registerReceiptFiles } from "./receipt-files.js";
import { registerReceipts } from "./receipts.js";
import { registerRegisters } from "./registers.js";
import { registerSalesDocuments } from "./sales-documents.js";
export interface CompanyIdentity {
  ownerId: string;
  clientId: string;
  scopes: readonly string[];
}
const companyInput = z.object({ company_id: z.string().uuid() }).strict();
const summary = z
  .object({
    company_id: z.string().uuid(),
    name: z.string(),
    state: z.enum(["active", "reconnect_required", "disconnected"]),
    mode: z.enum(["service", "user"]),
    read_only: z.boolean(),
    manual_vouchers: z.enum(["review_required", "client_managed"]),
  })
  .strict();
const evidence = z
  .object({
    retrieved_at: z.string(),
    complete: z.literal(true),
    sources: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict();
const errorOutput = z
  .object({
    status: z.literal("error"),
    error: z
      .object({
        code: z.string(),
        reason: z.string(),
        correlation_id: z.string().uuid(),
        provider_code: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const listOutput = z.union([
  z
    .object({
      status: z.literal("ok"),
      data: z
        .object({ companies: z.array(summary), count: z.number().int() })
        .strict(),
      evidence,
      continuation: z.null(),
    })
    .strict(),
  errorOutput,
]);
const statusOutput = z.union([
  z
    .object({
      status: z.literal("ok"),
      company_id: z.string().uuid(),
      data: summary,
      evidence,
      continuation: z.null(),
    })
    .strict(),
  errorOutput,
]);
const profileOutput = z.union([
  z
    .object({
      status: z.literal("ok"),
      company_id: z.string().uuid(),
      data: z
        .object({ name: z.string(), organization_number: z.string() })
        .strict(),
      evidence,
      continuation: z.null(),
    })
    .strict(),
  errorOutput,
]);
export function companyServer(context: {
  identity: CompanyIdentity | null;
  connections: Connections;
  provider: FortnoxConnections;
  testMode: boolean;
  diagnostics?: boolean;
  companyReads?: CompanyReads;
  reads?: ReadServices;
  bookkeeping?: Bookkeeping;
  receiptFiles?: ReceiptFiles;
  receipts?: Receipts;
  receiptAttachments?: ReceiptAttachments;
  receiptWorkflow?: ReceiptWorkflow;
  registers?: Registers;
  payroll?: PayrollInputs;
  openItems?: OpenItems;
  liquidity?: LiquidityAnalysis;
  financial?: { service: FinancialAnalysis; provider: FortnoxFinancialReads };
  salesDocuments?: SalesDocuments;
}) {
  const server = new McpServer(
    { name: "fortnox-mcp-product", version: "0.0.0-experimental" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const proof = () => ({
    retrieved_at: new Date().toISOString(),
    complete: true as const,
    sources: [] as string[],
    warnings: [],
  });
  const companyReads =
    context.companyReads ??
    new CompanyReads(
      context.connections,
      new FortnoxCompanyReads(context.connections, context.provider),
      true,
    );
  const actor = context.identity ? requestActor(context.identity, "mcp") : null;
  const identity = () => {
    if (!actor) throw new DomainError("AUTH_REQUIRED");
    requirePermission(actor, "read");
    return actor;
  };
  const reply = async <T>(
    schema: z.ZodType<T>,
    operation: () => Promise<unknown>,
  ) => {
    let result: unknown;
    try {
      result = await operation();
    } catch (error) {
      result = {
        status: "error",
        error: {
          code:
            error instanceof DomainError ? error.code : "UPSTREAM_UNAVAILABLE",
          reason:
            error instanceof ProviderError ? error.reason : "request_failed",
          correlation_id: crypto.randomUUID(),
          provider_code:
            error instanceof ProviderError ? error.providerCode : null,
        },
      };
    }
    const parsed = schema.parse(result);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(parsed) }],
      structuredContent: parsed as Record<string, unknown>,
      ...(typeof parsed === "object" &&
      parsed !== null &&
      "status" in parsed &&
      parsed.status === "error"
        ? { isError: true }
        : {}),
    };
  };
  const common = {
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      securitySchemes: [
        { type: "oauth2", scopes: ["mcp:read", "offline_access"] },
      ],
    },
  };
  server.registerTool(
    "list_companies",
    {
      ...common,
      title: "List authorized companies",
      description:
        "List companies authorized for this client. Installation-wide approval includes newly connected companies automatically; selected-company grants remain limited to their approved versions.",
      inputSchema: z.object({}).strict(),
      outputSchema: listOutput,
    },
    () =>
      reply(listOutput, async () => {
        const who = identity();
        const data = await companyReads.companies(who);
        return {
          status: "ok",
          data,
          evidence: {
            ...proof(),
            warnings: data.companies.length
              ? []
              : [
                  "No companies are currently authorized for this client. The installation owner can connect a company or check this client's access under AI clients.",
                ],
          },
          continuation: null,
        };
      }),
  );
  server.registerTool(
    "get_connection_status",
    {
      ...common,
      title: "Read connection status",
      description:
        "Read safe local status for an explicitly authorized company.",
      inputSchema: companyInput,
      outputSchema: statusOutput,
    },
    (input) =>
      reply(statusOutput, async () => {
        const who = identity();
        const data = await companyReads.status(who, input.company_id);
        return {
          status: "ok",
          company_id: data.company_id,
          data,
          evidence: proof(),
          continuation: null,
        };
      }),
  );
  if (context.diagnostics !== false)
    server.registerTool(
      "diagnose_connection",
      {
        ...common,
        title: "Diagnose an authorized company connection",
        description:
          "Bounded read-only diagnosis. Unknown permission/license causes remain unknown. No activation or write.",
        inputSchema: diagnosisInput,
        outputSchema: z.union([diagnosisOutput, errorOutput]),
      },
      (input) =>
        reply(z.union([diagnosisOutput, errorOutput]), async () => {
          const who = identity();
          return diagnoseConnection(
            {
              ...context,
              owner: who.ownerId,
              authorize: (id) =>
                context.connections.authorize(
                  who.ownerId,
                  who.clientId,
                  id,
                  false,
                ),
            },
            input.company_id,
          );
        }),
    );
  server.registerTool(
    "get_company_profile",
    {
      ...common,
      title: "Read company profile",
      description:
        "Read Company Information with an authenticated company-bound grant and verified provider identity.",
      inputSchema: companyInput,
      outputSchema: profileOutput,
    },
    (input) =>
      reply(profileOutput, async () => {
        const who = identity();
        const data = await companyReads.profile(who, input.company_id);
        return {
          status: "ok",
          company_id: input.company_id,
          data,
          evidence: {
            ...proof(),
            sources: ["Fortnox GET /3/companyinformation"],
          },
          continuation: null,
        };
      }),
  );
  if (context.bookkeeping?.gates.references)
    registerAccounting(server, context.bookkeeping, context.identity);
  if (context.registers)
    registerRegisters(server, context.registers, context.identity);
  if (context.financial)
    registerFinancialReads(
      server,
      context.financial.service,
      context.financial.provider,
      context.identity,
    );
  if (context.payroll)
    registerPayrollTools(server, context.payroll, context.identity);
  if (context.openItems)
    registerOpenItems(server, context.openItems, context.identity);
  if (context.liquidity)
    registerLiquidity(server, context.liquidity, context.identity);
  if (context.salesDocuments)
    registerSalesDocuments(server, context.salesDocuments, context.identity);
  if (context.receiptFiles)
    registerReceiptFiles(server, context.receiptFiles, actor);
  if (context.receipts)
    registerReceipts(server, context.receipts, actor, context.receiptWorkflow);
  if (context.receiptAttachments)
    registerReceiptAttachments(server, context.receiptAttachments, actor);
  if (context.reads)
    registerReads(
      server,
      context.reads,
      actor,
      context.salesDocuments?.enabled,
    );
  return server;
}
