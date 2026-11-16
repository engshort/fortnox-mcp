# S09 — Payroll input

Status: implementation in progress; see [milestone 7 delivery and evidence](M07-analysis-payroll.md). Original full acceptance below remains required. Depends on S04; closes G10 for enabled operations.

## Deliver

Implement at least one useful documented payroll-input workflow using supported employee, attendance, absence, expense or salary-transaction resources. Keep resource adapters extensible for later breadth. Verify employee/date/salary-code/amount rules and corresponding provider rights.

Separate reading existing inputs, creating inputs, updating and deleting where supported. Use standard client approvals and the shared company/validation/write-intent layers. Payroll data is sensitive and must not appear in debug logs or public fixtures.

## Acceptance

Demonstrate a synthetic input from preparation through Fortnox acceptance, with missing employee/code/permission, wrong company and retry cases. State which resources are actually supported. Test that the server does not expose or imply a complete payroll calculation, payslip-generation or payout operation.

## Handoff

Provide a Swedish user example, operation coverage and a clear future-extension path. Do not assume every entry under the `salary` scope is implemented or usable with every Fortnox payroll license.
