import {
  ReceiptFileError as FileError,
  type ClientFile as FileInput,
  type FileTransport,
  receiptFileLimits as fileLimits,
} from "@fortnox-mcp/core";
import ipaddr from "ipaddr.js";

type FileContext = {
  origins: readonly string[];
  transport: FileTransport;
  maxBytes?: number;
};
export function isPublicAddress(value: string) {
  try {
    const address = ipaddr.process(value);
    return address.range() === "unicast";
  } catch {
    return false;
  }
}
export function approvedFileUrl(value: string, origins: readonly string[]) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FileError("FILE_URL_DENIED");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // No IP literals, local names, credentials, custom ports or wildcards. The
  // runtime transport must additionally enforce public, pinned DNS resolution.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !host.includes(".") ||
    host.endsWith(".") ||
    /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host) ||
    ipaddr.isValid(host) ||
    !origins.includes(url.origin)
  )
    throw new FileError("FILE_URL_DENIED");
  return url;
}
export function parseFileOrigins(value: string | undefined) {
  if (!value) return [];
  const origins = value.split(",").map((s) => s.trim());
  if (origins.length > 4 || origins.some((s) => !s))
    throw new FileError("FILE_URL_DENIED");
  for (const origin of origins) {
    const url = approvedFileUrl(origin, origins);
    if (url.origin !== origin) throw new FileError("FILE_URL_DENIED");
  }
  return origins;
}
export async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function fetchFile(
  input: FileInput,
  context: Pick<FileContext, "origins" | "transport" | "maxBytes">,
) {
  const maximum = context.maxBytes ?? fileLimits.bytes;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > fileLimits.bytes
  )
    throw new FileError("FILE_UNAVAILABLE");
  const url = approvedFileUrl(input.download_url, context.origins);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new FileError("FILE_TIMEOUT"));
    }, fileLimits.timeoutMs);
  });
  const work = async () => {
    try {
      const response = await context.transport.open(url, controller.signal);
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new FileError("FILE_TIMEOUT");
      }
      if (response.status !== 200 || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw new FileError(
          [401, 403, 404, 410].includes(response.status)
            ? "FILE_EXPIRED"
            : "FILE_FETCH_FAILED",
        );
      }
      const length = response.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
        void response.body?.cancel().catch(() => {});
        throw new FileError("FILE_TOO_LARGE");
      }
      if (!response.body) throw new FileError("FILE_INVALID");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) throw new FileError("FILE_TOO_LARGE");
        chunks.push(chunk.value);
      }
      if (controller.signal.aborted) throw new FileError("FILE_TIMEOUT");
      if (size === 0) throw new FileError("FILE_INVALID");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return {
        bytes,
        contentType: response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase(),
      };
    } catch (error) {
      throw error instanceof FileError
        ? error
        : new FileError("FILE_FETCH_FAILED");
    }
  };
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
