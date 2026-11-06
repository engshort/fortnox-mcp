import { cleanupProduct } from "../../shared/maintenance.js";
import {
  createProductApplication,
  productSettings,
} from "../../shared/product.js";
import { d1State } from "./product-storage.js";
export interface ProductEnv extends Partial<ProductBindings> {
  PUBLIC_ORIGIN?: string;
  AUTH_SECRET?: string;
  CREDENTIAL_KEYS?: string;
  CREDENTIAL_ACTIVE_KEY?: string;
  MCP_REDIRECT_URIS?: string;
  FORTNOX_CLIENT_ID?: string;
  FORTNOX_CLIENT_SECRET?: string;
  FORTNOX_TEST_TENANTS?: string;
}
export default {
  async scheduled(_event: ScheduledController, env: ProductEnv): Promise<void> {
    if (env.DB && env.PRODUCT_ENABLED === "true")
      await cleanupProduct(d1State(env.DB));
  },
  async fetch(request: Request, env: ProductEnv): Promise<Response> {
    if (env.PRODUCT_ENABLED !== "true" || !env.DB)
      return new Response("Product disabled", { status: 503 });
    try {
      const settings = productSettings({ ...env, DB: undefined });
      return await createProductApplication(settings, {
        database: env.DB,
        state: d1State(env.DB),
      }).fetch(request);
    } catch {
      return new Response("Product configuration unavailable", {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
  },
};
