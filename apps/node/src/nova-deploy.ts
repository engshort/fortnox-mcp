import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

export function deploymentCommand(command: string) {
  const match = /^(deploy|status) ([a-f0-9]{40})(?: ([a-f0-9]{64}))?$/.exec(
    command,
  );
  if (
    !match?.[2] ||
    match[0] !== command ||
    (match[1] === "deploy") !== Boolean(match[3])
  )
    throw new Error("Invalid deployment command");
  return { operation: match[1], revision: match[2], digest: match[3] };
}

export async function receiveImage(
  input: NodeJS.ReadableStream,
  path: string,
  expected: string,
  limit = 1024 * 1024 * 1024,
) {
  const hash = createHash("sha256");
  let size = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > limit)
        return callback(new Error("Image exceeds upload limit"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    input,
    measure,
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
  if (hash.digest("hex") !== expected)
    throw new Error("Image checksum mismatch");
}

async function run(args: string[], cwd: string, image?: string) {
  return new Promise<string>((accept, reject) => {
    const child = spawn("docker", args, {
      cwd,
      env: { ...process.env, ...(image ? { FORTNOX_MCP_IMAGE: image } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 1024 * 1024) child.kill("SIGKILL");
    });
    // Never relay provider/configuration values from subprocess diagnostics.
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Deployment subprocess failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) accept(output.trim());
      else
        reject(
          new Error("Deployment subprocess failed; inspect private state"),
        );
    });
  });
}

export async function deploy(
  directory: string,
  command: string,
  input: NodeJS.ReadableStream = process.stdin,
) {
  const request = deploymentCommand(command);
  const image = `fortnox-mcp:nova-${request.revision}`;
  const compose = (args: string[]) =>
    run(["compose", "-f", "compose.yaml", ...args], directory, image);
  const inspect = async () => {
    const id = await compose(["ps", "-q", "fortnox-mcp"]);
    if (!id) return undefined;
    return JSON.parse(await run(["inspect", id], directory))[0] as {
      Image: string;
      Config: { Labels: Record<string, string> };
      State: { Health?: { Status: string } };
    };
  };
  const verify = async () => {
    const current = await inspect();
    if (
      current?.Config.Labels["org.opencontainers.image.revision"] !==
        request.revision ||
      current.State.Health?.Status !== "healthy"
    )
      throw new Error("Requested revision is not healthy");
    return current;
  };
  if (request.operation === "status") {
    const current = await verify();
    console.log(
      JSON.stringify({
        revision: request.revision,
        image: current.Image,
        healthy: true,
      }),
    );
    return;
  }
  const privateDirectory = resolve(directory, ".private");
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  try {
    await readFile(resolve(privateDirectory, "pending.json"));
    throw new Error("Interrupted deployment requires operator recovery");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = await mkdtemp(resolve(privateDirectory, "upload-"));
  try {
    const archive = resolve(temporary, "image.tar.gz");
    if (!request.digest) throw new Error("Missing image checksum");
    await receiveImage(input, archive, request.digest);
    await run(["load", "--input", archive], directory);
    const candidate = JSON.parse(
      await run(["image", "inspect", image], directory),
    )[0] as {
      Id: string;
      Config: { Labels: Record<string, string> };
    };
    if (
      candidate.Config.Labels["org.opencontainers.image.revision"] !==
      request.revision
    )
      throw new Error("Image revision mismatch");
    const previous = await inspect();
    if (
      previous?.Image === candidate.Id &&
      previous.State.Health?.Status === "healthy"
    ) {
      await verify();
      console.log(
        JSON.stringify({
          revision: request.revision,
          healthy: true,
          unchanged: true,
        }),
      );
      return;
    }
    const backup = `/data/pre-deploy-${request.revision}-${randomUUID()}.enc`;
    const pending = {
      revision: request.revision,
      image: candidate.Id,
      previousImage: previous?.Image ?? null,
      backup: previous ? backup : null,
      startedAt: new Date().toISOString(),
    };
    const pendingPath = resolve(privateDirectory, "pending.json");
    // Durable failure evidence exists before stopping or migrating the database.
    await writeFile(pendingPath, JSON.stringify(pending), { mode: 0o600 });
    if (previous) {
      await compose(["stop", "fortnox-mcp"]);
      await compose([
        "run",
        "--rm",
        "--no-deps",
        "-e",
        "MAINTENANCE_MODE=true",
        "fortnox-mcp",
        "node",
        "/app/dist/product-ops.js",
        "upgrade",
        backup,
      ]);
    } else {
      try {
        await readFile(resolve(privateDirectory, "deployed.json"));
        throw new Error(
          "Missing previous container; operator recovery required",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await compose([
      "up",
      "-d",
      "--no-build",
      "--wait",
      "--wait-timeout",
      "150",
      "fortnox-mcp",
    ]);
    await verify();
    await mkdir(resolve(privateDirectory, "revision"), { recursive: true });
    await writeFile(
      resolve(privateDirectory, "revision/revision.conf"),
      `add_header X-Fortnox-Revision "${request.revision}" always;\n`,
      { mode: 0o644 },
    );
    await compose(["up", "-d", "--no-build", "proxy"]);
    await compose(["exec", "-T", "proxy", "nginx", "-t"]);
    await compose(["exec", "-T", "proxy", "nginx", "-s", "reload"]);
    await writeFile(
      resolve(privateDirectory, "deployed.json"),
      JSON.stringify({ ...pending, completedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    await rm(pendingPath);
    console.log(
      JSON.stringify({
        revision: request.revision,
        image: candidate.Id,
        healthy: true,
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const directory = process.argv[2];
  if (!directory) process.exit(1);
  void deploy(resolve(directory), process.env.SSH_ORIGINAL_COMMAND ?? "").catch(
    () => {
      console.error(
        "Deployment failed; preserve pending.json, image, encrypted backup and keys. Do not downgrade a migrated database or resend financial writes.",
      );
      process.exitCode = 1;
    },
  );
}
