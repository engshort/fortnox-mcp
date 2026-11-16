# S05 — Sales and purchase workflows

Current activation follows the [2026-11-11 owner decision](product-activation-2026-11-11.md);
historical default-off statements below retain their dated evidence scope.

## Empty copy-recipient recovery — 2026-11-11

Actual independently AI-reviewed sandbox creation exposed #131: a known offer
reference returned explicit null CC/BCC instead of requested empty strings.
Other requested header values and the ordinary row matched, but exact nested
comparison and reconciliation retained `outcome_unknown`. No create was retried;
new company writes were stopped and the original intent was preserved.

The provider read projection now canonicalizes only explicitly present null
CC/BCC to the existing empty-string copy profile. It does not invent a To
recipient, missing fields, amounts or templates, accept nonempty copy recipients,
change the intent hash or modify stored execution state directly. Source-version
hashing still uses the entire raw provider record. Ordinary exact-reference
reconciliation can therefore resolve retained matching intent content without
a provider write. Missing or changed identity/content remains uncertain.

Shared transport regressions exercise addressed create/read/comment-only update,
known-reference recovery without another POST, changed customer/recipient/
subject/row rejection, raw-version changes and missing/nonempty recipient fields.
Actual recovery of the preserved hosted intent must be recorded against the
reviewed deployed fix. The recipient-free To limitation in #130 remains open;
this narrow equivalence does not certify all sales lifecycles or delivery.

Local verification: all 11 targeted shared sales-transport cases passed in
Node/SQLite, including the three added regressions. Four TypeScript projects,
the production build and changed-source Biome checks passed. Actual local
workerd was not rerun after the known Windows native-runtime failures; Linux
CI must run the same shared contracts in workerd/D1 before deployment. Hosted
reconciliation of the preserved original intent remains pending at this point.
The separate built-artifact test attempt passed five of ten cases; five Node
fixture processes exited before startup on Windows. It is not a passing full
artifact run and requires the Linux CI result.

Status: in progress; no document operation is enabled or advertised. Depends on
S04. The portable sales domain and internal fixed-route provider adapter below
are implemented, with focused MCP schemas and a read-only isolated product
profile. Product write activation, supplier invoices, payments and actual
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
The internal document transport has a separately selected read-only test profile. Its independent
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

## Focused MCP and isolated document reads

The optional sales service registers separate list/get, preparation, immutable
execution, reconciliation and status tools per resource/effect. Strict input
schemas reject arbitrary fields and replacement content at execution. Shared
Node/SQLite and actual local workerd/D1 MCP clients check the catalog, annotations,
partial summaries, preparation/result schemas, replay, foreign-company/anonymous
denial and default-off discovery. Reconciliation updates local execution state
and is annotated as a local mutation, despite never dispatching a provider write.
Reported totals/balances preserve exact decimal lexemes and nulls separately
from writable headers; no total is invented from an incomplete summary.

Only `dist/register-test-node.js` can read `DOCUMENT_TEST_OPERATIONS`, an explicit
JSON array of at most six distinct `offer.list`, `offer.get`, `order.list`,
`order.get`, `invoice.list`, `invoice.get` values. It reuses the same isolated
database, two-tenant allowlist and maximum one-hour lease. Unknown/duplicate IDs
and every document write operation are rejected. Ordinary product ENV ignores
this selection. Shared profile and built-entry cases cover this boundary and
expiry. The document write adapter/MCP contracts remain available for synthetic
tests only; financial/reference, permission and actual client gates remain closed.

## First actual document reads (2026-11-10)

At `2b502ab149f7e03d61879070a2c8b05c8c1d8276`, a human-approved product
OAuth/PKCE Node MCP SDK client read offer, order and invoice lists in both
allowlisted companies. All six unfiltered lists and six selected-filter requests
returned empty complete collections. This establishes accepted bounded requests,
not filter semantics on matching records. Six exact nonexistent detail reads
returned `record_not_found`; positive detail readback is still pending. A foreign
company request returned `COMPANY_FORBIDDEN`. The actual catalog exposed the six
selected read tools and no document write tools. No document write was dispatched.

Private evidence retains timestamps and response hashes outside git. This is
actual provider/product-MCP evidence, not ChatGPT acceptance. The operation
matrix remains unsupported/default-off, with all financial, permission,
precision, nonempty pagination and lifecycle cases still requiring acceptance.

The S11 company/program handoff is integrated into #118. Both document-domain
reads and the internal provider transport enforce local program selection,
including disable while existing upstream scopes remain present. The common
business dispatcher applies the same check to prepared writes. UI connection
status does not activate these document operations.

## Deliver

Practical offer/order/customer-invoice and supplier-invoice flows: retrieval, preparation, creation, explicit update, sending, bookkeeping, cancellation/credit and supported payment registration. Split operations by side effect and gate them by actual scope/license/record state.

Model updates as reviewed resulting content/diffs, preserving intended rows under Fortnox's replacement semantics. Treat sending/printing/reminders according to verified effects, not GET/PUT labels. Standard client approvals apply; manual-voucher creation via any route still enters the manual-voucher policy.

## Acceptance

End-to-end synthetic document lifecycle, mixed VAT/precision examples validated against provider constraints, row omission/update tests, cancellation/credit state errors and timeout/reconciliation tests. External delivery goes only to explicitly authorized test recipients. Payment registration is never described as sending money through a bank.

Verify all advertised operations individually; do not enable a resource's full method set merely because creation passed.

## Handoff

Record provider IDs/state transitions and synthetic fixtures needed for analysis. Document specialized finance/recurring functions still assigned to S13.
