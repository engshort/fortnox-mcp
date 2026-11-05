import { Buffer } from "node:buffer";
import { HTTPParser } from "http-parser-js";
import {
  FileError,
  type FileTransport,
  fileLimits,
  isPublicAddress,
} from "./files.js";

export interface FileSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
  startTls(options: { expectedServerHostname: string }): FileSocket;
}
export interface SocketEgress {
  resolve(hostname: string, signal: AbortSignal): Promise<string[]>;
  connect(address: string): FileSocket;
}
export type FileTransportDiagnostic = {
  stage:
    | "resolving"
    | "connecting"
    | "securing"
    | "requesting"
    | "reading"
    | "response"
    | "complete"
    | "failed";
  status?: number;
  reason?:
    | "tls"
    | "egress_denied"
    | "http_parser"
    | "unsupported"
    | "connection"
    | "other";
};
// The maintained HTTP parser handles framing/chunking. Only a fixed GET is
// emitted; the socket uses a checked public IP and TLS validates the URL host.
// No unpinned fetch fallback is permitted if the runtime refuses that socket.
export function socketFileTransport(
  egress: SocketEgress,
  maximumBytes: number = fileLimits.bytes,
  report?: (event: FileTransportDiagnostic) => void,
): FileTransport {
  const emit = (event: FileTransportDiagnostic) => {
    try {
      report?.(event);
    } catch {
      /* Operator diagnostics never alter transport. */
    }
  };
  return {
    async open(url, signal) {
      emit({ stage: "resolving" });
      const addresses = await egress.resolve(url.hostname, signal);
      if (!addresses.length || addresses.some((a) => !isPublicAddress(a)))
        throw new FileError("FILE_URL_DENIED");
      signal.throwIfAborted();
      emit({ stage: "connecting" });
      let socket = egress.connect(addresses[0]);
      const abort = () => {
        void socket.close().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      const chunks: Buffer[] = [];
      try {
        await socket.opened;
        signal.throwIfAborted();
        emit({ stage: "securing" });
        socket = socket.startTls({ expectedServerHostname: url.hostname });
        await socket.opened;
        signal.throwIfAborted();
        emit({ stage: "requesting" });
        const writer = socket.writable.getWriter();
        await writer.write(
          new TextEncoder().encode(
            `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nAccept: image/png, image/jpeg, application/pdf\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`,
          ),
        );
        writer.releaseLock();
        const parser = new HTTPParser(HTTPParser.RESPONSE);
        parser.maxHeaderSize = 16 * 1024;
        let status = 0,
          size = 0,
          networkBytes = 0,
          complete = false;
        const headers = new Headers();
        parser[HTTPParser.kOnHeadersComplete] = (info) => {
          emit({ stage: "response", status: info.statusCode });
          if (status || info.upgrade || info.statusCode !== 200)
            throw new FileError(
              [401, 403, 404, 410].includes(info.statusCode)
                ? "FILE_EXPIRED"
                : "FILE_FETCH_FAILED",
            );
          status = info.statusCode;
          for (let i = 0; i < info.headers.length; i += 2)
            headers.append(info.headers[i], info.headers[i + 1]);
          const length = headers.get("content-length");
          if (
            length &&
            (!/^\d+$/.test(length) || Number(length) > maximumBytes)
          )
            throw new FileError("FILE_TOO_LARGE");
          if (
            headers.has("content-encoding") &&
            headers.get("content-encoding") !== "identity"
          )
            throw new FileError("FILE_INVALID");
        };
        parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
          size += length;
          if (size > maximumBytes) throw new FileError("FILE_TOO_LARGE");
          chunks.push(Buffer.from(chunk.subarray(offset, offset + length)));
        };
        parser[HTTPParser.kOnMessageComplete] = () => {
          complete = true;
        };
        const reader = socket.readable.getReader();
        emit({ stage: "reading" });
        try {
          while (!complete) {
            const next = await reader.read();
            if (next.done) {
              const error = parser.finish();
              if (error) throw error;
              break;
            }
            networkBytes += next.value.length;
            if (networkBytes > maximumBytes + 128 * 1024)
              throw new FileError("FILE_TOO_LARGE");
            const parsed = parser.execute(Buffer.from(next.value));
            if (parsed instanceof Error) throw parsed;
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
        if (!complete || !status || signal.aborted)
          throw new FileError("FILE_FETCH_FAILED");
        emit({ stage: "complete" });
        return new Response(Buffer.concat(chunks, size), { status, headers });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const reason = /TLS|SSL|certificate|cert|hostname/i.test(message)
          ? "tls"
          : /proxy request failed|cannot connect to the specified address/i.test(
                message,
              )
            ? "egress_denied"
            : error instanceof Error &&
                "code" in error &&
                /^HPE_/.test(String(error.code))
              ? "http_parser"
              : /not implemented|not supported/i.test(message)
                ? "unsupported"
                : /socket|connection|stream|closed/i.test(message)
                  ? "connection"
                  : "other";
        emit({ stage: "failed", reason });
        throw error;
      } finally {
        for (const chunk of chunks) chunk.fill(0);
        signal.removeEventListener("abort", abort);
        void socket.close().catch(() => {});
      }
    },
  };
}
