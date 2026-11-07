import { type FileTransport, ReceiptFileError } from "@fortnox-mcp/core";
import { approvedFileUrl } from "./transport.js";

export interface ReceiptRelayAccess {
  origin?: string;
  token?: string;
  until?: string;
}
export function activeReceiptRelay(
  access: ReceiptRelayAccess,
  now = Date.now(),
) {
  const until = Date.parse(access.until ?? "");
  return (
    Boolean(access.token?.match(/^[0-9a-f]{64}$/)) &&
    Number.isFinite(until) &&
    until > now &&
    until <= now + 15 * 60000
  );
}

// Explicit short-lived test transport. The separate Node helper pins DNS and
// validates TLS; Worker fetch is used only to reach that authenticated helper.
export function receiptRelayTransport(
  access: ReceiptRelayAccess,
  send: typeof fetch = fetch,
  now = Date.now,
): FileTransport {
  return {
    async open(url, signal) {
      if (!activeReceiptRelay(access, now()) || !access.origin)
        throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
      const endpoint = approvedFileUrl(access.origin, [access.origin]);
      if (
        endpoint.origin !== access.origin ||
        !endpoint.hostname.endsWith(".trycloudflare.com")
      )
        throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
      const response = await send(`${endpoint.origin}/receipts/fetch`, {
        method: "POST",
        redirect: "manual",
        cache: "no-store",
        signal,
        headers: {
          authorization: `Bearer ${access.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ download_url: url.href }),
      });
      if (!activeReceiptRelay(access, now())) {
        void response.body?.cancel().catch(() => {});
        throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
      }
      if (response.status === 200 && !response.redirected) return response;
      void response.body?.cancel().catch(() => {});
      const code = response.headers.get("x-receipt-file-error");
      const known = [
        "FILE_URL_DENIED",
        "FILE_EXPIRED",
        "FILE_TOO_LARGE",
        "FILE_TIMEOUT",
        "FILE_INVALID",
        "FILE_LIMIT",
        "FILE_TRANSPORT_UNAVAILABLE",
      ] as const;
      throw new ReceiptFileError(
        known.find((value) => value === code) ?? "FILE_FETCH_FAILED",
      );
    },
  };
}
