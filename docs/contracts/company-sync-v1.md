# Company sync v1

Wire version: `company-sync-v1`. Scope: S03/S04/S11. This is a consumer-owned
latest-state synchronization contract, not a backup, financial replica inside
Fortnox MCP, or an atomic provider snapshot. See [implementation/evidence](../implementation/company-sync.md)
and [Swedish instructions](../users/synk.sv.md).

## Authorization and activation

`REST_SYNC_ENABLED=true` requires `REST_API_ENABLED=true` and
`REST_BRIDGE_ENABLED=true`. All default off. A private source-bound reviewed
bridge catalogue is required for available content reads. Use a dedicated
confidential OAuth registration, authorization code/S256 PKCE, API resource
`<origin>/api/v1`, scopes `api:read api:bridge api:finance:read offline_access`,
and explicit company consent. The separate MCP registration and
`company-onboarding-v1` are unchanged. Verify the already known company UUID
against `/api/v1/companies`; never select the first returned company.

Current user, membership, client approval, company generation/access revision,
provider scopes and program rights apply before I/O and before results return.
Refresh requires the existing offline policy; it never widens authorization.
No write, file, generic MCP proxy or owner-administration capability is added.

## Manifest and native content

`GET /api/v1/companies/{company_id}/sync/manifest`, without query parameters,
returns `version`, `company_id`, `generation`, `access_revision`,
`catalog_revision`, `manifest_revision`, `resources` and `realtime`.

Fixed resource IDs:
`financial_years`, `accounts`, `voucher_series`, `vouchers`,
`customer_invoices`, `supplier_invoices`, `customer_invoice_payments`,
`supplier_invoice_payments`, `customers`, `suppliers`, `projects`, `cost_centers`.

Each resource contains `available`, `reason`, `required_scopes`,
`support_status`, `provider_access_verified`, native bridge `list_path` and
`detail_path`, `path_parameters` (path variable to record field),
`collection_envelope`, `detail_envelope`, `identity_fields`, `year_required`,
`pagination`, `lastmodified`, `event_topic` and `event_support`.
Availability requires reviewed list/detail operations and present authorization;
it does not claim live Fortnox verification or prove a licence. Provider 403s do
not identify an exact missing licence. Current profiles are `implemented_unverified`.

Use only the available reviewed bridge reads. Retrieve every list page and
detail where rows/full records are needed. Pagination uses `page` and `limit`
(recommended 100), `MetaInformation.@CurrentPage` and `@TotalPages`.
Independently reviewed global read parameter overlays apply only to these paths;
year-dependent accounts, vouchers and series require explicit positive
`financialyear`. Voucher identity is year/series/number. Annual balances come
from account records; missing amounts never become invented zero.

The bridge retains native exact-number JSON and its 2 MiB/15-second transport
bounds and shared tenant pacing. Consumers must parse amounts without float
rounding. Oversized responses fail rather than truncate. No resource currently
advertises `lastmodified`; use full listing until an endpoint-specific delta
profile has documented verification. A successful final page is not an atomic
ledger snapshot. Retry only authorized pure reads; never effectful GETs/actions.

## Changes

`GET .../sync/changes?cursor=<opaque>&limit=100&wait_seconds=20` accepts optional
cursor, limit 1–100 (default 100), and wait 0–20 seconds (default 0). Duplicate
or unknown query parameters fail. Node supports bounded long-poll with token
rechecks and cancellation. Worker returns immediately with realtime unavailable.

The response contains the manifest's version/company/revision bindings plus
`events`, `next_cursor`, `has_more`, `resync_required`, `resync_reason` and
`realtime_status`. Events contain `event_id`, `company_id`, `resource`, `action`
(`upsert`, `delete`, `rescan`), `identity` and `occurred_at`; payment signals can
also carry a provider-supplied `related_invoice`. Event IDs are stable digests
of integration/topic/offset/resource. Duplicate delivery remains possible.

Without a cursor, events are empty and `resync_required=true` with reason
`initial_baseline`; `next_cursor` identifies the current tail. Persist this
cursor **before** the baseline, finish full reads, then replay changes. On any
reset, save the new tail first and repeat this process. A cursor never proves
complete financial state. Commit the consumer's inbox/checkpoint atomically.

Authenticated encrypted cursors bind owner, subject, stable OAuth registration,
company, generation/access revision, manifest revision and journal epoch. They
survive normal token rotation. Invalid/foreign cursors fail 400; expired cursors,
changed source, reset epoch and retention gaps explicitly require resync. Cursor
lifetimes are seven days, renewed on successful reads. Resource authorization
is checked again and unavailable resource signals are not exposed.

Retain at most seven days or 1,000 events/company and 20,000/installation.
Trimming moves a durable floor; a cursor behind it cannot silently skip events.
Operational restore and credential-key rotation clear events/offsets and rotate
journal epochs. Journal bodies are excluded from Node snapshot copies. No
financial values, raw provider messages, tokens or credentials enter the journal.

## Node realtime and consumer recovery

`FORTNOX_EVENTS_ENABLED=true` additionally opts Node/Docker into one outgoing
`wss://ws.fortnox.se/topics-v1` socket per integration, shared across its active
verified companies, under the existing installation lock. Child tenants are
disabled. Token renewal updates tenants on the existing socket. Connection,
credential, catalogue and company changes are rechecked every 30 seconds.
Unknown/malformed messages fail closed or request resource rescan, never vanish
as successful processing. Provider command replies can echo tokens and are never
logged, persisted or returned. A message's derived signals and opaque upstream
offset commit atomically; persistence failure closes the stream before resuming.

Fortnox documents per-topic offsets, possible duplicates and at most 14 days of
replay. Missing/stale topic offsets or changed membership trigger explicit journal
reset on reconnection. Quiet topics without an offset therefore conservatively
require a baseline after an actual disconnection; normal token renewal preserves
the socket. Provider replay is not proof of completeness.

Annual account/voucher events currently request resource rescan because event
`year` is not verified as the REST fiscal-year ID. Unknown versions or incomplete
identities also request rescan. Supplier payments and voucher series have no
advertised event topic. A delete signal is a retrieval hint; confirm deletion
with an authorized detail read or complete reconciliation. Scope/licence errors
and partial reads never delete the consumer's copy.

M2X's agreed defaults are WebSocket-triggered reads, hourly fallback polling,
nightly full reconciliation, and a 60-second realtime target under normal load.
Those jobs and the latest-state database belong to the consumer. Worker supports
the same manifest/native reads and journal contract but advertises
`realtime.status=unavailable`; this delivery adds no Worker socket coordinator.
