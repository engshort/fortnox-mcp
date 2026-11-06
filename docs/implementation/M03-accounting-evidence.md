# Milestone 3 — reviewed manual accounting

Scope: M09–M13 (#63–#67), M22 (#76), reference gate #92 and voucher gate #93.
Base: milestone 2 squash `b531952`. Full G06/#36, G07/#37, G02/#32 and source
rights #35 retain their independent criteria. CI proves automated behavior,
not successful live bookkeeping or a human interaction in ChatGPT.

## Domain, provider and activation

`packages/core/src/accounting.ts` defines strict input and deterministic
validation. Company and fiscal-year ID are mandatory. The bounded creation
profile accepts SEK, exact cents, 2–100 ordinary rows and at most twelve integer
digits per row amount. The existing Decimal.js context has 96-digit precision.
Numeric JSON amounts, exponent notation, unsupported fractions, negative values,
correction/removed rows, attachments and unbalanced vouchers are rejected.
Nothing is rounded, balanced or inferred on the caller's behalf. This narrow
profile is not a claim about all values Fortnox supports.

Validation requires complete, verified company/year-bound references no older
than one minute: year dates, lock boundary, active accounts, manual series and
required/allowed/forbidden dimensions/information. Current references are fetched
again before claiming submission. Provider final validation remains authoritative;
it can race a precheck. Unknown rules fail closed.
Reference reads are not a provider transaction or atomic snapshot. Their
freshness timestamp starts with the earliest read, so a slow collection cannot
present old reference data as newly retrieved.

`packages/fortnox/src/accounting.ts` independently implements fixed HTTPS paths,
explicit `financialyear`, modeled response envelopes and the common durable
client/tenant rate budget. Each reference list has a five-page/500-item/256-KiB/
15-second budget, using bounded 64-KiB responses. Incomplete results explicitly
return `complete=false` and cannot authorize validation. No supplied provider URL
is followed. Foreign years, schema drift and unknown flags are rejected.

The [operation matrix](../reference/mvp-accounting-operations.json) records exact
methods/paths, scopes, effects, contracts, source hashes and missing evidence.
No blocked OpenAPI snapshot or generated provider code is distributed. The
official [voucher guide](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers),
[parameter guide](https://www.fortnox.se/developer/guides-and-good-to-know/parameters)
and [scope table](https://www.fortnox.se/developer/guides-and-good-to-know/scopes)
were read on 2026-11-06. They establish resource/permission context, not actual
installation licenses, lock boundaries, precision or live response envelopes.
The current official [API reference](https://apps.fortnox.se/apidocs) was also
read for the relevant response fields, including project identity/status and
the optional lock date. No specification download or generated schema was used.
Monetary JSON number lexemes in voucher readback are preserved as decimal text
before parsing; they never round through IEEE-754. Unknown precision, signed or
correction-row semantics remain blocked.

Default: `ACCOUNTING_REFERENCES_ENABLED=false`. Only an explicit allowlisted
two-tenant test installation may exercise the reference contracts. Production
composition hard-disables writes and trusted-host approval; provider financial
semantics are marked unverified. No ENV switch can declare G02/G06/G07 approved.
Changing policy or obtaining `mcp:write` cannot enable an unverified operation.
Additional Fortnox scopes require fresh consent; existing connections/tokens
and MCP grants are never silently broadened.

## Reference discovery follow-up

The live test exposed a missing first step: a client could request references
only if it already knew an internal fiscal-year ID. `list_financial_years`
now reads actual IDs/date ranges under the same durable company grant before
year-specific reads. It needs no selected year and never substitutes a calendar
year for a provider ID. The provider's financial-years list is company-scoped;
its request omits the unrelated `financialyear` filter. Other reference and
voucher reads retain mandatory explicit fiscal-year context.

The [official human-readable API reference](https://api.fortnox.se/apidocs),
checked on 2026-11-06, documents prefixed pagination fields and the
`VoucherSeriesCollection` list envelope. The independently written adapter and
synthetic fixtures now match those field names. Empty-page completion requires
explicit zero total resources/pages; missing metadata or incompatible shapes
continue to fail closed. Duplicate year IDs, invalid date ranges and unknown
financial semantics are rejected. Shared Node/workerd tests cover discovery,
two-company token/ID isolation, strict MCP inputs, default-off registration,
bounded pages and authorization before/after I/O. Actual provider responses
and financial acceptance remain separate; this change does not enable writes.

Follow-up local checks on 2026-11-06: 89 Node/domain tests and 73 actual local
workerd/D1 tests passed, including four shared year-discovery cases. Root
typecheck/lint/build, the six no-eval artifact checks, native Worker transport,
private operator CLI and product Wrangler dry-run passed. Initial restricted
execution could not bind local test ports; the complete suite passed after
running with local-port permission. Browser behavior was not changed or rerun.
Hosted follow-up deployment and actual reference results are recorded separately
against their exact source in #63/#92.

## Provider reference contract follow-up

The owner's actual reference reads failed with an undifferentiated
`VALIDATION_FAILED` after successful year discovery. A provider Zod error was
being reported as caller input validation. Reference decoding now reports
`UPSTREAM_UNAVAILABLE` with fixed operation-specific reasons and at most eight
deduplicated, allowlisted schema paths. Numeric row indices become wildcards;
no provider value or raw exception is exposed. Internal output schema failure
is separately `invalid_tool_result`.

The official API reference's account-list sample documents a numeric
`TransactionInformationSettings`, while its single-account shape uses a named
rule. The previous parser accepted only the named form. This documented mismatch
is reproducible synthetically; it is a candidate explanation for the live
failure, not a claim that its exact field was observed live. A safe integer in
this field is now represented as `UNKNOWN` in reference reads. No numeric-to-rule
mapping is assumed. The domain independently rejects unknown rules before
preparation/submission, including if a reference set is incorrectly marked
verified. Complete retrieval does not mean verified financial semantics.

Shared Node/workerd tests exercise numeric settings through the actual HTTP
adapter and MCP serialization, unknown-rule rejection, redaction of malformed
provider fields/lock dates, strict caller inputs and malformed internal results.
Actual reference rechecks, G02 and financial/provider gates remain required.

Local follow-up results on 2026-11-06: 91 Node/domain tests and 75 actual local
workerd/D1 tests passed. Root typecheck/lint/build, six no-eval artifact tests,
native Worker/CLI checks and Wrangler dry-run passed. An initial new assertion
exposed repeated schema paths; diagnostics now deduplicate those paths before
publication. The complete checks passed after that correction. No live reference
success or verified numeric-rule semantics is claimed by these tests.

## Optional account settings and provider vocabulary

The next actual reference attempt narrowed the failure to transaction-information
settings for both test companies. The operator supplied an additional private
source snapshot (identity in the [source register](../reference/sources.md)).
Its account-list information setting is optional, and the named account rules
use `MANDATORY`. The adapter previously required the information setting and
accepted the internal `REQUIRED` spelling as though it were provider vocabulary.

The independently written parser now normalizes documented `MANDATORY` to
internal `REQUIRED` across the three account rules. Omitted/null information
settings remain explicitly `UNKNOWN`, as do unmapped numeric values. Named
mandatory information/dimensions are enforced; unknown values cannot validate a
voucher. No missing field is silently treated as allowed. Shared HTTP/MCP tests
cover omitted/null values, named mandatory requirements, explicit valid inputs
and unknown-rule blocking. The exact failing wire value remains unobserved until
actual client recheck; the field-specific error alone does not prove its value.

The raw attachment is ignored local documentation input only. It is not bundled,
redistributed or used to generate implementation or fixtures. #35 retains its
separate status; no provider/financial gate closes from a local source check.

Local results for this correction: 91 Node/domain tests and 75 actual
workerd/D1 tests passed, including omitted/null settings, mandatory information
and dimensions, required-value rejection and explicit valid input. Root
typecheck/lint/build, built-artifact checks and Wrangler dry-run passed. The
private documentation catalog loaded the supplied input as 451 operations and
680 schemas; no input was bundled into product artifacts.

## Hosted two-company read recheck — 2026-11-06

[PR #100](https://github.com/engshort/fortnox-mcp/pull/100) was squash-merged as
`e9f5a6226d8e0a8c0ef2d2019377d07e57d2194d` after all three PR workflows passed
on head `1266a30eb1fe12ced432288eb03dfcc289f3d155`:
[S01](https://github.com/engshort/fortnox-mcp/actions/runs/42217753272),
[S00](https://github.com/engshort/fortnox-mcp/actions/runs/42217753160) and
[S00 OAuth](https://github.com/engshort/fortnox-mcp/actions/runs/42217753129).
The same source was deployed in the existing allowlisted product test
installation. Product bundle SHA-256:
`fff2dcd97c38b2c7c88b27500a5ca6224af0f57de25808f4897075c6bce5e765`.
D1, five secret bindings and the maintenance schedule were preserved.
Post-deployment health/metadata passed; unauthenticated administration,
reference reads and mixed public/private MCP batches returned 401. Financial
write tools remain absent.

At **12:32:42 UTC**, a private operator probe ran the same company MCP server,
domain services, provider adapter and native outbound fetch in actual hosted
workerd against the installation's D1. It used a short-lived, one-use operator
capability and the existing owner's current company grants/generations. It did
**not** exercise the product OAuth transport or an actual ChatGPT conversation.
Its independently tested temporary endpoint was removed after the run, together
with its one-use nonce. No financial write was permitted or attempted. Token
renewal used the shared durable connection coordination and persisted replacement
tokens; it did not copy tokens into a separate test database.

| Observation | Service test company | User test company |
| --- | --- | --- |
| Profile and full year discovery | Passed | Passed |
| Reference result | `ok`, `complete=false` | `ok`, `complete=false` |
| Accounts returned before the bounded limit | 500 | 500 |
| Information setting | Omitted on all returned accounts; `UNKNOWN` | Omitted on all returned accounts; `UNKNOWN` |
| Manual series / cost centres / projects returned | 1 / 0 / 0 | 1 / 0 / 0 |
| Financial semantics | `validation_verified=false` | `validation_verified=false` |
| Forced token renewal followed by profile read | Passed | Passed |

The account-list field is now **observed omitted**, rather than merely suspected
from documentation. Account retrieval reached the configured five-page/500-item
budget; it makes no claim about the full account count. This bounded partial
result cannot validate a voucher. Named settings from individual account detail
responses and numeric-rule meanings were not verified by this list probe.

Bearer-token fingerprints were disjoint across the two company paths; only the
boolean result was retained in redacted evidence. A foreign company reference
request returned `COMPANY_FORBIDDEN` with **zero** provider calls. Removing the
internal actor's `mcp:read` scope was also denied. That internal check does not
prove an actual provider 403, absent license or restricted provider user.
Exactly two token endpoint calls occurred during the forced-renewal recheck;
this does not establish natural-expiry, revocation or lost-response recovery.

#92 remains open for complete/applicable reference data, individual account
rules, negative provider permissions/licenses, broken-year and lock-boundary
cases, and an actual ChatGPT reference recheck on this revision. #76/#93 and G02
remain open for their independent financial and trusted-review acceptance.
This evidence does not enable bookkeeping or claim that milestone 3 is complete.

## Selected account detail follow-up

The hosted list recheck established two independent limitations: a large account
chart reaches the bounded collection limit, and list items omit transaction
information settings. Raising the list limit cannot establish the missing rule.
The private source snapshot separately describes `GET /3/accounts/{Number}`
(`AccountController_doShow`, `Account` envelope) with named settings. This is a
new independently written registered read operation, still default-disabled
outside explicit reference-test activation; it is not generated from the input.

Optional `account_numbers` selects 1–20 distinct accounts for detail reads under
an explicit company/year. Output reports the exact sorted selection. Complete
selected data is distinguished from a complete chart of accounts. Other required
collections must also be complete. The selected detail collection has a shared
15-second/256-KiB budget and existing 64-KiB response and durable client/tenant
pacing limits. Exhausting time or aggregate bytes returns `complete=false`.
A wrong returned account/year, changed grant/generation or disconnected company
cannot disclose a successful result. Missing settings remain unknown.

The shared domain service derives the selection from the voucher rows during
validation and preparation, and from the immutable stored voucher immediately
before execution. A caller cannot choose a narrower validation scope or supply
rules. At most 20 distinct accounts may be used in this bounded profile; up to
100 rows can reuse them. `validation_verified=false`, product `writes=false` and
`reviewHost=false` are preserved. Account detail discovery alone cannot approve
financial precision, locks, provider permissions or a human action.

Shared Node/workerd tests cover full selected results beside a partial catalog,
strict MCP input/output, both company token paths, unknown/mandatory settings,
wrong identity/year, authorization before I/O, disconnect during I/O, time/size
budgets and selection reuse by validation/preparation/commit. Local verification passed: 95 Node/domain tests, 79 actual local workerd/D1
tests, typecheck/lint/build, six no-eval artifact checks, native Worker/CLI
checks and Wrangler dry-run. An initial whole-suite run caught an output-schema
transform that prevented MCP tool listing; sorting now happens in the domain
service and the shared selection test explicitly lists tools before calling
them. Live selected response evidence remains separate.

The existing connector also successfully repeated the two bounded catalog reads
on revision `e9f5a62` on 2026-11-06: both returned 500 accounts, `complete=false`
and 500 unknown information settings. This exercises authenticated connected
remote tool calls; it does not establish a human review or selected-detail
behavior on this later implementation.

### Actual selected-detail recheck — 2026-11-06

At **13:02:56 UTC**, the short-lived operator probe exercised source
`1e8c38b9c8dbb9e642d26566397c323f32c15cb9` in hosted workerd against the
installation's D1. It selected two active account numbers actually returned by
each company's catalog, solely for read-contract verification. It made no
accounting/tax choice, created no proposal and performed no financial write.

| Selected-reference observation | Service test company | User test company |
| --- | --- | --- |
| Account details returned / selected | 2 / 2 | 2 / 2 |
| Complete selected reference bundle | `true` | `true` |
| Unknown information rules in selected details | 0 | 0 |
| Financial semantics verified | `false` | `false` |
| Profile / year discovery | Passed / complete | Passed / complete |

The read used named rules from detail responses, without mapping the catalog's
missing/numeric information setting. Other required reference collections also
completed. This establishes bounded positive detail behavior for those four
reads, not all accounts or all financial semantics. Bearer fingerprints remained
disjoint. A foreign-company request was denied with zero provider calls; the
internal missing-scope check also failed closed. The one-use operator endpoint
and nonce were removed, and the local capability file deleted.

Probe bundle SHA-256:
`e5e008934b14f4ccbedc88b9f0b74aa987e293c614eb898dcc036122ba7e186e`.
This probe uses current durable owner/company grants and an internal MCP client;
it is not a product OAuth-transport or actual ChatGPT UI/review acceptance.
#92 retains negative provider scope/license/user and applicable lock/year cases;
#76/#93 retain financial and trusted-review acceptance. Production support and
financial activation are unchanged.

## Durable proposals and execution

`packages/core/src/bookkeeping.ts` is the single domain service for pure
validation, persisted proposals, reviewed/client-managed execution, status and
reconciliation. Provider adapters are trusted internal ports, never public
arbitrary HTTP tools. Each proposal represents one independently balanced
voucher. Several vouchers require separate proposals, reviews and results.
There is no pooled balance or ambiguous batch selection in this slice.

Proposals and minimal intents are additive fields in the existing bounded
connection snapshot. One SQLite/D1 compare-and-set atomically checks company,
connection generation, policy version, client, original hash, expiry and prior
consumption while recording submission. No destructive SQL migration is needed.
Additive migration `0005_accounting_scope.sql` makes optional `mcp:write` available
for the known previous product resource policy. It never changes client,
consent, access-token or refresh-token scopes. Custom resource policy stays
unchanged and fresh explicit owner consent is still required.
Before network dispatch, a second durable transition rechecks authorization,
policy/generation and marks dispatch. Already sent upstream requests cannot
be recalled. Disconnect cannot restore credentials or old approvals.

Each write performs at most one POST. No automatic write retry is made for
401/403/429/5xx, redirects or lost responses. A stranded `submitting` intent,
crash or storage uncertainty is `outcome_unknown`; it is never reclaimed for
submission after restart. Provider rejection is not success.
An unresolved/submitting canonical hash also blocks a new proposal or another
pending intent for that same content, so changing only the proposal ID cannot
bypass investigation. This is not a general ban on legitimate identical entries
after an earlier outcome is known, nor perfect receipt duplicate detection.

A successful creation response provides a typed year/series/number reference.
The domain reads that exact reference back and compares the full canonical
voucher hash before reporting success. Failed/mismatched readback remains
unknown, retaining the provider-issued reference where storage permits.
If no reference survived, installation-owner administration may register an
independently inspected exact Fortnox reference. The model cannot attest this
evidence. Reconciliation resolves success only on full matching content;
date/amount alone, absence or a failed lookup never authorizes resubmission.
Owner attestation is an explicit trust boundary, not cryptographic proof that
the original request created that record. No upstream idempotency guarantee is
assumed and no exactly-once claim is made.

## Policy and review boundary

Companies start `review_required` and read-only. Only owner-session administration
can select `client_managed` or change read-only, with Origin/CSRF and expected
policy version checks. Updates increment policy version and invalidate proposals.
Reconnect restores the safe defaults. MCP tokens cannot administer policy or
attest provider references. Read-only allows pure `validate_manual_voucher`,
but denies persisted preparation and booking. Preparation is annotated as a
mutation and requires an explicit `mcp:write` grant.

The MCP Apps resource renders company identity, year/date/series, description,
all rows/dimensions, totals/difference, currency, explicit absence of attachments
and review expiry. UI execution accepts only the original reference/hash and
one-time capability; no replacement rows, selection or `confirmed` argument.
Capabilities use 256 cryptographically random bits and only their SHA-256
digests are stored.
The capability exists only in result `_meta`, never model-visible text,
structured content, resource HTML, status or logs. Commit is app-only.

A conforming host must keep `_meta` outside model context and restrict app-only
tools. Visibility alone does not establish physical human presence against a
malicious host. Unsupported hosts cannot execute in review mode. The UI checks
durable status before enabling commit and suppresses duplicate activation.
Timeout, missing metadata, expiry, unknown result or unavailable status disables
submission. The view retries only status reads, never commits.

## Encryption, bounds and retention

Per company: eight pending encrypted proposals and 32 intents, subject to the
existing 128-KiB snapshot and 20-company bounds. Exhaustion fails explicitly;
unknown outcomes are never discarded to make space. External-key AES-GCM binds
proposal bodies to owner/company/proposal/hash/generation/policy. Key rotation
includes all proposals; wrong/missing retained keys deny private snapshots.

Proposal bodies expire after 24 hours and UI capabilities after 15 minutes.
Definite outcomes erase the body early. Five-minute cleanup deletes expired
bodies and terminal intent metadata older than 30 days, preserving unresolved/
submitting metadata indefinitely. Minimal unresolved records survive disconnect
and cannot authorize new work. Once terminal metadata expires, duplicate
detection is limited; a new proposal never proves an old write did not occur.
File identity/upload/linking and full backup lifecycle remain later scopes.

## Rule-to-test matrix

Shared contracts run unchanged in Node/SQLite and actual local workerd/D1.

| Rules / failure | Observable checks |
| --- | --- |
| V01/V10 ownership and isolation | owner/client/company/hash bindings, foreign reference/year denial, no provider I/O for unknown company |
| V02/V03 exact money | 0.10+0.20, one-cent imbalance, numeric/exponent/precision/sign/overflow rejection |
| V04/V05 structure/year | strict unknown-field rejection, invalid calendar date, non-calendar-year boundaries |
| V06/V07 accounts/series | inactive/missing account and unavailable manual series |
| V08 period locks | synthetic exact boundary and changed lock before submit; **actual boundary pending** |
| V09 dimensions | required/forbidden/unknown rules and foreign/inactive references |
| V11 immutable policy/review | version invalidation, capability, expiry, changed proposal/selection, unsupported host, concurrent execution and replay |
| V13 provider state | fresh references, definite rejection, exact provider-reference readback |
| Recovery/restart | lost response, post-dispatch storage failure, actual SQLite reopen and workerd/D1 restart, no second POST |
| Reconciliation | independent owner reference, full-content mismatch stays unknown, no model-attested recovery |
| Storage/privacy | encrypted body, key rotation/wrong-key denial, expiry cleanup preserves unknown metadata |
| MCP boundary | capability only in UI metadata, strict schemas, annotations, default-off catalog, app-only commit |

V12 invoice updates, V14 files, signed/correction/removed-row creation, broad
analysis/SIE and tax/accounting-law correctness remain unsupported.

## Verification and remaining gates

Local Chromium/Playwright: **eight scenarios passed** across 1200×1100 desktop and
393×1000 mobile emulation, no page/console errors. The actual view, strict
script/style-hash CSP, a sandboxed iframe without same-origin privileges and a
SQLite-backed synthetic domain service were exercised. Keyboard commit made one
write; consumed remount stayed disabled; lost response and status check made no
second write; completed remount kept its confirmed result after local review expiry; standalone view stayed unsupported. Screenshots are private `/tmp`
artifacts. Browser plugin was unavailable; the existing pinned Playwright 1.64.1
and Chromium were used. This is not real-device or actual ChatGPT evidence.

Original milestone implementation checkpoint (before the discovery follow-up):
automated results are recorded in the PR/issues against the pushed source.
Observed locally on 2026-11-06, Node 24.19.0/npm 11.9.0:

| Check | Result |
| --- | --- |
| Root typecheck and lint | Passed |
| Root Node/domain suite | 85 passed |
| Actual local workerd/D1 suite | 69 passed |
| Build and six original built-artifact checks | Passed; original no-eval boundary retained |
| Native workerd integration and private operator CLI checks | Both passed |
| Product Wrangler 4.151.1 dry-run | Passed, about 3,528 KiB / 630 KiB gzip; no deploy |
| Browser identity/content/controls/console/screenshots | Passed across both emulated viewports; eight scenarios |
| Private-value scan and relative documentation links | Passed, 107 changed-document links checked at this checkpoint |
| Incomplete financial evidence record | Correctly rejected with exit 1, no private values printed |

Local workerd uses supported foundation date `2026-10-18`; no newer hosted date
or resource-budget claim follows. No new hosted deployment or actual Fortnox
accounting read/write is claimed here. #76/#92/#93 require dated authorized
test-company results before closure. Green CI or merge cannot approve a missing
gate. Follow the [Swedish live checklist](../users/manuell-bokforing.sv.md);
preserve missing evidence explicitly rather than closing unverified work.
