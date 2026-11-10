# Milestone 7 — financial analysis and payroll input

Status: implementation in progress; no new capability accepted or enabled in the
ordinary product. Tracks [S08/#25](https://github.com/engshort/fortnox-mcp/issues/25),
[S09/#26](https://github.com/engshort/fortnox-mcp/issues/26),
[G07/#37](https://github.com/engshort/fortnox-mcp/issues/37) and
[G10/#40](https://github.com/engshort/fortnox-mcp/issues/40).
Original issue acceptance remains authoritative. The separate milestone 6 work
in [#118](https://github.com/engshort/fortnox-mcp/pull/118) was merged as
`7524e8f`; its remaining actual acceptance is not closed by that merge.

## Delivery sequence in one PR

1. Portable exact financial calculations, explicit account classification,
   provenance and completeness; bounded SIE4 parsing and reconciliation fixtures.
2. Authenticated, company/year-bound provider reads with bounded pagination,
   continuations, drill-down and independent SIE/account reconciliation. Reuse
   register/document read contracts; completion of their writes is unnecessary.
3. Deterministic receivables/payables, booked liquidity basis and explicitly
   comparable periods/companies. Preserve currency, definitions, mapping and
   source consistency limits.
4. A bounded salary-transaction input workflow using shared durable write
   intents, company authorization, current employee/code references and exact
   decimals. Classify read/create/update/delete individually; expose no full
   payroll calculation, payslip-generation or payout operation.
5. Node/SQLite and actual local workerd/D1 behavior and failure tests, packaged
   artifacts and applicable CI. Actual allowlisted Fortnox and ChatGPT acceptance
   are separate evidence and cannot be inferred from synthetic tests.
6. Update the four issues and related roadmap/verification/release tracking.
   Close each only after its full acceptance is delivered. Follow latest-head CI,
   resolve findings and squash merge under branch rules; publish an installer
   prerelease from verified main with source, Linux amd64 Docker, notices/SBOM,
   checksums and Swedish/English notes. Select the available version at delivery;
   milestone 6 already reserves v0.2.0-alpha.1. Permanent installation is excluded.

## Implemented local foundation

`packages/core/src/analytics.ts` computes signed debit-minus-credit movements and
as-of balances from explicit openings and effective posted rows. It preserves
zero/inactive/custom accounts, explicit unmapped classification, source hashes,
retrieval window and year boundaries. It reconciles the whole supplied chart
before applying an account display selection. Missing pages/openings, unknown
row semantics, mismatches and observed source changes prevent complete status.
A non-atomic retrieval remains disclosed even when its bounded data reconciles.
No year-end balance is substituted for an earlier date. No live bank balance,
foreign-exchange conversion or statutory consolidation is claimed.

`packages/core/src/sie.ts` independently parses a bounded SIE4 export (2 MiB,
25,000 lines, 10,000 effective rows). It preserves comparison-year balances,
dimensions, exact cents and source line references. Effective rows are #TRANS;
#RTRANS must match its immediately following #TRANS and is not added twice;
#BTRANS is not an effective posting. Missing zero balances stay missing until
export semantics are actually verified. Unsupported records, unbalanced vouchers
and unchecked checksums are explicit limitations. Parsing alone never establishes
export completeness or provider identity. Encoding is explicit CP437 or UTF-8;
UTF-8 transport is marked as a deviation from the PC8 declaration.

The authenticated analysis service is off by default and reauthorizes after
retrieval, including connection generation and program selection. No ordinary
product MCP analysis tool or financial provider write is activated by these files.
Analytical source data remains request-local; no persistent ledger is introduced.

## Payroll consent preparation

The separate one-hour test entry may explicitly offer the `payroll-input`
connection feature to collect `salary` consent. The ordinary product never reads
this test setting. Consent does not activate salary operations. Extending a
connection preserves other scopes, verifies the tenant, increments its generation
and invalidates old client grants. An owner-requested additive payroll consent
may proceed with a retained tenant-bound register/document outcome. In-flight,
legacy unbound, accounting, receipt and payroll uncertainty still blocks it.
The outcome is not cleared and BusinessWrites still refuses new writes. An
owner-only POST can reconcile known evidence using a reserved read-only identity
that expires within one minute and is revoked after the call. It never issues a
bearer token, rewrites the originating client, attests an ID or sends a write.
The dialog refreshes current program choices/revision when opened and explains
unknown-outcome errors instead of hiding them behind a generic message.

The owner confirmed Fortnox Lön is available and requested fresh consent on
2026-11-10. Synthetic employee and salary-code evidence still need private
verification. API documentation requires the code table appropriate to the
employee; there is no inferred universal salary-code list. Sensitive payroll rows,
credentials, recipient addresses and provider IDs stay outside public evidence.

## Verification of the first slice

On 2026-11-10, 125 Node/SQLite product cases passed. The 14 new analysis,
SIE and salary-consent cases also passed in actual local workerd/D1. These
use independently authored synthetic inputs, not real payroll or ledger data.
TypeScript checks cover the portable domain and both runtime configurations.

## Remaining evidence

Actual public OAuth MCP evidence below includes chart discovery, an independently
reconciled ordinary voucher and a bounded hourly-input create/update/delete
lifecycle. Full financial export/balance coverage, nonempty invoice semantics,
remaining G07/G10 variants and actual ChatGPT acceptance remain pending. No
issue/gate is closed. Source rights for vendored/generated material retain G05;
this work uses independent schemas and synthetic fixtures, without
redistributing the external OpenAPI input.

## Primary references

- [Analytics contract](../contracts/analytics.md), [validation](../contracts/validation.md),
  [storage](../contracts/storage.md), [tests](../testing.md).
- [Fortnox API](https://api.fortnox.se/apidocs),
  [scopes/licences](https://www.fortnox.se/developer/guides-and-good-to-know/scopes),
  [global parameters](https://www.fortnox.se/developer/guides-and-good-to-know/parameters).
- [SIE 4B specification, 2008-09-30](https://sie.se/wp-content/uploads/2020/05/SIE_filformat_ver_4B_080930.pdf),
  sections 5, #RAR, #IB/#UB/#RES and #TRANS/#RTRANS/#BTRANS.

## Bounded payroll domain

`PayrollInputs` independently models salary-transaction list/get/create/update/
delete behind an empty default operation allowlist. Every write uses
`BusinessWrites`, current references and immutable complete-field previews/diffs.
The initial code profile requires separately verified per-employee code evidence
for quantity times unit amount; this formula is not assumed for every Fortnox
salary code. Employee employment dates, exact decimals, provider rights and
license evidence are checked on preparation and again at execution. No financial
or personal payload is retained in execution metadata. The read-only provider adapter is available only in the isolated leased test profile. Ordinary product payroll activation and provider payroll writes remain disabled.

## Consent dialog regression

The initial dialog accidentally carried an existing receipt-file selection into
an unrelated payroll request. The server correctly rejected the extra feature.
The corrected dialog includes an optional selection only when the current
program exposes it. A desktop/mobile regression starts with existing
receipt-files access, refreshes the server's newer program revision, and asserts
that the payroll preview sends exactly payroll-input. This UI defect did not
create a Fortnox flow, alter scopes or dispatch a payroll write.

## Bounded provider read slice

The financial adapter reads an explicit financial year, a paginated chart, raw
SIE4 bytes and an exact voucher reference. It repeats the SIE read to detect
observed changes; this does not establish an atomic snapshot. Export coverage
and correction semantics remain unverified, so the basis remains partial.
Missing openings are not fabricated, and unknown account classification stays
unmapped. Analysis account continuations bind the query and source version,
with whole-selection totals distinct from the bounded account page.

Four focused payroll MCP read tools expose minimal employee references and
salary transactions by employee/day or exact provider row. The separate test
entry accepts only these four operation IDs and a current one-hour lease.
Names, personal identity numbers and wage fields are excluded from employee
output. Salary numeric strings retain exact source precision; nullable fields
remain nullable. Read success does not attest write rights, code validity or
employee eligibility. Records remain uneditable and no provider write is sent.
Both companies completed fresh salary consent; synthetic employee/code evidence
and actual operation acceptance are still separate requirements.

## First actual read observations, 2026-11-10

At commit b82efd7 the owner-approved MCP SDK client discovered exactly four
payroll read tools, all annotated read-only. Both allowlisted companies returned
a successful complete empty employee page. A foreign-company request was denied
with COMPANY_FORBIDDEN. This proves neither employee detail, salary filtering,
write rights nor ChatGPT acceptance. Private evidence retains source hashes and
company identifiers; public evidence contains no personal data.

The owner subsequently authorized creating a synthetic employee through the API.
A separate operator-only helper uses BusinessWrites and a fixed synthetic profile
with a reserved preallocated ID, required name/email and an explicit employment
date. It accepts no real identity, bank account, arbitrary wage or arbitrary employee
fields. A later explicit fixture option permits only a fixed 0.01 synthetic
hourly/monthly wage; it is never a model-callable setting. Existing IDs stop preparation. Exact-ID readback must match every
intended field; missing or inconclusive responses remain outcome_unknown and
are never resent. It is not an employee-management MCP tool. The helper is
restricted by the same company grants, salary scope, test-tenant allowlist,
read-only policy, unresolved-write guard and existing lease.

The test-only financial MCP slice adds explicit-year analysis and exact voucher
drill-down, using strict resource schemas and read-only annotations. The model
cannot supply a basis, completeness flag or classification map. Ordinary product
activation remains disabled. Full reskontra/liquidity and actual G07 evidence
remain pending.

The first synthetic employee creation at 3440c12 succeeded and exact-ID
readback matched the intended fields. MCP list/detail and employee/day reads
then passed for that synthetic reference; the day contained zero salary rows.
No salary transaction or payout was created by provisioning.

The first actual analysis attempts reached financial-year reads but SIE returned
Fortnox 1000030, Invalid response type. Fortnox requires Accept: application/json
also for file retrieval. The transport was corrected while retaining raw-byte
bounds and explicit encoding; a regression asserts the header for every read.
No failed read is evidence of a complete financial report.

Primary sources for this correction and test-code candidates:
[headers](https://www.fortnox.se/developer/guides-and-good-to-know/header-fields),
[errors](https://www.fortnox.se/developer/guides-and-good-to-know/errors), and
[official employee salary-code table](https://support.fortnox.se/produkthjalp/lon/lonearter-och-berakningsformler-for-tjanstemannaavtalet).
The latter documents hourly code 11 and monthly code 12; company-specific
availability and transaction field semantics still require actual verification.
The owner authorized both monthly and hourly synthetic examples.

## Successful actual financial reads and login follow-up

After the SIE header correction at f57a33e, both test companies returned a bounded
financial report and a matching-source-version continuation page through MCP.
The report correctly remained partial for omitted opening/zero balances,
export coverage and effective-row semantics. This is source retrieval evidence,
not positive G07 reconciliation or full S08/ChatGPT acceptance. Both synthetic
employee profiles (hourly and monthly) were created and read back; no salary
transaction, payslip or payout has been created by that preparation.

A sign-in error follow-up separates failed credentials from expired sessions.
The prior wrapper mapped every password-login failure, including service errors,
to AUTH_REQUIRED and displayed a misleading expired-session message. The new
wrapper uses a uniform SIGN_IN_FAILED for unknown email/wrong password, preserves
rate limits and separates session-creation/service failures. It never returns
upstream messages or distinguishes account existence. The form clears password
and one-time code values while retaining email for a retry. Shared owner tests
exercise wrong and unknown credentials followed by a valid login; browser tests
exercise the same visible retry path. This does not reset the owner's password
or change session/cookie authorization.

## Bounded salary-code acceptance experiment

The operator-only candidate experiment uses the same durable BusinessWrites
policy as the product. It binds one company and at most two previously created
synthetic employees, verifies active employment and the exact hourly/monthly
profile, and permits only fixed quantity 1, amount/total 0.01 and a synthetic
marker. Code 11/12 are candidates from the official TJM table; the helper does
not claim that company-specific availability or write rights are already
verified. It rechecks the employee baseline and complete employee/day pages
before dispatch. A retained exact SalaryRow plus matching normalized fields is
required for success. Lost create responses never match by employee/date/amount
and never cause a resend. Ordinary MCP payroll writes remain off.

## Actual candidate mismatch, 2026-11-10

At 2325abb the hourly candidate returned an exact SalaryRow, but readback
preserved employee/date/code/quantity/marker while Amount and Total differed
from the prepared 0.01. A separate exact-ID read confirmed the same mismatch.
Normalized decimal comparison also failed; this is not trailing-zero formatting.
The outcome remains unknown under the existing intended-field contract. The
monthly attempt was not dispatched and no resend or guard reset was performed.

This proves the candidate's amount fields must not be treated as universally
writable for code 11. The official standard table identifies a provider formula,
but company-specific calculation and field behavior still need verification.
The retained row and original intent/digest remain private for investigation.
It does not establish a successful intended-input flow or G10 closure.

### Known-effect discrepancy classification

The follow-up adds `applied_different`, a terminal result for acknowledged exact
provider identity with matching stable fields but different observed content.
It never reports intended success or changes the original execution digest.
The operator-only salary experiment can classify only Number/Amount/Total differences
after exact readback and normalized employee/date/code/marker checks.
Recovery additionally requires the original private prepared fields to match
the retained immutable digest and fixed synthetic profile. No model-supplied
reference or name/date/amount heuristic can establish identity. Missing exact
references, changed stable fields and incomplete readback remain unknown.

Owner Operations lists these discrepancies separately, with field names and
evidence hashes, without retaining payroll values. Same-intent execution always
returns the retained terminal result; any correction needs a new preparation.
Node/SQLite and workerd/D1 cases cover persistence, no replay, invalid evidence,
lost references and operation-specific readback. Actual reconciliation of the
earlier candidate is recorded separately when performed; this implementation
alone does not accept the candidate or G10.

## Financial movement drill-down

A separate strict MCP read selects one account, year and inclusive date interval.
It returns at most 50 normalized rows, exact amounts, dimensions, effective-row
flags and structured voucher references where the exported reference is
representable. Every continuation binds company/year/account/interval and the
source version. Missing accounts, incomplete source coverage and unverified row
semantics remain explicit. A last continuation page is not labeled as a whole
complete result. Whole-basis validation also applies to drill-down, including
rows outside the requested display selection. No persistent ledger is added.

## Empty-year and export coverage observation

The actual current-year default SIE exports contained 451 chart accounts, no
explicit opening/closing balances and no effective movements in either company.
A bounded read experiment with the documented exportall parameter and candidate
value true returned the same counts; it did not establish broader coverage.
The separately paginated API chart contained 1,339 accounts. The union is
preserved and remains partial; omitted accounts/balances are not silently
treated as zero. Neither an empty-year source nor an unchanged exportall trial
is evidence for positive ledger reconciliation or correction semantics.

An independently gated account-detail read adds the exact fiscal-year/account
endpoint for checking provider opening/closing values. It checks returned year
and identity. Missing source values remain null; account-base-currency units
remain unverified and cannot produce a complete financial assertion. Analysis
and movement discovery require only their three basis reads; an unrelated
voucher/detail gate does not hide those independently enabled reads.

## Known-effect follow-up verification

The focused run passed 29 Node/SQLite cases (including actual SQLite and
workerd/D1 process restarts) and 27 shared workerd/D1 cases. Both desktop and
mobile Chromium flows rendered the discrepancy, separate unknown list and
evidence hashes, with no horizontal overflow or unexpected browser errors.
Browser plugin not available; the existing Playwright owner harness was used.
Typecheck, lint, build and all 13 packaged build/native-Worker smoke cases
passed. The full Node suite passed all 320 cases; all 260 full Worker cases also passed. Latest-head CI is recorded separately. A previous CI failure
was an outdated register-test-entry source hash; the operation ledgers now pin
the current source files without promoting any operation to supported status.

## Actual discrepancy follow-up, 2026-11-10

At 3b1b4f4 the earlier hourly intent reconciled to `applied_different` using its
retained exact response reference and original private receipt. Amount/Total
were the differing fields, the original hashes were preserved and no provider
write was sent. The separate monthly candidate then returned a retained exact
row whose Number/Amount differed while its Total matched. That result initially
remained unknown because the experimental proof treated quantity as stable.

The follow-up treats the three numeric fields as mutable content while requiring
exact acknowledged row identity and unchanged employee/date/code/marker. It
reports every changed numeric field and keeps the original fixed candidate hash.
A changed employee/date/code/marker still fails closed; this is neither formula
verification nor successful intended input. The cause and supported monthly
field contract remain unverified. No input was resent or payroll/payout executed.

The monthly row subsequently reconciled by exact retained identity and original
hash to `applied_different` for Number/Amount, without provider writes. Both
original zero-wage employees and both candidate rows remain private fixtures.

A separate explicit provisioning option can create a new synthetic employee
with a fixed 0.01 hourly or monthly wage to test the provider formula hypothesis.
It accepts no wage value, arbitrary employee data or real identifier. Required
synthetic name/email/profile fields are unchanged; wage readback compares exact
normalized decimals. It uses the same absence check, durable create intent,
exact-ID readback, tenant/grant/scope/lease and unknown-outcome rules. Formula
behavior and operation activation remain unverified until separately observed.

## Verified-profile provider/MCP write implementation

At e5514b4 the new fixed-wage hourly employee and code-11 candidate matched all
prepared fields on exact actual readback. The separate fixed-wage monthly
candidate still returned different content and is not an accepted monthly
workflow. Both use synthetic data; no payroll or payout was run.

The new provider adapter defaults to no profiles or enabled operations. Trusted
installation code must supply separate acceptance hashes for create, update and
delete, bound to one company, employee, code 11 and date interval. A create
observation does not unlock update/delete. The adapter re-reads active TJM/TIM
employment and the applicable dated hourly wage (or today's explicitly current
wage); changed rate or missing dated coverage blocks preparation/execution.
Quantity precision and the exact unit amount are part of the verified profile.
It exposes no code-12/monthly formula or employee-management tool.

Focused MCP prepare/execute/reconcile/status tools use strict schemas, immutable
references and accurate effect annotations. Updates show complete modeled
before/after/diff, re-read the full source version and preserve identity. Rows
with unmodeled fields, dimensions, expenses or nonzero VAT are uneditable. Each
write uses BusinessWrites and pre-dispatch authorization; provider rejects/lost
responses never trigger a resend. A wrong update response identity cannot
replace the original target. Delete needs the verified final response (HTTP 200 by documented default)
and an exact-ID not-found read; absence after a lost acknowledgement remains
unknown. These tools are absent when their operation is disabled. The ordinary
product and existing leased read-only entry still enable no payroll writes.

Actual acceptance of this provider/MCP implementation, update/delete rights and
ChatGPT behavior remain separate pending evidence. The candidate helpers do not
set their own production evidence or promote a capability after one probe.

## Actual hourly MCP/provider acceptance, 2026-11-10

At 54d12c0, a separately prepared hourly input with a different integer quantity
passed strict product MCP schemas, current employee/dated-wage references,
BusinessWrites dispatch and exact Fortnox readback. Repeating the same immutable
MCP reference returned the retained success; instrumentation counted one POST.
The client used an in-memory MCP SDK transport with the owner's current
company/client grant. This is actual domain/provider evidence, not a public HTTP
OAuth or ChatGPT-host observation. No ordinary product operation was activated.
The row/intent/profile receipts and cleanup plan are retained privately.

A separate operator-only maintenance probe can test update/delete on that exact
retained successful synthetic row. It takes no caller-selected row or fields:
its target must come from the retained successful create/update intent in the
same tenant/client, and current content must match that intent's evidence.
It permits only the synthetic marker/employee/date/code profile, rechecks wage
and employment, binds the full source version and uses BusinessWrites plus the
same fixed provider transport. Update tests a fixed third quantity; delete
requires acknowledged delivery and exact absence. Candidate rights are not
advertised or inserted into the verified profile by the helper.

The delete transport retains empty final HTTP 200/204 acknowledgement metadata,
while the verified profile selects exactly one accepted status (documented
default 200). The operator probe can observe either final status separately;
202, nonempty responses, missing acknowledgement or inconclusive readback remain
unknown. No actual undocumented status is claimed before the experiment.

## Actual maintenance observation and retained response recovery

At b839428 the exact synthetic MCP-created row updated successfully and its
fixed intended fields matched actual readback. The single subsequent DELETE
returned HTTP 200, captured by the private operator transport. Initial final
verification remained unknown. A separate exact-ID GET then returned not-found;
no DELETE was repeated. The raw response body was not retained, so its format
is not inferred from the status observation.

The operator-only recovery extension accepts a hash of that captured final
response receipt, bound to the existing intent ID/hash. It introduces no row
identity and must match the already retained target/reference. The operator
loader separately checks the prior successful update, same tenant/client and
the one captured DELETE acknowledgement. Only a subsequent exact-ID not-found
read can resolve it. Missing response proof, a different intent/hash, forbidden
reads or a still-existing row remain unknown. A lost acknowledgement is never
replaced by absence alone. No model-callable status/reference attestation or
new provider write is added. Actual reconciliation is recorded when performed.

This distinguishes a retained final response from a lost response. Fortnox's
[response guidance](https://www.fortnox.se/developer/guides-and-good-to-know/responses)
defines successful responses in the 200 range; the supplied operation reference
explicitly lists 200 for salary-transaction deletion without a response-body
schema. The ordinary adapter's body-shape acceptance still needs separately
captured actual evidence before advertising deletion.

The initial empty-body restriction was an implementation assumption, not a
provider contract. The corrected transport accepts a bounded empty or valid
JSON final response for the profile's verified status; recognized error
envelopes, malformed JSON and 202 remain unknown. Exact-ID not-found readback
is still required. This corrects response handling without weakening missing-
acknowledgement recovery or changing any approved product decision.

The full 54d12c0 regression passed 332 Node/SQLite and 271 actual workerd/D1
cases, all 13 packaged/native-Worker smoke cases and all five CI flows. The
maintenance follow-up separately passed final-status, exact-intent and lost-
acknowledgement tests in both runtimes; subsequent retained-response recovery
and JSON-response cases are recorded with their own run.

## Actual complete hourly input lifecycle through MCP

At a2cef28 the retained final-200 deletion receipt reconciled the original
intent by exact not-found readback, with no new provider write. The independent
product MCP lifecycle then prepared/created, prepared/updated and prepared/deleted
a new synthetic hourly input. Every intended readback matched, and a final MCP
read independently confirmed absence. Repeated references sent exactly one POST,
one PUT and one DELETE in total. Wrong company and unverified salary code were
denied. The captured actual DELETE response was HTTP 200 with a JSON string,
which the corrected transport accepts without assuming an empty body. No raw
response string, IDs or payroll values are included in public evidence. This
remains product-domain-service/provider evidence using an in-memory SDK transport,
not ChatGPT acceptance or ordinary product activation.

## Efficient bounded chart discovery

`list_financial_accounts` independently gates the existing financial.accounts
operation and returns at most 100 provider chart records. It binds continuation
to company/year and the first-page source hash, rechecks that anchor around each
continued page, validates every row's year and checks connection generation
after retrieval. It preserves inactive/custom/zero references and unknown
balances without inventing zero. Source record totals, retrieval window and
non-atomic pagination are explicit. A last continuation is never a complete
collection; completeness describes chart records, not reconciled financial
statements or verified balance units. No financial cache or new provider
operation is introduced. This enables independent bounded detail-read acceptance
without reloading the entire SIE/chart for every display page.

The chart-discovery and DELETE JSON-response follow-up passed 10 targeted cases
in Node/SQLite and the same 10 in actual local workerd/D1, plus typecheck and
lint. These checks do not establish complete live chart/balance coverage.

## Bound comparisons and payroll reference changes

`compare_financial_periods` accepts two explicit company/year/date selections
and at most 50 shared account numbers. It retrieves both source reports itself;
a caller cannot supply report values, mappings or completeness. Both companies
are authorized before any provider read and checked again after both reads.
Each report retains its source window, currency, mapping and reconciliation.
Differences are exact right-minus-left period movements only for compatible
definitions; this is neither currency conversion nor statutory consolidation.

Prepared payroll writes now bind the validated employee/code reference profile,
including its acceptance hash, date limits, quantity precision and verified rate.
A changed profile invalidates an old preparation even if its amounts still
satisfy the new profile. Retrieval timestamps and unrelated employee references
do not determine this hash. Earlier preparations without this binding are stale.

The comparison/reference-binding follow-up passed 10 targeted Node/SQLite cases
and the same 10 actual local workerd/D1 cases, operation-source-ledger validation,
typecheck and lint. Actual cross-company comparison and ChatGPT evidence remain
pending; these tests do not promote default support.

## Isolated payroll acceptance profile

Only the separately built Node test entry can load `PAYROLL_TEST_PROFILE_FILE`.
The bounded JSON file must be private, regular, not a symbolic link and bound to
the exact compiled source commit. It supplies explicit per-action evidence and
company/employee/code/date/rate profiles. Ordinary product startup never loads
this file. The existing test-tenant allowlist, company grants, one-hour operation
lease, restore/read-only/unknown-write guards and current reference validation
still apply. The public health catalog exposes operation names, never profiles.

This permits the next public OAuth MCP/client acceptance attempt for the already
provider-verified hourly create/update/delete slice. Merely loading a profile is
not actual ChatGPT acceptance or ordinary capability activation.

Private-file/source/operation rejection passed two Node cases, and the shared
isolated-profile rejection passed in actual local workerd/D1; typecheck and lint
also passed. Public OAuth write/client acceptance remains a separate next step.

## Actual all-account zero-balance coverage

Source e2b565c was deployed in the isolated leased test build. Public OAuth MCP
SDK acceptance discovered and independently detail-read all 1,339 chart accounts
in each of the two allowlisted sandboxes (2,678 detail reads). Every record had
explicit zero opening/closing balances. Both initial/final financial source
versions matched, and no account read failed. Rotating MCP access was renewed
between batches; no owner session was impersonated. Private evidence contains
account numbers, flags and hashes, not a replicated chart with names/amounts.

This independently proves the observed zero-state account coverage. It does not
establish nonempty posting/correction semantics, a complete SIE export, arbitrary
future zero inference, classification, booked liquidity or ChatGPT acceptance.
Those limitations remain in product results and the original G07 acceptance.

## Current receivable/payable observations

The portable `OpenItems` service and two finite provider list adapters back
`list_receivables` and `list_payables`. Each reads at most 100 unfiltered source
records, preserving unknown amounts/status/dates and exposing only current
provider state. Paid/cancelled records are excluded locally; unbooked records
require an explicit selection. The adapter cannot invent a historical unpaid
amount or apply an unverified server filter that omits records.

Continuation binds company, resource, selection and first-page source hash,
which is rechecked around continued reads. Both company generation and scope are
checked after retrieval. Per-currency sums cover only the returned page and do
not establish a complete collection. Unknown balance-currency/credit semantics
block signed expected cash flow. Even with verified signs, due date is an
explicit expectation input rather than proof of future payment. Ordinary
activation is off, and actual nonempty reskontra/credit/partial-payment acceptance
remains pending.

The current-open-item slice passed four observable cases in Node/SQLite and the
same four in actual local workerd/D1: strict MCP output/current-state limits,
source-bound continuation, rights/disconnect/read-only behavior, exact page-only
currency/sign calculations and invalid-money rejection. Typecheck, lint and the
operation/source ledger check passed. These are synthetic provider contracts;
nonempty actual balance/credit/currency evidence remains separate.

## Actual public OAuth MCP follow-up

At 83c20b3 the isolated HTTPS build loaded its private source-bound hourly
profile. Public OAuth MCP SDK acceptance prepared/created, prepared/updated and
prepared/deleted another synthetic input, with exact independent readback and
final not-found. Repeated immutable references produced the retained results;
the private transport observer recorded exactly POST, PUT, DELETE, all HTTP 200.
Wrong company and an unverified code were rejected. This is actual public product
transport/domain/provider evidence, not actual ChatGPT acceptance. No payroll,
payslip or payout occurred, and the lifecycle row was deleted on success.

Both companies also passed public current receivable/payable reads (zero source
records), an explicit two-company account comparison (compatible, incomplete)
and foreign-company denial. These empty observations do not establish nonempty
invoice/currency/credit semantics. All five latest-head CI flows passed for
83c20b3, including [S01](https://github.com/engshort/fortnox-mcp/actions/runs/42767345857),
[Docker HTTPS](https://github.com/engshort/fortnox-mcp/actions/runs/42767346071),
[source packet](https://github.com/engshort/fortnox-mcp/actions/runs/42767346004),
[OAuth](https://github.com/engshort/fortnox-mcp/actions/runs/42767346036) and
[S00](https://github.com/engshort/fortnox-mcp/actions/runs/42767345768).
The full local baseline passed 349 Node and 287 actual workerd/D1 cases, plus
all 13 packaged/native-Worker cases, typecheck, lint and build.

## Liquidity inputs and explicit classification

`get_liquidity_basis` combines at most 20 selected booked account balances with
one bounded current page from each invoice source. The explicit observation day
must be today in Stockholm; expected dates cover at most 90 days and use the
explicit `due_date_only` assumption. Historical current-status inference is
rejected. It authorizes all three source scopes before reading and rechecks the
company and observation day afterward.

Amounts remain exact and in the ledger currency. Unknown balance/credit/currency
semantics block expected-flow calculations, other currencies remain excluded and
counted, and missing amounts block the projected figure. The scope is selected
accounts and returned invoice pages, with continuation references retained.
Source coverage and non-atomic retrieval remain visible. Due date is not a
payment promise, and a booked balance is never called a live bank balance.

A separate private source-bound financial test profile supplies explicit
company/year account classifications and cash/bank selections. It cannot infer
BAS ranges or classify a non-asset account as cash. Both classification version
and evidence hash appear in the result. Missing cash classification prevents
complete status; ordinary startup never loads this test file. This configuration
is not financial-semantics acceptance and cannot enable provider writes.

The liquidity/classification follow-up passed seven targeted Node/SQLite cases
and the same seven in actual workerd/D1, plus the private financial-profile and
source-ledger Node checks, typecheck and lint. Trusted mapping evidence now
participates in financial source versions, invalidating older continuations even
when classifications have the same values. Malformed provider invoice money is
reported as an upstream response failure, rather than invalid caller input.

## Latest isolated-build verification

At f89d3d89d4f9816c64a85993f0141476c4d7656a, public HTTPS/OAuth MCP SDK
checks passed in both allowlisted sandboxes for current liquidity inputs with
explicit classification. Results correctly remained partial: export coverage and
invoice sign/currency semantics are unverified, so no projected balance was
invented. Historical current-status queries and foreign-company access were
rejected. This adds transport/domain/provider evidence, not ChatGPT acceptance.

The same build passed separate payroll negative checks. With company read-only
mode temporarily enabled through the owner-domain service, create, update and
delete preparations were rejected; reading the known employee still succeeded.
A missing synthetic employee returned the provider's not-found response. The
transport observation confirmed that no payroll write occurred. The original
read-only setting was restored, preserving the company's recorded manual-voucher
policy throughout. These observations do not establish every provider license or
permission-denial variant.

All five latest-head CI flows passed: [S01](https://github.com/engshort/fortnox-mcp/actions/runs/42769077764),
[Docker HTTPS](https://github.com/engshort/fortnox-mcp/actions/runs/42769077861),
[source packet](https://github.com/engshort/fortnox-mcp/actions/runs/42769077648),
[OAuth](https://github.com/engshort/fortnox-mcp/actions/runs/42769077686) and
[S00](https://github.com/engshort/fortnox-mcp/actions/runs/42769077683).
S01 ran 353 Node/domain cases, 290 actual local workerd/D1 cases, typecheck,
lint, build and all 13 packaged/native-Worker cases. Docker verification ran
in CI; no local Docker execution is claimed.

The subsequent positive-ledger acceptance attempt did not find the expected
booked fixture. Independent account-detail reads in both sandboxes and their
available fiscal years still reported zero balances for the two selected
accounts; movement reads in the intended company returned no movements. The
company/year selection was independently checked against the company listing.
Matching zero balances are not positive posting/SIE reconciliation evidence.
The initial attempt remains partial, with private receipts preserved; no provider
write, policy change or capability promotion was used to make it pass. The owner
subsequently confirmed that booking was still pending; the successful follow-up
below supersedes that fixture prerequisite. Nonempty invoice semantics and
actual ChatGPT acceptance remain outstanding. Issues #25, #26, #37 and #40
remain open.

## Actual positive voucher and period reconciliation

The owner subsequently booked a voucher in the intended allowlisted sandbox and
supplied its exact provider reference privately. At source f89d3d8, public
HTTPS/OAuth MCP SDK reads found three ordinary, balanced rows. Their content
differed from the previously proposed two-row fixture; the initial proposed-input
comparison correctly failed and its receipt was preserved. No replacement or
duplicate voucher was created. A separate acceptance attempt reconciled the
actual provider reference and observed contents instead.

For all three affected accounts, exact signed voucher rows matched the SIE
movements carrying that same year/series/number. Independently retrieved account
opening balances plus effective SIE movements matched the account-detail API's
closing balances. Product report period movements matched those observed
movements. Source versions remained unchanged across the reads, and a second
exact voucher read returned the same source hash. Provider IDs, amounts and raw
rows remain in private bounded evidence, not public fixtures or issue text.

Additional actual product queries selected the interval before the posting day,
the posting day alone and the interval after it. All three selections returned
the expected movement sums with the same source version. Unverified as-of
balances remained unavailable instead of being inferred from year-end fields.
This is positive evidence for the observed normal rows, exact debit-minus-credit
signs and inclusive date selection; it does not verify correction/removed-row
semantics, non-calendar or multiple fiscal years, period-lock boundaries or every
account/export balance.

The product report correctly remains incomplete. Its limitations still include
unverified export coverage, missing openings, unverified provider semantics,
a closing-source disagreement in the full report basis
and an unsupported SIE `#PSALDO` record. Unknown classifications remain visible.
Those limitations require separate investigation and evidence before promotion.
No provider write, policy change, ordinary activation, ChatGPT acceptance or
whole G07/G10 completion is claimed by this follow-up.
