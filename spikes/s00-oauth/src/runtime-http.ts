import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  type RuntimeContext,
  type RuntimeWorkload,
  runRuntimeProbe,
  runtimeCompany,
  runtimeWorkloads,
} from "./runtime-probe.js";

export interface RuntimeAccess {
  origin: string;
  token?: string;
  until?: string;
  context: RuntimeContext;
}
// Operator-only, synthetic, temporary diagnostics. Not an MCP tool or a financial
// endpoint. The provisioning owner authenticates with a separate expiring secret;
// the server owns the company and every workload. No URLs or accounting inputs.
export async function handleRuntimeRequest(
  request: Request,
  access: RuntimeAccess,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/s00-runtime/")) return undefined;
  const respond = (data: unknown, status: number) =>
    Response.json(data, {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  const until = access.until ? Date.parse(access.until) : NaN;
  const now = Date.now();
  if (
    !access.token?.match(/^[0-9a-f]{64}$/) ||
    !Number.isFinite(until) ||
    until <= now ||
    until > now + 15 * 60_000
  )
    return respond({ error: "RUNTIME_DISABLED" }, 404);
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (
    url.origin !== access.origin ||
    (request.headers.has("origin") &&
      request.headers.get("origin") !== access.origin) ||
    !bearer ||
    !timingSafeEqual(
      new TextEncoder().encode(bearer),
      new TextEncoder().encode(access.token),
    )
  )
    return respond({ error: "RUNTIME_UNAUTHORIZED" }, 401);
  if (url.pathname === "/s00-runtime/state" && request.method === "GET") {
    const id = url.searchParams.get("id"),
      expires = Number(url.searchParams.get("expires"));
    if (
      !z.uuid().safeParse(id).success ||
      !Number.isSafeInteger(expires) ||
      expires <= 0
    )
      return respond({ error: "RUNTIME_REFERENCE_INVALID" }, 400);
    const state = await access.context.reviews.read({
      id: id ?? "",
      owner: access.context.owner,
      company: runtimeCompany,
      proposalHash: "0".repeat(64),
      policyVersion: 1,
      expires,
    });
    return respond(
      {
        state: state?.state ?? "unavailable",
        synthetic: true,
        fortnoxEnabled: false,
      },
      200,
    );
  }
  const workload = url.pathname.slice(
    "/s00-runtime/".length,
  ) as RuntimeWorkload;
  if (
    !Object.hasOwn(runtimeWorkloads, workload) ||
    request.method !== "POST" ||
    url.search ||
    request.headers.get("content-type") !== "application/octet-stream"
  )
    return respond({ error: "RUNTIME_REQUEST_INVALID" }, 400);
  const maximum = runtimeWorkloads[workload] * 2;
  const body = new Uint8Array(maximum);
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: "RUNTIME_SIZE_INVALID" }, 400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new Error("RUNTIME_TIMEOUT"));
    }, 15_000);
  });
  const received = performance.now();
  try {
    let offset = 0;
    await Promise.race([
      (async () => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (offset + chunk.value.length > maximum)
            throw new Error("RUNTIME_SIZE_INVALID");
          body.set(chunk.value, offset);
          offset += chunk.value.length;
        }
      })(),
      timeout,
    ]);
    clearTimeout(timer);
    if (offset !== maximum)
      return respond({ error: "RUNTIME_SIZE_INVALID" }, 400);
    const uploadMs = Math.round((performance.now() - received) * 100) / 100;
    const result = await runRuntimeProbe(access.context, workload, body);
    return respond(
      {
        ...result,
        uploadMs,
        cpuMs: null,
        memoryBytes: null,
        runtime: "worker",
      },
      200,
    );
  } catch {
    return respond({ error: "RUNTIME_CHECK_FAILED" }, 422);
  } finally {
    clearTimeout(timer);
    body.fill(0);
    void reader.cancel().catch(() => {});
  }
}
