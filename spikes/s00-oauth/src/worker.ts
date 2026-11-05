import { diagnosticWindow, type McpRequestDiagnostic } from "./diagnostics.js";
import { fileCodec } from "./file-codec.js";
import { d1FileStore } from "./file-d1.js";
import type { FileTransportDiagnostic } from "./file-socket-transport.js";
import { fileValidator } from "./file-validation.js";
import { workerFileByteBudget } from "./file-worker-budget.js";
import { workerFileTransport } from "./file-worker-transport.js";
import { parseFileOrigins } from "./files.js";
import { createProbeHandler } from "./http.js";
import { d1ReviewStore } from "./review.js";
import { d1RuntimeReviews } from "./runtime-d1.js";
import { handleRuntimeRequest } from "./runtime-http.js";

interface Env {
  AUTH_DB: D1Database;
  PROBE_ORIGIN: string;
  AUTH_SECRET: string;
  OWNER_ID: string;
  PROBE_PROTOCOL_DIAGNOSTICS?: string;
  PROBE_PROTOCOL_DIAGNOSTICS_UNTIL?: string;
  PROBE_SYNTHETIC_REVIEW?: string;
  PROBE_SYNTHETIC_FILES?: string;
  PROBE_FILE_ORIGINS?: string;
  PROBE_FILE_CLEANUP?: string;
  PROBE_RUNTIME_TOKEN?: string;
  PROBE_RUNTIME_UNTIL?: string;
}
let diagnosticConfig: string | undefined;
let emitDiagnostic: ((event: McpRequestDiagnostic) => void) | undefined;
let emitFileSource: ((event: { hostname: string }) => void) | undefined;
let emitFileTransport: ((event: FileTransportDiagnostic) => void) | undefined;
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.AUTH_SECRET || !env.OWNER_ID || !env.PROBE_ORIGIN)
      return new Response("Probe not provisioned", { status: 503 });
    const runtime = await handleRuntimeRequest(request, {
      origin: env.PROBE_ORIGIN,
      token: env.PROBE_RUNTIME_TOKEN,
      until: env.PROBE_RUNTIME_UNTIL,
      context: {
        owner: env.OWNER_ID,
        secret: env.AUTH_SECRET,
        files: d1FileStore(env.AUTH_DB),
        reviews: d1RuntimeReviews(env.AUTH_DB),
        validator: fileValidator,
        codec: fileCodec,
      },
    });
    if (runtime) return runtime;
    const key = JSON.stringify([
      env.PROBE_PROTOCOL_DIAGNOSTICS,
      env.PROBE_PROTOCOL_DIAGNOSTICS_UNTIL,
    ]);
    if (key !== diagnosticConfig) {
      diagnosticConfig = key;
      emitDiagnostic = diagnosticWindow(
        env.PROBE_PROTOCOL_DIAGNOSTICS,
        env.PROBE_PROTOCOL_DIAGNOSTICS_UNTIL,
        (event) => console.info({ event: "s00_mcp_request", ...event }),
      );
      emitFileSource = diagnosticWindow(
        env.PROBE_PROTOCOL_DIAGNOSTICS,
        env.PROBE_PROTOCOL_DIAGNOSTICS_UNTIL,
        (event: { hostname: string }) =>
          console.info({ event: "s00_file_source", ...event }),
      );
      emitFileTransport = diagnosticWindow(
        env.PROBE_PROTOCOL_DIAGNOSTICS,
        env.PROBE_PROTOCOL_DIAGNOSTICS_UNTIL,
        (event: FileTransportDiagnostic) =>
          console.info({ event: "s00_file_transport", ...event }),
      );
    }
    return createProbeHandler({
      origin: env.PROBE_ORIGIN,
      secret: env.AUTH_SECRET,
      ownerId: env.OWNER_ID,
      database: env.AUTH_DB,
      ...(env.PROBE_SYNTHETIC_FILES === "true" &&
      env.PROBE_FILE_CLEANUP === "scheduled-5m"
        ? {
            files: {
              store: d1FileStore(env.AUTH_DB),
              transport: workerFileTransport(emitFileTransport),
              validator: fileValidator,
              codec: fileCodec,
              origins: parseFileOrigins(env.PROBE_FILE_ORIGINS),
              maxBytes: workerFileByteBudget,
              ...(emitFileSource
                ? {
                    onSourceHostname: (hostname: string) =>
                      emitFileSource?.({ hostname }),
                  }
                : {}),
            },
          }
        : {}),
      ...(env.PROBE_SYNTHETIC_REVIEW === "true"
        ? { review: d1ReviewStore(env.AUTH_DB) }
        : {}),
      ...(emitDiagnostic ? { onMcpRequest: emitDiagnostic } : {}),
    }).fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    // Cleanup remains available after ingress is disabled. The operator must
    // configure a five-minute cron before opting into temporary file storage.
    await d1FileStore(env.AUTH_DB).cleanup(Date.now());
  },
};
