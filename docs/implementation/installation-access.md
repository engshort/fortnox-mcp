# Persistent backend access — implementation and evidence

Scope: S02/S11, requested and implementation-authorized by the owner on
2026-11-18. Base: `29c3b39`. See the [contract](../contracts/installation-access.md)
and [Swedish instructions](../users/serverintegrationer.sv.md).

The implementation adds a separate installation principal using maintained
OAuth client credentials, a finance profile for initial or reused service
connections, current/future-company REST consent and explicit optional write
approval. Temporary service renewal failures preserve credentials. Existing
write policy, exact validation and uncertain outcomes remain authoritative.
The new feature defaults off; no installation has been deployed or enabled.

## Verification

Operator: implementation AI. Independent reviewer: `installation_review` AI.
Local scenarios use synthetic identities, original synthetic schemas and
intercepted Fortnox transport. They do not establish real Fortnox or Office
acceptance.

Local verification on 2026-11-18 used Node 24.19.0, the locked OAuth library,
SQLite, local workerd/D1 and Playwright 1.64.1 Chromium. Verification ran against
the working tree on `codex/office-installation-access`, based on
`29c3b39`. No actual provider data or credentials were used.

Source identity: SHA-256
`a74d5226241ff33d5a9e4668cb7ce74cf512c3c4acf35b19e38f6d9359260f51`.
This hashes the sorted 29 changed/new TypeScript source and test files as
`UTF8(path) + NUL + file bytes + NUL`, relative to the repository root. Current
operation ledgers also bind the affected source files; historical evidence
digests are unchanged.

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed: domain, Node, Worker, tests and admin UI |
| `npm run lint` | Passed: 379 files |
| `npm run build` | Passed: Node, Worker, docs and admin artifacts |
| `npm run test:build` | Passed: 14 artifact/runtime tests |
| Node product contract, `-t 'persistent installation access'` | 13 passed |
| Worker product contract, same filter | 13 passed |
| `tests/node/installation-restart.test.ts` | 2 passed: SQLite and actual local workerd/D1 restart |
| Node product + operator tests, `-t 'persistent installation access\|restore'` | 21 passed |
| Final restore regression, `tests/node/product-operations.test.ts -t restore` | 3 passed; independently rerun: 3 passed |
| Four `tests/core/*-ledger.test.ts` source/evidence checks | 4 passed |
| Owner browser suite, `spikes/s00-oauth/playwright.owner.config.ts` | 26 passed: desktop and Pixel 7 |
| Changed documentation links and `git diff --check` | Passed; 277 relative links resolved |

The initial complete Node run had 547 passes and three failures: an outdated
REST broad-grant rejection expectation, the selected-company consent layout and
a stale accounting source pin. The first Worker run had 465 passes and five
failures: the two REST cases and three payroll timeouts during concurrent suites.
The REST expectation was updated for the intended new behavior, ordinary selected
consent was preserved, and current source pins were refreshed without changing
historical evidence. Focused reruns passed all affected cases: 16 Node tests and
17 Worker tests, including the three isolated payroll cases. The full suites were
not repeated after those corrections; these are bounded regression results.

The shared contracts exercise five-minute machine tokens without refresh,
independent backend rights after logout and simulated 31-day inactivity,
current/future companies, exact resource isolation, grant replacement and
revocation during provider reads, client disablement, secret rotation, read-only
grants, explicit writes and retained unknown writes without resubmission.
They also cover service renewal recovery, provider/integration 401 distinction,
initial profile consent and reconnect-required service companies.

Separate SQLite and local workerd/D1 tests close/reopen storage before issuing
new backend access and reading financial data after simulated inactivity.
The browser harness checks actual owner login, initially unchecked writes,
one-time secret presentation, explicit write approval, revocation and persistence
on desktop and Pixel 7 Chromium. Browser plugin not available; existing pinned
Playwright is used.

Independent review found and verified corrections for genuine service-account
reconnection during profile onboarding, retained library write scopes after
revocation/rotation, and restore of an inactive predecessor sharing an onboarding
client with an active successor. Actual browser execution also found and verified
the admin request-body correction. The final reviewer independently reproduced
the restore recovery and reran all three restore cases. No concrete remaining
defect was found in the reviewed changes. This is AI-executed, independently
AI-reviewed local synthetic verification; real Fortnox/Office acceptance remains
incomplete.

## Remaining actual acceptance

Actual customer consent, provider scopes/licenses, cached-token behavior after
Fortnox revocation, a 72-hour wall-clock idle interval, Office process/scheduler
behavior and employee-rights changes require the actual authorized environments.
No customer/production data, credentials or provider identifiers belong in public
evidence. Simulated elapsed time and provider fixtures cannot close those items.
No merge, release or deployment is included.
