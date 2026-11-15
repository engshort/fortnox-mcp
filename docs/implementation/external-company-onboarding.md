# External application company onboarding — #146

Status: implemented with local and joint synthetic acceptance on
`feature/codex/external-company-onboarding`; actual Fortnox acceptance remains pending,
based on `3f5e8bb21146b0582c981339ee31a7557af6c331`. The separately committed
[wire contract](../contracts/company-onboarding-v1.md) was agreed with the M2X #11
implementation chat ([M2X #11](https://github.com/m2x-se/mcp/issues/11)). This delivery changes only the Fortnox repository.

Current follow-up: [natural login return and optional server offline access](onboarding-continuity.md)
adds retained `interaction_required` recovery and a separately configured 30-day
confidential-backend policy. Its local evidence and remaining joint 72-hour
acceptance are separate from the historical runs below.

## Connection guide design follow-up

The owner requested the administration's existing visual language throughout the
connection guide, with a focused header rather than the administration sidebar.
The shared server-rendered frame now covers company selection, client consent,
retained session review and HTML navigation errors. Login continuations use the
same brand, typography and layout width. The existing palette, local logo and
system fonts are retained; no asset or dependency is added.

New-company connection is the primary action above existing-company rows.
Rows show the escaped name, organization number and a secondary choose action.
Successful provider verification and explicit existing-company choices continue
directly to client consent with the exact attempt-bound company selected.
The owner still explicitly reviews/submits that consent; returning to the guide
shows the selected company without asking for another choice. Prior authorized
company selections are preserved by the existing domain service. No list-first
or before/after heuristic chooses the integration's resulting company.

Pending consent, failed attempts, unknown provider outcomes and session recovery
retain their domain actions. Competing page submissions are blocked while a
request runs. A lost response leaves actions disabled and offers a read-only
reload of retained state. Client consent likewise blocks duplicate submissions.
GET navigation errors requested as HTML keep their error status and use bounded
messages without client/company details; API/POST errors retain JSON. The
authenticated owner/session/Origin/revision checks, company isolation, CSP,
provider exchange rules and policy are unchanged. No SQL migration is required.

Acceptance uses the actual local Node product and existing synthetic consumer/
provider fixture, plus the real local workerd/D1 contracts. Browser plugin is
unavailable; the repository's pinned Playwright Chromium harness is used for
1487 × 1058 desktop and Pixel 7 (412 × 839 CSS pixels). Unknown state is explicitly
seeded for the browser rendering case; actual synthetic exchange uncertainty,
session fencing and no replay are tested separately in Node/workerd. This is not
actual Fortnox, hosted ChatGPT, deployment or production acceptance.

Local verification on 2026-11-15, based on `ccbe3e6`:

- Typecheck, lint, build, 10 artifact and 3 native runtime/CLI tests passed.
- The complete owner browser suite passed all 16 desktop/mobile cases, including
  new A then B connections reaching consent with the intended company preselected,
  result/profile/status readback, preserved A+B access and existing administration.
- Broad Node/SQLite product and restart checks passed 252 tests before the final
  automatic-continuation addition; all 12 affected OAuth/onboarding tests passed
  again after that addition.
- Broad workerd/D1 product checks passed 249 of 250 cases; an unchanged payroll
  write case exceeded its five-second timeout during concurrent checks. The
  final focused run passed all 13 OAuth/onboarding/payroll cases, including that
  timeout case, without changing its timeout or implementation.
- The first browser run exposed a test navigation race when reading the URL
  before login completed. Explicitly waiting for navigation fixed both failures.
  Initial restricted execution could not bind loopback listeners; complete
  runtime/browser checks used the approved local execution context.
- The separate `independent_ui_review` AI inspected the diff, raw logs and
  desktop/mobile screenshots, independently ran the HTML/JSON error contract and
  automatic-continuation scenario, and checked escaping/script syntax and
  unknown-outcome actions. No blocker was found. This is **AI-executed,
  independently AI-reviewed local synthetic acceptance**.

After rebasing onto `a7a1043` (the account-email change), code candidate `0a2b7f5`
passed typecheck, lint, build, all 16 owner browser cases, 10 artifact and 3 native
runtime/CLI tests. Focused OAuth/onboarding/owner/source checks passed 45 Node
tests (216 intentionally filtered) and 22 workerd tests (234 filtered). All 82
relative links in changed documentation resolved. The rebase preserved upstream
login/email behavior and both documentation additions; the UI code and tests
were unchanged by it. Final evidence-only documentation edits follow this run.

The first PR CI run passed the other five workflows and 461 Node/domain tests,
but its S08/S09 source-ledger test found two stale hashes for the changed gateway
and administration entry. Refreshing those exact source pins resolves the
metadata mismatch; it changes no operation, support classification or acceptance
claim. The complete source-ledger regression is checked before the CI rerun.

The existing workerd source-map/form-body warnings and browser runner color-env
warning remain. Intentional lost-response/404/410 browser cases are distinguished
from unexpected page or console errors; the ordinary success flow has none.

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
relax product Origin or cookie checks. Set
`FIXTURE_VALID_ORGANIZATION_NUMBERS=true` for checksum-valid synthetic identities
in automatic consumer matching; the default intentionally tests identity review. A shared-host test avoids SSH/tunnel setup.

The existing Playwright workflow can select `onboarding.spec.ts` after build:
`cd spikes/s00-oauth && npx playwright test --config playwright.owner.config.ts onboarding.spec.ts`.
Browser plugin is not available; the repository's Playwright is used.

## Local verification — 2026-11-15

Code candidate: `c566f525da2ae6cd96f01ce58e73feaf3389a43a`, above the separately
agreed contract commit `1000e8a`. Operator: implementation AI; reviewer: separate
`independent_acceptance_review` AI. Both initial findings (session-expiry recovery
and mobile consent) were corrected and independently re-reviewed. No remaining
blocking code finding was identified. This is **AI-executed, independently
AI-reviewed local synthetic acceptance**; it is not actual provider acceptance.

| Actual command/scenario | Observed result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `git diff --check` | Passed |
| `npm run build`, `npm run test:build` | Build passed; 10 built-artifact and 3 native Worker/recovery checks passed |
| `npm run test:node -- --maxWorkers=2` | 28 files, 430 tests passed |
| `npm run test:worker -- --maxWorkers=2` | 6 files, 361 tests passed in actual local workerd/D1 |
| Selected `session recovery` / `rebinds expired owner` in Node and Worker product tests | 2 + 2 passed, including the negative case added after the full runs started; overlapping cases are not additional unique regression counts |
| Existing `playwright.owner.config.ts`, desktop + Pixel 7 Chromium | All 12 passed, including 2 complete external-consumer A-then-B journeys and existing standalone owner/OAuth regressions |

Shared scenarios cover exact attempt results and real product MCP profile/status
reads through the maintained OAuth library, A+B/other-client isolation, lost
start/callback/code responses, idempotency, existing-company reuse, reconnect,
different-tenant refusal, concurrent callback claims, stale policy, tampered
state/PKCE, cancellation, retention and current token validity after record purge.
SQLite close/reopen and actual workerd/D1 restart preserve exact successful
receipts and unknown outcomes without provider replay.

Session recovery checks both unused and unknown provider outcomes after owner
logout/login. A second still-active owner session, foreign Origin and a paused
actual synthetic provider exchange cannot take over a pending attempt. Recovery
itself makes no provider call; choosing an existing company verifies its identity
before explicit client consent. Mobile overflow is checked on the consent page,
not only on the consumer result page.

The independent reviewer inspected the original recovery/browser logs and the
new screenshots, and separately executed targeted Node scenarios. Original local
screenshot SHA-256 digests (synthetic identities only):

| Artifact | SHA-256 |
| --- | --- |
| A consent, desktop | `fd14a1ea2ebe3cd07a5f0fdade95fc6ea17533bb612a63893e8fcdf99238e47f` |
| A+B consent, mobile | `0f3eaeb2307a9d1e6d81dda0d2e7fcbef0e0207630037a22c824320ba14e33a5` |
| Exact B customer result, mobile | `fc1155e19c9e1ab3bcf2ec51a85cd10e40249108ae75ec138949e9d52c10b991` |

All six GitHub Actions checks passed for code candidate `c566f52`: `s01-offline`,
`s00-offline`, `s00-oauth-offline`, `source-packet`, `owner-ui` and `docker-https`.
[Full Node/Worker/build/bundle CI](https://github.com/engshort/fortnox-mcp/actions/runs/43672560666)
and [owner browser CI](https://github.com/engshort/fortnox-mcp/actions/runs/43672560678)
retain the hosted run evidence. Later evidence-only documentation updates do not
change that tested code candidate.

Current operation-ledger source hashes are refreshed for changed shared files;
provider support statuses and historical live evidence are not promoted.

## Cross-repository acceptance — 2026-11-15

The actual M2X Laravel backend completed both browser journeys on `iss` in
isolated private `/tmp` state, against the synthetic Fortnox provider:

- Final M2X runtime: `4dbe5e28e1386cf32813133a34328bdd9c0139ab`.
- Consumer delivery: [M2X PR #13](https://github.com/m2x-se/mcp/pull/13),
  `5508131a1371c62064bba487607d656aaba2423e`; only documentation is above
  the tested runtime revision. Its [pinned integration evidence](https://github.com/m2x-se/mcp/blob/5508131a1371c62064bba487607d656aaba2423e/docs/integrations.md)
  records the consumer environment and verification separately.
- Fortnox MCP: `c566f525da2ae6cd96f01ce58e73feaf3389a43a`.
- Installation `127.0.0.1:8801`, consumer `localhost:8810`, synthetic provider
  `127.0.0.2:8803`; no real provider calls, shared owner cookies or VPN changes.
- At execution the provider checkout had no tracked changes; the consumer had
  documentation changes only. Credentials were generated and retained privately
  on the test host; none are in the reports or repository.

Both journeys were rerun after the final consumer change handling attempts whose
initiator access/session version has been invalidated. Earlier results against
M2X `190954320a6f6a0c0e951244fd4d3f83cb884243` remain historical evidence;
the final reports below bind acceptance to the delivered consumer runtime.

With checksum-valid synthetic organization numbers, A and B each returned from
explicit provider/client consent, completed actual code/PKCE exchange, fetched
the exact authenticated result and read MCP profile/status using the consumer's
own client. Both customer cards were created automatically. A remained readable
through M2X after B used the replacement token pair. An employee without a
customer assignment received 404. Cookie hosts remained separate; the 390px
mobile customer card had no horizontal overflow.

With the default intentionally invalid synthetic numbers, both companies instead
required explicit identity review in the actual M2X browser UI. After that review
the same verified cards, A-after-B, employee isolation, cookies and mobile checks
passed. This tests the intended exceptional matching path without treating an
invalid identifier as automatically trustworthy.

The joint run exposed a consumer Laravel MCP/Guzzle transport incompatibility
that mocked HTTP tests did not reveal. The tested consumer revision includes the
bounded adapter correction; no Fortnox contract relaxation was needed.

Original redacted tool outputs were retrieved from the companion implementation
chat. The JSON report bytes reconstructed from that output match the operator's
original file SHA-256 exactly. Operator: M2X implementation AI. Independent report
review status is recorded below; this is actual consumer/backend/browser evidence
with a **synthetic provider**, not actual Fortnox acceptance.

| Original cross-repository artifact | SHA-256 |
| --- | --- |
| Final automatic A+B report (`4dbe5e2`) | `e3a3a7730c16df790046bbe41f765e808a899b24de7fb8d3e24060791ca0ced3` |
| Final identity-review A+B report (`4dbe5e2`) | `55c16af54144c4a229554c69570ef352881793d7c3eaf5390376deee65ca7f14` |
| Initial automatic A+B report (`1909543`) | `98c2a195413974c52ce9c3265b50150c53137c2b4295dfad698d07c0e7e059f9` |
| Initial identity-review A+B report (`1909543`) | `c98aa205b9d3d2dbf430514f815384e92034b260a4e9682be4239c0ea229106c` |
| Initial actual M2X A customer card | `00105c1e20874cc8059043e43c92c5aaa84f6cce2ac2fa280a21f9f724515983` |
| Initial actual M2X B customer card | `137098cd514129ab7b05c21f4931de3ca6eb11fadb4c58657a98140510b7081e` |
| Initial actual M2X mobile customer card | `0d70a1d5d78848270a630d07ad95986c2359d65e83bfa58ea2543f38ee98ad6f` |

Independent cross-repository report review: passed by the separate
`independent_acceptance_review` AI against the initial and final original reports
and their exact digests. The final assessment covers M2X `4dbe5e2` against Fortnox
`c566f52`. This is **AI-executed, independently report-reviewed** acceptance. The
reviewer did not independently execute the M2X browser flow or inspect separate
token/PKCE network traces. The report's `reviewed` field identifies the customer
identity-matching branch, not independent AI review. Actual provider acceptance
remains outside this evidence.

## Remaining actual provider acceptance

Synthetic provider responses prove mappings, OAuth library interaction,
state/authorization, consumer integration and recovery only. Actual authorized
Fortnox onboarding has not been run for this change. Issue #146 remains open
pending that separately recorded evidence. No merge, release, deployment or
production account operation is part of this implementation. Reviewable delivery:
[Fortnox PR #147](https://github.com/engshort/fortnox-mcp/pull/147).
