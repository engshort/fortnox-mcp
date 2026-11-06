import { fileCodec } from "../src/file-codec.js";
import { d1FileStore } from "../src/file-d1.js";
import { fileValidator } from "../src/file-validation.js";
import { d1RuntimeReviews } from "../src/runtime-d1.js";
import { handleRuntimeRequest } from "../src/runtime-http.js";

export default {
  async fetch(
    request: Request,
    env: { DB: D1Database; TOKEN: string; UNTIL: string },
  ) {
    return (
      (await handleRuntimeRequest(request, {
        origin: "https://runtime.example.com",
        token: env.TOKEN,
        until: env.UNTIL,
        context: {
          owner: "synthetic-runtime-owner",
          secret: "synthetic-runtime-encryption-key-not-real-credential",
          files: d1FileStore(env.DB),
          reviews: d1RuntimeReviews(env.DB),
          validator: fileValidator,
          codec: fileCodec,
        },
      })) ?? new Response(null, { status: 404 })
    );
  },
};
