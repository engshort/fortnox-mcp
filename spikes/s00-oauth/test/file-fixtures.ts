import { Buffer } from "node:buffer";
import jpeg from "jpeg-js";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";

export const fileOrigin = "https://files.example.com";
export const fixtureSecret = "synthetic-file-key-not-a-real-credential-32";
export function pngFixture() {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([
    0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
  ]);
  return new Uint8Array(PNG.sync.write(png));
}
export function jpegFixture() {
  return new Uint8Array(
    jpeg.encode(
      { width: 1, height: 1, data: Buffer.from([20, 40, 60, 255]) },
      70,
    ).data,
  );
}
export async function pdfFixture(pages = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([100, 100]);
  return pdf.save({ useObjectStreams: false });
}
