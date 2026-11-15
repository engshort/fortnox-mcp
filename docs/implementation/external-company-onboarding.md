# External application company onboarding — #146

Status: implementation under verification on `feature/codex/external-company-onboarding`,
based on `3f5e8bb21146b0582c981339ee31a7557af6c331`. The separately committed
[wire contract](../contracts/company-onboarding-v1.md) was agreed with the M2X #11
implementation chat. This delivery changes only the Fortnox repository.

## Implementation and risk classification

The backend-only v1 API authenticates allowlisted confidential clients using the
maintained OAuth library. Owner actions retain the owner-session/Origin boundary.
The ordinary public-client OAuth and standalone connection paths are preserved.
New onboarding is disabled by default and requires explicit configured clients.
This is an authorization/connection capability, not a financial module or proxy.
No accounting/file/write scope, policy change or production readiness is implied.

Portable bounded attempt records live in the existing encrypted connection-set
CAS snapshot. Provider success and its exact company receipt commit together;
client approvals carry an immutable attempt/revision/company binding. The result
requires current bearer authorization and does not infer a company from a list.
Old code bindings are fenced after resume; current valid tokens do not depend on
retaining an onboarding record forever. Other clients' grants are unchanged.

## Local synthetic fixture

Use Node 24.19.0 and the existing locked dependencies. Run `npm run build`, then
`npm run dev:onboarding-fixture -- /tmp/company-onboarding-fixture`.
The fixture creates private synthetic state and a 0600 `consumer.json`; do not
copy its credentials into public logs. The installation is `http://127.0.0.1:8801`,
consumer `http://localhost:8802`, synthetic provider `http://127.0.0.2:8803`.
All listeners bind loopback. Provider network calls are synthetic and cannot
reach a real Fortnox account. The fixture owner and password are fixed synthetic
values in the fixture source. Never use this fixture as an ordinary deployment.

`FIXTURE_CONSUMER_CALLBACK` may select an exact HTTPS/loopback callback for an
isolated real consumer backend. Generate its credentials locally. The fixture
uses the maintained library's explicit native HTTP-loopback registration policy
for local tests; production ENV and web callbacks remain HTTPS-only. It does not
relax product Origin or cookie checks. A shared-host test avoids SSH/tunnel setup.

The existing Playwright workflow can select `onboarding.spec.ts` after build:
`cd spikes/s00-oauth && npx playwright test --config playwright.owner.config.ts onboarding.spec.ts`.
Browser plugin is not available; the repository's Playwright is used.

## Evidence and remaining acceptance

The initial five shared scenarios passed in Node/SQLite and actual local
workerd/D1: provider connection, exact result and MCP reads; A+B approval and
client isolation; lost-answer recovery/idempotency; reuse/reconnect; rejection and
unknown outcomes. Expanded Node tests additionally passed callback concurrency,
stale policy, cancellation/retention and SQLite/actual D1 restart cases.
Desktop and mobile Chromium browser journeys now pass through distinct consumer,
installation and synthetic provider origins, actual owner login, A then B consent,
HTTP OAuth exchange and MCP profile/status reads. Full regression and
cross-repository results are updated after execution.

Synthetic provider responses prove local mappings, OAuth library interaction,
state/authorization and recovery only. Actual authorized Fortnox onboarding and
the shared M2X-backend journey need separately recorded evidence with both exact
revisions/environment. No live provider or cross-repository acceptance is claimed
by these initial results. Issue #146 remains open until its full acceptance is
supported. No merge, release, deployment or production account operation is part
of this implementation.
