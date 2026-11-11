import {
  type ClientFile,
  type FileTransport,
  ReceiptFileError,
} from "@fortnox-mcp/core";
import {
  type ReceiptRelayAccess,
  receiptRelayTransport,
} from "./relay-transport.js";
import { fetchFile, parseFileOrigins } from "./transport.js";

export interface ReceiptSourceSettings {
  transport: "none" | "node-direct" | "node-relay";
  origins: readonly string[];
  relay: ReceiptRelayAccess;
}
export function receiptSourceSettings(
  env: Record<string, string | undefined>,
  _testMode?: boolean,
): ReceiptSourceSettings {
  const transport = env.RECEIPT_FILE_TRANSPORT ?? "none";
  if (!["none", "node-direct", "node-relay"].includes(transport))
    throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
  return {
    transport: transport as ReceiptSourceSettings["transport"],
    origins: parseFileOrigins(env.RECEIPT_FILE_ORIGINS),
    relay: {
      ...(env.RECEIPT_FILE_RELAY_ORIGIN
        ? { origin: env.RECEIPT_FILE_RELAY_ORIGIN }
        : {}),
      ...(env.RECEIPT_FILE_RELAY_TOKEN
        ? { token: env.RECEIPT_FILE_RELAY_TOKEN }
        : {}),
      ...(env.RECEIPT_FILE_RELAY_UNTIL
        ? { until: env.RECEIPT_FILE_RELAY_UNTIL }
        : {}),
    },
  };
}
export function receiptFileSource(
  settings: ReceiptSourceSettings,
  runtime: "node" | "worker",
  direct?: FileTransport,
  send: typeof fetch = fetch,
) {
  const unavailable: FileTransport = {
    async open() {
      throw new ReceiptFileError("FILE_TRANSPORT_UNAVAILABLE");
    },
  };
  const transport =
    settings.transport === "node-relay"
      ? receiptRelayTransport(settings.relay, send)
      : settings.transport === "node-direct" && runtime === "node" && direct
        ? direct
        : unavailable;
  return (input: ClientFile) =>
    fetchFile(input, { origins: settings.origins, transport });
}
