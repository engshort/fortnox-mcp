# G08 — milestone 4 recovery verification packet

Scope: #38, M11/M13 and M14–M17. Local behavior is verified; actual authorized
test-company recovery and applicable host/file/financial evidence remain pending.
This packet does not close G08, G06/#36, G07/#37 or G02/G03. No exactly-once
delivery or upstream transaction/idempotency guarantee has been established.

## Authoritative local baseline

Shared PR #105 contains separately pushed M14–M17 commits and their follow-ups.
Source `8f06aecb5c80b1746c0ce52c26d56c815a433764` passed all three exact-head
CI workflows: [S01](https://github.com/engshort/fortnox-mcp/actions/runs/42387125532),
[S00](https://github.com/engshort/fortnox-mcp/actions/runs/42387125509) and
[OAuth/browser](https://github.com/engshort/fortnox-mcp/actions/runs/42387125577).
Its full local run passed 161 Node/130 actual local workerd cases before the
last helper interoperability case; that final helper/ledger subset passed eight
cases. The complete receipt subset has 50 shared Node/workerd cases and eight
SQLite/workerd restart cases. See [implementation evidence](M04-receipts-evidence.md)
for dated commands and boundaries, and the [source ledger](../reference/mvp-receipt-operations.json)
for fingerprints. Versions are locked in the root/spike package locks; this is
local workerd/D1 evidence, not public-edge or multi-region proof.

## Scenario-to-evidence matrix

All local rows below pass. The actual test-company column is **not run** for
every row; a mocked provider and local browser are not an upstream observation.
Names in the first column are stable IDs in the private operator report template.

| Scenario | Observable invariant and local evidence | Required independent test-company observation |
| --- | --- | --- |
| `lostUploadAnswer` | Accepted synthetic upload answer lost; one durable unknown step and no second upload. `tests/shared/receipt-provider.ts`, `tests/node/receipt-restart.test.ts`. | Accepted Inbox file exists; lose only the response; status and restart stay unknown without a new upload or voucher. |
| `lostVoucherAnswer` | Accepted synthetic voucher answer lost; durable unknown execution and no second financial submission. `tests/shared/receipt-workflow.ts`. | Provider voucher exists once; unknown status survives repeated reads/resume; exact owner-attested reference resolves by readback. |
| `concurrentSubmit` | Competing reviewed calls claim one upload/financial intent; keyboard/double-click tests and concurrent durable CAS in both runtimes. Shared workflow and receipt browser tests. | Two simultaneous submissions of the same reviewed item result in one local dispatch attempt and one observed provider voucher. |
| `restartUnknown` | Reopen SQLite and restart actual workerd/D1; unknown upload/financial result is never resent. Eight receipt restart cases include link-only recovery. | Restart the selected test runtime with its same durable state/key; inspect provider before any recovery action. |
| `knownUnappliedLinkRepair` | Successful upload/voucher plus a proven-unapplied link failure reports partial; repair creates no new upload/voucher. Shared provider/workflow tests. | Cause a link failure known to occur before dispatch, or with operation-specific proof of no effect; restore the prerequisite and create only the missing relationship. |
| `lostLinkAnswer` | Exact positive relationship evidence resolves an unknown link; absent relationship never permits automatic replay. Shared provider/workflow tests. | Lose a successful connection answer; inspect exact file/year/series/number; reconcile without another POST. A negative lookup alone remains unknown. |
| `tenItemPartial` | Eight completed/two failed links → ten completed, ten uploads, ten voucher attempts and twelve link attempts against the synthetic fixture. Shared workflow tests. | Ten individually reviewed test items preserve all successful voucher IDs while repairing only the proven-unapplied links. Record actual attempt counts rather than assuming the fixture's HTTP classification. |
| `mixedItemOutcomes` | Completed, invalid, expired and unknown items retain separate counts/reasons/actions; one receipt never balances another. Shared workflow tests. | Observe the four independent statuses and references; no invalid/expired item gets a financial write, and the unknown item is not resent. |
| `lateDisconnectAnswer` | Late upload ID is minimal unknown evidence; generation increases and credentials remain deleted. Shared provider/file tests. | Disconnect during an in-flight test operation; the late answer cannot reactivate it. Old batch/grant access remains denied after reconnect. |
| `resultStorageFailure` | Accepted financial result cannot be saved; durable submitting claim remains unknown and resume never resubmits. Shared workflow tests. | In a controlled isolated test runtime, deny result storage after provider acceptance; restore storage/restart, inspect provider and reconcile before any further action. |

The synthetic HTTP 400 rejection used by link tests is an explicit fixture
classification. The product's upload/link classification lists remain empty and
separate. A real 400/401/403/429/5xx, timeout or missing record is not assumed to
prove no effect. All dispatched ambiguous writes remain unknown. An unfinished
local claim also remains unknown after a crash, including a crash before network
dispatch when absence cannot be proven. Success is not a retry instruction.

## Concrete opt-in status check

`npm run test:receipts:status` reads only `list_companies` and
`get_receipt_batch`. It cannot upload, approve, create a voucher, repair a link,
reconcile an execution or change policy. It verifies that both explicitly allowed
company handles are present, each selected batch/hash belongs to that company,
per-item/step states are consistent and requested/completed/partial/failed/unknown/
needs-input/prepared counts match the operator's expected phase. It is bounded to
eight snapshots, ten items each, 1 MiB per response and a 20-second request budget,
with no redirects or automatic retry.

1. Copy [the status template](../examples/m4-recovery-status.example.json) to
   ignored `.data/m4-recovery-status.json` and make it mode 0600. The template is
   intentionally unusable: source commit, origin, token, IDs and hashes must be
   replaced privately from the actual test deployment/results.
2. Provide a fresh private MCP access token and exactly the two explicitly
   authorized test-company handles. Never place a token in argv, an issue or PR.
   Record the exact deployed source commit and verify it against deployment
   metadata separately; the script cannot authenticate an operator-supplied SHA.
3. Supply one or more current snapshots per company, with each immutable batch
   reference and **all seven expected counts** for the actual phase. For example,
   the ten-item partial phase has requested 10/completed 8/partial 2; after repair
   the same batch has completed 10. Run separate checks at the two phases; the
   script does not alter a batch between them.
4. Run `RECEIPT_ACCEPTANCE_CONFIRM=test-companies-only npm run test:receipts:status`.
   `ACCEPTANCE_CONFIG` can select a different private file. Output contains only
   source SHA and aggregate counts, never company/item/provider IDs or voucher
   content. A failed/missing scope, disconnected generation or inconsistent
   result fails the command; do not change the expected values merely to pass it.

Success means authenticated local status reads match the stated expectation.
It does **not** prove Fortnox record counts, actual file bytes, browser behavior,
deployment source or human review. The output explicitly says no mutation and
no acceptance granted. Provider readback and negative cases need their own
independent evidence below/#94.

## Actual test session procedure (pending)

1. Keep ordinary product flags off. Confirm the selected isolated installation,
   owner, source commit, runtime/SDK versions and both authorized test tenants.
   Obtain fresh required provider and MCP consent. Complete applicable financial
   reference/rule and host-review requirements (#76/#92/#93/#32) first; do not
   assert them through ENV flags or silently change company policy.
2. Prepare two actual synthetic client files and compare their byte hashes using
   the [M14 procedure](M04-receipts-evidence.md#human-client-acceptance-pending).
   If using the temporary helper, follow its private short-lived setup/teardown;
   this is not native Worker source egress. Keep original bytes private.
3. Review each immutable synthetic item independently in the supported client.
   Record the selected company, file/proposal hashes, current generation/policy,
   exact provider references, attempt counts and timing in private evidence.
4. For fault cases, use the already tested provider/storage ports in an isolated,
   reviewed test build. Lose the response **after** provider acceptance rather
   than claiming a request blocked before acceptance is an unknown provider
   write. A known-unapplied link failure must occur before its dispatch callback
   or have separately established endpoint evidence. There is no production
   fault-injection route, public failure argument or current ENV shortcut; no
   such test build is deployed by this packet.
5. Exercise each matrix row. Read status before/after restart and the explicit
   selected-item resume action. Resume itself never creates a voucher. If only
   upload completed, obtain a new explicit review of the same still-live item;
   capability rotation is not approval. If an exact trusted voucher reference
   is missing, have the installation owner inspect Fortnox and use the protected
   attestation path. Do not infer identity/absence from amount/date searches.
6. Check Fortnox independently for each selected company's exact voucher and
   relationship and compare the **same** provider IDs before/after repair. Do not
   use local success alone as proof. Readback of originals/scopes/licenses/rights
   remains the separate #94 provider acceptance. Capture negative company/grant/
   expired/changed-policy outcomes without publishing identities or raw responses.
7. Preserve minimal unresolved state, stop faults/helper/ingress and verify file
   cleanup. Deleting local data does not undo Fortnox actions. Financial records
   may need a deliberate correction rather than deletion; never promise rollback.

This procedure is prepared, not executed. Any remaining actual client/provider
session and its controlled test-build deployment are explicit prerequisites;
ordinary supported operations remain off until their exact evidence passes.

## Record handling and closure

Copy [the report template](../examples/m4-recovery-record.example.json) to private
`.data/m4-recovery-record.json`, mode 0600. Leave every unperformed scenario as
`not_run`. After actual observation, record time, source/deployment, client/runtime
version, result and a private evidence location; include limitations.
`npm run test:receipts:record` only checks structural completeness of that supplied
operator report. It does not execute or independently verify its claims and
explicitly grants no acceptance. No report promotes a gate or operation by itself.

Publish only redacted evidence summaries with exact commit/deployment and scope.
Keep #38 open/Verification until actual exit evidence is reviewed. Then document
and close only the fulfilled scope; #24, #36, #37, #32, #33 and #94 retain their
own criteria. Human evidence is excluded from the autonomous implementation goal,
not fabricated or silently converted into a gate pass.

## Packet validation

The Node verifier tests cover fixed read-only operation names, actual product MCP
result contracts for two independent SQLite companies, malformed/foreign inputs,
inconsistent/false success, protocol/errors/size bounds, incomplete operator reports
and CLI failure redaction. They make no actual provider or browser request.

Packet checks on 2026-11-07: root `typecheck` and `lint` passed. The seven new
Node verifier cases and two existing acceptance-record cases passed (nine total),
including real product MCP output contracts, no accounting/provider dispatch,
public-file denial, redacted failure and explicit non-acceptance on valid manual
record structure. Both public JSON templates parse and the unperformed report
cannot pass structural completion. Relative documentation file targets and
whitespace passed; anchors were not mechanically verified. No live scenario,
provider/browser action or new application build result is inferred from this
packet-only change.
