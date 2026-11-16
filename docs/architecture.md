# Architecture

Status: these boundaries originated in S01; see the [documentation map](README.md) for current implementation and acceptance evidence. The optional [team extension](implementation/team-access.md) adds user-specific authorization while retaining the installation data partition. Historical S01 evidence does not establish later product acceptance.

## Components and boundaries

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| MCP transport | Identity context, schemas, tool discovery/results, standard annotations | Decide company access from model text or call Fortnox directly |
| Domain services | Company authorization, policy, validation, preparation/execution, deterministic analysis | Depend on Cloudflare bindings or Node filesystem APIs |
| Fortnox adapter | HTTP requests, versioned endpoint mappings, pagination, errors, rate limits and token acquisition | Retry uncertain non-idempotent writes blindly |
| Operational storage | Connections, policy versions, bounded proposals, execution receipts, audit metadata | Mirror the ledger or retain full receipts indefinitely |
| Runtime adapters | Cloudflare or Node hosting, secrets, storage, file streams, clock | Change business behavior between runtimes |
| UI | Setup/admin and embedded receipt/voucher review | Turn a model-supplied confirmation into human approval |

Workspace structure (created in S01; responsibilities expand in later scopes):

| Path | Purpose |
| --- | --- |
| `packages/core` | Pure domain types, policies, validators, analytics |
| `packages/fortnox` | Typed provider client and explicit endpoint corrections |
| `packages/mcp` | Tools, resources, schemas and result envelopes |
| `packages/ui` | Small setup/admin and MCP Apps views |
| `apps/node` | Node HTTP/stdio entry points, SQLite/storage adapter, Docker |
| `apps/worker` | Cloudflare HTTP entry point and platform bindings |
| `apps/shared` | Shared product HTTP/authentication composition and portable SQL adapters |
| `tests` | Synthetic contract, integration and client acceptance evidence |

## Web application and HTTP routing (D22)

The protected web application uses React with a Vite production build. Its static assets are served from the same origin as the installation on both Cloudflare Workers and Node.js. Hono composes same-origin shell/asset routes around the existing Fetch-based product handlers. It does not replace the MCP SDK, move policies into UI routes or introduce a second backend. Optional team access adds administrator and personal views; authorization stays in the shared domain layer.

Keep distinct entry points and trust boundaries for the protected setup/admin/member app and embedded MCP Apps receipt/voucher review. The embedded views must remain compatible with actual host CSP, model/UI visibility and server-enforced review acceptance under G02 before any framework migration. Existing HTML-based views may remain in place until verified replacements are ready.

The dependency-free public GitHub Pages website (`index.html`, `installera/`, `site/`) is **outside** this decision. See [D22](decisions.md#d22--web-application-framework-proposed-2026-11-06) and [S11](implementation/S11-setup-deployment.md) for decision and acceptance details.

## Runtime choices

Use the official TypeScript MCP SDK release that passes the supported-client matrix. MCP `2026-07-28` and older client negotiation/compatibility must be evaluated explicitly in S00; a newer protocol must not strand the first ChatGPT target. Pin exact dependency versions and runtime compatibility settings in S01; do not use an untested floating `latest` in release artifacts.

Use runtime input/output validation (a compatible schema library such as Zod), strict TypeScript and a maintained exact-decimal library. TypeScript types alone are insufficient. Keep money lexemes exact at the JSON boundary; do not parse large/precise money through a binary floating-point intermediate before constructing a decimal.

Streamable HTTP is the remote transport. Stdio is an optional local adapter for clients that support it, with explicitly configured company access and logs on stderr. It does not make a localhost server directly accessible to ChatGPT; see [clients](contracts/clients.md).

## Request path

Authenticate → authorize company and module → validate input → resolve provider context → enforce current write/review policy → perform/reconcile request → return structured result and evidence.

Mutations use distinct prepare/execute services when review is required. Every entry path, including batch, UI and developer diagnostics, calls those same services. Generic API passthrough is not exposed.

## Concurrency and state

Rate limiting is scoped to Fortnox client ID and tenant, shared across concurrent requests for the same installation. Serialize token refresh per connection when the refresh-token flow is used. Bound global and per-tenant concurrency to avoid one company starving others.

The storage interface must support atomic compare-and-set, uniqueness and durable write-intent records. For Node, SQLite is the initial single-instance candidate. For Cloudflare, D1/another transactional adapter must demonstrate equivalent primitives. Eventually consistent KV alone is not acceptable for approval consumption or duplicate-write protection. Do not promise safe multi-replica deployment until coordination is tested.

## Long and large work

Page provider reads with item/page/time/byte budgets. Return `complete=false` and continuation information when a budget is hit. Never represent the first page as the whole ledger. Parse SIE and file streams incrementally where possible; keep state bounded. Operations exceeding a runtime's limits must resume explicitly or produce an actionable limit error, not silently truncate.

Workers free-tier CPU limits, schema-catalog size, decimal/SIE parsing and upload size are feasibility gates. Benchmark real representative payloads in S00/S01 and document when a paid plan or Node deployment is required.

## Extension seams

The [REST read adapter](contracts/rest.md) shares portable company/accounting/
financial services with MCP. Both adapters convert validated OAuth grants into
domain permissions. API company grants and continuation bindings include the
resource; existing MCP storage and public result formats remain compatible.
The Hono read router is mounted in the existing product application for both
runtimes. REST does not call MCP over HTTP or duplicate the provider connection
lifecycle. Its own OpenAPI document is generated from shared Zod read contracts.

Modules register capabilities and contracts; runtime adapters implement storage/transport; clients advertise UI/file capabilities. Optional team access uses these seams without replacing company storage or policy. Hosted multi-user operation, external SSO, payroll expansion and event listeners remain separate extensions. They do not justify building a multi-user SaaS control plane now.
