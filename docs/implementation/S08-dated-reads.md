# S08 — dated financial reads

Implementation follow-up to M07, 2026-11-13. Addresses T01/T02, T04, T15/T16
and T20. The owner requested ordinary activation, a PR and squash merge after
green CI on 2026-11-13. This follows the existing
[ordinary activation decision](product-activation-2026-11-11.md). Merge starts
the repository's deployment workflow; no release/package publication or
production Fortnox test is included.

## Interfaces and source rules

- `get_account_balances` resolves the actual fiscal year containing `as_of` and
  uses the shared opening-plus-effective-movements calculation. Inactive, zero
  and unmapped accounts, source disagreements and unknown balances are preserved.
- `list_financial_transactions` resolves intersecting actual fiscal years,
  including non-calendar years. Each page contains at most 50 effective rows
  from one year with available text, currency, dimensions and voucher reference.
  An empty intermediate year can still have a continuation. Opening balances
  never become transactions. Missing intervals and incomplete indexes are explicit.
- Transaction cursors bind company, connection generation, selection, fiscal-year
  index and source versions. Every traversed year is rechecked; changes require
  restart. Totals cover the returned page. `data_complete` requires coverage of
  all requested years, separately from page exhaustion.
- Receivable/payable `as_of` reads include currently paid and older invoices.
  Current provider balances remain separate from historical rest amounts. Dated
  settlements include verified write-offs. Unknown dates, cancellation history,
  currencies, credit signs, mutable terms, missing payment pages or a current
  balance mismatch prevent a complete historical result. Undated calls retain
  the current-state behavior and output shape.
  Whole-result completeness additionally requires control-account reconciliation
  using an explicit trusted account/currency mapping. Missing mappings leave
  reconciliation unavailable; numeric differences remain visible and are never
  repaired with invented rows or accounts.
- Historical invoice calls advance at most ten candidates. They recheck previous
  histories on the current source page and completed source pages. Work has a
  45-second invoice-read budget; optional ledger reconciliation retains the
  separate bounded financial-read budget. Exhaustion fails without mixing
  versions. Scans stop at 100
  source pages with an explicit size limitation. No durable ledger or invoice
  snapshot cache is introduced.
- Historical liquidity uses ledger and invoice inputs for the same `as_of`.
  Today's calls retain current-state observations. Future observation dates are
  rejected. The due-date assumption and 90-day horizon remain unchanged.

Historical results mean current records by effective date, including later
backdated corrections. They do not reconstruct what was known at an earlier
wall-clock time. Retrieval remains non-atomic; currencies are never combined.

## Parser, verification and activation

SIE `#PSALDO` records are validated, preserved and compared with effective
movements for the current-year month/dimensions. They are never counted as
transactions or substituted for a daily balance. The independent parser follows
SIE 4B section 11. Unknown records, unchecked checksums and inconsistent period
values remain limitations.

Trusted installation profiles separately classify export coverage, effective/
correction rows and omitted-zero rules. Invoice profiles separately classify
amount currencies, credit signs, effective dates, payment coverage and historical
terms. Profiles enter source versions; MCP arguments cannot attest verification.
The [Fortnox API reference](https://api.fortnox.se/apidocs) documents the fixed
invoice/supplier-invoice payment resources used here. Current unpaid/date filters
are not historical evidence.

The ordinary product includes the classified fixed read catalog without a test
lease or a provider/client evidence admission gate. Optional trusted financial
evidence profiles establish calculation semantics separately; the default
profile supplies no unearned financial assertions. Ordinary transport checks
ownership, connected tenant, selected program/feature, scope and generation.
Existing write capabilities keep their policy/validation/intent boundaries;
dated reads create no write path. Isolated acceptance entries retain their
tenant allowlists. New owner program choices request the corresponding
`bookkeeping`, `invoice` or `supplierinvoice` scope; existing consent is not
silently expanded. Reskontra uses the existing invoice feature choices; dated
ledger reads add a dedicated financial-analysis feature.

## Evidence and remaining acceptance

Shared synthetic contracts run separately in Node/SQLite and local workerd/D1.
They cover dates, non-calendar/multiple years, paid/part-paid/credit invoices,
write-offs, missing history, changed sources, company isolation, MCP schemas
and ordinary transport/policy isolation. Final commands/results belong in the delivery
report; synthetic tests are not provider acceptance.

Read-only observations through the existing acceptance connection on 2026-11-13
found both approved sandboxes active and read-only, each with one fiscal year
and empty returned receivable/payable lists. The older deployed server reports
unverified balance/credit/currency semantics. These observations do not test this
patch. No policy was changed and no provider fixture was created.

Remaining: nonempty independent historical provider fixtures, full export/zero/
correction evidence, control-account reconciliation with verified account and
currency mappings, and actual ChatGPT acceptance of this build. Ordinary
availability is enabled as requested; no G07 gate is closed and no missing
provider/client evidence is promoted.

## Local verification before integration with latest main, 2026-11-13

- `npm run typecheck` and `npm run lint`: passed.
- `npm run test:node`: 370 cases passed in 26 files in an isolated suite run.
- `npm run test:worker`: 307 cases passed in six files in actual local workerd/D1.
- `npm run build`: passed, including the protected owner UI and both runtimes.
- `npm run test:build`: all 13 built-artifact/native Worker cases passed.
- Relative links in changed Markdown documents and all 89 source-hash bindings
  were checked; `git diff --check` passed.

One existing receipt/workerd restart case exceeded its 20-second timeout when
both complete runtime suites ran concurrently. The entire Node suite passed
when rerun separately. Test timeout settings were not changed.

These local results do not establish actual ChatGPT acceptance or validate
undocumented Fortnox financial semantics. Regression checks are rerun after
integration with the latest main; their final results are recorded in the PR.
