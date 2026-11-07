import { receiptFileSource, receiptSourceSettings } from "@fortnox-mcp/files";
import { cleanupProduct } from "../../shared/maintenance.js";
import {
  createProductApplication,
  productSettings,
} from "../../shared/product.js";
import { d1State } from "./product-storage.js";
import { d1ReceiptFiles } from "./receipt-storage.js";
export interface ProductEnv extends Partial<ProductBindings> {
  PUBLIC_ORIGIN?: string;
  AUTH_SECRET?: string;
  CREDENTIAL_KEYS?: string;
  CREDENTIAL_ACTIVE_KEY?: string;
  MCP_REDIRECT_URIS?: string;
  FORTNOX_CLIENT_ID?: string;
  FORTNOX_CLIENT_SECRET?: string;
  FORTNOX_TEST_TENANTS?: string;
  ACCOUNTING_REFERENCES_ENABLED?: string;
  RECEIPT_FILE_TRANSPORT?: string;
  RECEIPT_FILE_ORIGINS?: string;
  RECEIPT_FILE_RELAY_ORIGIN?: string;
  RECEIPT_FILE_RELAY_TOKEN?: string;
  RECEIPT_FILE_RELAY_UNTIL?: string;
}
export default {
  async scheduled(_event: ScheduledController, env: ProductEnv): Promise<void> {
    if (env.DB && env.PRODUCT_ENABLED === "true")
      await Promise.all([
        cleanupProduct(d1State(env.DB)),
        d1ReceiptFiles(env.DB).cleanup(Date.now()),
      ]);
  },
  async fetch(request: Request, env: ProductEnv): Promise<Response> {
    if (env.PRODUCT_ENABLED !== "true" || !env.DB)
      return new Response("Product disabled", { status: 503 });
    try {
      const settings = productSettings({ ...env, DB: undefined });
      return await createProductApplication(settings, {
        database: env.DB,
        state: d1State(env.DB),
        receiptFiles: d1ReceiptFiles(env.DB),
        fileSource: receiptFileSource(
          settings.receiptSource ?? receiptSourceSettings({}, false),
          "worker",
        ),
      }).fetch(request);
    } catch {
      return new Response("Product configuration unavailable", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
  },
};
