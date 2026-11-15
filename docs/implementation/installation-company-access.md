# Installation-wide company access

## Scope and acceptance

Owner-requested on 2026-11-15; refines S02/S11 and D06/D10. An ordinary AI client
connects once and explicitly approves the installation owner's current and
future Fortnox connections. Adding a company, changing its programs or verifying
a reconnect must not require reconnecting that AI client. Acceptance also checks
foreign-owner isolation, disconnect, unchanged capability scopes and policy,
existing-client migration and external onboarding's selected-company boundary.

## Implementation

`CompanyGrant.companyAccess: owner_connections` records the approved access mode;
absence preserves the older selected-company/connection/access-revision snapshot.
Ordinary browser consent names current companies and explicitly explains future
access. It posts this mode through the maintained signed OAuth/PKCE flow. An
empty installation can be approved before the first company is connected.

Each company request resolves current owner-managed connections on the server.
Versioned installation-wide grants also match the current registration's owner,
grant identity and revision. A later OAuth approval fences the former identity,
including in-flight domain calls. Disconnect rejects access immediately;
reconnect-required remains a distinct state. Current program/provider scopes,
OAuth read/write/file scopes, read-only and manual-voucher policy remain enforced.
Financial proposals, files, intents and approvals keep their original version
bindings and are never revived or resent by a company-access change.

Existing approvals are not broadened during upgrade/startup. In **AI clients**,
the owner can explicitly allow all current/future connections without replacing
the existing token family. `POST /admin/clients/company-access` requires a valid
owner session, exact Origin and observed registration/grant/revision. Legacy
unversioned rows use CAS; versioned grants update the existing bounded approval
map with CAS and preserve expiry. Expired approvals cannot be revived. No model
tool or bearer-token administration path exposes this action. No database schema
migration, new operational store or OAuth capability scope is added.

External onboarding consent rejects the installation-wide mode and retains its
concrete selection. Its resulting grants cannot be widened by the owner upgrade
endpoint. A separate ordinary OAuth flow for the same registration may still
replace that grant after a new explicit installation-wide owner approval; the
restriction applies to onboarding grants, not permanently to the registration.

## Verification and limits

The shared Node/SQLite and actual local workerd/D1 contracts cover consent before
company creation, existing-token migration, future company listing, refresh,
foreign owners, access-revision changes, disconnect/reconnect, legacy upgrades,
expired/superseded grants and competing OAuth renewal. Onboarding regressions
reject an injected broad-access flag and an owner upgrade of its bounded grant.

The owner browser harness runs the built Node application with synthetic state
and separate owner/client cookies. Desktop and Pixel 7 cases execute the actual
consent script, local program addition, new-company discovery on the original
access token, owner-side upgrade UI and refresh. The external callback is
intercepted locally; this is not execution in ChatGPT or against Fortnox.

Verification on 2026-11-15, Node 24.22.0, based on `80e2a0f` plus this
working-tree patch. The source/test diff (`git diff -- apps packages tests
spikes/s00-oauth/browser-owner/setup.spec.ts`) has SHA-256
`13dd8507d82aee026015e49f51f4c3d720d0fff740e0fc1c5ee21c64c4c8cbd6`.

- `npm run typecheck`, `npm run lint` and `npm run build`: passed.
- `npm run test:node`: 452 passed, two initial failures out of 454. A source-hash
  check failed because two changed UI source hashes had not yet been updated;
  the corrected ledger's isolated rerun passed. An existing workerd receipt
  restart test timed out during overlapping browser load; its isolated rerun
  passed both selected restart scenarios. No timeout or assertion was relaxed.
  The complete Node suite was not rerun after those corrections.
- `npm run test:worker`: all 385 tests passed in actual local workerd/D1,
  including the new controlled upgrade/renewal race.
- From `spikes/s00-oauth`, `node_modules/.bin/playwright test --config
  playwright.owner.config.ts`: all 12 desktop/mobile Chromium cases passed.
  The first attempt navigated the new browser case to the JSON API rather than
  the existing AI clients page; correcting that test URL resolved both failures.
- `npm run test:build`: all 13 artifact/native-runtime/CLI tests passed.
- 203 relative links in changed documentation, all 102 operation source hashes
  and `git diff --check`: passed.

Initial sandbox execution could not start required loopback/workerd processes;
complete runtime/browser runs used the approved local execution context.
Workerd retained its existing source-map/form-body warnings. All inputs were
synthetic and local. Dependency installation used the local npm cache.

A separate AI reviewer inspected authorization/concurrency and documentation,
independently ran six relevant Node/SQLite scenarios (including the controlled
CAS race), and reviewed the raw browser/runtime logs. No concrete blocker was
found in the reviewed scope. This is AI-executed, independently AI-reviewed
local evidence; the operator and reviewer are distinct agents.
Actual Fortnox and hosted ChatGPT acceptance remain unverified. Provider operation
coverage and historical evidence classifications are unchanged. No deployment,
merge, release or production account action is included.
