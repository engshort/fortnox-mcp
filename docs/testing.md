# Test strategy and evidence

Milestone 4 adds a shared product receipt-file contract in Node/SQLite and actual local workerd/D1, plus two-file restart/expiry recovery. It checks authenticated MCP resource bytes, default-off discovery, content checks, encryption/tampering, generation/policy isolation, competing capacity and failed-workflow cleanup. These tests do not establish actual client file transfer or Fortnox file-operation acceptance; see [receipt evidence](implementation/M04-receipts-evidence.md).

Milestone 3 shared `accounting.ts` and `accounting-transport.ts` contracts run in
Node and actual local workerd/D1: exact validation, isolation, encrypted review,
one-time intents, failures, policy/disconnect races, key rotation, recovery and
default-off MCP schemas. `tests/node/accounting-restart.test.ts` reopens SQLite
and restarts actual workerd/D1 for these records. These synthetic checks do not
establish live G02/G06/G07 gates; see [accounting evidence](implementation/M03-accounting-evidence.md).

The [S00 file-probe record](implementation/S00-files-evidence.md) adds observable
two-file round trips, private-address/redirect/timeout rejection, format bounds,
real OAuth scope denial/revocation, encrypted SQLite/D1 isolation, concurrent
capacity and restart/expiry cleanup. These run in the OAuth package's existing
`npm test`, including actual local workerd execution, without live credentials.
Actual-host file ingress/egress remains a separate G03 requirement.

Tests establish business behavior, not merely that an HTTP wrapper returns JSON. All financial fixtures are synthetic. The [S00 spike tests](../spikes/s00-mcp/test/http.test.ts) cover transport and schema boundaries. The S01 root tests add exact decimals, server identity/company checks and durable SQLite/D1 state transitions. The separate [OAuth probe tests](../spikes/s00-oauth/test/oauth.test.ts) exercise maintained auth endpoints on Node and local workerd/D1. Full financial and hosted-client acceptance remain pending.

## Layers

| Layer | What it proves | Environment |
| --- | --- | --- |
| Domain unit/property tests | Decimal invariants, policy/state transitions, date/account mappings | Offline; deterministic |
| Provider contract tests | Request mapping, pagination, schema overlays, errors and side effects | Mocked transport with authorized synthetic fixtures |
| Storage/runtime tests | Atomic consumption, concurrency, expiry and restart recovery | Both Node and Worker adapters |
| Fortnox integration | Actual permissions, financial-year behavior, files and mutation semantics | Explicitly configured test company only |
| Client acceptance | Authentication, UI/file behavior and actual host trust boundary | ChatGPT first, Claude separately |

## Minimum scenarios

| ID | Scenario and expected outcome |
| --- | --- |
| T01 | Company A token/reference/approval cannot access company B, including batch, cache, file and continuation paths. |
| T02 | Missing/expired/wrong-audience client token fails before provider access; refresh/revocation races are handled. |
| T03 | Balanced synthetic voucher passes; `50.00` and `0.01` imbalance fail without provider write. |
| T04 | Decimal sums, large values, unsupported precision and negative/correction cases match verified rules without float drift. |
| T05 | Wrong fiscal year, inactive/missing account, invalid series, locked period and required dimension fail clearly. |
| T06 | Read-only mode blocks every mutation, including GET email/eprint and batch/developer entry points. |
| T07 | `confirmed=true`, forged UI origin, wrong owner, wrong hash, expired/replayed approval and policy change cannot authorize a review-required voucher. |
| T08 | Unsupported client cannot downgrade review mode; owner can change policy only through authenticated administration. |
| T09 | Double click/concurrent submit generates one local upstream submission attempt for the same intent. |
| T10 | Provider accepts a write but response is lost: state becomes unknown; restart does not blindly resubmit. |
| T11 | Voucher succeeds but attachment link fails: repair only the link; no duplicate voucher. |
| T12 | Ten-item batch with eight successes and two failures returns separate outcomes and resumes only proven-safe failed steps. |
| T13 | Duplicate/similar receipt candidates are flagged; different legitimate transactions are not silently merged. |
| T14 | Expired/oversized/mislabelled files, redirects/private-IP URLs and unreadable PDFs fail without unsafe fetch or data leak. |
| T15 | More than one page, zero/inactive/custom accounts and non-calendar years produce complete or explicitly partial analytics. |
| T16 | SIE/opening balance + movements reconciles with the provider at the same date/year; unknown mapping and concurrent changes are surfaced. |
| T17 | Provider 429/5xx respects budgets and safe backoff; one company's workload does not consume another's connection state. |
| T18 | Updating invoice rows preserves intended content and does not silently delete omitted rows. |
| T19 | Logs/results/backup examples contain no credentials, raw receipts or unredacted payroll data. |
| T20 | Both deployment adapters enforce the same validation, policy, error and retention behavior. |
| T21 | Payroll sample honors employee/date/code permissions; unsupported full payroll actions are unavailable. |
| T22 | Documentation search/diagnostics cannot execute arbitrary API calls, expose secrets or override instructions. |

Use property tests for voucher arithmetic and state transitions where they find real edge cases. Do not treat a test generated from the same schema as evidence of undocumented Fortnox behavior.

## Fortnox test-company protocol

The owner can provision a test company. Before mutations, explicitly verify the configured connection against an allowlist of test tenant IDs and display the selected company. Tests must refuse an unrecognized tenant. Obtain authorization for test writes and external delivery targets; do not send invoices to real customers.

Create isolated synthetic resources with recognizable test references. Record created provider IDs and cleanup rules; accounting records may require corrections rather than deletion. Never promise that resetting the local database reverses Fortnox writes. Fixtures must remove all credentials and personal data before being committed.

## Continuous integration

The [S00 CI workflow](../.github/workflows/s00-ci.yml) runs on every pull request
and on pushes to `main`, without path filters. Its stable check name is
`s00-offline`. It uses GitHub-hosted Ubuntu 24.04, Node 24.19.0 and npm 11.9.0,
with a ten-minute timeout. New runs cancel superseded runs for the same PR/ref.

From `spikes/s00-mcp`, separate fail-fast steps run `npm ci --ignore-scripts`,
`npm run typecheck`, `npm test`, `npm run build` and `npm run test:build`.
The built-artifact tests run after the build. Actions are pinned to release
commit SHAs. Only npm's download cache is reused, keyed by the spike lockfile;
`node_modules` is installed fresh. The workflow grants only `contents: read`,
does not persist checkout credentials and uses no project secrets or live services.
The tests themselves use only in-process requests and loopback HTTP; setup needs
network access to GitHub, Node distributions and the npm registry.

Make `s00-offline` a required status check in an active branch ruleset targeting
`refs/heads/main`, with GitHub Actions as the expected source. Require pull
requests and an up-to-date branch before merging; preserve any existing rules.
The workflow file alone does not enforce merging policy. See the
[CI evidence record](implementation/S00-ci-evidence.md) for actual run results
and the separately verified status of the repository setting.

The [S01 workflow](../.github/workflows/s01-ci.yml), check `s01-offline`, independently runs the root locked install, typecheck, lint, Node/workerd tests, build and built-artifact tests. It preserves `s00-offline`; no repository protection setting is changed. The Worker tests run in actual **local workerd** with D1, and the Node suite additionally disposes/restarts workerd to check D1 persistence. The new hosted workflow passed on source commit `0655bfd` in [PR #8](https://github.com/alex-engvall/fortnox-mcp/pull/8), [S01 CI run 1](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39123344680). The pinned Cloudflare testing toolchain includes a beta Miniflare release; successful local tests are not evidence for hosted runtime budgets.

Root `test:build` keeps the original artifact suite under `--disallow-code-generation-from-strings`, then runs the [native product Worker consent test](../tests/product-worker-native.test.mjs) in actual isolated workerd/D1. The latter uses a synthetic outbound provider and exercises the default native fetch wiring, rather than replacing the product fetch function. Its Miniflare Node proxy requires code generation and runs in a separate harness; this does not change the Worker application's runtime restrictions. The local compatibility-date limit and live acceptance gap are recorded in [milestone 2 evidence](implementation/M02-connections-evidence.md).

The native harness also restores D1/admin access after a wrong-key restart and verifies operator-issued recovery records through the actual reset endpoint. A second subprocess case checks the recovery CLI's private-file permissions and absence of capabilities/identity/secrets from stdout/stderr. Together these supplement the six original no-eval artifact cases; they do not execute a hosted user's browser.

Later scopes add runtime/contract checks. Live Fortnox tests remain explicit
opt-in jobs in a protected environment, never run on untrusted fork code with
secrets. Do not expose tokens in artifacts or logs. Release artifacts and SBOMs
belong to the release workflow.

The [first S11 slice](implementation/S11-cloudflare-first-installation.md) adds eight actual local workerd tests for the public infrastructure entry: readiness without stored-data disclosure, missing binding/migration, incompatible schema, fixed-language rendering, blocked MCP, read-only routes and HEAD/security headers. A third built-artifact test checks the separate installation bundle with dynamic code generation disabled. The S01 workflow additionally dry-runs the root Wrangler deployment configuration without Cloudflare credentials or resource creation. These automated checks do not establish hosted provisioning or client/provider acceptance. A separate manual Chrome run on 2026-10-18 verified GitHub connection recovery, new resource provisioning, Workers Builds, the remote D1 migration, deployment and Swedish readiness in one existing owner account. Fresh-account onboarding and lifecycle checks remain pending; see [S11 evidence](implementation/S11-cloudflare-evidence.md).

## Evidence record

The [S10 local documentation slice](implementation/S10-docs-evidence.md) adds a
shared Node/workerd contract for bilingual lookup, source provenance, bounded
schema reading, continuation binding, hostile text and invalid/external
references without network access. Node tests exercise private file selection
and actual CLI startup/errors. CI uses original synthetic specifications only.
These checks address the documentation part of T22, not connection diagnostics
or permission to redistribute the provider specification.

The second S10 slice adds shared Node/workerd cases for parameter inheritance,
`*/*` request bodies, local/recursive schema references, security declaration
precedence, hash/identity-bound supplements, destructive invoice row semantics,
GET delivery effects and bounded descriptions with complete paginated details.
It also runs the actual Node docs entry with a private synthetic file and
rejects excessive reference expansion. Private provider-input checks are
separate from CI and do not introduce vendored fixtures.

The [local operator recovery regression](implementation/S00-operator-recovery-evidence.md)
tests explicit renewal after the OAuth spike's operator session expires,
preservation of clients/grants/review state, actual local D1 login-delta import,
forged/mismatched state and real CLI private-file/error handling. It does not
authorize remote recovery or establish Windows/tunnel acceptance.

The [G01/G02 follow-up](implementation/S00-client-maintenance-evidence.md) adds
`npm run test:browser` in `spikes/s00-oauth`. Its loopback synthetic SQLite host
serves the actual review widget under hash-based CSP with no network access.
Playwright desktop/mobile-emulated Chromium cases check remount, concurrent and
duplicate approval attempts, status outage, missing metadata and lost commit
responses including the real bridge timeout. The OAuth CI installs pinned
Playwright's Chromium and runs the suite without credentials. Browser binaries
are test-only; screenshots/results stay outside Git under the system temporary
directory. These tests do not replace actual ChatGPT or real-device acceptance.

Each completed scope records commit, environment, exact commands, fixture/test-company scope, results and remaining limitations. Client acceptance additionally records date/client/protocol/account prerequisites. Mark tests not run as not run. Do not label a gate passed from source reading alone.

The [S00 evidence record](implementation/S00-spike-evidence.md) records the actual offline commands and results. Run `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:build` from `spikes/s00-mcp`. The Worker fetch entry is exercised in Node, not Cloudflare. These tests do not establish T01–T22 product acceptance, real client authentication or Fortnox behavior. Continue checking relative links and git whitespace for documentation changes.
