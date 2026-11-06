# MCP tool and provider contract

Milestone 2 adds implemented experimental `list_companies`, `get_connection_status` and test-only `get_company_profile` with strict schemas, durable authorization and structured errors. Profile execution remains disabled outside explicit two-tenant acceptance mode. See [evidence](../implementation/M02-connections-evidence.md).

Most names below are proposed public contracts to finalize in S03. The opt-in
[local documentation entry](../developer-tools.md) implements `search_api_docs`
and `read_api_doc` plus `describe_api_operation`, with no provider operation. Other product tools remain
unimplemented. The isolated [S00 spike](../../spikes/s00-mcp/README.md) exposes only `read_synthetic_status`, a fixed company-independent fixture with strict input/output schemas and read-only, non-destructive, idempotent, closed-world annotations. It is not a provider operation or public product contract.

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
