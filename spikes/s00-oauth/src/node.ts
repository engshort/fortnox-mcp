import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createAdaptorServer } from "@hono/node-server";
import { nodeFileTransport } from "./file-node-transport.js";
import { fileSchema } from "./file-sql.js";
import { sqliteFileStore } from "./file-sqlite.js";
import { fileValidator } from "./file-validation.js";
import { parseFileOrigins } from "./files.js";
import { createProbeHandler } from "./http.js";
import { reviewSchema } from "./review.js";
import { sqliteReviewStore } from "./review-sqlite.js";

if (import.meta.main) {
  const config = JSON.parse(await readFile(".data/config.json", "utf8"));
  const database = new DatabaseSync(".data/auth.sqlite");
  if (config.reviewEnabled === true) database.exec(reviewSchema);
  if (config.filesEnabled === true) database.exec(fileSchema);
  const files =
    config.filesEnabled === true
      ? {
          store: sqliteFileStore(database),
          transport: nodeFileTransport,
          validator: fileValidator,
          origins: parseFileOrigins(config.fileOrigins),
        }
      : undefined;
  if (files)
    setInterval(() => {
      void files.store.cleanup(Date.now()).catch(() => {});
    }, 60_000).unref();
  const app = createProbeHandler({
    ...config,
    database,
    ...(files ? { files } : {}),
    ...(config.reviewEnabled === true
      ? { review: sqliteReviewStore(database) }
      : {}),
  });
  createAdaptorServer({
    fetch: app.fetch,
    overrideGlobalObjects: false,
  }).listen(8790, "127.0.0.1", () => {
    console.log("Synthetic OAuth probe listening on http://127.0.0.1:8790");
  });
}
