# REST and shared financial reads

Date: 2026-11-16. Scope: S03 transport/authorization; read subsets of S04–S06;
provider-supplied annual data within S08; S11 runtime/docs. This does not complete
those scopes, establish production support or change approved product decisions.

## Implementation

- `packages/rest` composes Hono routes over portable services, with a separate
  OAuth resource, explicit company selection and resource-bound company grants.
- Company list/status/profile share services with MCP. Existing accounting
  years/references retain their policy and public MCP formats.
- Invoice, supplier-invoice, voucher and annual-account reads use shared Zod
  schemas and explicit provider operations. Financial MCP tools require a new
  scope. Money is parsed before binary floating-point conversion.
- Cursors store paging metadata only, bind client/resource/company/generation/
  query, expire after ten minutes and are included in scheduled cleanup.
- API/modules default off. Financial provider access is restricted to explicit
  test mode and configured test tenants. Module flags enable no financial write.
- Build generates this project's OpenAPI document from its own read contracts.
  Docker and release preparation include and hash that artifact.

See the [contract](../contracts/rest.md), [integration guide](../rest-api.md),
[Swedish guide](../users/rest-api.sv.md) and
[operation classifications](../reference/read-api-operations.json).

## Verification and limits

Shared synthetic tests cover resource/company isolation, exact numeric JSON
money, missing balances, inactive/custom accounts, non-calendar years, both
invoice families, removed voucher rows, bound continuation/recreation/expiry,
mismatched provider identities and disconnect races. They exercise REST/MCP
data equivalence, output schemas, strict inputs/errors, default-off behavior
and OpenAPI route correspondence.

The OAuth contract uses the actual maintained auth component and product HTTP
routes: PKCE, signed consent, explicit company selection, API token use, MCP/admin
denial, refresh rotation and revocation. Tests run on Node/SQLite and actual local
workerd/D1. They do not establish hosted application/provider acceptance.

Actual M2X integration, hosted OAuth/installation behavior, new provider shapes/
permissions/annual-balance semantics and representative large payloads require
dated acceptance against explicitly authorized test companies. No live provider
calls, production data, deployment, release, merge or publication is implied.

Existing ledgers retain historical live observations bound to their original
commits. Updated source hashes identify this refactor; they do not transfer those
observations to the current code or REST. No operation becomes verified/supported.

## Local verification record

| Check | Result |
| --- | --- |
| `npm run typecheck` | All four TypeScript configurations pass |
| `npm run lint` | Pass |
| `npm run test:node -- --maxWorkers=1` | 209 tests, 21 files pass |
| `npm run test:worker` | 153 tests, 6 files pass in local workerd/D1 |
| `npm run build` | Pass; own OpenAPI artifact generated and hashed |
| `npm run test:build` | 9 artifact checks and 3 native Worker/recovery checks pass |
| Documentation links/source pins | Relative links and all four operation-ledger hash sets checked |

The final insufficient-financial-scope correction (403 rather than 401) was
followed by the eight shared read/OAuth cases in each runtime. These include
revocation during provider I/O and rejection of a MCP token at the API resource.
The migration test independently checks idempotence and unchanged existing
client/consent/access-token scopes in SQLite and D1.

The initial default-parallel Node run hit a CLI startup failure and a workerd
restart timeout. Both existing process tests passed in isolation and the entire
Node suite then passed serially. The first sandboxed Worker attempt could not
bind loopback; the successful runtime checks used local process permissions and
only synthetic services. Dependencies were installed from the local npm cache
using the repository's required Node 24.19.0 runtime. No live credentials were
used.

## Integration with current main — 2026-11-16

The delivery branch integrates `ea718be` before PR validation. Existing program
selection, installation-wide MCP consent, external onboarding, immutable approval
revisions, optional backend offline access, financial analysis and write recovery
remain in place. New API consent uses the current revision/family mechanism with
an explicit resource binding and selected-company versions. A dedicated client
per transport avoids replacing another transport's token family on reapproval.
The optional MCP scope migration is `0008_financial_read_scope.sql`, following
the existing analysis-context migration. Current source hashes are refreshed in
all affected ledgers without promoting historical provider evidence.

The local verification table above records the pre-integration implementation.
Integrated Node/Worker/build checks and GitHub CI are recorded separately in the
PR; no earlier count is represented as a test of the integrated candidate.
