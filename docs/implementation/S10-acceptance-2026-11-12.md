# S10 documentation and diagnosis acceptance — 2026-11-12

Scope: issue #27's existing documentation/developer-assistance deliverables and
synthetic acceptance, with the separate product diagnosis delivered in #73.
This is not provider operation, hosted documentation-client, source-redistribution
or stable-release acceptance. The earlier dated reports retain their original
limits; this record supersedes their pending S10 status only.

## Criteria and evidence

| Existing criterion | Concrete evidence |
| --- | --- |
| Find a voucher operation with source attribution | `tests/shared/docs.ts` searches Swedish/English voucher operations through the bounded catalog/MCP and checks source hash, import date and unknown acquisition/review metadata. `tests/node/docs.test.ts` starts the actual Node documentation entry with a privately loaded, independently authored synthetic specification and retrieves a voucher description over loopback HTTP. |
| Explain missing scope/license without inventing the cause | Original scope guides distinguish scope, user rights and license. `tests/shared/diagnostics.ts` returns `missing_scope` before provider I/O, retains `permission_or_license_unknown` for an unclassified provider denial and excludes private response text. The actual two-company diagnosis evidence remains scoped to [the separately completed diagnosis delivery](M05-issue-review-2026-11-09.md#closure-decisions) and [the subsequent acceptance audit](acceptance-audit-2026-11-11.md). |
| Identify an unsafe invoice-row update | `tests/shared/operation-docs.ts` checks the reviewed destructive row-replacement warning, RowId handling, scope/effect provenance and separation of project policy from upstream source facts. |
| No arbitrary URL, credential export, provider execution or policy mutation | Shared documentation MCP tests reject extra execution/source-replacement inputs, expose only the three bounded read-only documentation tools, treat hostile descriptions as data and assert no network calls. Provider diagnosis authorizes before I/O, uses fixed operations and redacts credentials/private payloads. |
| A newer source cannot enable tools silently | Source-hash/operation-identity mismatch loses old reviewed supplements; executable documentation coverage remains unavailable. These cases run in both shared Node and actual local workerd contracts. |
| Allowlisted source strategy and maintenance handoff | Bundled guides are original project summaries with fixed official links and actual review dates. A private operator-selected specification is loaded only at startup; it and its derived catalog are not distributed. [Developer instructions](../developer-tools.md) document provenance, bounded import, semantic update review, supplement binding and separate executable coverage. |

## Verification

The Windows follow-up initially passed 14 of 16 documentation cases. Both actual
CLI cases failed before startup because the test harness passed a drive-letter
path to Node's ESM `--import` loader. A minimal isolated invocation reproduced
`ERR_UNSUPPORTED_ESM_URL_SCHEME`; this was not a demonstrated product CLI failure.
The test harness now converts its loader path with `pathToFileURL(...).href`.
The actual product entry, assertions, fixtures and production code are unchanged.

On Windows / Node 24.22.1, the same three documentation test files then passed
**16/16**, including actual CLI startup, loopback MCP, guide-only startup and
fixed-error invalid-file rejection. The three existing product-diagnosis cases
passed separately; 209 unrelated product cases were skipped. Test TypeScript,
scoped formatting and whitespace checks passed. No Fortnox request was made by
these synthetic/local tests.

The unchanged shared implementation also passed the preceding exact-head Linux
[S01 run, attempt 2](https://github.com/engshort/fortnox-mcp/actions/runs/43301849107/attempts/2):
5 documentation and 8 operation-description cases in actual local workerd,
the matching Node cases and 3 Node CLI cases. Its full totals were 393 Node and
326 workerd cases. Attempt 1's unrelated SQLite restart timeout is preserved in
the receipt recovery record; it is not relabeled as a pass. The closeout patch
requires its own exact-head independent review and green CI before issue closure.

## Retained boundaries

Issue #35 remains open for acquisition/provenance and redistribution rights of
the supplied external specification or derivatives. S10 already permits original
summaries plus links; completing that strategy does not resolve #35 or authorize
bundling provider text. This is not a change to the approved scope or decisions.

Issue #36 and the individual operation ledgers retain actual provider/scope/license
verification. An ambiguous 403 is not a proved missing license. Documentation
search is a separate local opt-in service, not part of the connected hosted
product's tool catalog. Windows CLI evidence does not establish hosted Worker
budgets, native ChatGPT documentation acceptance or Windows workerd parity.
Receipt uncertainty in #134, file output and per-item client gates remain open.
