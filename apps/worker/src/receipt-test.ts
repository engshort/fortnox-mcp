import { receiptFileSource, receiptSourceSettings } from "@fortnox-mcp/files";
import {
  createProductApplication,
  productSettings,
} from "../../shared/product.js";
import product, { type ProductEnv } from "./product.js";
import { d1State } from "./product-storage.js";
import { d1ReceiptFiles } from "./receipt-storage.js";

// Replaced by the build; deployment evidence must independently match the
// artifact digest/version to this source. No binding can override the value.
declare const __M14_TEST_SOURCE_COMMIT__: string;
export interface ReceiptTestEnv extends ProductEnv {
  M14_FILE_TEST_UNTIL?: string;
}

export default {
  scheduled: product.scheduled,
  async fetch(request: Request, env: ReceiptTestEnv): Promise<Response> {
    if (env.PRODUCT_ENABLED !== "true" || !env.DB)
      return new Response("File experiment disabled", { status: 503 });
    try {
      const settings = productSettings({
        ...env,
        DB: undefined,
        ASSETS: undefined,
      });
      // Public-edge source sockets remain unsupported. The experiment must
      // explicitly select the already bounded/pinned temporary Node relay.
      if (settings.receiptSource?.transport !== "node-relay")
        throw new Error("Missing reviewed file transport");
      return await createProductApplication(
        settings,
        {
          database: env.DB,
          state: d1State(env.DB),
          receiptFiles: d1ReceiptFiles(env.DB),
          fileSource: receiptFileSource(
            settings.receiptSource ?? receiptSourceSettings({}, false),
            "worker",
          ),
        },
        undefined,
        {
          sourceCommit: __M14_TEST_SOURCE_COMMIT__,
          until: Date.parse(env.M14_FILE_TEST_UNTIL ?? ""),
        },
      ).fetch(request);
    } catch {
      return new Response("File experiment configuration unavailable", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
  },
};
