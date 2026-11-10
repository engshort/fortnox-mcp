# S05 — Sales and purchase workflows

Status: in progress; no document operation is enabled or advertised. Depends on
S04. The portable sales domain and internal fixed-route provider adapter below
are implemented. MCP/product wiring, supplier invoices, payments and actual
acceptance remain pending.

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
The internal document transport is not wired into the product. Its independent
[23-operation ledger](../reference/s05-sales-operations.json) classifies routes,
effects, scopes, exact wire values and retry rules without promoting support.
List summaries explicitly retain unknown states and incomplete document content;
they cannot stand in for a full editable detail read. Unmodeled discounts,
article/stock rows, fees and unknown row fields block the bounded write profile.

The adapter performs a final whole-source version comparison before dispatch,
retains all surviving row IDs, and reads the complete intended result after IDs
change. Decimal prices/VAT use exact JSON numeric tokens; quantities use the
endpoint's string representation. Conversion reads both the source reference
and exact target document. GET email uses the one-attempt write transport;
all uncertain provider rejections remain unknown until proven otherwise.

Consumed intents retain only bounded identity/field-name/content-digest evidence.
Read-only reconciliation can compare current intended content or exact observed
cancel/booking/conversion relationships. It never uses a name/date/amount search,
never resends and cannot resolve an email from a Sent flag. A lost create response
without a returned identity remains unknown. Matching current state is not proof
of which actor caused a concurrent change.

Eight shared HTTP behavior cases pass in Node/SQLite and actual local workerd/D1,
alongside the six sales-domain cases. The chained lifecycle case also checks
resource-specific quantities, mixed VAT, booked-state cancellation denial and a
separately prepared credit. They cover partial summaries, decimal
lexemes, retained and regenerated IDs, a final stale-version rejection, unknown
discounts, lost effectful GETs, uncertain rejections, disconnect during dispatch,
read-only content reconciliation and exact conversion target readback. These are
synthetic fixed-endpoint tests, not actual Fortnox or ChatGPT acceptance.
All operations remain disabled by default.

## Deliver

Practical offer/order/customer-invoice and supplier-invoice flows: retrieval, preparation, creation, explicit update, sending, bookkeeping, cancellation/credit and supported payment registration. Split operations by side effect and gate them by actual scope/license/record state.

Model updates as reviewed resulting content/diffs, preserving intended rows under Fortnox's replacement semantics. Treat sending/printing/reminders according to verified effects, not GET/PUT labels. Standard client approvals apply; manual-voucher creation via any route still enters the manual-voucher policy.

## Acceptance

End-to-end synthetic document lifecycle, mixed VAT/precision examples validated against provider constraints, row omission/update tests, cancellation/credit state errors and timeout/reconciliation tests. External delivery goes only to explicitly authorized test recipients. Payment registration is never described as sending money through a bank.

Verify all advertised operations individually; do not enable a resource's full method set merely because creation passed.

## Handoff

Record provider IDs/state transitions and synthetic fixtures needed for analysis. Document specialized finance/recurring functions still assigned to S13.
