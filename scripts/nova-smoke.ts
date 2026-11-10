import assert from "node:assert/strict";

const origin = new URL(
  process.env.NOVA_PUBLIC_ORIGIN ?? "https://fortnox.mcp.engshort.se",
);
const revision = process.env.SOURCE_COMMIT;
assert.equal(origin.protocol, "https:");
assert.match(revision ?? "", /^[a-f0-9]{40}$/);
const call = (path: string, init?: RequestInit) =>
  fetch(new URL(path, origin), {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
const health = await call("/health");
assert.equal(health.status, 200);
assert.equal(health.headers.get("x-fortnox-revision"), revision);
assert.equal(((await health.json()) as { ok: boolean }).ok, true);
assert.equal((await call("/setup")).status, 200);
const metadata = await call("/.well-known/oauth-authorization-server");
assert.equal(metadata.status, 200);
assert.equal(
  ((await metadata.json()) as { issuer: string }).issuer,
  origin.origin,
);
assert.equal((await call("/admin/state")).status, 401);
assert.equal(
  (
    await call("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  ).status,
  401,
);
const redirect = await fetch(
  new URL("/setup", origin.origin.replace("https:", "http:")),
  { redirect: "manual", signal: AbortSignal.timeout(15_000) },
);
assert.ok([301, 308].includes(redirect.status));
const location = redirect.headers.get("location");
assert.ok(location);
assert.equal(new URL(location).origin, origin.origin);
console.log(
  JSON.stringify({
    origin: origin.origin,
    revision,
    health: "passed",
    oauth: "passed",
    private_access: "denied",
    http: "redirected",
    provider_calls: 0,
  }),
);
