import {
  type Bookkeeping,
  type Connections,
  DomainError,
  type ReceiptAttachments,
  type ReceiptFiles,
  type Receipts,
} from "@fortnox-mcp/core";
import {
  companyInformation,
  type FortnoxConnections,
  FortnoxHttp,
  ProviderError,
} from "@fortnox-mcp/fortnox";
import { McpServer } from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { z } from "zod";
import { registerAccounting } from "./accounting.js";
import { registerReceiptAttachments } from "./receipt-attachments.js";
import { registerReceiptFiles } from "./receipt-files.js";
import { registerReceipts } from "./receipts.js";
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
  bookkeeping?: Bookkeeping;
  receiptFiles?: ReceiptFiles;
  receipts?: Receipts;
  receiptAttachments?: ReceiptAttachments;
}) {
  const server = new McpServer(
    { name: "fortnox-mcp-product", version: "0.0.0-experimental" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const proof = () => ({
    retrieved_at: new Date().toISOString(),
    complete: true as const,
    sources: [] as string[],
    warnings: ["Product live acceptance pending; test installation only."],
  });
  const describe = (c: Awaited<ReturnType<Connections["list"]>>[number]) => ({
    company_id: c.id,
    name: c.name,
    state: c.state,
    mode: c.mode,
    read_only: c.readOnly,
    manual_vouchers: c.review,
  });
  const identity = () => {
    if (!context.identity?.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    return context.identity;
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
      title: "List authorized test companies",
      description:
        "List only companies in this client's durable grant. Product live acceptance is pending.",
      inputSchema: z.object({}).strict(),
      outputSchema: listOutput,
    },
    () =>
      reply(listOutput, async () => {
        const who = identity();
        const companies = [];
        for (const c of await context.connections.list(who.ownerId)) {
          try {
            await context.connections.authorize(
              who.ownerId,
              who.clientId,
              c.id,
              false,
            );
            companies.push(describe(c));
          } catch (error) {
            if (
              !(error instanceof DomainError) ||
              !["COMPANY_FORBIDDEN", "CONNECTION_DISCONNECTED"].includes(
                error.code,
              )
            )
              throw error;
          }
        }
        return {
          status: "ok",
          data: { companies, count: companies.length },
          evidence: proof(),
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
        const c = await context.connections.authorize(
          who.ownerId,
          who.clientId,
          input.company_id,
          false,
        );
        return {
          status: "ok",
          company_id: c.id,
          data: describe(c),
          evidence: proof(),
          continuation: null,
        };
      }),
  );
  if (context.testMode)
    server.registerTool(
      "get_company_profile",
      {
        ...common,
        title: "Read test company profile",
        description:
          "Read a verified tenant's Company Information in an explicitly enabled test installation. No financial operation.",
        inputSchema: companyInput,
        outputSchema: profileOutput,
      },
      (input) =>
        reply(profileOutput, async () => {
          const who = identity();
          const c = await context.connections.authorize(
            who.ownerId,
            who.clientId,
            input.company_id,
          );
          if (!context.testMode)
            throw new DomainError("CAPABILITY_UNAVAILABLE");
          if (!c.scopes.includes("companyinformation"))
            throw new ProviderError("CAPABILITY_UNAVAILABLE", "missing_scope");
          const active = async () => {
            await context.connections.authorize(
              who.ownerId,
              who.clientId,
              c.id,
            );
          };
          const http = new FortnoxHttp({
            fetch: context.provider.config.fetch,
            state: context.connections.state,
          });
          const raw = await http.read(
            {
              owner: who.ownerId,
              company: c.id,
              generation: c.generation,
              tenant: c.tenant,
              clientId: (await context.connections.credentials(who.ownerId, c))
                .clientId,
              assertActive: active,
              token: (force) => context.provider.token(who.ownerId, c, force),
            },
            "company_information",
          );
          const data = companyInformation.parse(raw).CompanyInformation;
          if (String(data.DatabaseNumber) !== c.tenant)
            throw new DomainError("COMPANY_FORBIDDEN");
          return {
            status: "ok",
            company_id: c.id,
            data: {
              name: data.CompanyName,
              organization_number: data.OrganizationNumber ?? "",
            },
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
  if (context.receiptFiles)
    registerReceiptFiles(server, context.receiptFiles, context.identity);
  if (context.receipts)
    registerReceipts(server, context.receipts, context.identity);
  if (context.receiptAttachments)
    registerReceiptAttachments(
      server,
      context.receiptAttachments,
      context.identity,
    );
  return server;
}
