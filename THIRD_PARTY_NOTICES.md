# Third-party material and names

Project-authored code and documentation use AGPL-3.0-only. This does not grant rights to Fortnox's API specification, documentation, trademarks, customer data or other third-party material.

## S00 optional file-probe dependencies (2026-11-05)

These exact versions are confined to the experimental OAuth/file package:

| Package | Version | License |
| --- | --- | --- |
| pdf-lib | 1.17.1 | MIT |
| pngjs | 7.0.0 | MIT |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| ipaddr.js | 2.2.0 | MIT |
| http-parser-js | 0.5.10 | MIT |
| @types/pngjs (development only) | 6.0.5 | MIT |

Transitive pins, integrity and licenses remain in the package lockfile. Preserve
their original notices when distributing a bundle. These libraries provide
format parsing, address classification and HTTP framing; no Fortnox specification
or generated provider material was introduced. Their licenses do not resolve G05.

## Fortnox specification provenance

The initial design was informed by a user-supplied `openapi.json`, identified in [source-lock.json](docs/reference/source-lock.json). Its `info.license` field is absent. The file is not committed or relicensed here. Obtain an authorized copy from Fortnox for local development and preserve provenance. Review redistribution rights before vendoring specifications or generating redistributable code from them.

The inventory in this repository contains resource names, counts and original design classifications; it is not a replacement for Fortnox documentation. Source links are in [sources](docs/reference/sources.md). Keep downloaded third-party documentation out of git unless its redistribution terms have been checked.

## License text

`LICENSE` contains the GNU Affero General Public License version 3 text. The license itself permits verbatim copying; its own notice is retained. The initial copy was retrieved from the SPDX license-list-data repository, `text/AGPL-3.0-only.txt`.

## Names and dependencies

### Website fonts

The website bundles unmodified Latin WOFF2 font files from `@fontsource-variable/inter` 5.3.0 and `@fontsource/libre-baskerville` 5.3.0. These font files use SIL Open Font License 1.1, rather than the project's AGPL license. Their original copyright and complete license notices are retained in [INTER-LICENSE.txt](site/fonts/INTER-LICENSE.txt) and [LIBRE-BASKERVILLE-LICENSE.txt](site/fonts/LIBRE-BASKERVILLE-LICENSE.txt).

- Inter: [upstream project](https://github.com/rsms/inter), [Fontsource package](https://www.npmjs.com/package/@fontsource-variable/inter). `inter-latin.woff2` SHA-256: `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`.
- Libre Baskerville: [upstream project](https://github.com/impallari/Libre-Baskerville), [Fontsource package](https://www.npmjs.com/package/@fontsource/libre-baskerville). `libre-baskerville-italic-latin.woff2` SHA-256: `efb7e5f4376a557314f5bb9f5197ef837d86c0ab38e1a50a0ff5c60c3400c629`.

### Service names and future dependencies

Fortnox is used descriptively. This project is not an official Fortnox integration or an endorsement by Fortnox, OpenAI, Anthropic or Cloudflare. Do not use their logos without appropriate permission.

### Service names on the website

The current website uses plain-text product names to describe the planned integration. It contains no OpenAI/ChatGPT or Claude logo files. OpenAI's and Anthropic's marks are not part of the project's AGPL grant.

The earlier logo proposal was removed at the owner's request during the hero redesign. In particular, Anthropic's [trademark guidelines](https://www.anthropic.com/legal/trademark-guidelines) require prior approval for materials using its marks; no such approval is recorded. Do not restore the Claude artwork without resolving that requirement. The use of a product name in technical compatibility documentation does not claim endorsement or an implemented integration.

When implementation adds dependencies, record their versions and licenses in the lockfile and release SBOM. Verify compatibility with AGPL-3.0-only before distribution. Do not infer a dependency's license from the language or ecosystem.

### S00 isolated spike dependencies

The private, unpublished package in `spikes/s00-mcp` pins these direct dependencies.
Versions, registry URLs, integrity hashes and transitive license metadata are in
its [package-lock.json](spikes/s00-mcp/package-lock.json).

| Dependency | Version | License | Purpose |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | Official MCP server/client and Streamable HTTP |
| `@cfworker/json-schema` | 4.1.1 | MIT | SDK validator without dynamic code generation |
| `@hono/node-server` | 2.1.5 | MIT | Node HTTP adapter |
| `zod` | 4.6.7 | MIT | Strict runtime input/output schemas |
| `@types/node` | 24.19.2 | MIT | Development types |
| `typescript` | 7.0.2 | Apache-2.0 | Compiler |
| `tsx` | 4.23.15 | MIT | TypeScript development/test runner |
| `esbuild` | 0.28.2 | MIT | Portable Worker bundle |

The lockfile's 148 dependency entries (including optional platform packages)
declare MIT (117), Apache-2.0 (21), ISC (7), BSD-3-Clause (2) or BSD-2-Clause (1).
These permissive licenses are compatible with this project's AGPL-3.0-only
selection; original notices still apply. No dependency is relicensed as project
source. Generate an installed runtime inventory with
`npm sbom --sbom-format cyclonedx --omit=dev` from the spike directory. A release
must retain required notices and produce an SBOM for its actual artifacts.
No Fortnox specification is vendored or used to generate code by this spike;
G05's upstream acquisition/redistribution question remains open.

## S01 workspace dependencies

### S00 OAuth probe

The isolated [OAuth probe lockfile](spikes/s00-oauth/package-lock.json) adds
`better-auth` and `@better-auth/oauth-provider` `1.7.10` (MIT). OAuth issuance,
verification and one-time login remain in those maintained components. Its
dual-protocol follow-up pins `@modelcontextprotocol/server` and transitive
`@modelcontextprotocol/core` `2.3.1` (Apache-2.0). The SDK 2 client `2.3.1`
(Apache-2.0) and SDK 1 `1.32.1` (MIT) are development-only interoperability
test dependencies. Apache-2.0 is compatible with AGPL-3.0-only; preserve the
upstream license and applicable notices in any distributed artifact.
The browser regression suite pins `@playwright/test`, `playwright` and
`playwright-core` `1.64.1` (Apache-2.0) as development-only dependencies. Test
browsers are separate development downloads and are not bundled with the Worker.
Validator, Zod and Node adapter pins match the earlier spike. The probe also
uses the pinned Wrangler/Workers types/Miniflare toolchain listed below.
Lockfile license metadata and an installed runtime SBOM must be reviewed for
any distributed artifact. No package or release is published by this probe.

The root workspace preserves the spike's official MCP SDK `1.32.1`, Zod `4.6.7`,
`@cfworker/json-schema` `4.1.1` and Node HTTP adapter `2.1.5` (MIT), and adds
`decimal.js` `10.6.0` (MIT). No Fortnox source is vendored or generated.

Direct development dependencies are pinned in the root lockfile:

| Dependency | Version | Declared license |
| --- | --- | --- |
| TypeScript | 7.0.2 | Apache-2.0 |
| tsx | 4.23.15 | MIT |
| esbuild | 0.28.2 | MIT |
| Node types | 24.19.2 | MIT |
| Biome | 2.5.15 | MIT OR Apache-2.0 |
| Vitest | 4.1.12 | MIT |
| Cloudflare Vitest plugin | 1.4.4 | MIT |
| Cloudflare Workers types | 5.20261018.1 | MIT OR Apache-2.0 |
| Wrangler | 4.151.1 | MIT OR Apache-2.0 |
| Miniflare | 5.20261012.1-beta | MIT |

The beta Miniflare pin is part of the current Cloudflare test-plugin dependency
set and is verified only for the recorded local scenarios. Preserve dependency
notices when distributing artifacts. `npm sbom --sbom-format cyclonedx --omit=dev`
produces the installed runtime dependency inventory; a release must attach its
own SBOM and review transitive licenses. No package or release is published by S01.
