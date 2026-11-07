import { readFile, stat } from "node:fs/promises";
import { activeReceiptRelay } from "@fortnox-mcp/files";
import { nodeFileTransport } from "@fortnox-mcp/files/node";
import {
  createReceiptRelay,
  receiptRelayConfig,
} from "@fortnox-mcp/files/relay-node";
import { createAdaptorServer } from "@hono/node-server";

// Only the private session file is read; no provider/OAuth configuration is used.
async function configuration() {
  try {
    const path = process.argv[2] ?? ".data/product-file-relay.json";
    const info = await stat(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 8192)
      throw new Error();
    const value = receiptRelayConfig.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (!activeReceiptRelay(value)) throw new Error();
    return value;
  } catch {
    throw new Error("Private receipt relay configuration unavailable");
  }
}
const config = await configuration();
const server = createAdaptorServer({
  fetch: createReceiptRelay(config, nodeFileTransport),
  overrideGlobalObjects: false,
});
server.listen(8796, "127.0.0.1", () =>
  console.log("receipt_relay_started; loopback:8796; no request logging"),
);
const timer = setTimeout(
  () => server.close(),
  Date.parse(config.until) - Date.now(),
);
timer.unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    clearTimeout(timer);
    server.close();
  });
