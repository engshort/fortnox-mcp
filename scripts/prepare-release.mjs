import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const licenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "(MIT AND Zlib)",
]);
export async function prepareRuntimeNotices(directory) {
  const root = resolve(".");
  const inputFiles = [];
  for (const name of ["product-node", "product-ops"]) {
    const metadata = JSON.parse(
      await readFile(`dist/${name}.meta.json`, "utf8"),
    );
    inputFiles.push(...Object.keys(metadata.inputs));
  }
  inputFiles.push(
    ...JSON.parse(await readFile("dist/admin/admin-inputs.json", "utf8")),
  );
  const packages = new Map();
  for (const input of inputFiles.filter((p) => p.startsWith("node_modules/"))) {
    let path = dirname(resolve(input));
    while (path.startsWith(join(root, "node_modules"))) {
      try {
        const pkg = JSON.parse(
          await readFile(join(path, "package.json"), "utf8"),
        );
        if (pkg.name && pkg.version) {
          if (!licenses.has(pkg.license))
            throw new Error("Unreviewed runtime license");
          packages.set(path, pkg);
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      path = dirname(path);
    }
  }
  if (!packages.size) throw new Error("Runtime dependency evidence missing");
  const noticeDirectory = join(directory, "licenses");
  await mkdir(noticeDirectory, { recursive: true });
  const components = [];
  for (const [path, pkg] of [...packages.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const notices = (await readdir(path)).filter((f) =>
      /^(licen[sc]e|copying|notice)([._-].*)?$/i.test(f),
    );
    if (!notices.length) throw new Error(`Missing license text: ${pkg.name}`);
    const name = `${pkg.name.replaceAll("/", "_").replaceAll("@", "")}-${pkg.version}`;
    for (const notice of notices)
      if ((await stat(join(path, notice))).isFile())
        await copyFile(
          join(path, notice),
          join(noticeDirectory, `${name}-${notice}`),
        );
    components.push({
      type: "library",
      name: pkg.name,
      version: pkg.version,
      "bom-ref": relative(root, path),
      licenses: [{ expression: pkg.license }],
    });
  }
  return components;
}
export async function prepareRelease({ version, output, image, measurement }) {
  if (!/^0\.\d+\.\d+-(alpha|mvp|rc)\.[0-9.]+$/.test(version))
    throw new Error("Explicit prerelease version required");
  if (
    (
      await run("git", ["status", "--porcelain", "--untracked-files=normal"])
    ).stdout.trim()
  )
    throw new Error("Clean reviewed source required");
  const commit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  const root = resolve("."),
    directory = resolve(output);
  if (directory === root || directory.startsWith(`${root}/`))
    throw new Error("Prepare artifacts outside the source checkout");
  await mkdir(directory, { mode: 0o700 }); // Never replace a previous candidate.
  const built = JSON.parse(await readFile("dist/build-info.json", "utf8"));
  if (built.source_commit !== commit)
    throw new Error("Rebuild from the candidate commit");
  for (const [path, expected] of Object.entries(built.artifacts))
    if (hash(await readFile(join("dist", path))) !== expected)
      throw new Error("Built artifact changed after verification");
  const tracked = (
    await run("git", ["ls-files", "-z"], { maxBuffer: 4 * 1024 * 1024 })
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const path of tracked) {
    if (
      /(^|\/)(vendor-specs|private-fixtures|\.private|\.data|node_modules|\.git)(\/|$)/.test(
        path,
      ) ||
      (/(^|\/)(openapi\.json|\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$/.test(
        path,
      ) &&
        path !== ".env.example")
    )
      throw new Error("Unreviewed private/external source path");
  }
  const components = await prepareRuntimeNotices(directory);
  await run("git", [
    "archive",
    "--format=tar",
    `--prefix=fortnox-mcp-${version}/`,
    `--output=${join(directory, `fortnox-mcp-${version}-source.tar`)}`,
    "HEAD",
  ]);
  await copyFile("LICENSE", join(directory, "LICENSE"));
  await copyFile(
    "THIRD_PARTY_NOTICES.md",
    join(directory, "THIRD_PARTY_NOTICES.md"),
  );
  await copyFile(
    "docs/implementation/M05-actual-acceptance.md",
    join(directory, "ACCEPTANCE-PENDING.md"),
  );
  await copyFile("docs/deployment-linux.md", join(directory, "INSTALL.en.md"));
  await copyFile("docs/users/docker.sv.md", join(directory, "INSTALL.sv.md"));
  await writeFile(
    join(directory, "sbom.cdx.json"),
    JSON.stringify(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        version: 1,
        metadata: {
          component: {
            type: "application",
            name: "fortnox-mcp",
            version,
            properties: [{ name: "source:commit", value: commit }],
          },
        },
        components,
      },
      null,
      2,
    ),
  );
  let imageEvidence = null;
  if (image) {
    const inspected = JSON.parse(
      (await run("docker", ["image", "inspect", image])).stdout,
    )[0];
    if (
      inspected.Config.Labels["org.opencontainers.image.revision"] !== commit ||
      inspected.Config.Labels["org.opencontainers.image.version"] !== version
    )
      throw new Error("Image does not match candidate source/version");
    const imageHashes = (
      await run("docker", [
        "run",
        "--rm",
        "--network=none",
        image,
        "sha256sum",
        "/app/dist/product-node.js",
        "/app/dist/product-ops.js",
        "/app/public/admin.js",
        "/app/public/admin.css",
      ])
    ).stdout
      .trim()
      .split("\n");
    for (const line of imageHashes) {
      const [digest, path] = line.trim().split(/\s+/);
      const key = path
        .replace("/app/dist/", "")
        .replace("/app/public/", "admin/");
      if (built.artifacts[key] !== digest)
        throw new Error("Image artifact differs from reviewed local build");
    }
    await run(
      "docker",
      [
        "save",
        "--output",
        join(directory, `fortnox-mcp-${version}-image.tar`),
        image,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    // Full OS package inventory and original runtime notices accompany the JS SBOM.
    const inventory = await run("docker", [
      "run",
      "--rm",
      "--network=none",
      image,
      "dpkg-query",
      "-W",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal dpkg-query field syntax, no shell interpolation
      "-f=${Package}\t${Version}\t${Architecture}\n",
    ]);
    await writeFile(join(directory, "image-os-packages.tsv"), inventory.stdout);
    const container = (
      await run("docker", ["create", "--network=none", image])
    ).stdout.trim();
    try {
      await run("docker", [
        "cp",
        `${container}:/usr/share/doc`,
        join(directory, "os-notices"),
      ]);
      await run("docker", [
        "cp",
        `${container}:/usr/local/LICENSE`,
        join(directory, "NODE-LICENSE"),
      ]);
      await run("docker", [
        "cp",
        `${container}:/usr/share/common-licenses`,
        join(directory, "os-common-licenses"),
      ]);
    } finally {
      await run("docker", ["rm", container]);
    }
    imageEvidence = {
      id: inspected.Id,
      size_bytes: inspected.Size,
      architecture: inspected.Architecture,
      os: inspected.Os,
    };
  }
  const manifest = {
    version,
    source_commit: commit,
    created_at: new Date().toISOString(),
    distribution_approved: false,
    status: "draft-artifacts-only",
    actual_acceptance: "pending",
    source_rights_gate:
      "#35 remains separate; external specification and private material absent",
    image: imageEvidence,
    limitations: [
      "No stable release or publication",
      "Financial/provider-file/review gates remain off",
      "Actual operator/ChatGPT/Fortnox/security-report delivery pending",
      "OS inventory/notices supplement the JS runtime SBOM; full image distribution review remains required",
    ],
  };
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  if (measurement)
    await writeFile(
      join(directory, "MEASUREMENTS.json"),
      JSON.stringify(measurement, null, 2),
    );
  await writeFile(
    join(directory, "RELEASE-NOTES.md"),
    `# fortnox-mcp ${version}\n\nDraft candidate preparation from ${commit}. Distribution and actual acceptance remain pending.\n\nLinux amd64, Node 24.19.0, Docker Compose and existing Nginx. Protected bilingual owner setup, bounded connection diagnosis and offline backup/restore/rotation/upgrade are implemented. Financial/provider-file/review operations remain disabled. No production account support or stable release is claimed. Systemd and APT are documented future work only.\n\nSee INSTALL.en.md, INSTALL.sv.md, ACCEPTANCE-PENDING.md, runtime SBOM and original notices. No external OpenAPI or private fixtures are included.\n`,
  );
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) files.push(next);
      else if (!entry.isSymbolicLink())
        throw new Error("Unexpected artifact type");
    }
  }
  await walk(directory);
  const sums = [];
  for (const path of files.sort())
    sums.push(`${hash(await readFile(path))}  ${relative(directory, path)}`);
  await writeFile(join(directory, "SHA256SUMS"), `${sums.join("\n")}\n`);
  return {
    version,
    source_commit: commit,
    components: components.length,
    image_prepared: !!image,
    distribution_approved: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        await prepareRelease({
          version: process.argv[2],
          output: process.argv[3],
          image: process.env.M05_RELEASE_IMAGE,
        }),
      ),
    );
  } catch (error) {
    console.error("Draft artifact preparation failed:", error.message);
    process.exitCode = 1;
  }
}
