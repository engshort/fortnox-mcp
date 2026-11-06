import { fileCodec } from "../src/file-codec.js";
import { d1FileStore } from "../src/file-d1.js";
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
      transport: {
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
