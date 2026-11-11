# API coverage plan

Sales recovery #131: explicit provider null CC/BCC now use the existing empty
copy-recipient representation during reads and content reconciliation. Raw
source versions, strict recipient/write checks and unknown-intent retention are
preserved. See the [contract](../contracts/tools.md#s05-focused-sales-tools-default-off-service)
and [bounded evidence](../implementation/S05-documents.md#empty-copy-recipient-recovery--2026-11-11).
This changes no operation's verification classification; recipient-free drafts
in #130 and broader lifecycle/provider acceptance remain separate.

Actual acceptance update (2026-11-11): [the implemented-function audit](../implementation/acceptance-audit-2026-11-11.md)
records native ChatGPT review, bounded register writes/readback/cleanup,
selected references, explicit validation failures and partial financial reads.
The consent-overlap defect #127 and bounded empty-copy recovery defect #131 are
resolved with actual reviewed cleanup. Stale-generation native reconnect is
tracked in #129 and remaining sales editability in #130. Actual two-PNG staging
and authenticated UI readback passed, while disk output remains incomplete.
The first reviewed receipt upload is retained as unknown before voucher creation;
#134 tracks its missing positive reconciliation. Broader provider, financial and
recovery gates retain their missing evidence. No operation is promoted to fully
verified support by this bounded audit.

Browser-consent recovery: one Fortnox flow per authenticated admin session is
reserved atomically before provider navigation. Independent sessions retain
bounded concurrency. This changes connection UX, not provider-operation
verification; see the [authentication contract](../contracts/authentication.md).

Current activation: the owner removed ordinary product test/verification
activation restrictions on 2026-11-11. See [the activation decision and runtime
boundaries](../implementation/product-activation-2026-11-11.md). Dated milestone
records below retain their original evidence; activation does not promote it.

Nova merge-to-main deployment adds infrastructure automation only; it changes no
provider coverage or activation gates. Public deployment acceptance is recorded
separately from Fortnox and client acceptance in the
[Nova runbook](../deployment-nova.md).

The [owner's 2026-11-09 MVP acceptance and release authorization](../implementation/M05-release-authorization-2026-11-09.md)
permits a bounded prerelease after green CI. This decision changes no operation
classification or default activation gate; actual scenario evidence remains scoped.

M05 adds protected Hono/React owner setup, write-only encrypted Fortnox settings,
Swedish/English guidance and company policy/status management. This adds no
provider operation or support claim. Node/workerd authorization regressions and
desktop/mobile synthetic browser evidence are recorded in the delivery log.

Milestone 5 [Node runtime work](../implementation/M05-delivery.md) adds
configurable paths/listening, file-mounted secrets and explicit Nginx handling.
It enables no provider operation and does not complete installation acceptance.
The synthetic Docker/isolated Nginx/HTTPS and packaged maintenance smoke passed
on the owner-selected Linux host on 2026-11-08. Full owner/ChatGPT/Fortnox
acceptance remains pending; see the linked delivery evidence.
The persistent target-domain installation now also passes public TLS/health/setup,
OAuth discovery and proxy-boundary checks through the operator's existing Nginx;
the owner completed bootstrap/login/credential save and both allowlisted test
connections are active. A new client registration now has an exact two-company
grant, while the original grant remains unchanged. Public MCP handshake/discovery
passed. The owner reports successful company listing, diagnosis and profile reads
for both service/user test connections in a separate ChatGPT chat. A read-only
server inspection confirmed distinct allowlisted tenant IDs and separate encrypted
credential records. The shared sandbox organization number is expected according
to the owner. The owner also confirms denial outside the client's granted
companies without information disclosure. These are bounded owner-reported
observations; raw client traces/version and remaining isolation/lifecycle cases
remain pending. See the
[dated read evidence](../implementation/M05-delivery.md#owner-reported-client-reads-and-persisted-tenant-binding-2026-11-08).
These observations enable no financial or provider-file operation.

The subsequent [local Chrome lifecycle report](../implementation/M05-client-lifecycle-2026-11-08.md)
records reads before/after client disconnection/reconnection, saved-answer reload
and continued reads after access expiry. Read-only server metadata corroborates
refresh revocation and actual rotation after expiry on the same tested image.
Old-token rejection/replay, explicit tool reload and remaining client/provider/
receipt/recovery acceptance remain open. This does not promote provider coverage.

The [provider-renewal follow-up](../implementation/M05-token-renewal-2026-11-08.md)
records actual service reacquisition and user refresh rotation, persisted
replacements, tenant-checked profile readback and a subsequent Chrome read report.
Existing connections and gates were preserved. Old original MCP tokens were not
retained; isolated synthetic old-token checks do not establish original-client
replay acceptance or promote supported provider coverage. The unchanged image
passed all four isolated rejection cases and a valid-token positive control.

The [2026-11-09 issue review](../implementation/M05-issue-review-2026-11-09.md)
documents 51 related issues and six bounded implementation closures. This changes
tracking status only; all seven delivery PRs remain drafts, actual acceptance is
pending and no provider operation is promoted to verified support.

The [M14 client-file experiment](../implementation/M04-client-file-test.md) is a
separate time-bounded build exposing staging/original-readback and the three
company reads only. It is not ordinary product activation or provider support;
actual client-file evidence remains pending and the four file-provider operations
remain unverified/default-off. Existing OAuth grants are never widened.

The [explicit host-picker follow-up](../implementation/M04-file-picker-followup.md)
records the actual client's pre-call refusal and adds a company-authorized optional
picker using host file APIs. The new experiment catalog contains six tools;
ordinary product files remain off. Neither synthetic browser download checks nor
the earlier internal PDF preview establish actual product file acceptance.

Milestone 3 implements bounded reference transport, exact voucher validation,
encrypted proposals, durable execution and an MCP Apps view. [Evidence](../implementation/M03-accounting-evidence.md)
and the [accounting ledger](mvp-accounting-operations.json) separate synthetic
Node/workerd behavior from missing actual provider/ChatGPT acceptance. All new
provider operations remain `implemented_unverified`; product booking is disabled.

The reference follow-up adds `list_financial_years` so the caller can discover
real company-specific year IDs before requesting references. It also corrects
the documented `@CurrentPage`/`@TotalPages` pagination fields and
`VoucherSeriesCollection` envelope. This adds no provider operation to the
eight-operation accounting ledger and establishes no live financial acceptance.

The subsequent provider-contract follow-up preserves numeric account information
settings as explicitly `UNKNOWN`, blocking financial validation, and separates
provider/output schema errors from caller input errors. Diagnostics expose only
bounded known field paths, never provider values. This establishes no financial
rule mapping and promotes no operation to verified support.

A further account-contract check against a privately supplied source snapshot
handles optional information settings and normalizes the provider's named
`MANDATORY` requirement to the internal `REQUIRED` rule. Absent/null/numeric
information settings remain unknown and block financial validation. The local
snapshot is reference input only; it is neither redistributed nor generated
into product code. Actual reference acceptance remains open under #92.

The [milestone 2 product work](../implementation/M02-connections-evidence.md) adds owner/bootstrap, OAuth, encrypted connections, token lifecycles, disconnect/reconnect and three company tools with shared Node/workerd evidence. Provider operations remain disabled outside explicitly allowlisted test acceptance; the operation ledger distinguishes `implemented_unverified` from verified support.

The built product Worker also has a native-fetch consent regression in isolated workerd/D1 with a synthetic outbound provider. It verifies runtime transport wiring separately from the injected domain transports and does not establish live Fortnox acceptance.

Owner recovery includes a private D1 operator bridge and same-origin form. Native workerd tests verify imported library records, expiry/replay/origin denial, session revocation and stable owner identity; a CLI test verifies private output and redacted logs. Hosted owner redemption remains a separate acceptance step. M07/#61's bounded HTTP-adapter acceptance is complete; broader provider-operation acceptance remains under #75/#36.

The [default-off S00 file probe](../implementation/S00-files-evidence.md) now
has local Node/workerd/MCP/OAuth evidence for bounded two-file input, encrypted
temporary storage and authenticated output resources. Actual ChatGPT file
acceptance remains open. It adds **zero** enabled Fortnox operations.

This is a planning inventory, not a claim of implemented coverage. Machine-readable resource assignments are in [resource-inventory.json](resource-inventory.json); source identity is in [source-lock.json](source-lock.json).

The [S00 synthetic tool](../../spikes/s00-mcp/README.md) has offline transport/schema evidence only. It maps to no Fortnox operation and adds **zero** provider coverage. All provider modules remain disabled and `not_implemented`; the spike does not establish client or hosting acceptance. See the [S00 evidence](../implementation/S00-spike-evidence.md).

The [S01 foundation](../implementation/S01-evidence.md) adds exact-decimal primitives, identity/company checks and durable intent adapter tests. Its `read_synthetic_status` tool accepts only the `s01` fixture. No Fortnox operation is enabled, and neither these primitives nor successful synthetic transport tests establish financial or hosted-client acceptance.

The separate [S00 OAuth probe](../../spikes/s00-oauth/README.md) adds authenticated
synthetic tool access with local Node/workerd/D1 evidence. It enables **zero**
Fortnox operations. Live ChatGPT consent, a synthetic tool call and refresh
rotation succeeded; broader client and product-auth acceptance remain pending in
[its evidence record](../implementation/S00-oauth-evidence.md).

The local [G01/G02 maintenance follow-up](../implementation/S00-client-maintenance-evidence.md)
adds synthetic review status/recovery and browser regression coverage. It still
enables **zero** Fortnox operations and does not establish actual-host acceptance.

The [2026-11-07 owner review recheck](../implementation/S00-review-acceptance-2026-11-07.md)
adds actual ChatGPT synthetic approval and completed-card recovery reports,
corroborated by the same single consumed D1 record. Remaining host scenarios
keep G02 open. This changes no provider operation to `verified` and enables
no product bookkeeping.

## Snapshot inventory

The opt-in [S10 local documentation tools](../developer-tools.md) add search and
bounded reading of original guides and a private user-supplied OpenAPI snapshot.
They enable **zero** provider operations. A documentation entry is not a
supported executable operation, and input files/derived catalogs are not shipped.
`describe_api_operation` also reports all executable coverage as
`not_implemented`; eight source-specific documentation reviews do not change
that ledger or enable a corresponding action.

The [first Cloudflare installation slice](../implementation/S11-cloudflare-first-installation.md) adds only public infrastructure readiness checks. One hosted installation with new resources, migration and readiness was [verified in an existing account](../implementation/S11-cloudflare-evidence.md#hosted-installation-verification--2026-10-18). It enables **zero** Fortnox operations; the deployed test entry blocks MCP entirely. Fresh-account and lifecycle acceptance remain open.

The supplied OpenAPI 3.0.3 file contains 249 paths, 405 operations and 672 schemas. HTTP methods: 176 GET, 71 POST, 109 PUT, 9 PATCH and 40 DELETE. HTTP methods alone do not classify risk.

| API family | Operations | Initial treatment |
| --- | ---: | --- |
| Fortnox `/3` resources | 281 | Common workflow foundation plus explicit payroll/asset/finance limits |
| Warehouse | 83 | Extension module; no silent promise of full warehouse coverage in 1.0 |
| Company-order bank process | 14 | Restricted/specialist prerequisites; exclude by default |
| Bank process webhook | 6 | Restricted/specialist prerequisites; exclude by default |
| File attachments | 6 | Investigate access and need alongside classic inbox/archive/file links |
| Recurring billing | 10 | Extension module |
| Integration developer | 3 | Partner/developer prerequisites; separate from public documentation-search tools |
| Time reporting | 2 | Extension module; distinguish from payroll attendance inputs |

## Milestone 2 operation ledger

The [connection/read matrix](mvp-connection-operations.json) records independently written source hashes, fixed operation mappings, authentication, scopes, parameters, side effects and test references. All entries remain `implemented_unverified`; ordinary supported provider coverage is still zero. The test-only path is explicitly bounded to two owner-configured test tenants. `upstreamOperationId` and product rights/license evidence remain unverified where no authorized product source establishes them; missing evidence blocks supported activation.

Later MVP G06 acceptance is preserved in #92 (references), #93 (vouchers) and #94 (files). #75 covers milestone 2 only; full #36 is not closed.

## Required operation ledger during implementation

For each enabled operation record: stable local tool ID, source operation ID/path/method, source hash, scope/license requirements, company/year context, actual side effects, annotations, input/output schemas, validation rules, approval policy, retry/reconciliation behavior, file limits, test references and client/deployment support.

Permitted statuses: `not_implemented`, `implemented_unverified`, `verified`, `blocked`, `out_of_initial_scope`. Only verified operations may be advertised as supported. Resource-family completion does not imply every operation in that family is covered. Never claim "405 tools supported" from inventory generation.

## Explicit distinctions

- Standard invoice-payment registration is not bank payment initiation.
- Payroll input is not a complete payroll run, payslip engine or payout service.
- API documentation search is not the restricted integration-sales/ratings API.
- A scope present in developer settings may still need customer reconsent, a product license and appropriate provider user rights.
- The raw source includes demo/auth schemes and lacks security declarations for most operations. Do not auto-configure auth from those omissions/examples.

## Source updates

Compare new authorized snapshots against the locked hash. Review added/removed operations, parameters, schemas, security and side-effect descriptions. New write operations remain disabled until classified and tested. Keep versioned overlays for provider-documentation discrepancies with dated evidence. Source updates cannot silently weaken policy or broaden granted access.

## Milestone 3 hosted reference recheck

The [dated two-company operator evidence](../implementation/M03-accounting-evidence.md#hosted-two-company-read-recheck--2026-11-06)
records actual hosted workerd/D1 reads at source `e9f5a62`, separate service/user
token renewal and a foreign-company denial without provider I/O. Both reference
results were partial at the 500-account budget and contained unknown information
rules. This is bounded positive provider evidence, not supported financial
coverage or a product OAuth/ChatGPT reference acceptance. #92/#76/#93 remain open;
no operation changes to `verified` or default-enabled status.

## Selected account details

Optional explicit account selection adds one registered read,
`GET /3/accounts/{Number}`, to the nine-operation accounting ledger. Detail
responses bind number/year and expose named information settings when present.
Completeness of an explicit selection is separate from completeness of the full
chart. Domain validation/preparation/commit derive this selection from voucher
rows, bounded to 20 distinct accounts. Financial verification and trusted review
remain disabled pending their own evidence; #92/#76/#93 remain open.

The voucher payload follow-up emits exact decimal JSON number tokens and rejects
row information over 100 characters, matching the reviewed private source. Its
HTTP/body tests are synthetic; it adds no provider operation, financial live
evidence or supported/default-enabled behavior.

## Milestone 4 receipt implementation (in progress, 2026-11-07)

M14 adds default-off product file staging and authenticated output with Node/SQLite and local workerd/D1 behavioral tests, separate encrypted temporary storage and restart/expiry cleanup. Actual two-file ChatGPT acceptance remains pending. No Fortnox file operation or financial write is activated or counted as verified provider coverage. M15–M17, G08/#38 and file-specific G06/#94 remain in progress; [evidence and human test steps](../implementation/M04-receipts-evidence.md).

M15 adds separate receipt proposals/totals and a default-off embedded review view.
Receipt identities participate in canonical hashes and encrypted bindings; ordinary
voucher entry points cannot bypass the internal receipt guard. Synthetic Node,
workerd/D1 and desktop/mobile-sized Chromium results do not establish new provider
coverage or actual-host acceptance. Existing accounting operation source hashes
are updated without changing their unverified statuses or dated live evidence.

M16 adds four fixed file operations in a separate
[receipt-operation ledger](mvp-receipt-operations.json): Inbox upload/read and
voucher-file connection create/read. Durable claims, exact owning-record checks,
bounded binary output and link-only repair are covered with synthetic providers
in Node and actual local workerd/D1. Every operation is `implemented_unverified`,
unsupported and disabled by default; actual format/size/license/user-right and
linked-binary availability evidence remains pending under #94. No operation is
promoted by mocked multipart or byte-round-trip success.

M17 connects the separate steps under the same reviewed/client-managed financial
policy. Selected-item resume never uploads or creates a voucher; it reconciles
exact known references and repairs only a successful voucher's remaining link.
Fresh review rotates UI-only capabilities without approving them. Recovery and
retention tests, including ten-item partial results and restart, do not promote
the four file operations or satisfy live G08/#38 acceptance.

The M14 follow-up ports S00's temporary authenticated Node file relay into product
source preparation, with shared Node/workerd two-file byte/isolation tests and
Node helper/CLI privacy/capacity tests. Native Worker source egress remains
unsupported; no ordinary Worker fetch fallback is added. ENV transport settings
activate no tool or provider operation and promote no live/client evidence.

File-specific G06/#94 now has a [provider packet](../implementation/M04-G06-files.md)
and opt-in original-byte MCP readback checker. Explicit test consent may request
`inbox connectfile` only on a new owner-initiated flow; existing connection scopes
and MCP grants never widen automatically. The flag enables no operation. Shared
Node/workerd consent/lifecycle tests and bounded-byte reader tests preserve all
four `implemented_unverified`/unsupported/default-off statuses and missing actual
scope/license/rights/format/post-link/client evidence.

M05 connection diagnosis reuses the existing Company Information read in the
explicit test environment. Status/permission/upstream/implementation/verification
codes are implemented; this is no additional verified provider-operation claim.

M05 offline maintenance adds encrypted snapshot/candidate restore, session/grant/
review revocation, interval write blocking and transactional credential/file-key
rotation. No provider operation is added or promoted by restore or reconciliation.

## S04/S05 business write foundation

The [S05 sales domain](../implementation/S05-documents.md) is in progress and
default-off. Shared synthetic Node/workerd tests cover explicit row replacement,
exact mixed VAT, immutable prepared content and separate lifecycle intents.
The internal fixed-route provider adapter has shared Node/workerd HTTP tests;
Focused MCP contracts and an explicitly selected isolated read-only product
profile are implemented. Product write activation, supplier invoices/payments and actual acceptance remain
pending; this does not classify any document provider operation as supported.

The shared [business write foundation](../implementation/S04-S05-business-writes.md)
adds bounded encrypted proposals, domain authorization, atomic claims and
conservative uncertain outcomes. It enables zero provider operations and changes
no existing verification gate or default activation setting.

### S04 bounded register profile

The [32-operation ledger](s04-register-operations.json) covers customers,
suppliers, service-article creation/common maintenance and ten reference
collections. Independently written source, strict schemas and shared SQLite/D1
behavior are implemented; actual provider/client acceptance is pending.
All entries remain `implemented_unverified`, unsupported and disabled by default.
Only a separate one-hour, two-tenant, isolated-database test entry exposes the
explicitly selected operations. Stock changes, bank instructions, field clearing
and all document operations remain outside this register slice. See the
[implementation boundary](../implementation/S04-register-evidence.md).

S11/#117 completes the company/program administration structure on PR #118, a shared
manifest and explicit company-bound scope extension with Node/workerd and browser
regressions. The owner excluded actual Fortnox acceptance from this delivery;
no live result is claimed. This enables zero new provider operations. Register availability
retains the isolated test profile and expiry; invoice/order/payment provider
lifecycles and payroll remain unavailable. Existing operation ledgers retain their
classification and missing acceptance. See [implementation/evidence and S04/S05
handoff](../implementation/S11-company-programs.md).

## Milestone 7 work in progress

The [M07 delivery record](../implementation/M07-analysis-payroll.md) tracks S08/S09 and G07/G10. Exact request-local ledger calculations and a bounded independent SIE4 parser have synthetic tests; authenticated analysis defaults off. The isolated consent build can request salary access without activating payroll. Full financial breadth and actual G07/ChatGPT evidence remain pending; a narrow hourly create/update/delete lifecycle has passed product MCP/domain and actual provider readback. No full financial correctness or payroll gate is closed.

The M07 known-effect follow-up distinguishes `applied_different` from intended
success and uncertain delivery. Only an acknowledged exact provider identity
plus verified stable-field readback can establish it; original hashes and
bounded field-name/hash evidence remain. Owner Operations shows discrepancies
separately. This recovery classification activates no provider capability and
provides no payroll correctness or client-acceptance claim.

M7 adds a bounded explicit-account period/company comparison through the same
financial source contracts. Both companies are authorized before reads and after
completion; each report retains its own coverage, currency and reconciliation.
The local operation remains unverified/default-off pending actual acceptance.
Prepared payroll inputs also bind their verified reference profile so changed
operation evidence cannot silently authorize an earlier preparation.

M7 current receivable/payable observations use two fixed unfiltered list
operations, explicit company ownership, bounded pages and source-bound
continuation. Unknown fields remain visible. Provider credit/currency semantics
are still unverified, so expected cash-flow sums remain unavailable. Historical
reskontra is not inferred from current invoice status. Ordinary activation is off.

The bounded M7 liquidity input tool combines selected booked accounts and current
invoice pages with an explicit due-date assumption. Private company/year mappings
are source-bound; missing mapping or sign/currency/source evidence prevents a
complete result. No live bank state, currency conversion or payment initiation
is introduced. Actual positive ledger/reskontra reconciliation remains pending.

At f89d3d8, actual public OAuth MCP checks confirmed partial liquidity results in
both sandboxes, historical/foreign-company rejection and read-only denial of all
three payroll write preparations without a provider write. The known employee
remained readable and a missing employee returned not-found. CI passed 353 Node
and 290 actual local workerd/D1 cases. These observations extend the
[dated delivery evidence](../implementation/M07-analysis-payroll.md#latest-isolated-build-verification);
zero-state balance matches do not establish positive SIE reconciliation or close
G07/G10. Actual ChatGPT acceptance remains separate.

A subsequent owner-booked voucher passed independent public OAuth MCP
reconciliation: its three ordinary rows matched SIE references and exact signed
movements, and opening plus movements matched all three account-detail closing
balances. Before/day/after queries selected movements correctly with unchanged
sources. This bounded positive observation does not establish complete report
coverage: missing openings, closing-source disagreement, unsupported SIE period
records and unverified semantics remain explicit. G07/G10 and ChatGPT acceptance
remain open; no provider write or capability promotion occurred in this check.

Conflicting account-list/SIE opening or closing values are now withheld in the
combined report, with their source-disagreement limitation preserved. Independent
detail reads retain their provider label and do not promote report coverage.
Nine financial transport cases passed in each of Node/SQLite and actual local
workerd/D1; ordinary activation remains off.
