# Company synchronization implementation and evidence

Date: 2026-11-16. Scope S03/S04/S11; T01/T02/T15/T17/T19/T20.
See [company-sync-v1](../contracts/company-sync-v1.md) and
[Swedish setup](../users/synk.sv.md).

## Delivered behavior

The optional manifest describes twelve reviewed native read resources, explicit
fiscal years, identity/path bindings, pagination, unavailable deltas and event
coverage. Content remains in the existing authenticated bridge with exact numeric
JSON and shared tenant pacing. The dedicated API OAuth registration is separate
from the existing MCP onboarding registration. No financial replica, file pipeline,
Fortnox write or consumer scheduler is added to this repository.

Migration `0010_company_sync.sql` adds bounded journal heads/events and opaque
upstream offsets. SQLite transactions and D1 batch transactions commit signals
and offsets together. Expiry/capacity move durable floors. Encrypted cursors bind
subject/stable registration/company/source revisions and journal epoch. Bootstrap
and reset expose a tail to save before the consumer baseline. Node operator
snapshot copies omit events/offsets and rotate epochs; restore and key rotation
also invalidate journal continuity.

The Node installation lock owns one WebSocket per integration. The collector
checks active verified companies, updates tenant tokens on the same socket,
handles protocol acknowledgements without persisting token-echoing responses,
and closes on malformed frames, persistence failure or overload. Actual
reconnection with missing topic continuity requires a new baseline. Worker
exposes the shared read/journal contract with realtime unavailable.

The consumer's agreed policy is WebSocket-triggered reads, hourly fallback
polling and nightly full reconciliation. A 60-second realtime target under normal
load is not an SLA or snapshot guarantee.

## Verification

Original synthetic fixtures exercise resource discovery, native exact amounts,
required years, bootstrap-before-baseline, duplicate events, atomic multi-signal
offsets, retained page traversal, service recreation, current company/OAuth
permissions, forged/foreign cursors, source/epoch/retention resets, cancellation,
revocation during long-poll and unknown events. They run against Node/SQLite and
actual local workerd/D1. The separate Node socket fixture uses the native
WebSocket client and a synthetic loopback server for the provider command sequence,
token renewal without socket replacement and opaque-offset reconnection.

SQLite-specific tests inject failure in the offset insert after the event insert
to prove rollback, reopen a real database file, reject stale-generation offset
updates and exercise the installation capacity floor. Both shared runtimes test
the per-company event cap.

Use Node 24.19.0, the pinned workspace toolchain, `npm run typecheck`,
`npm run lint`, `npm run test:node`, `npm run test:worker`, `npm run build`,
and `npm run test:build`. Focused commands append the new test file paths to the
existing test scripts. Local workerd and native sockets require loopback process
permissions; a sandbox EPERM is not a test pass. Final observed results are
recorded below after execution.

Local verification used the working tree based on `21ad577`, before PR
publication, merge or deployment, with Node 24.19.0:

- Typecheck, Biome lint, build, 11 built-artifact tests and three native
  Worker/recovery tests passed. The final build/artifact checks include the
  program-revision correction to the collector.
- Ten new Node tests and seven new actual local workerd/D1 tests passed. The
  final native socket test also disables invoicing while retaining bookkeeping
  and verifies that invoice topics disappear without disabling the other topics.
- Full Node run: 518 passed and three stale source-hash checks failed. Affected
  ledgers were updated without promoting support; all three checks then passed.
- Full Worker run: 443 passed and one existing S09 payroll recovery test timed
  out at five seconds. It first passed with a 20-second test budget, then passed
  with the unchanged default five-second budget when rerun alone (4.66 seconds).
  The original full runs are not relabeled as entirely green runs.
- Ten affected Markdown documents had no missing relative link targets;
  source-hash consistency and `git diff --check` passed.

Initial Worker fixture failures were corrected: flattened SQL needed a block
comment and isolated fixtures needed to clear legacy grant state. Initial
loopback/filesystem restrictions were rerun with approved local test permissions.

Independent AI review inspected the implementation and original synthetic test
results. It found a partial-topic offset gap and the risk of repeated baselines
on periodic socket replacement, and a missing program-revision binding. The
implementation now resets on insufficient reconnect evidence, renews tokens in
place and reconfigures topics when program revision changes. Review and synthetic execution do
not constitute actual Fortnox acceptance.

## Remaining actual acceptance

No live Fortnox or hosted M2X acceptance is claimed. The optional catalogue,
features and dedicated consumer grant need explicit setup before that session.
In an authorized sandbox, verify at least two companies, multi-page lists and
detail rows, all fiscal years, scope revocation, WebSocket changes, in-place
token renewal and reconnect/reset behavior. A separate AI reviewer must inspect
the original private evidence under the existing acceptance procedure.

Provider event `year` is not verified as a REST fiscal-year ID. Annual resource
events therefore request rescan. No resource advertises `lastmodified`; supplier
payments and voucher series have no advertised event topic. This is an honest
capability boundary, not inferred provider support. No production feature flag,
company policy, merge, deployment or release was changed by this implementation.
