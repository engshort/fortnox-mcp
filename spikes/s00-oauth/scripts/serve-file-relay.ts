import { readFile } from "node:fs/promises";
import { createAdaptorServer } from "@hono/node-server";
import { nodeFileTransport } from "../src/file-node-transport.js";
import { createFileRelay, type FileRelayConfig } from "../src/file-relay.js";
import { activeFileRelay } from "../src/file-relay-transport.js";

const config = JSON.parse(
  await readFile(process.argv[2] ?? ".data/file-relay.json", "utf8"),
) as FileRelayConfig;
if (!activeFileRelay(config))
  throw new Error(
    "An explicit relay session of at most 15 minutes is required",
  );
const handler = createFileRelay(config, nodeFileTransport);
const server = createAdaptorServer({
  fetch: handler,
  overrideGlobalObjects: false,
});
server.listen(8796, "127.0.0.1", () =>
  console.log(
    "Synthetic file relay bound to loopback:8796; no request logging",
  ),
);
const timer = setTimeout(() => {
  server.close();
}, Date.parse(config.until) - Date.now());
timer.unref();
