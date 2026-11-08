import { startProduct } from "./product-runtime.js";

void startProduct().catch(() => {
  console.error(
    "product_startup_failed; check private configuration and state",
  );
  process.exit(1);
});
