# S08 — bounded analysis contexts and SIE performance (#143)

This change implements optional pinned analysis contexts and larger read-only SIE
inputs. It addresses T01/T02, T04, T15/T16, T17 and T20. It does not close S08,
G07, G09 or issue #143's actual provider/hosted-client acceptance requirements.

## Interfaces and activation

`FINANCIAL_ANALYSIS_CONTEXTS_ENABLED=true` enables
`prepare_financial_analysis({company_id, from, to, analysis_context_id?})`.
Both Node/SQLite and Worker/D1 require migration `0007_analysis_contexts.sql`.
The flag defaults to false. Existing reads without an analysis ID retain their
live provider-read behavior. The optional large parser/transport profile is
separately controlled by `FINANCIAL_LARGE_READS_ENABLED=true`, also false by default.
These flags are server defaults. Owners/administrators can override them through
[protected installation settings](../contracts/installation-settings.md), without
exposing model-callable configuration tools. Both optional features remain off
unless explicitly enabled.

Preparation returns only a context ID, building/ready state, expiry, progress
and next action. Repeat the same selection with the returned ID to advance.
Source acquisition, individual chart pages, source recheck and output-page
publication checkpoint separately. The immutable SIE dataset is staged once;
chart continuations only read/write their small mutable cursor and chart data. Publication writes at most 32 pages of 256
movements per call. A request has a 45-second work budget and a 50-second lease;
a building context expires ten minutes after reservation. There is no unattended
background job or claim of resumable upstream HTTP range downloads. An interrupted
network download starts again; a lost lease cannot publish a ready result.

A ready ID can be supplied to `get_financial_analysis`, `get_account_balances`,
`list_financial_movements`, and `list_financial_transactions`. Each side of
`compare_financial_periods` accepts its own ID. It selects captured fiscal years,
not a new provider query. Explicit preparation without an ID replaces the prior
ready context for the same identity and requested interval; callers use the
returned new ID. An expired, foreign, changed or unfinished context fails clearly
instead of silently substituting a new source. Cursors also bind the context ID.

The response's optional `analysis_context` contains its ID, `pinned_basis` mode,
expiry and the time of the independent provider-access check. `retrieved` remains
the original source-observation window. Numerical completeness retains the
existing coverage/reconciliation rules; it never means current provider state.
The exact source-voucher tool remains a separate live read.

## Correctness and isolation

Each context binds owner, authenticated client/grant, company/tenant, connection
generation, access revision, selected programs/scopes, financial revision,
encryption key version, fiscal-year index and trusted mapping/verification/parser
versions. Authorization is checked before and after reads. Each reused year's
small authenticated financial-year read checks current provider access and year
boundaries. Failure returns no cached financial data and removes the context.
This probe is not evidence that the ledger itself has remained unchanged.

A financial dispatch increments the company financial revision before the
provider call, including dispatches that later have unknown outcomes. Grants,
program changes, reconnection and known local writes therefore invalidate older
contexts. External postings may occur after the original observation; pinned
responses disclose that boundary and require explicit preparation for newer
figures. No cache is passed off as a fresh source observation.

Both SIE reads remain. Byte-identical exports with the same encoding reuse the
first parse. Different bytes are parsed and their effective data compared, so
changes to generation metadata alone do not manufacture a financial change.
`source_changed_during_retrieval` prevents publishing a reusable context. Unknown
semantics, omitted openings, inconsistent sources, currency and mapping limits
remain in reports; preparation does not approve their financial interpretation.

Daily exact aggregates serve reports without retrieving source descriptions or
dimensions. Sample movement IDs retain original source order. A separate encrypted
row-pointer index selects the pages needed for drill-down, including its cursor
anchor and one look-ahead row. Actual MCP responses still contain at most 50 rows.
Only source acquisition/publication loads a whole bounded year into memory;
this is not an unbounded streaming ledger engine.

## Limits and retention

Default parsing retains 2 MiB / 25,000 lines / 10,000 movements. The opt-in
profile allows 16 MiB / 300,000 lines / 100,000 effective movements per export.
Decoding is incremental with bounded line buffers and unchanged 8,192-character
line validation. Reporting and financial summation support the larger count;
manual-voucher summation keeps its separate original bound.

Encrypted context data reserves 64 MiB per context, 128 MiB per owner and
256 MiB per installation, including staged data and indexes. Capacity reservations
and build leases are atomic across application instances. At most five intersecting
fiscal years can be captured. Byte/line/movement limits, storage capacity and lease
exhaustion produce explicit errors, never truncated totals. Not every input at the
parser maximum fits the independent context storage/time budgets.

Ready TTL is five minutes without sliding renewal. Staged source data is deleted
when publication completes. Expiry/failure cleanup removes active SQL parts;
Node startup/timers and Worker scheduled cleanup remove abandoned work. Per-part
AES-GCM binds context/identity, logical part and ordinal. Node operator backups
remove analystables from the snapshot and vacuum it before encryption; restore
and credential rotation also discard them. D1 managed backup/Time Travel retention
is separate from active-row TTL: after a D1 restore, delete `analysis_parts` and
`analysis_contexts` before reopening traffic. No immediate erasure from managed
provider backups is claimed.

## Reproducible verification

Run the synthetic benchmark with:

```sh
node --max-old-space-size=256 --expose-gc --import tsx scripts/analysis-benchmark.ts 30
```

It reports actual sample count, p50/p95, transferred bytes, request/export counts,
process CPU and observed RSS. RSS is a sampled process observation, not isolated
peak memory or a Worker memory measurement. Its provider is synthetic and its
pacing is the actual adapter pacing. The baseline is the current direct-read
path without contexts, including the byte-identical recheck optimization; large
inputs were unavailable in the previous default parser profile. No credentials or real bookkeeping inputs
are used. Optional provider/core observer callbacks receive bounded metadata only;
there are no company names, monetary rows, payloads or bearer tokens in events.

Shared regression contracts cover isolation, revoked provider access, source
changes, expiry/physical cleanup, unknown-write invalidation, concurrent requests,
SQL-backed continuation, strict MCP schemas, exact drill-down and larger exports.
SQLite restart is additionally tested by closing/reopening a private temporary
file. Actual local workerd/D1 execution is distinct from hosted Worker acceptance.
The dated benchmark and final verification observations below retain that scope.

## Local verification — 2026-11-14

Environment: Linux x64, checksum-verified official Node 24.19.0. The host initially
had Node 22; the delivery checks below use Node 24. No dependency was added.
The parser benchmark uses a 256 MiB old-space limit and explicit GC between
samples on a shared development host. CPU includes that GC; per-sample parser
latency excludes it. These are observations, not isolated peak-resource claims.

| Synthetic follow-up workload | Direct-read p50 / p95 | Pinned p50 / p95 | Preparation | SIE exports | All provider calls |
| --- | --- | --- | --- | --- | --- |
| 100 movements, ten questions | 847 / 908 ms | 212 / 217 ms | 1.07 s | 20 → 2 | 40 → 15 |
| 20,000 movements, ten questions | 1,601 / 1,960 ms | 212 / 215 ms | 6.08 s | 20 → 2 | 40 → 15 |

Pinned query timings exclude the separately shown preparation. The prepared
request/export counts include preparation and ten live permission probes. For
the larger repeated workload transferred bytes fell from 58,626,420 to
5,863,490. The independent parser retained every movement for 100, 20,000 and
100,000-row workloads, 30 samples each. The 20,000-row input was 2,931,114 bytes,
above the former byte limit. Raw figures, CPU/RSS observations and source hashes
are in the [synthetic benchmark record](S08-performance-benchmark-2026-11-14.json).

Verification performed:

- Full Node suite: 437 cases passed in 30 files.
- Full actual local workerd/D1 suite: 370 cases passed in eight files.
- After separating immutable SIE data from chart cursors, all 16 focused Node
  context/restart cases and all 15 focused local workerd/D1 context cases passed.
  These include complete 20,000/100,000-movement workflows, a fourteen-page chart,
  original source IDs, multiple non-calendar years, lease takeover, permission
  loss, no sliding TTL, physical SQL cleanup and unknown-write invalidation.
- Backup/key-rotation/restore regressions and source-hash ledgers passed.
- Typecheck, lint, build, all 13 built-artifact/native Worker cases, Markdown
  link targets and Git whitespace checks passed.

Earlier exploratory 100,000-movement context runs hit the storage budget while
full object records were duplicated during publication. Compact encrypted
movement tuples removed that overhead; both actual local runtimes subsequently
completed the full workflow. The quota and error remain enforced.

Not performed: actual Fortnox test-company observations, actual hosted Worker
CPU/memory/paid-plan limits, Docker resource-limit benchmarks, actual ChatGPT
acceptance or independent AI acceptance review. There is no local private
acceptance configuration for this build. SDK in-memory transport and local
workerd are not substitutes for those gates. Both new modules remain off by
default, and no issue/gate or release is promoted by this evidence.
