# Team access and generic membership provisioning

Scope: S02 identity/company authorization and S11 protected administration.
Owner-requested and implementation-authorized on 2026-11-16. D06/D22 are extended
explicitly; Fortnox financial capability classifications are unchanged.

## Implementation

The portable membership service uses a schema-1 bounded CAS directory through
the existing SQLite/D1 `product_state` adapters. Missing directories mean an
unchanged single-owner installation. The protected owner remains represented by
the existing active installation record, never a mutable/provisionable membership.
No SQL schema change, company-ID rewrite or credential re-encryption is required.

Company data remains under the installation's existing owner partition. Browser
sessions resolve the actual subject separately. Non-owner grants have a
user-specific registration key, subject and membership revision; legacy grants
remain owner-only. Current registration and membership are checked at domain
authorization boundaries. Member read access projects effective read-only into
the existing shared write/preparation/file policy checks. No alternate provider
dispatch path is introduced. Proposals/files/analysis contexts retain their
existing client/grant binding, now unique per authenticated user.

Protected React views support member administration, source credentials,
invitations, explicit account linking and a personal company/client/password view.
The generic [provisioning contract](../contracts/membership-provisioning-v1.md)
supports source-owned desired-state replacement, explicit deactivation, owner-only
administrator delegation, optimistic revisions and bounded idempotent recovery.
There is no M2X runtime dependency. Both feature flags default off.

Account creation uses Better Auth after a durable one-time invitation claim.
Interrupted linking requires explicit administrator recovery; an email match
never silently adopts a login. Account email remains optional and uses the
existing adapter only for active-account password recovery/notification.

Cleanup expires invitations/results. Key rotation clears temporary invitation
material. Backup restore blocks non-owner members and revokes source credentials;
owner/operator recovery and uncertain financial intents are preserved.

## Verification and limits

Shared synthetic membership cases run through Node/SQLite and actual local
workerd/D1, including real product OAuth endpoints. Browser acceptance uses the
existing Playwright harness because the Browser plugin is not available. Tests
and screenshots contain synthetic identities only; screenshots stay in `/tmp`.

Local tests do not establish actual ChatGPT multi-user behavior, M2X consumer
compatibility, mail delivery or real Fortnox acceptance. No production account operation is included. PR publication and squash merge were
separately owner-authorized after local implementation.

### Local verification — 2026-11-16

AI-executed local synthetic verification, with no independent acceptance-review
claim. Toolchain: Node 24.19.0; npm 11.17.0 (within the repository
engine range). Dependencies
were installed from the unchanged lockfile using `npm ci --ignore-scripts`.

| Command/scenario | Observed result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `git diff --check` | Passed |
| `npm run build`, `npm run test:build` | Passed; 10 artifact and 3 native runtime/recovery tests |
| `npm run test:node -- --maxWorkers=2` | Initial overlapping run: 469 passed, 5 failed; all failed cases passed the isolated follow-up below |
| Node follow-up: product-runtime, docs, receipt-restart, membership-restart, receipt-ledger and product files; filter `installation memberships\|boots the actual Node entry\|the actual local docs entry\|restarts actual workerd/D1 without resending an unknown receipt upload\|retains source ownership\|pins the receipt`, `--maxWorkers=1` | 17 passed, 268 intentionally skipped |
| `npm run test:node -- tests/node/membership-restart.test.ts --maxWorkers=1` | 2 passed: SQLite close/reopen and actual workerd/D1 shutdown/restart |
| `npm run test:worker -- --maxWorkers=2` | Initial overlapping run: 400 passed, 4 failed; all failed cases passed the isolated follow-up below |
| Worker follow-up: product and analysis-contexts files; filter `installation memberships\|probes update/delete only\|100000 movements`, `--maxWorkers=1` | 15 passed, 268 intentionally skipped; includes the 100,000-movement context |
| Final Node and Worker product tests, filter `installation memberships\|product owner boundary`, `--maxWorkers=1` | 22 passed in each runtime, 246 intentionally skipped in each; includes final login and own-client revocation assertions |
| Four existing accounting/receipt/register/analysis source-ledger test files | 4 passed; hashes refreshed without changing support classifications |
| `cd spikes/s00-oauth && npx playwright test --config playwright.owner.config.ts` | All 18 passed on desktop and mobile-sized Chromium, including existing owner/onboarding flows and new member/integration flows |

The initial overlapping broad runs found a conflicting-header test fixture and a
source pin that changed during verification. Both were corrected. They also had
one docs-port collision and existing startup/receipt/payroll/large-analysis timeouts;
the new browser fixture now uses a dynamic port, and isolated reruns passed.
This is full-suite coverage plus targeted successful reruns, not a claim of one
uninterrupted green full-suite run. Known SDK source-map/form-body warnings and
Playwright color-environment warnings remain; the new browser flow has no
unexpected page/console errors.

The browser flow proves invitation acceptance, assigned-company isolation,
generic backend provisioning, Swedish/English views, password change, logout and
role-appropriate login. It checks title/content, controls and horizontal overflow.
Desktop and mobile screenshots were visually inspected; a sidebar overlap and an
ambiguous company-selector label were fixed before the final run. Screenshots
remain outside the repository and contain synthetic identities only.

The OpenAPI JSON and local references are structure-checked. Documentation link
checks include the new contract, product decision, implementation scope and
Swedish guide. No acceptance result changes the existing Fortnox provider gates.


| Synthetic screenshot | SHA-256 |
| --- | --- |
| `membership-admin-desktop.png` | `6c211fc5954935875ea795a988e7e2a64985585d300790bc320d7845951e0d85` |
| `membership-admin-mobile.png` | `771d34d7f56fbd25f53a40134b7097e54471abf2cd39c1a3377f963a054bb91d` |
| `membership-employee-desktop.png` | `c70bc5b3dc02dc2bf6b2459621fdcae32a5e313585131323fde7bcc5666a94f4` |
| `membership-employee-mobile.png` | `afa2880a3df2712c579ea0b5901f9a213ffa9e61e4f5800a7d281999fbd1e2f3` |

## Concurrent main integration

The PR incorporates the onboarding continuity and optional REST read API changes
merged while this work was being prepared. OAuth checks preserve both resource
binding and per-subject registration keys. The shared company-read projection
reports effective member read-only access for both transports. A shared synthetic
case exercises two members using one REST registration, selected-company
isolation, wrong-resource rejection, independent registrations and immediate
membership revocation (including refresh and an already authenticated domain
identity). Feature activation and actual provider/client acceptance remain
separate gates.

After the REST integration, typecheck/lint passed and the focused Node product
suite passed 29 cases (257 intentionally skipped): 13 membership, eight shared
REST/MCP reads, one real REST OAuth and seven onboarding-continuity cases.
