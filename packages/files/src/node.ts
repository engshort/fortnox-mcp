import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { Readable } from "node:stream";
import {
  ReceiptFileError as FileError,
  type FileTransport,
} from "@fortnox-mcp/core";
import { isPublicAddress } from "./transport.js";

export const nodeFileTransport: FileTransport = {
  async open(url, signal) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
      throw new FileError("FILE_URL_DENIED");
    signal.throwIfAborted();
    const address = addresses[0];
    if (!address) throw new FileError("FILE_URL_DENIED");
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          signal,
          agent: false,
          rejectUnauthorized: true,
          servername: url.hostname,
          family: address.family,
          // Pin the actual socket to the already checked address, retaining TLS
          // hostname verification. No incoming headers/cookies are copied.
          lookup: (_name, _options, callback) =>
            callback(null, address.address, address.family),
          headers: { accept: "image/png, image/jpeg, application/pdf" },
        },
        (response) => {
          const headers = new Headers();
          for (const name of ["content-type", "content-length"]) {
            const value = response.headers[name];
            if (typeof value === "string") headers.set(name, value);
          }
          resolve(
            new Response(
              Readable.toWeb(response) as ReadableStream<Uint8Array>,
              { status: response.statusCode ?? 502, headers },
            ),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  },
};
