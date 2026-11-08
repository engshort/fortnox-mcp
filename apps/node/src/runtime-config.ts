import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";

const secretNames = [
  "AUTH_SECRET",
  "CREDENTIAL_KEYS",
  "FORTNOX_CLIENT_SECRET",
  "BACKUP_KEY",
] as const;
export async function nodeEnvironment(input: NodeJS.ProcessEnv) {
  const env = { ...input };
  for (const name of secretNames) {
    const path = env[`${name}_FILE`];
    if (!path) continue;
    if (env[name]) throw new Error(`Conflicting ${name} configuration`);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 65536) throw new Error();
      const value = (await readFile(path, "utf8")).trimEnd();
      if (!value || Buffer.byteLength(value) > 65536) throw new Error();
      env[name] = value;
    } catch {
      throw new Error(`Unavailable ${name} file`);
    }
  }
  return env;
}

export function nodeRuntimeSettings(env: NodeJS.ProcessEnv) {
  const host = env.HOST ?? "127.0.0.1";
  if (
    !isIP(host) &&
    !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?)$/.test(host)
  )
    throw new Error("Invalid HOST");
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const proxy = env.NODE_PROXY_MODE ?? "none";
  if (proxy !== "none" && proxy !== "nginx")
    throw new Error("Invalid NODE_PROXY_MODE");
  return {
    host,
    port,
    proxy,
    database: resolve(
      env.PRODUCT_DATABASE ??
        resolve(env.DATA_DIR ?? ".data", "product.sqlite"),
    ),
    migrations: resolve(env.PRODUCT_MIGRATIONS_DIR ?? "apps/worker/migrations"),
  } as const;
}

// Only enable behind the supplied Nginx boundary and a loopback-published port.
// Nginx overwrites Host/forwarded protocol; browser Origin is never rewritten.
export function proxyRequest(
  request: Request,
  origin: string,
  mode: "none" | "nginx",
) {
  if (mode === "none") return request;
  const expected = new URL(origin);
  const url = new URL(request.url);
  if (
    expected.protocol !== "https:" ||
    url.host !== expected.host ||
    request.headers.get("x-forwarded-proto") !== "https" ||
    (request.headers.has("x-forwarded-host") &&
      request.headers.get("x-forwarded-host") !== expected.host)
  )
    throw new Error("PROXY_DENIED");
  url.protocol = "https:";
  return new Request(url, request);
}
