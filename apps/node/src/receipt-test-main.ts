import { startProduct } from "./product-runtime.js";

// Only this separately built entry supplies the time-bounded profile.
declare const __M14_TEST_SOURCE_COMMIT__: string;
void startProduct({
  sourceCommit: __M14_TEST_SOURCE_COMMIT__,
  until: Date.parse(process.env.M14_FILE_TEST_UNTIL ?? ""),
}).catch(() => {
  console.error("file_test_startup_failed; check private test configuration");
  process.exit(1);
});
