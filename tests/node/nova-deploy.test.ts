import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  deploy,
  deploymentCommand,
  receiveImage,
} from "../../apps/node/src/nova-deploy.js";

describe("restricted Nova deployment input", () => {
  const revision = "a".repeat(40);
  const digest = "b".repeat(64);
  it("blocks an interrupted upgrade before consuming another image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-pending-"));
    try {
      await mkdir(join(directory, ".private"));
      await writeFile(join(directory, ".private/pending.json"), "{}");
      const input = Readable.from([Buffer.from("unused")]);
      await expect(
        deploy(directory, `deploy ${revision} ${digest}`, input),
      ).rejects.toThrow("operator recovery");
      expect(input.readableDidRead).toBe(false);
      expect(
        await readFile(join(directory, ".private/pending.json"), "utf8"),
      ).toBe("{}");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("cleans a corrupt upload before any Docker or service action", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-corrupt-"));
    try {
      await expect(
        deploy(
          directory,
          `deploy ${revision} ${digest}`,
          Readable.from([Buffer.from("corrupt")]),
        ),
      ).rejects.toThrow("checksum");
      expect(await readdir(join(directory, ".private"))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("allows only exact deploy/status commands, without shell expansion", () => {
    expect(deploymentCommand(`deploy ${revision} ${digest}`).revision).toBe(
      revision,
    );
    expect(deploymentCommand(`status ${revision}`).operation).toBe("status");
    for (const value of [
      "sh",
      `deploy ${revision}`,
      `status ${revision} ${digest}`,
      `deploy ${revision} ${digest};id`,
      `deploy ../${revision} ${digest}`,
      `status ${revision}\n`,
    ])
      expect(() => deploymentCommand(value)).toThrow();
  });
  it("accepts only a matching, bounded stream and refuses replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nova-image-"));
    try {
      const bytes = Buffer.from("synthetic image bytes");
      const expected = createHash("sha256").update(bytes).digest("hex");
      const path = join(directory, "image");
      await receiveImage(
        Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]),
        path,
        expected,
      );
      expect(await readFile(path)).toEqual(bytes);
      await expect(
        receiveImage(Readable.from([bytes]), path, expected),
      ).rejects.toThrow();
      await expect(
        receiveImage(Readable.from([bytes]), join(directory, "wrong"), digest),
      ).rejects.toThrow("checksum");
      await expect(
        receiveImage(
          Readable.from([bytes]),
          join(directory, "oversize"),
          expected,
          2,
        ),
      ).rejects.toThrow("limit");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
