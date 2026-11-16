# Catalogue-driven Fortnox REST bridge

Wire version: `fortnox-bridge-catalog-v1`. Scope: S03 REST transport, shared
S04–S09 policy/validation and S11 installation. This is a generic execution
interface, not a claim of verified provider coverage for every catalogue entry.

## Activation and authority

Both `REST_API_ENABLED` and `REST_BRIDGE_ENABLED` must be true. The bridge is
absent from ordinary installations until explicitly enabled. It uses the existing
`<PUBLIC_ORIGIN>/api/v1` OAuth resource, selected-company consent and active
subject/client grants. MCP, administration and provisioning credentials cannot
authorize it. Cross-origin browser access is not enabled; consumers use backend
requests without owner cookies.

`api:read` and the separately consented `api:bridge` are required throughout.
Existing REST read grants cannot acquire native register/financial access simply
because the installation enables the bridge. Classified financial operations additionally
need `api:finance:read`, actions need `api:write`, and file operations need
`api:files`. Company membership, program selection, granted Fortnox scopes,
read-only policy, connection generation and restore blocks remain authoritative.
Migration 0009 expands only known API resource policies, not registrations,
consents or existing token families. Register the consumer with the expanded
scopes and consent again; create a dedicated registration if an older client's
registered scope ceiling cannot be updated through its supported management flow.
Disabling the bridge stops its routes even for previously authorized tokens.

## Private catalogue

An owner prepares an authorized private OpenAPI input using
`npm run prepare:bridge-catalog -- /private/openapi.json /private/review.json`.
The command creates a new 0600 file and never overwrites one. Every entry starts
unavailable, with no scopes and conservative action/finance/file classifications.
No source or derived catalogue is included in public bundles or release packets.

The bundle contains `version`, the original `specification` JSON string,
`source_sha256` and an `operations` review array. Every source operation must have
exactly one review, matching `operation_id`, uppercase `method` and `path`.
Each review declares `scopes`, `effect` (`read`/`write`), `finance`, `files`,
`manual_vouchers` (whether an operation can change manual accounting rows),
`reconciliation` (`none` by default, or independently reviewed
`exact_existing_target` for an existing-target replacement),
`credentials` (`company_oauth`/`specialist`) and nullable `unavailable`.
Unavailable reasons are `specialist_credentials_required`,
`domain_validation_required` and `unsupported_media_type`. An executable entry
needs at least one verified Fortnox scope and `credentials: "company_oauth"`.
Specialist credentials are not provisioned by this interface.

Review actual effects, schema completeness, licenses, domain requirements and
recovery semantics before clearing `unavailable`. An HTTP GET is not evidence of
a read: delivery/print actions are always mutations. Non-GET/HEAD operations
cannot be labelled read. Known financial/file families cannot lose those guards;
manual-voucher paths cannot be relabelled to bypass company policy. Missing or
unsupported validation is a reason to leave an operation unavailable.

The protected owner installs the bundle with exact-origin, authenticated
`PUT /admin/fortnox/bridge-catalog`, `Content-Type: application/json`. API tokens,
members and additional administrators cannot install it. GET returns only the
revision and operation count. The bundle is bounded to 8 MiB, 1,000 operations
and the existing source-parser budgets.
The private stored bundle is gzip-compressed, capped at 1 MiB compressed and
8 MiB decompressed, to bound cold-start D1 reads. A complete staged upload atomically
replaces the active pointer. Two fixed chunk slots bound storage, including
interrupted uploads. Partial/mismatched chunks fail closed. A revision hashes
both source and review; changing review alone fences ongoing execution.

Source schemas are private operational installation inputs, not AGPL project
source or executable instructions. They cannot choose the upstream host, tokens,
tenant or authentication headers. External schema references are never fetched.
Catalogue coverage and actual provider verification remain separate.

## Native HTTP interface

`<METHOD> /api/v1/companies/{company_id}/fortnox/{provider_path}` mirrors the
catalogued provider method/path, query and body. For example:

```http
POST /api/v1/companies/{company_id}/fortnox/3/customers
Authorization: Bearer <API access token>
Content-Type: application/json
Idempotency-Key: <new UUID>

{"Customer":{"Name":"Synthetic customer"}}
```

Use literal slash-separated path segments. Absolute URLs, encoded separators,
double encoding, traversal, method overrides, tenant overrides and credential
headers are rejected. Requests only target `https://api.fortnox.se`; provider
redirects are never followed. Unknown paths return 404, uncatalogued methods 405,
and missing capabilities 403. Only documented query/header parameters are used.
Duplicate scalar parameters are invalid. Unsupported parameter encodings and
schema assertions fail closed; new upstream operations require a new review.

JSON is parsed for validation with exact decimal lexemes and forwarded as its
original bytes. Duplicate keys, non-finite/oversized numeric representations and
unmodelled object properties are rejected. No defaults, balancing rows, accounts
or tax decisions are invented. Numbers are bounded to 48 integer and 18 fractional
digits. Request bodies are at most 1 MiB; provider responses at most 2 MiB, with a
15-second provider request timeout and shared client/tenant pacing.
Consumers of native numeric JSON must also use exact number parsing; ordinary
JavaScript `Response.json()` can round amounts. The normalized read API keeps
its separate decimal-string contract.

JSON media types and validated PDF/PNG/JPEG multipart/binary inputs are supported.
Unsupported media types or file profiles fail rather than passing unchecked
bytes. Native response bytes and final HTTP statuses are preserved. Responses
strip cookies/authentication headers, use no-store, nosniff and restrictive CSP.
Provider links are data and never become executable server requests.

Document replacements (`PUT`/`PATCH` on invoice/offer/order details) require the
bridge ETag from a current GET in `If-Match`. They require an explicit row list;
all original row IDs must remain represented unless explicitly named in
`X-Fortnox-Removed-Row-Ids` (comma-separated). No row deletion is inferred from
an incomplete summary. Source changes return conflict.

Manual voucher creation additionally requires explicit `financialyear` and
`X-Fortnox-Currency: SEK`, since the existing domain profile requires a currency.
Account, voucher and SIE requests require an explicit positive `financialyear`;
the bridge never silently selects the provider's current fiscal year.
The supported bounded row shape maps to the same `Bookkeeping.validate` path as
MCP, including current company/year/account/series/lock/dimension rules and exact
balance. Missing amounts and unsupported correction/row fields fail. In
`review_required`, execution returns `REVIEW_REQUIRED`; complete the existing
trusted review flow. Voucher editing/deletion remains unavailable until its
domain implementation exists. No API call can approve itself or change policy.

## Execution and recovery

Every action, including effectful GETs, requires a UUID `Idempotency-Key`.
Retain it with the exact logical input before dispatch. The durable claim binds
owner, subject, stable OAuth registration, API resource, company, canonical
request hash, reviewed catalogue, connection generation and policy. The hash
includes body bytes, query, content type and effective conditional/domain headers.
Concurrent requests can dispatch the claim only once. Token refresh/reapproval
does not create a new key namespace.

Initial acknowledged success returns the native response plus
`X-Fortnox-Execution-Id` and `X-Fortnox-Execution-State`. Repetition returns the
existing execution status, not a retained copy of its financial response.
Changed input with the same key returns `IDEMPOTENCY_CONFLICT`. Missing,
malformed, interrupted, oversized or uncertain provider acknowledgements remain
`outcome_unknown`, including 202 and unclassified provider errors. No action is
automatically retried, even following a 401, timeout or lost client response.
A failure proven to precede the provider dispatch is recorded as `failed`.
An interrupted claim is still unknown after restart; absence of a dispatch
marker in a restored snapshot is not proof that no write occurred.

`GET /api/v1/companies/{company_id}/bridge/executions/{execution_id}` returns
execution ID, state, provider status and optional trusted reference. Only the
originating subject/registration with current company authority can read it.
`POST .../{execution_id}/reconcile` accepts `{}` and requires write permission.
The supported generic recovery is an exact desired-field readback of an existing
PUT target without query parameters. The target must have been successfully read
before the original dispatch and the operation explicitly classified
`exact_existing_target` in the review. It retains field shape and digest, not
financial values, and uses the originally bound catalogue and generation.
Active submissions cannot be reconciled for two minutes. A changed/missing
target, unavailable evidence or catalogue mismatch leaves the result unknown.
Creating, sending or deleting cannot be reconciled from matching values or
absence alone. Reconciliation never resends the action.

Uncertain bridge executions block further company writes through both bridge
and existing business/bookkeeping/receipt paths. Status and authorized reads
remain possible. Restore preserves unknown records and marks submissions unknown.
There are at most 32 retained bridge executions per company; terminal metadata
expires after 30 days, while unresolved records are never automatically evicted.
Capacity rejects before dispatch. After terminal retention, an old key cannot
prevent duplication: reconcile against Fortnox before starting another action.
This is local duplicate prevention, not an exactly-once provider guarantee.

## Discovery and evidence

`GET /api/v1/companies/{company_id}/bridge/operations` reports catalogue revision,
method/path, scopes, effects and company-specific availability/reasons. No private
specification, credential or request body is returned. OpenAPI describes this
project's bridge and management routes, not a redistributed Fortnox API.

See [implementation/evidence](../implementation/REST-bridge.md) and
[Swedish guide](../users/rest-brygga.sv.md). No new operation is promoted to verified
provider support by importing or enabling a catalogue.
