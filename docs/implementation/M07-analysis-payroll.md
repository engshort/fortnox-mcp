# Milestone 7 — financial analysis and payroll input

Status: implementation in progress; no new capability accepted or enabled in the
ordinary product. Tracks [S08/#25](https://github.com/engshort/fortnox-mcp/issues/25),
[S09/#26](https://github.com/engshort/fortnox-mcp/issues/26),
[G07/#37](https://github.com/engshort/fortnox-mcp/issues/37) and
[G10/#40](https://github.com/engshort/fortnox-mcp/issues/40).
Original issue acceptance remains authoritative. The separate milestone 6 work
in [#118](https://github.com/engshort/fortnox-mcp/pull/118) remains open.

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
and invalidates old client grants. Existing unresolved-write restrictions still
apply. A company with an unknown register outcome is not silently reconnected.

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

No actual SIE export, positive ledger reconciliation, salary request or ChatGPT
acceptance has run for this milestone. No issue/gate is closed. Provider adapters,
MCP contracts, full read breadth, payroll lifecycle and live acceptance remain in
progress. Source rights for vendored/generated material retain G05; this work
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
