import {
  type Actor,
  DomainError,
  type ReadDefinition,
  type ReadServices,
  readDefinitions,
  readError,
  readOutput,
} from "@fortnox-mcp/core";
import { ProviderError } from "@fortnox-mcp/fortnox";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function registerReads(
  server: McpServer,
  services: ReadServices,
  actor: Actor | null,
) {
  for (const [operation, entry] of Object.entries(readDefinitions)) {
    const definition: ReadDefinition = entry;
    if (
      operation !== "get_capabilities" &&
      (!definition.module ||
        !actor ||
        !services.financial.available(
          actor,
          operation as keyof typeof readDefinitions,
        ))
    )
      continue;
    const output = z.union([readOutput(definition.data), readError]);
    server.registerTool(
      operation,
      {
        title: operation.replaceAll("_", " "),
        description:
          "Read authorized company data with explicit completeness and source evidence. Experimental provider operations remain independently gated.",
        inputSchema: definition.input,
        outputSchema: output,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes: [
            {
              type: "oauth2",
              scopes: [
                "mcp:read",
                ...(definition.module ? ["mcp:finance:read"] : []),
              ],
            },
          ],
        },
      },
      async (input) => {
        try {
          if (!actor) throw new DomainError("AUTH_REQUIRED");
          const result = output.parse(
            await services.execute(
              actor,
              operation as keyof typeof readDefinitions,
              input,
            ),
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          const result = readError.parse({
            status: "error",
            error: {
              code:
                error instanceof DomainError
                  ? error.code
                  : error instanceof z.ZodError
                    ? "VALIDATION_FAILED"
                    : "UPSTREAM_UNAVAILABLE",
              reason:
                error instanceof ProviderError
                  ? error.reason
                  : "request_failed",
              provider_code:
                error instanceof ProviderError ? error.providerCode : null,
              correlation_id: crypto.randomUUID(),
            },
          });
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }
      },
    );
  }
}
