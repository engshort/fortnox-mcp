# S08 — Full financial data basis

Status: implementation in progress; see [milestone 7 delivery and evidence](M07-analysis-payroll.md). Original full acceptance below remains required. Depends on S04, document/accounting read contracts and G07.

## Deliver

Implement [analytics contract](../contracts/analytics.md): all-account discovery, opening/closing/period balances, effective movements and source drill-down. Add a bounded SIE ingestion/parser path after confirming source-format and API semantics. Preserve year, account, dimension and sign metadata.

Provide deterministic balance/result groupings, receivable/payable lists, liquidity basis and comparisons. Keep custom/unmapped accounts visible, label derived values and distinguish booked balances from live bank data or projections.

## Acceptance

Verify T15/T16 against synthetic reconciliation fixtures and a Fortnox test-company export. Include all/zero/inactive accounts, custom charts, non-calendar years, multi-year boundaries, partial exports and concurrent source changes. Check that year-end fields are not misused for arbitrary-date balances.

A report based on partial pagination/export must not say complete. Outputs include retrieval window, source references, definitions, currency, mapping version and limitations. Large work remains bounded and resumable.

## Handoff

Document calculation definitions and drill-down examples in English/Swedish. No LLM dependency, permanent ledger replica or automatic statutory consolidation is introduced.
