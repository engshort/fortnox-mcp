# Company access renewal and retained receipt recovery — 2026-11-13

## Scope and acceptance

Addresses S02/S03/S08/S11 authorization and receipt recovery: an unknown write
must not prevent a separately authorized local dated-read feature, erase its
history or acquire permission to resend. The owner can renew company approval
on the same OAuth registration. Runtime access status must explain the actual
next action instead of presenting historical verification as an activation gate.

## Program changes

Program preview returns `action` (`none`, `local_selection`, `provider_consent`),
`added_features` and `added_scopes`. Already-selected feature dependencies count.
No-op changes never navigate to Fortnox. A local selection changes program and
access revisions, preserving credentials, connection generation and voucher
policy. Prior company approvals become stale until explicitly renewed.

An additive `financial-analysis`/`supplier-invoices` selection in an already
selected Bookkeeping program can coexist with retained unknown outcomes. Any
in-flight write blocks the change. Provider credential replacement additionally
requires tenant provenance for retained business/receipt uncertainty; legacy
unbound evidence and unknown accounting executions retain that block. Other
program changes retain the existing unknown-write rules. No write is resent or
approved by adding read access.

## Client approval

The owner OAuth page names and selects companies and binds their current
connection/access revisions. The maintained OAuth library consumes the signed
consent and issues the PKCE-bound code. A CAS update renews that registration's
company approval. Each approval gets a separate immutable authorization identity;
ordinary model tokens cannot perform this update.

The library's hashed authorization-code identity binds the new token family to
the approval revision. Opaque access and refresh records remain owned by Better
Auth. Old access tokens, old refresh families and unspent old codes cannot gain
new rights. Domain authorization rejects a legacy mutable client identity after
its first renewal, including an already-running request. A concurrent renewal
can fail closed; it cannot widen an older request's immutable company snapshot.

Unused approval/code metadata expires after ten minutes. Successful token
issuance and refresh retain the same authorization snapshot through the actual
access/refresh expiry recorded by Better Auth, preserving sliding refresh.
Both owner-partitioned maps are capped at 128 live entries and use existing
scheduled cleanup. No credentials or raw tokens enter these maps.

## Receipt recovery

The same-origin owner route `POST /admin/companies/:company/receipts/:item/reconcile`
reads the original upload or link evidence without dispatching another write.
It uses a temporary company-authorized read/file identity, never `mcp:write`.
The analogous owner voucher route reads only an exact retained or owner-attested
reference and compares its full original proposal hash in the original generation.
This keeps accounting recovery available after a local read selection stales
the original client approval. No unknown voucher is identified by date/amount.
Batch/client/hash/proposal identities are retained. New batches record the tenant;
legacy batches without that provenance are recoverable only in their original
generation. Disconnected companies cannot be read. Byte expiry and a historical
policy version cannot authorize execution.

Upload success requires exact original-file identity and hash proof. Link success
requires the retained successful voucher reference and exact provider relationship.
Missing, ambiguous or conflicting evidence remains unknown. CAS and current
company checks protect late results; neither a fresh review nor an upload,
voucher or link is created by recovery. The Operations page names the affected
step and offers recovery where the retained bindings support it.

## Owner experience

The program dialog has no receipt checkbox. Receipts appear in the explicit
access summary when requested; stored exclusions are not changed automatically.
For an already-selected Bookkeeping program missing dated analysis, the dialog
offers that read addition separately from unrelated register/file additions.
Program cards distinguish connected access, read-only vouchers, missing access
and planned support. Historical `implemented_unverified` evidence remains in
technical records, not as a blanket disabled-state label.

Failed previews do not display blank scopes as if no permissions were needed.
Unknown-write errors link to Operations. Empty client company lists give a fresh
approval instruction without exposing unauthorized company names. The obsolete
test-installation warning is removed.

## Verification record

The shared Node/SQLite and actual local workerd/D1 contracts exercise local
selection with retained uncertainty, in-flight/stale rejection, existing receipt
dependencies, legacy authorization races, real library PKCE/exchange/refresh and
same-registration renewal, old-code/token rejection, sliding retention and
owner upload/link reconciliation across generations without resubmission, and
owner exact-voucher reconciliation after a local read addition.

The owner Playwright suite exercises the built Node app at desktop and Pixel 7
sizes, including a real local read selection with an unknown write, preserved
credentials/policy/history, the removed checkbox and updated status presentation.
A second browser flow completes actual local library OAuth approval, local read
activation, same-registration reapproval and authenticated MCP company listing;
the external client callback is intercepted, not executed in ChatGPT.
Browser plugin not available; the repository Playwright workflow is used.

Final local verification, 2026-11-13:

- `npm run typecheck`, `npm run lint` and `npm run build`: passed.
- `npm test`: all 415 Node/SQLite tests and 348 actual local workerd/D1 tests
  passed sequentially on the final source, including sliding token retention,
  confidential-client Basic exchange and owner exact-voucher recovery.
- `npm run test:build`: all 13 artifact/native-runtime/CLI tests passed.
- From `spikes/s00-oauth`, `npx playwright test --config playwright.owner.config.ts`:
  all ten desktop/mobile Chromium cases passed. The owner browser and OAuth
  client's HTTP context use separate cookies. The local approval/selection/MCP
  round trip uses an intercepted synthetic client callback.
- 191 relative documentation links, all 89 operation source hashes and
  `git diff --check`: passed. Provider support/evidence classifications are unchanged.

A separate AI reviewer found a legacy in-flight authorization race, fixed
approval retention that broke sliding refresh, and a previously selected receipt
dependency rejected by the new dialog. All three were corrected. The reviewer
independently reran seven relevant Node cases and three accounting recovery
cases, with no remaining concrete blocker in the reviewed scope. Execution and
review are separate; this is AI-executed, independently AI-reviewed local evidence.

An earlier concurrent workerd run timed out in an unchanged sales-document test;
the isolated repeat and final sequential complete run passed without changing
timeouts. The runtime emits its existing source-map/form-body warnings; these
are not provider evidence. Initial sandbox runs could not open loopback sockets;
the complete runs used the approved local test execution context.

These are synthetic local/runtime results. Actual Fortnox and hosted ChatGPT
acceptance of this change remain pending; no provider outcome or operation
coverage is promoted. No installation, deployment, merge or release is implied.
