import { connect } from "cloudflare:sockets";
import {
  type FileTransportDiagnostic,
  socketFileTransport,
} from "./file-socket-transport.js";
import { workerFileByteBudget } from "./file-worker-budget.js";
import { FileError } from "./files.js";

export const workerFileTransport = (
  report?: (event: FileTransportDiagnostic) => void,
) =>
  socketFileTransport(
    {
      async resolve(hostname, signal) {
        const addresses: string[] = [];
        for (const type of ["A", "AAAA"]) {
          const url = new URL("https://cloudflare-dns.com/dns-query");
          url.searchParams.set("name", hostname);
          url.searchParams.set("type", type);
          const response = await fetch(url, {
            headers: { accept: "application/dns-json" },
            redirect: "manual",
            signal,
          });
          if (response.status !== 200 || !response.body)
            throw new FileError("FILE_FETCH_FAILED");
          const reader = response.body.getReader();
          let bytes = 0;
          const parts: Uint8Array[] = [];
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              bytes += part.value.length;
              if (bytes > 16 * 1024) throw new FileError("FILE_FETCH_FAILED");
              parts.push(part.value);
            }
          } finally {
            void reader.cancel().catch(() => {});
          }
          const body = new Uint8Array(bytes);
          let offset = 0;
          for (const part of parts) {
            body.set(part, offset);
            offset += part.length;
          }
          const data = JSON.parse(new TextDecoder().decode(body)) as {
            Status?: number;
            Answer?: Array<{ type: number; data: string }>;
          };
          if (data.Status !== 0 || (data.Answer?.length ?? 0) > 32)
            throw new FileError("FILE_FETCH_FAILED");
          addresses.push(
            ...(data.Answer ?? [])
              .filter((a) => a.type === 1 || a.type === 28)
              .map((a) => a.data),
          );
        }
        return addresses;
      },
      connect(address) {
        return connect(
          { hostname: address, port: 443 },
          { secureTransport: "starttls", allowHalfOpen: false },
        );
      },
    },
    workerFileByteBudget,
    report,
  );
