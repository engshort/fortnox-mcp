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

Actual SIE/chart retrieval is observed below; positive independent ledger reconciliation, salary-transaction writes and ChatGPT acceptance are still pending. No issue/gate is closed. Full analytical read breadth, financial MCP contracts, payroll writes and live acceptance remain in progress. Source rights for vendored/generated material retain G05; this work
uses independent schemas and synthetic fixtures, without redistributing the
external OpenAPI input.

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
date. It accepts no real identity, bank account, wage or arbitrary employee
fields. Existing IDs stop preparation. Exact-ID readback must match every
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
The operator-only salary experiment can classify only Amount/Total differences
after exact readback and normalized employee/date/code/quantity/marker checks.
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
passed. The full Node suite passed all 320 cases; the full Worker result and
latest-head CI are recorded separately when complete. A previous CI failure
was an outdated register-test-entry source hash; the operation ledgers now pin
the current source files without promoting any operation to supported status.
