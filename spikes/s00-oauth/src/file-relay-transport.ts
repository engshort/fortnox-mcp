import { approvedFileUrl, FileError, type FileTransport } from "./files.js";

export interface FileRelayAccess {
  origin?: string;
  token?: string;
  until?: string;
}
export function activeFileRelay(access: FileRelayAccess, now = Date.now()) {
  const deadline = Date.parse(access.until ?? "");
  return (
    !!access.token?.match(/^[0-9a-f]{64}$/) &&
    Number.isFinite(deadline) &&
    deadline > now &&
    deadline <= now + 15 * 60_000
  );
}

// Explicit operator-selected transport, never an automatic fallback. Only the
// short-lived helper receives the signed URL; it pins upstream DNS and TLS.
export function relayFileTransport(
  access: FileRelayAccess,
  send: typeof fetch = fetch,
): FileTransport {
  return {
    async open(url, signal) {
      if (!activeFileRelay(access) || !access.origin)
        throw new FileError("FILE_TRANSPORT_UNAVAILABLE");
      const endpoint = approvedFileUrl(access.origin, [access.origin]);
      if (
        endpoint.origin !== access.origin ||
        !endpoint.hostname.endsWith(".trycloudflare.com")
      )
        throw new FileError("FILE_TRANSPORT_UNAVAILABLE");
      const response = await send(`${endpoint.origin}/s00-files/fetch`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ download_url: url.href }),
        redirect: "manual",
        cache: "no-store",
        signal,
      });
      if (!activeFileRelay(access)) {
        void response.body?.cancel().catch(() => {});
        throw new FileError("FILE_TRANSPORT_UNAVAILABLE");
      }
      if (response.status === 200) return response;
      void response.body?.cancel().catch(() => {});
      const code = response.headers.get("x-s00-file-error");
      const allowed = [
        "FILE_URL_DENIED",
        "FILE_EXPIRED",
        "FILE_TOO_LARGE",
        "FILE_TIMEOUT",
        "FILE_INVALID",
        "FILE_LIMIT",
        "FILE_TRANSPORT_UNAVAILABLE",
      ] as const;
      const recognized = allowed.find((value) => value === code);
      throw new FileError(recognized ?? "FILE_FETCH_FAILED");
    },
  };
}
