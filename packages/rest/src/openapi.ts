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
  const companyParameter = {
    name: "company_id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const bridgeResponse = {
    "200": {
      description:
        "Native provider response, or existing execution status on a repeated key.",
    },
    "201": { description: "Native provider creation acknowledgement." },
    "204": { description: "Native provider acknowledgement without a body." },
    "400": { description: "Invalid schema, parameter, key or body." },
    "401": { description: "Active API OAuth authorization required." },
    "403": { description: "Company, scope, program or operation unavailable." },
    "404": {
      description:
        "Bridge disabled, unknown operation or inaccessible execution.",
    },
    "409": {
      description:
        "Unknown outcome, review required, changed precondition or idempotency conflict. Never automatically resend.",
    },
    "413": { description: "Payload exceeds the configured transport limit." },
    "428": {
      description: "Document replacement requires the current bridge ETag.",
    },
    "429": { description: "Shared provider budget exhausted." },
    "502": { description: "Provider response unavailable or invalid." },
  };
  paths["/companies/{company_id}/fortnox/{fortnox_path}"] = Object.fromEntries(
    ["get", "post", "put", "patch", "delete", "head", "options"].map(
      (method) => [
        method,
        {
          operationId: `bridge_${method}`,
          "x-greedy-path": true,
          description:
            "Opt-in native Fortnox bridge. fortnox_path contains literal slash-separated provider path segments. The private reviewed catalogue determines effect, scopes, media types and availability. GET delivery operations also require write scope and Idempotency-Key. New endpoints require an owner-installed catalogue update.",
          parameters: [
            companyParameter,
            {
              name: "fortnox_path",
              in: "path",
              required: true,
              schema: { type: "string" },
              example: "3/customers",
            },
            {
              name: "Idempotency-Key",
              in: "header",
              required: !["get", "head"].includes(method),
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "If-Match",
              in: "header",
              required: false,
              schema: { type: "string" },
            },
          ],
          security: [
            {
              oauth2: [
                "api:read",
                ...(!["get", "head"].includes(method) ? ["api:write"] : []),
              ],
            },
          ],
          ...(!["get", "head"].includes(method)
            ? {
                requestBody: {
                  content: {
                    "application/json": { schema: {} },
                    "multipart/form-data": { schema: { type: "object" } },
                    "application/octet-stream": {
                      schema: { type: "string", format: "binary" },
                    },
                  },
                },
              }
            : {}),
          responses: bridgeResponse,
        },
      ],
    ),
  );
  paths["/companies/{company_id}/bridge/operations"] = {
    get: {
      operationId: "bridge_operations",
      parameters: [companyParameter],
      security: [{ oauth2: ["api:read"] }],
      responses: {
        "200": {
          description:
            "Versioned catalogue with company-specific availability and reasons.",
        },
      },
    },
  };
  const executionParameters = [
    companyParameter,
    {
      name: "execution_id",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    },
  ];
  paths["/companies/{company_id}/bridge/executions/{execution_id}"] = {
    get: {
      operationId: "bridge_execution_status",
      parameters: executionParameters,
      security: [{ oauth2: ["api:read"] }],
      responses: bridgeResponse,
    },
  };
  paths["/companies/{company_id}/bridge/executions/{execution_id}/reconcile"] =
    {
      post: {
        operationId: "bridge_reconcile",
        parameters: executionParameters,
        security: [{ oauth2: ["api:read", "api:write"] }],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: false },
            },
          },
        },
        responses: bridgeResponse,
      },
    };
  return {
    openapi: "3.1.0",
    info: { title: "Fortnox MCP REST API", version: "1.1.0" },
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
                "api:write":
                  "Execute catalogue-classified Fortnox actions under company policy",
                "api:files": "Transfer validated company-bound Fortnox files",
                offline_access: "Refresh access after owner consent",
              },
            },
          },
        },
      },
    },
  };
}
