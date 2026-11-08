import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const name = `fortnox-m5-${randomBytes(5).toString("hex")}`;
const directory = await mkdtemp(resolve(tmpdir(), `${name}-`));
const image = `${name}:test`;
const source = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `https://localhost:${port}`;
const env = { ...process.env, SOURCE_COMMIT: source, FORTNOX_MCP_IMAGE: image };
const compose = (...args) =>
  run(
    "docker",
    ["compose", "-p", name, "-f", resolve(directory, "compose.yaml"), ...args],
    { env, maxBuffer: 4 * 1024 * 1024 },
  );
try {
  await run(
    "docker",
    [
      "build",
      "-f",
      "deploy/docker/Dockerfile",
      "--build-arg",
      `SOURCE_COMMIT=${source}`,
      "-t",
      image,
      ".",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await mkdir(resolve(directory, ".private"), { mode: 0o700 });
  await run("docker", [
    "run",
    "--rm",
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "-v",
    `${directory}/.private:/output`,
    image,
    "node",
    "/app/initialize.mjs",
    "/output",
    origin,
  ]);
  await copyFile(
    "deploy/docker/compose.yaml",
    resolve(directory, "compose.yaml"),
  );
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    resolve(directory, "key.pem"),
    "-out",
    resolve(directory, "cert.pem"),
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-days",
    "1",
  ]);
  let nginx = await readFile("deploy/nginx/fortnox-mcp.conf", "utf8");
  nginx = nginx
    .replace("listen 443 ssl;", `listen 127.0.0.1:${port} ssl;`)
    .replaceAll("fortnox.example.invalid", "localhost")
    .replace(/ssl_certificate .*;/, "ssl_certificate /etc/nginx/test-cert.pem;")
    .replace(
      /ssl_certificate_key .*;/,
      "ssl_certificate_key /etc/nginx/test-key.pem;",
    );
  await writeFile(resolve(directory, "nginx.conf"), nginx);
  await compose("up", "-d", "--no-build");
  await run("docker", [
    "run",
    "-d",
    "--name",
    `${name}-nginx`,
    "--network",
    "host",
    "-v",
    `${directory}/nginx.conf:/etc/nginx/conf.d/default.conf:ro`,
    "-v",
    `${directory}/cert.pem:/etc/nginx/test-cert.pem:ro`,
    "-v",
    `${directory}/key.pem:/etc/nginx/test-key.pem:ro`,
    "nginx:1.28-alpine",
  ]);
  const ca = await readFile(resolve(directory, "cert.pem"));
  const call = (path, method = "GET", body, extra = {}) =>
    new Promise((resolveCall, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          servername: "localhost",
          ca,
          path,
          method,
          headers: {
            host: `localhost:${port}`,
            ...(body ? { "content-type": "application/json" } : {}),
            ...extra,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (b) => chunks.push(b));
          response.on("end", () =>
            resolveCall({
              status: response.statusCode,
              headers: response.headers,
              text: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.setTimeout(5000, () =>
        req.destroy(new Error("Synthetic HTTPS timeout")),
      );
      req.on("error", reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await call("/health")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert(ready, "Docker/Nginx health did not become ready");
  const token = (
    await compose(
      "exec",
      "-T",
      "fortnox-mcp",
      "node",
      "-e",
      "process.stdout.write(require('node:fs').readFileSync('/data/bootstrap-code.txt','utf8'))",
    )
  ).stdout;
  const bootstrap = {
    token,
    email: "owner@example.invalid",
    password: "synthetic-smoke-password",
  };
  assert.equal(
    (
      await call("/admin/bootstrap", "POST", bootstrap, {
        origin: "https://foreign.invalid",
      })
    ).status,
    403,
  );
  const accepted = await call("/admin/bootstrap", "POST", bootstrap, {
    origin,
  });
  assert.equal(accepted.status, 200);
  const cookies = accepted.headers["set-cookie"] ?? [];
  assert(
    cookies.some((c) => /; Secure/i.test(c)),
    "Secure cookie missing",
  );
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  assert.equal(
    (await call("/admin", "GET", undefined, { cookie })).status,
    200,
  );
  const metadata = JSON.parse(
    (await call("/.well-known/oauth-protected-resource/mcp")).text,
  );
  assert.equal(metadata.resource, `${origin}/mcp`);
  assert.equal(
    (
      await call("/mcp", "POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_companies", arguments: {} },
      })
    ).status,
    401,
  );
  await compose("stop", "fortnox-mcp");
  const container = (await compose("ps", "-aq", "fortnox-mcp")).stdout.trim();
  assert.equal(
    (
      await run("docker", [
        "inspect",
        "--format",
        "{{.State.ExitCode}}",
        container,
      ])
    ).stdout.trim(),
    "0",
  );
  await compose("up", "-d", "--no-build", "--force-recreate");
  for (let i = 0; i < 60; i++) {
    if ((await call("/health")).status === 200) break;
    await delay(500);
  }
  assert.equal(
    (await call("/admin", "GET", undefined, { cookie })).status,
    200,
  );
  assert.equal(
    (await call("/admin/bootstrap", "POST", bootstrap, { origin })).status,
    403,
  );
  const history = (await run("docker", ["history", "--no-trunc", image]))
    .stdout;
  for (const file of ["auth-secret", "credential-keys.json", "backup-key"])
    assert(
      !history.includes(
        (await readFile(resolve(directory, ".private", file), "utf8")).trim(),
      ),
    );
  console.log(
    "m5_docker_https_smoke_passed; synthetic bootstrap/origin/cookies/MCP/recreate checked; no provider calls",
  );
} catch (error) {
  // Never echo subprocess output: exec/HTTP buffers may contain synthetic tokens.
  console.error(
    "m5_docker_https_smoke_failed",
    error instanceof assert.AssertionError
      ? error.message
      : "build/runtime prerequisite failure",
  );
  process.exitCode = 1;
} finally {
  await run("docker", ["rm", "-f", `${name}-nginx`]).catch(() => {});
  await compose("down", "--volumes", "--remove-orphans").catch(() => {});
  await run("docker", ["image", "rm", image]).catch(() => {});
  await rm(directory, { recursive: true, force: true });
  process.chdir(root);
}
