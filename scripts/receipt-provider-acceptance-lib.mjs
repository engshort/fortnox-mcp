import { createHash } from "node:crypto";
import { z } from "zod";

const fileLimit = 1048576;
const digest = z.string().regex(/^(?!0{64}$)[a-f0-9]{64}$/);
const attachment = z
  .object({
    company_id: z.string().uuid(),
    file_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    voucher: z
      .object({
        financial_year: z.number().int().positive().safe(),
        series: z.string().regex(/^[A-Z0-9]{1,8}$/),
        number: z.number().int().positive().safe(),
      })
      .strict(),
    expectedSha256: digest,
    expectedBytes: z.number().int().min(1).max(fileLimit),
    expectedMime: z.enum(["image/png", "image/jpeg", "application/pdf"]),
  })
  .strict();
const schema = z
  .object({
    origin: z.string().url(),
    serverCommit: z.string().regex(/^(?!0{40}$)[a-f0-9]{40}$/),
    accessToken: z.string().min(1).max(8192),
    companyIds: z
      .array(z.string().uuid())
      .length(2)
      .refine((ids) => new Set(ids).size === 2),
    attachments: z.array(attachment).min(2).max(4),
  })
  .strict()
  .refine(
    (r) =>
      r.attachments.every((a) => r.companyIds.includes(a.company_id)) &&
      r.companyIds.every((id) =>
        r.attachments.some((a) => a.company_id === id),
      ),
  );
export function parseReceiptProviderConfig(input) {
  const config = schema.parse(input),
    url = new URL(config.origin);
  if (
    url.origin !== config.origin ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))
    )
  )
    throw new Error("Invalid acceptance origin");
  const keys = config.attachments.map(
    (a) =>
      `${a.company_id}/${a.voucher.financial_year}/${a.voucher.series}/${a.voucher.number}/${a.file_id}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error("Duplicate attachment");
  return config;
}
async function jsonResponse(response) {
  if (
    !response.ok ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  ) {
    await response.body?.cancel();
    throw new Error("MCP read unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing MCP body");
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 2097152) {
        await reader.cancel();
        throw new Error("MCP response limit");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
// Exact fixed product reads; never call upload/link/commit or follow a file URL.
export async function readReceiptProviderAttachments(input, send = fetch) {
  const config = parseReceiptProviderConfig(input);
  let id = 0;
  const call = async (name, args) => {
    const requestId = ++id;
    const response = await send(`${config.origin}/mcp`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = await jsonResponse(response);
    if (
      body.jsonrpc !== "2.0" ||
      body.id !== requestId ||
      body.error ||
      !body.result ||
      body.result.isError ||
      body.result.structuredContent?.status === "error"
    )
      throw new Error("MCP read failed");
    return body.result;
  };
  const listed = (await call("list_companies", {})).structuredContent;
  const companies = listed?.data?.companies;
  if (
    listed?.status !== "ok" ||
    !Array.isArray(companies) ||
    companies.length !== 2 ||
    !config.companyIds.every((id) => companies.some((c) => c.company_id === id))
  )
    throw new Error("Test company mismatch");
  let bytesCompared = 0;
  const mimeTypes = new Set();
  for (const sample of config.attachments) {
    const { expectedSha256, expectedBytes, expectedMime, ...reference } =
      sample;
    const result = await call("get_receipt_attachment", reference);
    const contents = result.content;
    const resource =
      Array.isArray(contents) &&
      contents.length === 1 &&
      contents[0]?.type === "resource"
        ? contents[0].resource
        : null;
    const uri = `receipt://attachments/${sample.company_id}/${sample.voucher.financial_year}/${sample.voucher.series}/${sample.voucher.number}/${sample.file_id}`;
    if (
      !resource ||
      resource.uri !== uri ||
      resource.mimeType !== expectedMime ||
      typeof resource.blob !== "string" ||
      resource.blob.length > Math.ceil(fileLimit / 3) * 4 ||
      resource.blob.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(resource.blob)
    )
      throw new Error("Invalid attachment resource");
    const bytes = Buffer.from(resource.blob, "base64");
    try {
      if (
        bytes.length !== expectedBytes ||
        bytes.toString("base64") !== resource.blob ||
        createHash("sha256").update(bytes).digest("hex") !== expectedSha256
      )
        throw new Error("Original bytes differ");
      bytesCompared += bytes.length;
      mimeTypes.add(expectedMime);
    } finally {
      bytes.fill(0);
    }
  }
  return {
    status: "authorized_attachment_bytes_match",
    serverCommit: config.serverCommit,
    companies: 2,
    attachments: config.attachments.length,
    bytesCompared,
    mimeTypes: [...mimeTypes],
    commitSource: "operator supplied; verify deployment separately",
    bookkeepingOrFileMutationRequested: false,
    browserExecutedByThisScript: false,
    providerAcceptanceComplete: false,
  };
}
