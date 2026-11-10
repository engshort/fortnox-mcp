# MCP tool and provider contract

Milestone 2 adds implemented experimental `list_companies`, `get_connection_status` and test-only `get_company_profile` with strict schemas, durable authorization and structured errors. Profile execution remains disabled outside explicit two-tenant acceptance mode. See [evidence](../implementation/M02-connections-evidence.md).

Most names below are proposed public contracts to finalize in S03. The opt-in
[local documentation entry](../developer-tools.md) implements `search_api_docs`
and `read_api_doc` plus `describe_api_operation`, with no provider operation. Other planned families remain
unimplemented. The isolated [S00 spike](../../spikes/s00-mcp/README.md) exposes only `read_synthetic_status`, a fixed company-independent fixture with strict input/output schemas and read-only, non-destructive, idempotent, closed-world annotations. It is not a provider operation or public product contract.

Milestone 3's opt-in `list_financial_years({ company_id })` discovers actual
provider year IDs and ISO date ranges without requiring a year ID first.
It uses the current owner/client/company/generation grant and `mcp:read`.
It is read-only, bounded to five pages/500 entries and explicitly reports
`complete=false` when partial. Read permission is rechecked after provider I/O.
`get_accounting_references({ company_id, financial_year })` then requires an
explicit returned year ID; no current-year default or guessed calendar-year
mapping exists. Both remain experimental test capabilities under #92.

Provider reference schema failures return `UPSTREAM_UNAVAILABLE`, a fixed
operation-specific reason and bounded, deduplicated schema field paths in
`error.fields`. They are not invalid caller input. Paths contain only known
schema names and wildcard indices; provider values, raw Zod issues/messages,
request headers and raw payloads are never reflected. Internal output-schema
failures use `invalid_tool_result`. Numeric information settings may be shown as
`UNKNOWN`; they can never authorize a voucher.

## Tool design

Expose focused tools with accurate side-effect annotations. Separate listing/reading, preparation, creation, updating, sending, booking and cancellation. A generic `execute(method, url, body)` tool is not exposed. The 405 upstream operations must be reviewed, not blindly published as 405 equally trusted tools.

| Family | Example tool names | Requirements |
| --- | --- | --- |
| Discovery | `list_companies`, `get_capabilities`, `get_connection_status` | Return only caller-owned connections and actual availability |
| Records | `list_invoices`, `get_invoice`, `create_invoice_draft`, `send_invoice` | Separate effects; verify whether a provider draft action itself changes state |
| Accounting | `list_accounts`, `get_account_balances`, `list_vouchers`, `get_voucher`, `prepare_manual_vouchers` | Explicit company/year/date context |
| Approval | `commit_reviewed_vouchers` | App-only in review mode and protected by the approval contract; never a confirmation boolean |
| Client-managed booking | `create_manual_voucher` | Available only when policy permits; same domain checks |
| Files | `upload_receipts`, `get_attachment`, `link_voucher_attachment` | Company-bound references; safe file ingestion |
| Analytics | `get_ledger_summary`, `get_receivables`, `get_payables`, `get_liquidity_basis` | Bounded, complete/evidenced or explicitly partial |
| Developer help | `search_api_docs`, `read_api_doc`, `describe_api_operation`, `diagnose_connection` | Local documentation tools implemented; diagnostics planned; no secret disclosure or bypass proxy |
| Recovery | `get_execution_status`, `resume_batch` | Company/owner authorization; resume only safe items |

Use capability/module selection to bound the tool catalog. The client sees supported, permitted operations; hiding a tool does not replace execution-time policy. If tool-search/discovery is added, it must preserve annotations and authorization for the discovered operation.

A preparation tool that creates a durable proposal changes server state and must not be labeled read-only merely because it has not booked anything in Fortnox. Keep purely computed previews distinct from stored proposals. Classify local operational mutations accurately and define which preparation functions remain available under read-only policy; the default read-only policy permits pure previews, not stored write proposals.

## Common request context

Every company-specific call includes an opaque `company_id`. Fiscal-year-sensitive reads/writes resolve and return an explicit fiscal year, even when upstream has a default. Multi-company analysis takes an explicit allowed list. Batch writes are divided into company-specific groups; each item retains its company. Reject ambiguous company selection.

Use ISO dates (`YYYY-MM-DD`) for business dates. Use UTC timestamps for events/expiry. Interpret business periods using the company's verified fiscal year and Europe/Stockholm where appropriate, never the host machine's timezone. Allow non-calendar fiscal years and fiscal-year boundaries.

Money is canonical decimal text in our schemas, with currency separately identified. Validate provider precision/scale before serialization. Dates, enumerations, references and bounds are checked at runtime. Unknown write fields are rejected; new upstream read fields may be ignored safely until modeled.

## Common result envelope

Illustrative shape, not an implemented endpoint:

```json
{
  "status": "ok",
  "company_id": "company_demo_a",
  "data": {},
  "evidence": {
    "fiscal_year_id": "year_demo_1",
    "retrieved_at": "2026-10-18T03:00:00Z",
    "sources": [],
    "complete": true,
    "warnings": []
  },
  "continuation": null
}
```

For lists include count, page/continuation and coverage. For batches return item-level outcomes and aggregate counts; never report success merely because some items succeeded. For writes return provider identifiers and reconciliation state. Keep large raw documents/files outside model-visible text unless requested and permitted. Return concise text plus structured content and valid output schemas.

Continuation handles are owner/company/query-bound, bounded and expiring. A handle must not let another user change the company or increase authorized scope.

## Error taxonomy

| Code | Meaning/action |
| --- | --- |
| `AUTH_REQUIRED`, `RECONNECT_REQUIRED` | Authenticate/reconnect through the trusted flow |
| `COMPANY_FORBIDDEN` | Caller is not authorized for the company; no provider call |
| `CONNECTION_DISCONNECTED` | A previously authorized connection was explicitly disconnected; no profile or provider call. The old generation stays invalid after reconnection. |
| `CAPABILITY_UNAVAILABLE` | Missing implementation, scope, license or provider rights; distinguish these causes |
| `VALIDATION_FAILED` | Structured field/domain violations and remediation |
| `REVIEW_REQUIRED`, `CLIENT_UNSUPPORTED` | Required approval cannot yet be completed |
| `PROPOSAL_STALE`, `POLICY_CHANGED` | Re-prepare/review; do not execute old content |
| `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` | Retry guidance only where safe |
| `OUTCOME_UNKNOWN` | Mutation may have happened; reconcile before resend |
| `PARTIAL_RESULT` | Explicit incomplete read/batch with remaining work |

Preserve relevant Fortnox error code and a redacted message, together with a local correlation ID. Do not include tokens, raw request headers or unrelated company's data.

## Provider HTTP behavior

Fortnox describes 25 requests per 5 seconds, equivalent to 300/minute, per client/tenant. Implement a shared bounded limiter; separate installations using identical credentials may still share the upstream budget. Back off on 429 using provider retry metadata when available, otherwise jittered bounded backoff. Do not invent a `Retry-After` guarantee.

Read pagination and filters are endpoint-specific. The global parameter guide documents `financialyear`, `financialyeardate`, date filters and pagination; the supplied OpenAPI omits or inconsistently capitalizes some parameters. Use reviewed overlays and test cases. Never blindly forward provider-returned arbitrary URLs with credentials; restrict to approved Fortnox API origins/paths.

Classify by behavior, not HTTP verb: `/3/invoices/{DocumentNumber}/email` and `/eprint` are GET operations with external effects. PDF/print/reminder behavior must also be verified before assigning read-only status.

Use `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` accurately. Bounded private-account reads are not automatically open-world merely because Fortnox is hosted remotely. Sending to external recipients is open-world; retry safety must be proved per operation. See [sources](../reference/sources.md).

### Selected accounting references

`get_accounting_references` accepts optional `account_numbers` (1–20 distinct
integers, 1000–9999). No provider URL, implicit account or company is accepted.
Its output echoes the sorted `account_numbers` when present; completeness then
covers that selection, not the entire chart. Without it, existing bounded list
behavior is preserved. This read adds no approval or financial write capability.

### Receipt attachment operations

M16 adds default-off `upload_receipt_file` and `link_receipt_attachment` tools
with strict company/batch/hash/item inputs. They mutate file/link state only;
neither accepts a replacement voucher, URL or model-supplied approval. Successful,
failed-with-proven-no-effect and unknown step outcomes are distinct.
`get_receipt_attachment` and the authenticated attachment resource require an
explicit company, fiscal year, voucher series/number and opaque provider file ID.
They verify the owning voucher and exact file relationship and return bounded
original bytes. Discovery omission never replaces execution-time authorization.
Provider contracts and missing evidence are in the
[receipt-operation ledger](../reference/mvp-receipt-operations.json).

M17 registers `commit_reviewed_receipt_item` as app-only with a private capability,
and `create_receipt_item` only for explicitly owner-selected client-managed policy.
Both use the same financial service. `resume_receipt_batch` accepts the immutable
batch reference and 1–10 distinct selected item IDs. It never uploads or creates a
voucher; it reconciles exact known references and repairs only remaining links.
`review_receipt_item_again` rotates capability metadata for a still-live,
unexecuted immutable item without approving it. Status reads never mint a new
capability. None of these routes accepts replacement content or `confirmed`.

### Connection diagnosis

`diagnose_connection({ company_id })` requires `mcp:read` and the existing durable
owner/client/company-generation grant. Owner UI diagnosis uses the same service
under its authenticated owner session and exact Origin. Fixed statuses are
`available`, `disconnected`, `missing_permission`, `upstream_error`,
`not_implemented`, `verification_blocked`, `unknown`. Results contain a random
correlation ID, timestamp and fixed per-capability status/reason codes, never
provider bodies, credentials or company profile data. Missing local scopes are
known; an upstream 403 means `permission_or_license_unknown`, not a guessed
license diagnosis. In allowlisted test mode only, the existing companyinformation
read uses the shared Fortnox HTTP budget, bounded retries and token lifecycle.
Authorization is rechecked after I/O. Successful diagnosis verifies that bounded
read only; it activates no financial/file operation. The fixed M14 file-only
experiment catalog is unchanged. Existing local documentation tools remain local
and do not acquire a provider proxy or activate operations from OpenAPI content.

### S04/S05 business write preparation

The internal business dispatcher accepts only registered domain operations and
never exposes an HTTP method/path/body proxy. Future focused tools use strict
`company_id`, `proposal_id` and `proposal_hash` references. Prepared bodies bind
the initiating client, current company generation/policy and operation; execution
revalidates source state. Standard client approvals do not authorize manual
vouchers or override read-only, restore, provider or ownership checks.
See [the foundation evidence](../implementation/S04-S05-business-writes.md).

`applied_different` is a terminal known-effect result, distinct from intended
success and from uncertain delivery. It requires a retained exact provider-response
reference, exact-ID readback, and operation-specific evidence that stable identity
fields match. The expected digest must equal the immutable execution evidence;
the observed digest must differ. Store only the two hashes and bounded changed
field names. Reconciliation may not introduce a different or previously unknown
reference to establish this result. Only explicitly implemented adapters can
classify it; generic mismatches remain unknown. The original intent is never
resent and its hash is never replaced. Show the discrepancy to the owner and
prepare any correction as a separate validated intent. This status establishes
neither successful intended content nor a cause for the observed difference.

### S04 register tools (isolated test profile only)

`list_customers`/`list_suppliers`/`list_articles` accept only their resource's
modeled query filters and bounded `start_page`. Detail tools require company and
exact `id`; price reads also require explicit price-list/article selection.
Reference collections have separate tools; missing permissions never become an
empty successful list. Paged reads without valid metadata remain incomplete.

`prepare_customer_create`/`prepare_customer_update` (and supplier/article
counterparts) accept strict resource fields. Execution tools take only the
immutable business reference. Updates display modeled before/after/diff and
revalidate the whole provider source version. Omission retains register fields;
empty values and `API_BLANK` do not provide an unverified clearing shortcut.

`reconcile_customer_create`/`reconcile_customer_update` and counterparts perform
only authenticated reads against trusted IDs. Exact field digests can establish
matching current state. Unknown identity, unproven mismatch or absence stays unknown;
no reconciliation tool resends. `get_register_write_status` reads only the
initiating client's durable proposal/execution. No tool supplies manual-voucher
approval, a provider URL, arbitrary method/body or bank instructions.

## Program selection and diagnostics (#117)

A company's local program/function selection is an additional authorization check
for accounting and register/file provider paths, including pre-dispatch rechecks.
Retained provider scopes cannot bypass local disable, read-only mode, restore
blocks, operation gates or client/company grants. Existing tool names and approval
boundaries are unchanged. `diagnose_connection` adds manifest-derived `programs`
summaries; OAuth connection, operation verification and unknown license/permission
causes remain separate. No model-callable program administration tool is added.

### S05 focused sales tools (default-off service)

`list_offers`/`list_orders`/`list_invoices` use resource-specific filters and bounded
pagination. `get_offer`/`get_order`/`get_invoice` require an exact company-bound
ID and return the whole-source version, projected rows, nullable observed states,
exact reported amounts and explicit completeness/editability. A summary is never
an editable full document or a source of invented defaults.

`prepare_<resource>_<action>` stores immutable content and full row diffs.
`create`/`update`/`email`/`bookkeep`/`credit`/`cancel` and supported `to_order`/
`to_invoice` executions take only the business reference. Reconciliation updates
local execution metadata from exact readback and is annotated as a local
mutation. Email is an external effect; its uncertain result cannot be resolved
from a Sent flag alone. No eprint, e-invoice, reminder or bank-initiation tool is
registered.

The ordinary product registers none of these tools. The separately selected
S04/S05 test entry permits at most six document read operations and refuses write
activation. Contracts, evidence and outstanding acceptance are in the
[S05 record](../implementation/S05-documents.md) and
[operation ledger](../reference/s05-sales-operations.json).

### Bounded payroll-input writes (disabled by default)

`prepare_salary_transaction_create`, `_update` and `_delete` accept strict
resource-specific fields/version selections. They return an encrypted immutable
business reference and complete modeled before/after/diff. Corresponding
`create_salary_transaction`, `update_salary_transaction` and
`delete_salary_transaction` tools take only that reference. Each effect and its
`reconcile_salary_transaction_*` tool is registered only when independently
enabled. `get_salary_transaction_write_status` performs an authorized local read.
Preparation mutates bounded local state; execution consumes a single intent.
No payroll calculation, payslip, tax calculation or payout is exposed.

The first provider write adapter accepts only trusted company/employee/date/code-11
profiles with separate action evidence, a verified unit amount and quantity
precision. It rechecks active employment and applicable dated hourly pay before
execution. Missing evidence, changed wages, dimensions/expenses/nonzero VAT or
unmodeled source fields prevent editing. Exact response identity and readback
are required; known numeric discrepancies remain distinct from success. Delete
requires the verified acknowledged final response and exact-ID not-found
readback. A lost delete acknowledgement cannot be resolved by absence alone.
The ordinary product and existing leased read-only profile enable none of these
write operations; operator probes and SDK evidence are separate from ChatGPT
acceptance.

The salary DELETE contract does not declare a response-body schema. A verified
final status with bounded empty or valid JSON content is an acknowledgement;
recognized ErrorInformation, malformed JSON, 202 or a lost response remains
unknown. It still requires exact not-found readback. An operator's already
captured final-200 receipt may reconcile its original intent/hash by a later
exact read; no tool accepts status assertions or a replacement row identity.

`list_financial_accounts` returns at most 100 chart records with company/year
and first-page-anchor-bound continuation. A continued page rechecks that anchor
and reauthorizes the connection generation. Missing balances remain null. Page
exhaustion is separate from whole-collection completeness, and chart completeness
never asserts verified balance units or financial reconciliation.

`compare_financial_periods` takes explicit left/right company/year/date
selections and 1–50 shared accounts. It performs both authorized reads and
returns separate reports plus exact right-minus-left period differences when
currency, mapping, calculation version and returned account identities match.
It accepts no caller-supplied reports or completeness assertions. Both companies
must remain authorized through completion; no currency conversion or statutory
consolidation is performed.

A payroll preparation binds the validated employee/code reference profile and
its operation evidence. A changed verification profile requires preparation
again, including when the intended amounts remain valid under the new profile.
