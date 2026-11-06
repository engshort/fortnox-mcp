import { fileCodec } from "../src/file-codec.js";
import { d1FileStore } from "../src/file-d1.js";
import { socketFileTransport } from "../src/file-socket-transport.js";
import { fileValidator } from "../src/file-validation.js";
import { FileError, fileService } from "../src/files.js";

const fixtureSecret = "synthetic-file-key-not-a-real-credential-32";
const fileOrigin = "https://files.example.com";

// Only bundled by the offline test; never imported by the deployed entrypoint.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const input = (await request.json()) as {
      owner: string;
      company: string;
      now: number;
      bytes?: number[];
      id?: string;
      mime?: string;
      socket?: boolean;
    };
    const service = fileService({
      owner: input.owner,
      company: input.company,
      secret: fixtureSecret,
      origins: [fileOrigin],
      store: d1FileStore(env.DB),
      validator: fileValidator,
      codec: fileCodec,
      now: () => input.now,
      transport: input.socket
        ? socketFileTransport({
            async resolve() {
              return ["8.8.8.8"];
            },
            connect() {
              const head = new TextEncoder().encode(
                `HTTP/1.1 200 OK\r\nContent-Type: ${input.mime ?? "image/png"}\r\nContent-Length: ${input.bytes?.length ?? 0}\r\n\r\n`,
              );
              const wire = new Uint8Array(
                head.length + (input.bytes?.length ?? 0),
              );
              wire.set(head);
              wire.set(input.bytes ?? [], head.length);
              const socket = {
                opened: Promise.resolve({}),
                readable: new ReadableStream<Uint8Array>({
                  start(c) {
                    for (let offset = 0; offset < wire.length; offset += 7)
                      c.enqueue(wire.slice(offset, offset + 7));
                    c.close();
                  },
                }),
                writable: new WritableStream<Uint8Array>(),
                async close() {},
                startTls() {
                  return socket;
                },
              };
              return socket;
            },
          })
        : {
            async open() {
              return new Response(new Uint8Array(input.bytes ?? []), {
                headers: { "content-type": input.mime ?? "image/png" },
              });
            },
          },
    });
    try {
      const path = new URL(request.url).pathname;
      const result =
        path === "/read"
          ? await service.read(input.id ?? "")
          : path === "/cleanup"
            ? await service.cleanup()
            : await service.ingest({
                files: [
                  {
                    download_url: `${fileOrigin}/receipt`,
                    file_id: "synthetic-file",
                  },
                ],
              });
      return Response.json(result ?? { cleaned: true });
    } catch (error) {
      return Response.json(
        { error: error instanceof FileError ? error.code : "FILE_UNAVAILABLE" },
        { status: 400 },
      );
    }
  },
};
