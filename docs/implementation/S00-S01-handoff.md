# S00/S01 verification status and handoff

For completed 2026-11-05 implementation work and remaining owner-assisted
acceptance, use the [milestone 1 handoff](S00-milestone-1-handoff.md). It includes
the measured Worker file budget, current deployed source and G05 blocker.

**2026-11-05 update:** the maintenance implementation is now deployed to the
existing isolated Worker with its original bindings and database preserved.
See the [dated deployment and local checks](S00-hosted-maintenance-2026-11-05.md).
Actual ChatGPT acceptance remains open. The historical baseline below describes
the earlier run; its "not deployed" statements no longer describe this update.

Recorded **2026-10-18** for [draft PR #11](https://github.com/alex-engvall/fortnox-mcp/pull/11).
**S00 is partially verified; the S01 foundation is implemented, with final
acceptance still open.** No installable Fortnox integration or production
client support is claimed. This is the current summary; the linked evidence
records preserve the individual runs and earlier failures.

The [G01/G02 maintenance follow-up](S00-client-maintenance-evidence.md) adds
local implementation and regression evidence for bounded dual-protocol
diagnostics, server-backed review status and safe view remount/timeout handling.
It is not deployed; actual ChatGPT reload/CSP acceptance remains open.

## Completed and observed

| Area | Verified result | Evidence and limit |
| --- | --- | --- |
| S01 foundation | Strict TypeScript workspace, exact decimals, portable core, Node/Worker entries, SQLite/D1 isolation, atomic state transitions and restart tests; secret-free CI | [S01 record](S01-evidence.md). Root remote MCP and provider operations remain disabled. |
| G01 OAuth | Real ChatGPT discovery/DCR, owner login/consent, authenticated synthetic tool, refresh after expiry, revocation and corrected renewable reconnection | [OAuth record](S00-oauth-evidence.md). Requires both `mcp:read` and `offline_access`; consent alone does not make a narrower grant renewable. |
| G01 protocol | Isolated probe migrated to SDK 2.3.1 with shared authorization for modern and legacy requests. The actual connected app returned the fixed synthetic result; filtered live traffic showed token refresh and authenticated `2026-07-28` POSTs returning 200 | [Dual-protocol result](S00-oauth-evidence.md#dual-protocol-follow-up-and-direct-connected-app-comparison). Root and original transport spike remain on SDK 1.32.1. |
| G02 server boundary | Immutable owner/company/proposal/policy/expiry binding, UI-only capability, strict input and atomic one-time SQLite/D1 consumption; forged/concurrent/replayed and cross-era calls tested | [Review record](S00-review-evidence.md) and [tests](../../spikes/s00-oauth/test/review.test.ts). A trusted host is required; app-only visibility cannot prove a physical human click. |
| G02 actual view | ChatGPT rendered the synthetic proposal; an automated UI click consumed exactly one D1 record and disabled the button. Commit was absent from model catalogs | [Live review result](S00-review-evidence.md#actual-chatgpt-view-and-click--2026-10-18). This run used SDK 1.32.1 with the existing global custom-app CSP setting off. |
| G04 Fortnox feasibility | Service consent, fresh client-credentials issuance, ordinary-user refresh rotation, exact test-tenant matching and differing `/me` SysAdmin values | [G04 passed within scope](S00-fortnox-evidence.md): one dedicated sandbox, only `companyinformation profile`, no financial operation. |
| G05 dependencies | Exact library pins, integrity hashes and attribution; SDK 2 Apache-2.0 notices recorded; point-in-time registry audit reported zero known vulnerabilities | [Notices](../../THIRD_PARTY_NOTICES.md). This does not resolve rights to the Fortnox specification or generated output. |
| G12 reporting availability | GitHub API and Security overview showed private vulnerability reporting enabled | [S01 record](S01-evidence.md). No confidential report was submitted or delivery tested. |

Direct connected-app comparison in the owner's Codex conversation:

| Saved app | Last observed result | Use |
| --- | --- | --- |
| Fortnox MCP – S00 verifiering | Authenticated synthetic status succeeded, including after SDK 2 deployment and automatic refresh | Continue direct tool/auth checks here. |
| Fortnox MCP – S00 anslutning | `UNAUTHORIZED`; reauthentication required | Older comparison client; reconnecting it is unnecessary for the working verifiering path. |

Both apps expose synthetic status with `fortnoxEnabled: false`. A successful
status call does not verify embedded rendering, receipt transfer or Fortnox access.

## Remaining work and exit criteria

| Gate | Current state | Next work and evidence needed to close it |
| --- | --- | --- |
| G01 client maintenance | Partially verified; local diagnostics/regression follow-up implemented | Deploy the follow-up and retest the saved ChatGPT answer after reload and administrative **Reload tools**. Record visible success and actual protocol behavior. Local repeated discovery/resource reads and bounded diagnostics do not establish administrative reload or resolve the earlier saved-answer failure. |
| G02 embedded review | Partially verified; local recovery and browser regression suite implemented | Deploy server-backed status/view recovery, then test actual ChatGPT rendering/click with restrictive custom-app CSP, remount and replay. Local Chromium desktop/mobile-emulation checks cover these mechanics; the actual host, real mobile device and another browser remain unverified. Show one consumed D1 record and preserve the declared trusted-host boundary. |
| G03 file transfer | Not implemented | Build and run a synthetic two-receipt input/output probe in the intended client. Verify bytes actually reach the server, per-file type/size/expiry bounds, failed/expired retrieval, safe URL handling and output-file retrieval. No current status tool supplies this capability. |
| G05 upstream provenance | Blocked for vendored/generated redistribution | Record the supplied specification's authorized acquisition URL/date/hash and applicable redistribution terms or reviewed written permission covering both specification and generated output. See [precise blocker and exit criteria](S00-source-evidence.md). Independently written probes may continue. |
| G09 runtime budgets | Representative benchmarks not implemented | Benchmark a representative schema catalog, exact decimals, file transfer, SIE parsing and durable state on Node and hosted Workers. Record workload, limits, CPU/memory/timing and storage behavior. Existing local atomic/restart tests and deployment startup/bundle figures do not establish hosted budgets. |
| G12 prerelease security | Partially verified | Test confidential report submission/delivery without real vulnerability details; verify production owner/bootstrap and lifecycle controls when implemented. The probe's one-time login and an enabled GitHub setting are insufficient for installable-prerelease acceptance. |
| S01 mechanism handoff | Final acceptance open | Use G01/G09 outcomes to select and document supported runtime, SDK/protocol and auth/storage interfaces, then verify the clean root setup against those choices. Production owner/provider implementations remain S02/S11 work; a working isolated probe is not root product authentication. |

Prioritize the G01/G02 retest on the already deployed server, then G03 and G09.
Resolve G05's external acquisition/permission evidence in parallel with that
implementation work. Follow [the gate register](../reference/verification-gates.md)
and [S00 acceptance](S00-feasibility.md); do not mark the whole scope passed from
one successful tool call. G06–G08/G10–G11 remain for their later product scopes.

Full S02 is also pending: durable/encrypted provider credentials, recovery after
actual Fortnox token expiry, concurrent refresh, provider revocation and broader
resources were not established by the immediate G04 refresh probe.

## Verification baseline

The last recorded deployed executable change is
[`856a687e85becc539f6f2697634c13798f70cf69`](https://github.com/alex-engvall/fortnox-mcp/commit/856a687e85becc539f6f2697634c13798f70cf69).
Subsequent changes before this handoff document record evidence only. On Windows,
Node 24.19.0 and npm 11.9.0, the OAuth package passed strict typecheck, Biome,
Worker build, credential-free Wrangler dry run and **22 behavioral tests**,
including actual local workerd/D1 and SDK 2 modern-only/SDK 1 legacy clients.
The preserved transport spike has its own 61 behavior and two built-artifact
tests; these are separate suites, not 61 live client scenarios.

All three hosted checks passed on the preceding evidence head
`5b734dd138b47807cd7b07fba1c8c7cd1888a06a`:
[S00 OAuth](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39149031122),
[S00](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39149031105), and
[S01](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39149031190).
The PR checks show results for later documentation heads. No new application
test result is inferred from editing this summary.

## Operational handoff

The isolated synthetic Worker/D1 remains deployed; review is explicitly enabled
there and off by default in the public example. It has no Fortnox credentials
or financial operation. The local Fortnox operator and UI harness were stopped.
Temporary tails ended; protocol diagnostics and stored observability are off.
Keep private provisioning, credentials, raw logs, screenshots and private
identifiers out of Git. The root infrastructure test installation and public
installation site are separate from this OAuth probe. PR #11 remains a draft;
these results do not authorize a merge, package release or production rollout.
