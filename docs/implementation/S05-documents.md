# S05 — Sales and purchase workflows

Status: in progress; no document operation is enabled or advertised. Depends on
S04. The portable sales-domain portion below is implemented; provider/MCP
adapters, supplier invoices, payments and actual acceptance remain pending.

## Implemented domain boundary

`SalesDocuments` registers separate durable intents for ordinary SEK offers,
orders and customer invoices. Creation and updates require explicit account,
VAT, prices, quantities, dates and fiscal year; no defaults are invented. The
existing accounting-reference contract must be verified, current, company-bound
and cover every selected account. Its unverified provider gate remains closed.

Updates preserve header omissions and describe the complete intended header and
rows. Every existing row ID must occur exactly once among retained or explicitly
removed rows. Unchanged rows can use `{RowId}`. The provider payload includes all
survivors, matching Fortnox's documented row-replacement mode. A changed source
version requires a new preparation; returned row IDs must be read afresh after
each update. Partial/unmodeled documents cannot enter this write profile.

Mixed VAT previews use exact decimal arithmetic and label totals unrounded;
synthetic arithmetic is not evidence of Fortnox's accepted precision or rounding.
Conversion needs current access to the target resource. Cancellation, booking,
credit and sending have distinct state checks and intents. Email is a write
regardless of HTTP method, requires an operator-approved recipient and empty
CC/BCC, and never retries a lost response. A Sent flag alone cannot reconcile an
unknown dispatch. Standard document client approval grants no manual-voucher
approval.

The shared row and sales-domain contracts currently pass 11 cases in Node/SQLite
and actual local workerd/D1, including explicit removal, regenerated/stale IDs,
mixed VAT precision, current reference gates, concurrent intent execution,
changed content and uncertain sends across service recreation. These tests use
synthetic provider ports; they establish neither provider nor ChatGPT acceptance.
The internal document transport is being implemented and is not wired into the
product. All operations remain disabled by default.

## Deliver

Practical offer/order/customer-invoice and supplier-invoice flows: retrieval, preparation, creation, explicit update, sending, bookkeeping, cancellation/credit and supported payment registration. Split operations by side effect and gate them by actual scope/license/record state.

Model updates as reviewed resulting content/diffs, preserving intended rows under Fortnox's replacement semantics. Treat sending/printing/reminders according to verified effects, not GET/PUT labels. Standard client approvals apply; manual-voucher creation via any route still enters the manual-voucher policy.

## Acceptance

End-to-end synthetic document lifecycle, mixed VAT/precision examples validated against provider constraints, row omission/update tests, cancellation/credit state errors and timeout/reconciliation tests. External delivery goes only to explicitly authorized test recipients. Payment registration is never described as sending money through a bank.

Verify all advertised operations individually; do not enable a resource's full method set merely because creation passed.

## Handoff

Record provider IDs/state transitions and synthetic fixtures needed for analysis. Document specialized finance/recurring functions still assigned to S13.
