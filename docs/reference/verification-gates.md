# Verification gates and known gaps

Activation update (2026-11-11): [ordinary product activation](../implementation/product-activation-2026-11-11.md) supersedes historical default-off/test-only statements in this document. Acceptance evidence remains unchanged; authorization, policy, validation, source completeness and recovery requirements still apply.

**2026-11-07:** milestone 4 has a [G08 recovery packet](../implementation/M04-G08-recovery.md)
with shared Node/workerd restart/failure evidence, actual-product MCP status
contract checks and explicit pending test-company procedures. Its opt-in utility
only reads status; operator-report validation grants no acceptance. G08 remains
open until actual provider recovery evidence is reviewed. File/host/financial
gates retain their independent prerequisites.

**2026-11-06:** the [G03 correction](../implementation/S00-G03-transport-2026-11-06.md)
passed relay ingress and exact server readback for two files, Chrome PNG download
and accelerated expiry/cleanup. Chrome PDF bytes differed. Native Worker egress
is unavailable. G03 remains partial and G05 stays open.

**2026-11-05:** [milestone 1 handoff](../implementation/S00-milestone-1-handoff.md)
records deployed maintenance, locally verified default-off files, actual hosted
runtime measurements and outstanding acceptance. G01/G02/G03 remain partial,
G04 retains its closed scope, G05 stays blocked and full G09 stays open.
Earlier observations below are historical evidence, not new client support.

The [actual ChatGPT follow-up](../implementation/S00-client-acceptance-2026-11-05.md)
adds scoped live CSP, double-click, consumed-remount and fresh-client refresh
evidence. Automatic saved-answer loading fails, with explicit retry recovery;
older registrations reject newly added scopes. Actual file calls return
`FILE_URL_DENIED`, then `FILE_FETCH_FAILED` after exact source-origin review,
with no stored bytes. G01–G03 remain partial and G05 remains open.

The [G01/G02 maintenance follow-up](../implementation/S00-client-maintenance-evidence.md)
implements local diagnostics, review-status recovery and restrictive-CSP browser
regressions. Actual ChatGPT maintenance/CSP acceptance remains open; no gate is
closed by this local follow-up.

These are engineering checks, not unmade product decisions. All begin **unverified**. Source reading alone does not close them. A failed gate disables the affected capability or requires an explicit product revision; it must not be hidden by a weaker fallback.

The [S00/S01 handoff](../implementation/S00-S01-handoff.md) provides a compact
current status and an action/exit criterion for each remaining S00/S01 gate.

The [first S00 spike](../implementation/S00-spike-evidence.md) left every gate
unverified. Local SDK transport/schema tests provide partial evidence for
G01/G09 and dependency provenance is recorded for G05. Later scoped live
evidence is recorded below; it does not imply full product acceptance.

The [isolated OAuth probe](../implementation/S00-oauth-evidence.md) adds local
Node/workerd/D1 evidence for G01: discovery, owner login, code exchange, PKCE,
resource binding, refresh and revocation. A real personal ChatGPT Pro connection
has now completed owner consent and an authenticated synthetic tool call;
refresh after expiry, revocation and immediate reconnection also succeeded.
A later idle check found that reconnection omitted `offline_access`; the server
scope fix and a corrected native client's required base scopes now preserve
refresh access through reconnection and expiry. The replacement's final ChatGPT
saved answer fails to load despite an authenticated MCP 200. A subsequent
Codex call worked, so the earlier unknown-tool failure is not persistent.
A bounded maintenance trace observed a rejected `2026-07-28` request followed
by successful authenticated `2025-11-25` traffic. The isolated probe's SDK 2.3.1
follow-up then served a successful direct connected-app call with renewable
access and authenticated `2026-07-28` traffic. Methods were not captured.
Saved-answer UI and administrative reload were not retested on that version.
These partial results
do not close the full gate.

**G02 has a scoped live view/click result**: actual ChatGPT rendered the fixed
proposal and a UI click consumed one D1 record. Commit was absent from model
catalogs. The existing custom-app CSP setting was off and left unchanged;
restrictive-CSP and remount/replay checks remain open. A conversation reload
left the saved widget blank. See [G02 evidence](../implementation/S00-review-evidence.md).

**G04 passed on 2026-10-18 for one isolated owner test company**, with only
`companyinformation profile`: service consent, client-credentials issuance,
ordinary-user refresh rotation, exact tenant checks and `/me` semantics all
succeeded live. Service `/me` reported `SysAdmin: false`; the ordinary user
reported `true`. The [G04 record](../implementation/S00-fortnox-evidence.md)
separates this from pending expiry recovery, durable storage, concurrency,
revocation and other resources. Other gates remain open.

**G05 is precisely blocked for vendored/generated redistribution**: the supplied
snapshot has a recorded hash but no declared license or exact acquisition
record. A current review of the official linked developer agreement did not
establish redistribution permission. See the [source evidence and exit criteria](../implementation/S00-source-evidence.md).
Independently written synthetic probes can continue; no specification is vendored.

| Gate | Owner scope | Required evidence | Blocks |
| --- | --- | --- | --- |
| G01 Client protocol/auth | S00/S02 | Real ChatGPT connection, token/metadata/redirect behavior, required account/workspace plan and SDK/protocol versions | Initial client claim |
| G02 Embedded review boundary | S00/S06 | UI-only commit behavior, owner/proposal binding, forged/replayed calls, declared trusted-host assumptions | Review-required manual booking |
| G03 Multi-file transfer | S00/S07 | Two uploaded receipts, expiry, size/type limits and output file retrieval | Receipt-flow claim |
| G04 Service/user connection | S00/S02 | Service consent/client credentials and user refresh paths; verify tenant identity and `/me` semantics | Connection modes |
| G05 Source provenance | S00/S03 | Authorized spec acquisition, dependency/generated-output licensing strategy and source hash | Vendored/generated redistribution |
| G06 Provider differences | S03 | Reviewed overlays for missing security/global parameters, casing, envelopes and undocumented constraints | Affected operation |
| G07 Financial correctness | S06/S08 | Test-company year/lock/row/sign/precision semantics; SIE/account reconciliation | Bookkeeping/analysis |
| G08 Write recovery | S03/S06/S07 | Lost-response, concurrent submit and partial-link recovery; evidence for any upstream idempotency claim | Financial writes |
| G09 Runtime budgets | S00/S01/S11 | Cloudflare/Node memory, CPU, file and state benchmarks; atomic durable storage | Hosting/scale claim |
| G10 Payroll limits | S09 | Supported employee/absence/attendance/salary-input fields, rights and errors | Payroll-input claim |
| G11 Common workflow breadth | S12 | End-to-end evidence for each mandatory release area | Stable 1.0 |
| G12 Security/reporting | S01/S12 | Owner/bootstrap security and a tested confidential vulnerability-report channel | Installable prerelease |

## Source inconsistencies already observed

- 405 operations on 249 paths; only three operations declare security locally, and no global security requirement is declared. Most operations still require provider authorization.
- Mixed Fortnox `/3` resources and newer `/api` families with different access prerequisites.
- An empty API version string; identify the snapshot by checksum and acquisition date.
- Global parameters from the guide are not consistently modeled on each operation. Some fiscal-year/date parameter casing differs between source sections.
- Invoice update rows can be removed when omitted and row IDs can change; naive partial array updates are unsafe.
- GET email/eprint operations have side effects. Print/reminder endpoints require classification before enabling.
- Accounts expose opening/closing balances, not a documented arbitrary-date balance query. SIE provides a candidate full-ledger basis; API behavior still needs verification.
- `/3/me` contains `SysAdmin`; that does not by itself identify the human owner behind service credentials.

## Gate record format

For each gate, commit a concise evidence record with status, date, server commit, client/provider test environment, exact scenario, observed result, limitations and links to tests. Keep credentials and real data out. Closed gates are reopened when an upstream change invalidates the evidence.
