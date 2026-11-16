import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describeOutput } from "@fortnox-mcp/docs";
import { expect, it } from "vitest";
import { loadDocsCatalog } from "../../apps/node/src/docs.js";
import { docsFixture } from "../shared/docs-fixture.js";

it("serves a privately loaded operation through the actual Node docs entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fortnox-docs-operation-"));
  const file = join(directory, "private-spec.json");
  await writeFile(file, JSON.stringify(docsFixture()));
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
      resolve("apps/node/src/docs-main.ts"),
    ],
    {
      cwd: directory,
      env: { ...process.env, PORT: "8799", FORTNOX_OPENAPI_PATH: file },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw new Error("Docs CLI exited before startup");
      }),
    ]);
    const response = await fetch("http://127.0.0.1:8799/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "describe_api_operation",
          arguments: { operation_id: "VoucherController_doCreate" },
        },
      }),
    });
    const body = (await response.json()) as {
      result: { structuredContent: unknown };
    };
    const result = describeOutput.parse(body.result.structuredContent);
    expect(result.request_body?.content[0]?.media_type).toBe("*/*");
    expect(result.coverage.execution_available).toBe(false);
    expect(result.source.kind).toBe("user_supplied_openapi");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it("loads a privately selected file and rejects explicit missing/invalid paths without leaking contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fortnox-docs-"));
  try {
    const file = join(directory, "spec.json");
    await writeFile(file, JSON.stringify(docsFixture()));
    expect((await loadDocsCatalog(file)).availability()).toMatchObject({
      operations: 4,
      schemas: 4,
    });
    await expect(loadDocsCatalog(join(directory, "missing"))).rejects.toThrow(
      "SPEC_UNAVAILABLE",
    );
    await expect(loadDocsCatalog("")).rejects.toThrow("INVALID_SPEC");
    await expect(loadDocsCatalog(directory)).rejects.toThrow("INVALID_SPEC");
    await writeFile(file, "secret malformed source");
    await expect(loadDocsCatalog(file)).rejects.toThrow(/^INVALID_SPEC$/);
    await writeFile(file, new Uint8Array([0xff, 0xfe]));
    await expect(loadDocsCatalog(file)).rejects.toThrow(/^INVALID_SPEC$/);
    await writeFile(file, " ".repeat(8 * 1024 * 1024 + 1));
    await expect(loadDocsCatalog(file)).rejects.toThrow(/^INVALID_SPEC$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("the actual local docs entry starts without a spec and fails closed for an explicitly invalid file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fortnox-docs-cli-"));
  const entry = resolve("apps/node/src/docs-main.ts");
  const tsx = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
  try {
    const environment: NodeJS.ProcessEnv = { ...process.env, PORT: "0" };
    delete environment.FORTNOX_OPENAPI_PATH;
    const missing = spawn(process.execPath, ["--import", tsx, entry], {
      cwd: directory,
      env: { ...environment, PORT: "8797" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const started = await Promise.race([
        once(missing.stdout, "data"),
        once(missing, "exit").then(() => {
          throw new Error("CLI exited before startup");
        }),
      ]);
      expect(String(started[0])).toContain("docs_server_started");
      const response = await fetch("http://127.0.0.1:8797/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search_api_docs", arguments: { query: "OAuth" } },
        }),
      });
      const body = (await response.json()) as {
        result: { structuredContent: { api_reference: { status: string } } };
      };
      expect(body.result.structuredContent.api_reference.status).toBe(
        "unavailable",
      );
    } finally {
      if (missing.exitCode === null && missing.signalCode === null) {
        const exited = once(missing, "exit");
        missing.kill();
        await exited;
      }
    }
    const badFile = join(directory, "bad.json");
    await writeFile(badFile, "DO_NOT_PRINT_SOURCE");
    const bad = spawn(process.execPath, ["--import", tsx, entry], {
      cwd: directory,
      env: { ...environment, FORTNOX_OPENAPI_PATH: badFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    bad.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    bad.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    expect((await once(bad, "exit"))[0]).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toBe("docs_startup_failed:INVALID_SPEC\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
