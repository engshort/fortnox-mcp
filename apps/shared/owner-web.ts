import { Hono } from "hono";
import { safeResponse } from "./admin.js";

export type AdminAssets = (name: "admin.js" | "admin.css") => Promise<Response>;
const shell = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Fortnox MCP</title><link rel="stylesheet" href="/admin-assets/admin.css"></head><body><div id="root"></div><script type="module" src="/admin-assets/admin.js"></script></body></html>`;
export function ownerWeb(
  fallback: (request: Request) => Promise<Response>,
  authorize: (request: Request) => Promise<unknown>,
  assets?: AdminAssets,
) {
  const router = new Hono();
  router.onError(() => safeResponse('{"error":"REQUEST_FAILED"}', 503));
  for (const path of ["/setup", "/sign-in", "/reset-password"])
    router.get(path, () =>
      safeResponse(shell, 200, "text/html; charset=utf-8"),
    );
  for (const path of ["/admin", "/admin/fortnox/api-credentials"])
    router.get(path, async (c) => {
      try {
        await authorize(c.req.raw);
      } catch {
        return safeResponse('{"error":"AUTH_REQUIRED"}', 401);
      }
      return safeResponse(shell, 200, "text/html; charset=utf-8");
    });
  for (const name of ["admin.js", "admin.css"] as const)
    router.get(`/admin-assets/${name}`, async () =>
      assets
        ? assets(name)
        : safeResponse('{"error":"ASSETS_UNAVAILABLE"}', 503),
    );
  router.all("*", (c) => fallback(c.req.raw));
  return router;
}
