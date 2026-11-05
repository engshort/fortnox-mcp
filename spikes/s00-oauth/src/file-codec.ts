import { Buffer } from "node:buffer";
import type { FileCodec } from "./files.js";

// Both selected runtimes provide node:buffer. Keep the portable fallback in the
// domain; use native base64 here to avoid JS intermediate strings for large files.
export const fileCodec: FileCodec = {
  encode(bytes) {
    return Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString("base64");
  },
  decode(text) {
    return Buffer.from(text, "base64");
  },
};
