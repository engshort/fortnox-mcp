import {
  type ReadDefinition,
  readDefinitions,
  readError,
  readOutput,
} from "@fortnox-mcp/core";
import { z } from "zod";

export function openApiDocument(origin = "") {
  const paths: Record<string, unknown> = {};
  for (const [operationId, entry] of Object.entries(readDefinitions)) {
    const definition: ReadDefinition = entry;
    const input = z.toJSONSchema(definition.input) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const parameters = Object.entries(input.properties ?? {}).map(
      ([name, schema]) => ({
        name,
        in: definition.path.includes(`:${name}`) ? "path" : "query",
        required:
          definition.path.includes(`:${name}`) ||
          input.required?.includes(name) === true,
        schema,
      }),
    );
    const scopes = [
      "api:read",
      ...(definition.module ? ["api:finance:read"] : []),
    ];
    const errors = Object.fromEntries(
      [400, 401, 403, 404, 409, 429, 502, 503].map((status) => [
        status,
        {
          description:
            "Structured error; no provider payload or secret is returned.",
          content: {
            "application/json": { schema: z.toJSONSchema(readError) },
          },
        },
      ]),
    );
    paths[definition.path.replace(/:([a-z_]+)/g, "{$1}")] = {
      get: {
        operationId,
        description:
          "Read-only. Provider operations remain experimental and independently gated; consult capabilities.",
        parameters,
        security: [{ oauth2: scopes }],
        responses: {
          "200": {
            description:
              "Bounded result. Check evidence.complete and continuation.",
            content: {
              "application/json": {
                schema: z.toJSONSchema(readOutput(definition.data)),
              },
            },
          },
          ...errors,
        },
      },
    };
  }
  paths["/openapi.json"] = {
    get: {
      operationId: "read_openapi",
      security: [{ oauth2: ["api:read"] }],
      responses: {
        "200": { description: "This independently authored OpenAPI document." },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: { title: "Fortnox MCP read API", version: "1.0.0" },
    servers: [{ url: `${origin}/api/v1` }],
    "x-oauth-resource": `${origin}/api/v1`,
    paths,
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/auth/oauth2/authorize`,
              tokenUrl: `${origin}/auth/oauth2/token`,
              scopes: {
                "api:read": "Read authorized company metadata and references",
                "api:finance:read":
                  "Read authorized invoices, vouchers and annual account balances",
                offline_access: "Refresh access after owner consent",
              },
            },
          },
        },
      },
    },
  };
}
