# Read API contract

Optional [company synchronization](company-sync-v1.md) adds resource discovery
and bounded change signals using separately consented API bridge/finance reads.
It keeps the existing MCP onboarding registration separate.

The separately enabled [native REST bridge](bridge.md) adds catalogue-bound
actions and files with explicit `api:bridge` plus `api:write`/`api:files` consent
where applicable. Statements below
about GET-only routes and no write/file permissions describe the original
normalized read resources, not the separately guarded bridge namespace.

The opt-in `/api/v1` JSON API and new financial MCP tools call shared TypeScript
services. REST adds no provider coverage by itself. See [implementation and
verification](../implementation/REST-read-api.md), [developer integration](../rest-api.md)
and the [operation ledger](../reference/read-api-operations.json).

## Identity and consent

REST is disabled unless `REST_API_ENABLED=true`. OAuth uses the existing
authorization server, authorization code with S256 PKCE, exact allowlisted HTTPS
redirects and rotating refresh tokens. The API resource is `<PUBLIC_ORIGIN>/api/v1`;
its protected-resource metadata is `/.well-known/oauth-protected-resource/api/v1`.
The issuer remains `<PUBLIC_ORIGIN>/auth`. Discovery is public; all API routes,
including capabilities and OpenAPI, require an active API bearer token.

`api:read` permits authorized company metadata and existing references.
`api:finance:read` additionally permits independently enabled financial reads.
`offline_access` permits the existing bounded refresh flow. API scopes grant no
write, file or owner-administration capability. Wrong-resource, mixed-protocol,
expired/revoked tokens and inactive owners fail. With optional team access enabled,
active administrators and members can approve API access using their own accounts.
Member selections are limited to current company assignments; registrations and
approvals are bound to the actual subject. Blocking, deactivation and membership
revision changes invalidate existing member API tokens and refresh families. Admin cookies are not API
authorization. Cross-origin browser requests are not enabled in this version.

REST consent names data categories and lists active companies for explicit
selection. OAuth approvals reuse the current immutable `oauth-approval-grants`
and token-family revisions, with an explicit `resource` binding (missing means
legacy MCP). Reapproval replaces the client's previous family; a dedicated client
registration per transport is recommended. API approvals retain selected company generations and access revisions unless
an owner or installation administrator explicitly approves `owner_connections`.
That mode resolves current and future owner connections on each request, including
an initially empty installation. Ordinary members retain explicit assigned-company
selection. External onboarding remains a distinct selected-company flow. Existing
selected grants require explicit upgrade or reapproval, without a new registration. Internal legacy API grants use `api-company-grants-v1`, separate
from legacy MCP. Reconnection/access changes invalidate the selected version.
Revoked tokens fail even while a retained grant remains stored.

New financial MCP tools require `mcp:read` and `mcp:finance:read`. Migration 0008
advertises the optional scope only on known MCP resource policies. It changes
no client, consent, access-token or refresh-token scopes. Custom policies remain
unchanged. Adapters convert verified OAuth into owner/client/resource/domain
permissions. Services check current permission, company grant and connection
generation before I/O and before returning data. REST also revalidates its token
after I/O. Provider secrets remain on the installation. Internal prerelease MCP
callers retain a compatibility conversion; API identities never gain write/file
permissions through it.

## Resources

Paths are relative to `/api/v1`. Only `GET` is supported; authenticated other
methods receive 405 with `Allow: GET`. Unknown routes receive 404.

| Path | Operation |
| --- | --- |
| `/capabilities` | `get_capabilities` |
| `/companies` | `list_companies` |
| `/companies/{company_id}/connection-status` | `get_connection_status` |
| `/companies/{company_id}/profile` | `get_company_profile` |
| `/companies/{company_id}/financial-years` | `list_financial_years` |
| `/companies/{company_id}/financial-years/{financial_year}/accounting-references` | `get_accounting_references` |
| `/companies/{company_id}/customer-invoices` | `list_invoices` |
| `/companies/{company_id}/customer-invoices/{number}` | `get_invoice` |
| `/companies/{company_id}/supplier-invoices` | `list_supplier_invoices` |
| `/companies/{company_id}/supplier-invoices/{number}` | `get_supplier_invoice` |
| `/companies/{company_id}/financial-years/{financial_year}/vouchers` | `list_vouchers` |
| `/companies/{company_id}/financial-years/{financial_year}/vouchers/{series}/{number}` | `get_voucher` |
| `/companies/{company_id}/financial-years/{financial_year}/accounts` | `list_accounts` |
| `/companies/{company_id}/financial-years/{financial_year}/accounts/{number}` | `get_account` |
| `/openapi.json` | Independently authored OpenAPI 3.1 document |

Company IDs are local UUIDs. Fiscal years are explicit positive provider IDs,
not guessed calendar years. Customer invoice identity is `DocumentNumber`;
supplier identity is `GivenNumber`, not the supplier's invoice number. Voucher
identity includes year/series/number. Account numbers are integers 1000–9999.
No arbitrary path, URL, method, body or provider-returned link is executable.
Unknown query fields, path/query overrides, duplicate scalar parameters and
invalid IDs/limits fail with 400. Existing account-reference selection uses
repeated `account_numbers` query parameters. Additional search/delta filters are
outside this version.

## Results, budgets and precision

Success is `{status:"ok", company_id?, data, evidence, continuation}`. Evidence
contains UTC retrieval start/end timestamps, sources, completeness, warnings and
an explicit financial year where applicable. New financial lists return
`{items,count}`; details return modeled records. Existing MCP formats are retained.

New financial lists accept `limit` (1–100, default 100) and optional UUID
`continuation`. Each request reads one upstream page. Continuation requires the
same operation/company/year/limit and is bound to owner, client, resource and
connection generation. Cursors expire after ten minutes, survive runtime
recreation, store only paging metadata and require current authorization.
At most 32 live financial cursors per owner are stored; maintenance removes them
after expiry.

`complete=false` with a cursor means further pages remain. `complete=true` marks
the last page of that traversal, not an atomic snapshot or a whole ledger in one
response. Existing years/reference reads retain their five-page/500-item budgets
and can report incomplete results without a continuation.

The shared adapter has a 15-second read budget, bounded retries, shared
client/tenant pacing and a 64-KiB response limit. Oversized/malformed responses
fail rather than dropping rows. Reducing `limit` can help lists; oversized single
documents are explicitly unavailable in this version.

Provider money is parsed from original numeric lexemes before binary floating
point conversion. Public amounts/quantities are decimal strings bounded to 48
integer and 18 fractional digits. Unsupported formats fail closed. Missing
amounts are `null`, never invented zero. Currency is provider-supplied; absent
account/voucher currency is `null`, not assumed SEK. No currency conversion occurs.

Annual balances map directly to `BalanceBroughtForward` and
`BalanceCarriedForward` for the requested year. Inactive/custom/zero-balance
accounts remain visible. These are not arbitrary-date balances. Invoice status
is the provider's current observation, not historical payment reconstruction.
Voucher read schemas preserve returned rows, including removed rows, separately
from manual-voucher creation validation.

## Errors and activation

Errors are `{status:"error",error:{code,reason,provider_code,correlation_id}}`.
Raw provider payloads, parser messages, credentials and headers are never returned.

| HTTP | Meaning |
| --- | --- |
| 400 | Invalid caller input |
| 401 | Missing/invalid/expired/revoked API authorization; resource challenge included |
| 403 | Company denied, missing permission/scope or unavailable capability |
| 404 | Unknown route or missing detail after company authorization |
| 409 | Disconnection or reconnection/conflict requiring intervention |
| 429 | Shared read/rate budget exhausted |
| 502/503 | Provider failure, malformed data or unavailable service |

Responses use `Cache-Control: no-store`. An upstream 403 cannot establish the
exact missing license and retains an unknown cause rather than becoming 404.

Financial modules default off. `FINANCIAL_READ_MODULES` accepts
`customer_invoices,supplier_invoices,vouchers,accounts` only in explicit test mode
with configured test tenants. The provider independently enforces that tenant
allowlist. Flags permit evidence collection, not verified production support.
Capabilities list only enabled, permitted operations with a suitable active
granted connection; execution-time checks remain authoritative. Financial writes
and file activation are unchanged.

## Persistent installations

[Installation access](installation-access.md) adds separately approved confidential
backend clients, five-minute client-credentials tokens, the finance profile and
optional writes through the common reviewed bridge. The opt-in installation
feature enables the implemented normalized finance modules without the historical
test-tenant restriction; actual provider acceptance remains separately tracked.
The legacy `FINANCIAL_READ_MODULES` test profile retains its own tenant restrictions.

Optional [Office contacts](office-contacts-v1.md) adds three separately consented,
backend-only normalized contact reads. Finance access alone grants no contact access.
