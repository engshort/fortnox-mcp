# Office contact API implementation and evidence

Scope: S02/S03 company/transport authorization, S04 customer projection, S09
employee contact projection, S11 administration/runtime. Contract:
[office-contacts-v1](../contracts/office-contacts-v1.md). User guide:
[Swedish contact import](../users/office-kontakter.sv.md).

The existing confidential finance registration gains separately approved contact
scope and company/source selections. Historical registrations and company grants
are not widened. The owner management UI persists connection/access revisions;
current checks before dispatch and after I/O fence changes. No new MCP tool or
bridge classification is introduced. Company onboarding and offline refresh keep
their existing contracts. Migration 0012 extends only known API resource ceilings.

The portable domain service stores bounded, expiring paging metadata only. Fixed
Fortnox adapters use existing provider OAuth, pacing, bounded transport and token
renewal. Employee source responses are immediately projected to contact fields.
Developer API use requires a private operator-verified published-integration
binding and revalidates both developer and target connections. Its documented
nonpaginated array is complete or fails rather than being silently truncated.

## Verification

Shared Node/SQLite and actual local workerd/D1 cases cover default-off behavior,
old finance-token isolation, source consent, active employee projection and null
email, exact customer/detail identity, duplicate matches, no fallback fields,
strict query validation, pagination binding/expiry/recreation, consent changes
during I/O, and developer-client/tenant binding. Migration checks verify
idempotence and unchanged client/consent/access-token scopes.

Exact command results and actual provider/Office acceptance are recorded below
when executed. Synthetic checks alone do not establish provider licensing,
Developer API publication/access or joint Office acceptance. Unavailable actual
provider prerequisites remain explicit limitations, not successful empty lists.

Operation classifications are recorded in the independently authored
[contact operation ledger](../reference/office-contact-operations.json). Source
pins in existing ledgers are refreshed for shared-source edits without promoting
their historical acceptance observations.

The existing local `.env` has no readable configured product connection database,
and `.data/acceptance.json` is absent. Consequently no actual Fortnox source or
hosted Office round trip has been verified in this checkout. All reported local
passes use original synthetic provider responses. The Office implementation chat
reports its own completed synthetic consumer tests; that is separate evidence,
not a joint contract-test pass. The shared CLI check is ready for that run.

## Local execution record — 2026-11-20

Node 24.19.0; original synthetic provider responses only. The final focused
`Office contacts` selection contains thirteen tests in each runtime (including
resource migration and the shared consumer check). These tests use the actual
maintained OAuth component and product HTTP routes.

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | All four TypeScript configurations pass |
| `npm run lint` | Pass |
| `npm run test:node -- tests/node/product.test.ts -t 'Office contacts' --maxWorkers=1` | 13 pass; 331 unrelated cases skipped |
| `npm run test:worker -- tests/worker/product.test.ts -t 'Office contacts'` | 13 pass in actual local workerd/D1; 331 unrelated cases skipped |
| `npm run test:node -- --maxWorkers=1` | 564 pass across 39 files; broad run loaded the earlier eight-case contact selection, followed by the final thirteen-case focused pass |
| `npm run test:worker -- --fileParallelism=false` | 487 pass across 9 files on the final implementation in actual local workerd/D1 |
| `npm run build` | Final build passes |
| `npm run test:build` | 11 artifact checks and 3 native Worker/recovery checks pass on the final build |
| Changed-document relative links and `git diff --check` | Pass |

The independent AI reviewer inspected original final focused logs and source,
including the administration correction for disconnected company consent.
Assessment: **AI-executed, independently AI-reviewed**, passed for the bounded
local synthetic contact/OAuth contract only. Source fingerprints are pinned in
the contact operation ledger; delivery source is the PR commit.

Redacted focused-log SHA-256 digests:

- Node: `982006d13566e54ba2034788316cbac5d343fc50427dede4f6852f6031737cc3`
- Worker: `030d3b1c5ac6c0cf3d16c22f5c1a650954bc063925c5cd68daf25d326d8bfafb`

The initial sandboxed Worker attempt could not bind loopback/write Wrangler logs;
actual workerd runs used local process permission and a temporary log path.
Initial broad concurrent regressions had five unrelated five-second timeouts and
one large-analysis capability/budget failure (476 Worker cases passed). These are
not passes. The serial Worker rerun passes all 487 cases; the whole Node suite passes
564 cases, supplemented by the final thirteen-case contact run. An earlier test fixture cloned an unconsumed error body and hung on
cancellation; the fixture now supplies a fresh response. The consumer checker
uses manual redirect rejection, compatible with both Node and workerd.


The implementation and focused evidence are bound to commit
`b0c6432ca47772992fb1e180255f4834624490c7` in
[PR #160](https://github.com/engshort/fortnox-mcp/pull/160). This subsequent evidence
update changes documentation only. CI results are visible on that PR; the earlier
failed resource-concurrent run remains recorded above rather than relabeled.
