import { expect, it } from "vitest";
import { productSettings } from "../../apps/shared/product.js";

it("accepts distinct HTTPS callbacks for multiple confidential integrations while retaining a bounded allowlist", () => {
  const urls = Array.from(
    { length: 16 },
    (_, i) => `https://client.example.invalid/callback-${i}`,
  );
  const env = {
    PUBLIC_ORIGIN: "https://server.example.invalid",
    AUTH_SECRET: "synthetic-auth-secret-at-least-thirty-two-characters",
    CREDENTIAL_KEYS: JSON.stringify({
      a: Buffer.alloc(32, 1).toString("base64"),
    }),
    CREDENTIAL_ACTIVE_KEY: "a",
    MCP_REDIRECT_URIS: JSON.stringify(urls),
  };
  expect(productSettings(env).redirects).toEqual(urls);
  expect(() =>
    productSettings({
      ...env,
      MCP_REDIRECT_URIS: JSON.stringify([
        ...urls,
        "https://client.example.invalid/extra",
      ]),
    }),
  ).toThrow();
  expect(() =>
    productSettings({
      ...env,
      MCP_REDIRECT_URIS: JSON.stringify([
        "http://client.example.invalid/callback",
      ]),
    }),
  ).toThrow();
});
