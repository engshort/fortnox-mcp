# Implementation queue

The [milestone 1 handoff](S00-milestone-1-handoff.md) records the 2026-11-05
maintenance, file implementation, actual runtime measurements and remaining
ChatGPT/rights acceptance. No full scope or product module is accepted by that
synthetic implementation alone.

For the first installable receipt/bookkeeping prerelease, use the bounded
[MVP delivery plan](MVP.md) and [tracker #54](https://github.com/alex-engvall/fortnox-mcp/issues/54).
Its small PR tasks reuse the scopes and gates below; they do not replace full
scope acceptance or the stable 1.0 baseline.

S00's **offline transport spike is verified**; full S00 remains in progress with live acceptance gates open. S01's **local foundation is implemented and verified**, with final acceptance dependencies recorded in [S01 evidence](S01-evidence.md). S11 has an early [Cloudflare infrastructure slice](S11-cloudflare-first-installation.md) with one verified hosted installation in an existing account; fresh-account/lifecycle acceptance and the protected wizard remain pending. S10 has an early [local documentation slice](S10-docs-evidence.md), independent of company connections; connection diagnostics remain pending. S02–S09 and S12–S13 are **not started**. Read [AGENTS.md](../../AGENTS.md), [decisions](../decisions.md) and relevant contracts before beginning a scope.

For the current completed work, remaining gates, exact exit criteria and next
steps, start with the [S00/S01 verification handoff](S00-S01-handoff.md). It
distinguishes the live isolated probes from the disabled root product.

| Scope | Deliverable | Dependencies |
| --- | --- | --- |
| [S00](S00-feasibility.md) | Client/auth/review/files/runtime evidence and selected versions | None |
| [S01](S01-foundation.md) | Executable workspace, tests, CI and runtime skeletons | S00 outcomes for selected mechanisms |
| [S02](S02-connections.md) | Owner identity, provider consent and multiple companies | S01, G01/G04 |
| [S03](S03-provider-mcp.md) | Provider client, policies, tool contracts and discovery | S02 |
| [S04](S04-registers.md) | Common registers and reference data | S03 |
| [S05](S05-documents.md) | Sales/purchase document workflows | S04 |
| [S06](S06-accounting-review.md) | Bookkeeping validation and embedded manual review | S04, G02 |
| [S07](S07-receipts.md) | Multi-receipt/file workflows and recovery | S06, G03 |
| [S08](S08-analytics.md) | Full financial data basis and traceable calculations | S04, S05/S06 read contracts, G07 |
| [S09](S09-payroll.md) | Verified payroll-input example and extensible module | S04 |
| [S10](S10-developer-tools.md) | Local documentation discovery first; safe connection diagnostics later | Local reference lookup can precede S03; diagnostics need S03; redistribution needs G05 |
| [S11](S11-setup-deployment.md) | User wizard, packaging, operations and bilingual guides | S02/S03; final acceptance after S06/S07 |
| [S12](S12-release.md) | Common-workflow acceptance and release process | S04–S11 and applicable gates |
| [S13](S13-expansion.md) | Explicit future modules | Stable core and per-module evidence |

## Scope handoff

Each implementation PR states the scope, accepted criteria, changed contracts, tests actually run and unresolved gates. Update status only with evidence. Product decisions need no repeated approval when the implementation follows them; raise only real ambiguities or necessary changes.

A scope can be split into smaller PRs, but dependencies and final acceptance remain visible. Do not merge unfinished cross-company isolation or approval logic behind an advertised production capability. Early prereleases may expose verified subsets.

## Coding-agent task template

“Implement scope Sxx in this repository. Read AGENTS.md, the decision register and the scope's contracts first. Inspect current implementation and existing work. Preserve accepted product behavior. Implement a reviewable slice with meaningful tests, update coverage/docs and report exact verification. Do not publish, merge or use production data unless separately authorized. If a verification gate fails, document the evidence and keep the affected capability disabled rather than weakening the contract.”

No multi-agent orchestration, model choice or paid service is required by the project. Contributors may use their preferred development tools while meeting the same acceptance criteria.
