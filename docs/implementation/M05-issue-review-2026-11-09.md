# M05 issue review — 2026-11-09

This is the issue-review snapshot before the owner's subsequent acceptance and
merge/publication authorization. See the [later decision](M05-release-authorization-2026-11-09.md)
for consolidation in #114; the remaining technical test criteria below are preserved.

Scope: all seven issues in **5 · Första installerbara MVP:n** (GitHub milestone 7),
all 24 MVP delivery items, reused gates, affected parent scopes and the two deferred
distribution steps: **51 issues**. Unrelated sales/payroll/future-module and tool
qualification issues are outside this review.

The owner explicitly requested documentation and closure of completed issues.
Review decisions distinguish verified bounded implementation from actual provider,
client, financial and release gates. #55, #56, #57, #72, #73 and #74 meet their
implementation exit criteria in the tested build. Their closure does not merge
draft PRs #108–#114, claim that main contains them, publish a release or enable
operations. GitHub issue updates remain in Swedish for the owner.

Runtime source: `ea2013739524727cd832833613610f8eaa496c51`.
Evidence snapshot: `b4882628d06f96fe4f180d410a43200c27846563`.
See [delivery/tests](M05-delivery.md), [actual client lifecycle](M05-client-lifecycle-2026-11-08.md),
[provider renewal and isolated old-token checks](M05-token-renewal-2026-11-08.md)
and the [remaining actual acceptance](M05-actual-acceptance.md).

## Closure decisions

| Issue | Exit-criterion evidence | Remaining boundary |
| --- | --- | --- |
| [#55](https://github.com/engshort/fortnox-mcp/issues/55) | One-time bootstrap expiry/replay/concurrency, durable secure owner sessions and MCP denial pass Node/workerd/runtime checks; actual owner setup completed. | Bounded implementation complete; broader security/reporting #42 and release acceptance #78 remain open. |
| [#56](https://github.com/engshort/fortnox-mcp/issues/56) | Negative discovery/PKCE/resource/audience/redirect and scope/owner/rotation/revocation checks pass; actual reconnect/reload/expiry reads supplement four isolated old-token rejections. | Bounded product OAuth complete; unsaved original ChatGPT tokens were not replayed. Historical actual Reload tools evidence retains its original provenance. |
| [#57](https://github.com/engshort/fortnox-mcp/issues/57) | External vault key, wrong/missing-key denial, company/generation/policy isolation and atomic SQLite/D1 updates are tested; distinct actual encrypted tenant bindings are confirmed. | Bounded storage/isolation complete; full actual provider/file/accounting and cross-owner cases remain separate activation gates. |
| [#72](https://github.com/engshort/fortnox-mcp/issues/72) | Hono/React SV/EN setup, secure bootstrap, owner-only encrypted write-only configuration/policy and operator ENV priority are checked; actual two-company/ChatGPT setup works. | Bounded setup complete; #42/#77/#78 and actual receipt/recovery acceptance remain open, without production/support claims. |
| [#73](https://github.com/engshort/fortnox-mcp/issues/73) | Shared diagnosis/admin results use authorization/budget, fixed codes, redaction and negative scope/upstream/disconnect tests; actual two-company diagnosis works. | Bounded diagnosis complete; unknown license/rights stay unknown, existing documentation tools are reused and no operation is activated. |
| [#74](https://github.com/engshort/fortnox-mcp/issues/74) | Maintenance exclusion, encrypted backup/restore, rotation, upgrade/cleanup and missing-history guards pass synthetic operations/Node/workerd and actual Docker/HTTPS smoke. | Bounded operator/state recovery complete, including pending/unknown/approval/session/grant cases. Actual financial/file/provider recovery #38/#42/#78 remains open. |

Only the six bounded issues above receive new completed closures. Previously
closed #31, #34, #61 and #63–#67 retain their historical scope and status. In
particular, #74 closes the operator/state-recovery implementation with actual
Docker smoke and synthetic pending/unknown-state cases; actual two-company
financial/file recovery stays in #38/#42/#78. #56's original-token replay limit
remains explicit: unchanged-image synthetic rejection tests are not replay of
ChatGPT's unsaved original tokens. No full parent/gate is closed by these decisions.

## Complete issue-by-issue disposition

| Issue | Decision | Verified progress | Remaining work / limit |
| --- | --- | --- | --- |
| [#16](https://github.com/engshort/fortnox-mcp/issues/16) | Open / partial | The tested Docker build includes owner setup, diagnosis, maintenance and dated client/token evidence. | Full receipt, human-review, recovery, source-rights and release gates remain open. |
| [#17](https://github.com/engshort/fortnox-mcp/issues/17) | Open / partial | Existing bounded G01/G04 results are preserved; Docker/Chrome observations add runtime/read evidence. | G02/G03/G05 and wider feasibility/runtime acceptance remain open. |
| [#18](https://github.com/engshort/fortnox-mcp/issues/18) | Open / partial | Node/workerd checks, private secret files, SQLite/SIGTERM and the test installation passed. | Full security/product acceptance and confidential report delivery in #42 remain open. |
| [#19](https://github.com/engshort/fortnox-mcp/issues/19) | Open / partial | Owner bootstrap/OAuth/encrypted bindings and actual service/user connections and renewal passed. | Provider disconnect/reconnect, negative provider cases and #75 remain open. |
| [#20](https://github.com/engshort/fortnox-mcp/issues/20) | Open / partial | The previously accepted #61 adapter, company authorization, provider budget and token lifecycle are reused. | Wider operation/rights/license evidence and #36/#92–#94 remain open. |
| [#21](https://github.com/engshort/fortnox-mcp/issues/21) | Open / partial | Previously closed reference implementation #63 retains its bounded scope. | Actual reference acceptance #92 and the full register scope remain open. |
| [#23](https://github.com/engshort/fortnox-mcp/issues/23) | Open / partial | Previously closed #63–#67 preserve exact amounts and server-bound review. | G02/#32, actual accounting #76/#92/#93 and the full S06 scope remain open. |
| [#24](https://github.com/engshort/fortnox-mcp/issues/24) | Open / partial | Receipt implementation, bounded staging and synthetic recovery/restore guards exist. | Actual originals, individual review, provider attachments and #38/#94 remain open. |
| [#27](https://github.com/engshort/fortnox-mcp/issues/27) | Open / partial | The three existing documentation tools are preserved; #73 adds redacted connection diagnosis. | Full S10/source-rights scope and #35 remain separate. |
| [#28](https://github.com/engshort/fortnox-mcp/issues/28) | Open / partial | Protected bilingual setup, Node/Docker/existing Nginx and maintenance passed their recorded checks. | Full S11/product lifecycle, actual recovery and release acceptance remain open; systemd/APT are future work. |
| [#29](https://github.com/engshort/fortnox-mcp/issues/29) | Open / partial | Draft packaging, compatibility limits and dated Chrome/token results are documented. | #42/#77/#78, rights decisions and complete client/receipt acceptance remain open. |
| [#31](https://github.com/engshort/fortnox-mcp/issues/31) | Kept closed | The previously closed bounded G01 scope is preserved; new reads/reconnection/reload/rotation evidence is supplementary. | Original ChatGPT tokens were not replayed; historical acceptance is not broadened. |
| [#32](https://github.com/engshort/fortnox-mcp/issues/32) | Open / partial | Read calls and saved-answer reload passed; synthetic review/replay checks retain fail-closed guards. | Actual trusted human action, restrictive CSP, remount/replay and separate review per receipt remain open. |
| [#33](https://github.com/engshort/fortnox-mcp/issues/33) | Open / partial | A bounded node-direct test entry, format/size restrictions and synthetic byte/security checks exist. | Two actual host-picked originals and identical server staging/output remain unverified in ChatGPT. |
| [#34](https://github.com/engshort/fortnox-mcp/issues/34) | Kept closed | Previously closed G04 remains bounded; actual product-build service reacquisition and user refresh now supplement it. | No wider provider/accounting acceptance follows. |
| [#35](https://github.com/engshort/fortnox-mcp/issues/35) | Open / blocked | Draft source/image excludes the blocked OpenAPI copy; SBOM and original notices are prepared. | Authorized provenance, distribution terms and a formal source/derivative decision remain blocked. |
| [#36](https://github.com/engshort/fortnox-mcp/issues/36) | Open / partial | Dated connection/profile/renewal evidence and separate reference/voucher/file matrices exist. | Full provider deviations/overlay acceptance and #75/#92/#93/#94 remain open; unknown rights stay unknown. |
| [#37](https://github.com/engshort/fortnox-mcp/issues/37) | Open / partial | Exact validation and the rule-to-test matrix pass their regression checks. | Actual provider rules/results #76 and wider analysis/SIE reconciliation remain open. |
| [#38](https://github.com/engshort/fortnox-mcp/issues/38) | Open / verification | Synthetic uncertain/partial outcomes and restore guards retain state without automatic resubmission. | Actual lost write response, restart, concurrency and link repair with provider references remain open. |
| [#39](https://github.com/engshort/fortnox-mcp/issues/39) | Open / partial | Linux/Docker limits and synthetic HTTPS health/concurrency/SIGTERM measurements are recorded. | Representative client/provider/SIE load and broader hosted Worker/Node budgets remain unverified. |
| [#42](https://github.com/engshort/fortnox-mcp/issues/42) | Open / partial | Actual owner setup/credential save, session boundaries, encryption and maintenance have evidence. | Confidential report delivery/receipt and remaining product/recovery acceptance remain open. |
| [#54](https://github.com/engshort/fortnox-mcp/issues/54) | Open / partial | Seven draft PRs #108–#114, the Docker test installation, two connections, client reads and provider renewal are recorded. | Two actual receipts, individual review, provider references, recovery, private reporting and rights/release decisions remain open. |
| [#55](https://github.com/engshort/fortnox-mcp/issues/55) | Closed: bounded implementation | One-time bootstrap expiry/replay/concurrency, durable secure owner sessions and MCP denial pass Node/workerd/runtime checks; actual owner setup completed. | Bounded implementation complete; broader security/reporting #42 and release acceptance #78 remain open. |
| [#56](https://github.com/engshort/fortnox-mcp/issues/56) | Closed: bounded implementation | Negative discovery/PKCE/resource/audience/redirect and scope/owner/rotation/revocation checks pass; actual reconnect/reload/expiry reads supplement four isolated old-token rejections. | Bounded product OAuth complete; unsaved original ChatGPT tokens were not replayed. Historical actual Reload tools evidence retains its original provenance. |
| [#57](https://github.com/engshort/fortnox-mcp/issues/57) | Closed: bounded implementation | External vault key, wrong/missing-key denial, company/generation/policy isolation and atomic SQLite/D1 updates are tested; distinct actual encrypted tenant bindings are confirmed. | Bounded storage/isolation complete; full actual provider/file/accounting and cross-owner cases remain separate activation gates. |
| [#58](https://github.com/engshort/fortnox-mcp/issues/58) | Open / verification | Actual owner-bound service consent/tenant check and normal client_credentials reacquisition with persisted profile readback passed. | Actual negative scope/revocation/failure, concurrency and recovery cases remain unperformed; keep Verification. |
| [#59](https://github.com/engshort/fortnox-mcp/issues/59) | Open / verification | Actual user refresh after natural expiry rotated both tokens; persistence/profile/tenant and unchanged generations/policies were checked. | Lost provider rotation response, interruption/restart, revoked provider refresh and actual concurrency remain unperformed; keep Verification. |
| [#60](https://github.com/engshort/fortnox-mcp/issues/60) | Open / verification | Generation-fenced disconnect/reconnect and stale-grant denial have synthetic implementation evidence. | Actual provider-company disconnect/reconnect remains untested; ChatGPT account disconnection is a different operation. |
| [#61](https://github.com/engshort/fortnox-mcp/issues/61) | Kept closed | Previously closed bounded HTTP-adapter acceptance is preserved; actual renewal/profile uses the same budget and fixed endpoints. | Broader G06/provider/accounting acceptance remains separate; no extra operation is enabled. |
| [#62](https://github.com/engshort/fortnox-mcp/issues/62) | Open / verification | Both modes list/return profiles, tenant bindings are checked, owner reports foreign-company denial and Chrome reports fresh post-renewal reads. | Distinct negative scope/rights/license/disconnect cases remain open; license causes cannot be guessed. |
| [#63](https://github.com/engshort/fortnox-mcp/issues/63) | Kept closed | Previously closed bounded accounting-reference implementation and synthetic evidence are preserved. | Actual reference acceptance #92 remains open; profile reads do not verify accounting references. |
| [#64](https://github.com/engshort/fortnox-mcp/issues/64) | Kept closed | Previously closed exact amount/voucher validation and the rule-to-test matrix are preserved. | Actual provider rules and voucher results #76/#93 remain open; writes stay disabled. |
| [#65](https://github.com/engshort/fortnox-mcp/issues/65) | Kept closed | Previously closed bounded intent/outcome_unknown implementation is preserved; restore/version guards supplement it. | Actual uncertain-write/recovery #38 remains open; no automatic resubmission is approved. |
| [#66](https://github.com/engshort/fortnox-mcp/issues/66) | Kept closed | Previously closed bounded proposal/review implementation is preserved. | Actual trusted human action/CSP/remount/replay #32 remains open; model confirmation is not approval. |
| [#67](https://github.com/engshort/fortnox-mcp/issues/67) | Kept closed | Previously closed bounded policy/review-bound execution is preserved. | Actual reviewed provider booking #76/#93 is required before activation. |
| [#68](https://github.com/engshort/fortnox-mcp/issues/68) | Open / verification | Two-file bounds, node-direct controls, encrypted staging, synthetic byte/restart checks and a separate leased test entry exist. | Two actual host-picked originals with identical server staging/output #33 remain open. |
| [#69](https://github.com/engshort/fortnox-mcp/issues/69) | Open / verification | Batch preparation, separate proposals/status, needs_input and renewed review have synthetic evidence. | Two actual client receipts and separate trusted human reviews remain open. |
| [#70](https://github.com/engshort/fortnox-mcp/issues/70) | Open / verification | Bounded upload/link/readback and minimal durable substeps have synthetic tests. | Actual provider file formats/rights, upload/link/readback and references #94 remain open. |
| [#71](https://github.com/engshort/fortnox-mcp/issues/71) | Open / verification | Partial batch outcomes, uncertain outcomes and link-only repair have synthetic state/restart coverage. | Actual receipt batch and lost response/restart/link failures #38/#94 remain open; known/unknown steps cannot be resent. |
| [#72](https://github.com/engshort/fortnox-mcp/issues/72) | Closed: bounded implementation | Hono/React SV/EN setup, secure bootstrap, owner-only encrypted write-only configuration/policy and operator ENV priority are checked; actual two-company/ChatGPT setup works. | Bounded setup complete; #42/#77/#78 and actual receipt/recovery acceptance remain open, without production/support claims. |
| [#73](https://github.com/engshort/fortnox-mcp/issues/73) | Closed: bounded implementation | Shared diagnosis/admin results use authorization/budget, fixed codes, redaction and negative scope/upstream/disconnect tests; actual two-company diagnosis works. | Bounded diagnosis complete; unknown license/rights stay unknown, existing documentation tools are reused and no operation is activated. |
| [#74](https://github.com/engshort/fortnox-mcp/issues/74) | Closed: bounded implementation | Maintenance exclusion, encrypted backup/restore, rotation, upgrade/cleanup and missing-history guards pass synthetic operations/Node/workerd and actual Docker/HTTPS smoke. | Bounded operator/state recovery complete, including pending/unknown/approval/session/grant cases. Actual financial/file/provider recovery #38/#42/#78 remains open. |
| [#75](https://github.com/engshort/fortnox-mcp/issues/75) | Open / verification | The operation matrix, two-company reads, authenticated tenant checks and actual service/user renewal are recorded; unverified operations stay disabled. | Missing upstream IDs/rights/licenses and actual negative provider/reconnect cases remain open; the matrix stays implemented_unverified. |
| [#76](https://github.com/engshort/fortnox-mcp/issues/76) | Open / verification | The rule matrix/exact validation and synthetic provider/review cases pass. | Actual provider year/lock/date/sign/row rules, reconciled vouchers and #32/#93 remain open. |
| [#77](https://github.com/engshort/fortnox-mcp/issues/77) | Open / verification | The owner-selected Linux/Docker/Nginx path is tested and measured, including resources, concurrent health reads, SIGTERM/volume and limits. | Representative two-receipt tests and final candidate rehearsal remain open. Wider G09/#39 stays open; Docker is the owner-approved path. |
| [#78](https://github.com/engshort/fortnox-mcp/issues/78) | Open / verification | A version-bound local draft source/image/SBOM/original-license/checksum packet and bilingual guides are prepared and checked. | Clean-room two-company/two-reviewed-receipt/recovery acceptance and rights/security decisions remain open; no release is published. |
| [#92](https://github.com/engshort/fortnox-mcp/issues/92) | Open / verification | Bounded reference implementation/matrix and earlier test-read preparation are preserved; M5 profiles add connection evidence. | Full operation/source/rights/license/year evidence and actual positive/negative reference cases remain open. |
| [#93](https://github.com/engshort/fortnox-mcp/issues/93) | Open / verification | Bounded manual voucher/intent implementation and exact validation are preserved. | Actual provider rules, trusted human approval and voucher write/readback remain open; no M5 accounting write occurred. |
| [#94](https://github.com/engshort/fortnox-mcp/issues/94) | Open / verification | Synthetic upload/link/readback implementation and prepared operation boundaries are preserved. | Actual file/scope/license cases, attachment links and recovery remain open; provider files stay disabled. |
| [#106](https://github.com/engshort/fortnox-mcp/issues/106) | Open / future | Future systemd use of the same Node artifact/configuration is documented in bilingual guides. | Implementation is explicitly deferred; no service unit, system user or installer was created. |
| [#107](https://github.com/engshort/fortnox-mcp/issues/107) | Open / future | Future .deb signing/repository management and the dependency on #106 are documented. | APT implementation/publication is explicitly deferred; no package or signing/repository resource was created. |

## Tracking safeguards and verification

The original acceptance requirements and archived baseline text are retained.
Checklists for the six completed bounded tasks are marked complete; broader
acceptance checklists are not bulk-approved. Status labels are reconciled without
changing milestones, assignees, parent relationships or unrelated labels.

The roadmap #16 is already near GitHub's 65,536-character body limit; its compact
current-status line points to #54/#114 instead of appending another large section.
Other issues receive a dated status/evidence block. The pre-update descriptions,
states and labels were saved privately for reversible tracking changes.

All **51 authorized issue updates succeeded**. A fresh read of both GitHub issue
collection pages confirmed every resulting body, state, status label, milestone
and assignee against the prepared changes and pre-update snapshot. The six new
closures have reason `completed`; eight previously closed issues stay closed;
**37 issues remain open**. No readback mismatch was found. No milestone was closed.

Within milestone 5 itself, #72/#73/#74 are now closed; #42/#54/#77/#78 remain open.
Source-rights blocker #35 and deferred systemd/APT #106/#107 remain open.
Documentation checks cover relative links, whitespace, source consistency and
absence of private identifiers; no application behavior changed in this update.
