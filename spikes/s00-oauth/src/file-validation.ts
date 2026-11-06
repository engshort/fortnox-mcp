import { Buffer } from "node:buffer";
import jpeg from "jpeg-js";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs/browser.js";
import { FileError, type FileValidator, fileLimits } from "./files.js";

// Bounded probe formats, deliberately narrower than a production receipt parser.
// PNG interlacing and compressed PDF objects are excluded to keep expansion
// bounded; no OCR, scripting, embedded actions or rendering is performed.
export const fileValidator: FileValidator = {
  async validate(bytes) {
    try {
      if (!bytes.length || bytes.length > fileLimits.bytes)
        throw new FileError("FILE_TOO_LARGE");
      if (
        bytes.length >= 33 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
      ) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        const width = view.getUint32(16),
          height = view.getUint32(20);
        if (
          view.getUint32(8) !== 13 ||
          new TextDecoder().decode(bytes.slice(12, 16)) !== "IHDR" ||
          !width ||
          !height ||
          width * height > fileLimits.pixels ||
          bytes[24] !== 8 ||
          bytes[28] !== 0
        )
          throw new FileError("FILE_INVALID");
        const decoded = PNG.sync.read(Buffer.from(bytes), { checkCRC: true });
        decoded.data.fill(0);
        return { mime: "image/png" };
      }
      if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
        if (bytes.at(-2) !== 255 || bytes.at(-1) !== 217)
          throw new FileError("FILE_INVALID");
        const decoded = jpeg.decode(bytes, {
          useTArray: true,
          tolerantDecoding: false,
          maxResolutionInMP: 2,
          maxMemoryUsageInMB: 32,
        });
        if (
          !decoded.width ||
          !decoded.height ||
          decoded.width * decoded.height > fileLimits.pixels
        )
          throw new FileError("FILE_INVALID");
        decoded.data.fill(0);
        return { mime: "image/jpeg" };
      }
      if (new TextDecoder().decode(bytes.slice(0, 8)).match(/^%PDF-1\.[0-7]/)) {
        const text = new TextDecoder("latin1").decode(bytes);
        if (
          !text.trimEnd().endsWith("%%EOF") ||
          /\/(?:Encrypt|Filter|ObjStm|XRef|JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/.test(
            text,
          ) ||
          text.includes("#") ||
          (text.match(/\bobj\b/g)?.length ?? 0) > 256
        )
          throw new FileError("FILE_INVALID");
        const pdf = await PDFDocument.load(bytes, {
          ignoreEncryption: false,
          throwOnInvalidObject: true,
          updateMetadata: false,
        });
        const pages = pdf.getPageCount();
        if (pdf.isEncrypted || pages < 1 || pages > fileLimits.pages)
          throw new FileError("FILE_INVALID");
        return { mime: "application/pdf", pages };
      }
      throw new FileError("FILE_TYPE_UNSUPPORTED");
    } catch (error) {
      throw error instanceof FileError ? error : new FileError("FILE_INVALID");
    }
  },
};
