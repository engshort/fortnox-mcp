# API coverage plan

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
