# S11/S02 — live installation settings

Owner-authorized implementation of the 2026-11-18 plan: expose fourteen existing
feature settings in protected administration, keep safe operational status under
Operations, allow owners/administrators and apply changes without restart.
See the [HTTP/storage contract](../contracts/installation-settings.md) and
[Swedish user guide](../users/installationsinstallningar.sv.md).

## Implementation

The portable core service stores bounded schema-1 overrides with CAS and a
separately encrypted Resend key. ENV remains the fallback per field. Reset,
explicit false, empty lists and explicit key deletion are distinct. The shared
product boundary resolves the effective configuration before requests, rebuilds
services on changes and fences in-flight provider I/O/results after restrictions.
Account-email callbacks also check the current configuration before dispatch.

The authenticated writer's role stamps app email keys. Admin-supplied keys cannot
carry owner recovery codes, avoiding owner takeover through a provider account
controlled by an additional administrator. An owner-supplied or operator ENV key
is required for that path, with status shown in the UI. This preserves all fourteen
admin-editable fields and the existing owner-only catalogue/delegation boundary.
The real reset HTTP/Resend adapter is exercised with intercepted synthetic delivery.

The Node runtime coordinates collector stop/start through the existing process
lock and `FortnoxEvents` service. Worker uses the same state and never opens a
realtime socket. Encryption rotation and restore include the new operational
record; existing uncertain outcomes and financial policies are preserved.
Node applies persisted settings before opening its listener, so an enabled
collector resumes after restart without waiting for external traffic.

The React settings page has independent forms for email, users, integrations and
analysis, source labels, reset actions, safe secret replacement, eligible client
selection and conflict feedback. Unsaved changes in other sections are retained
when one form is saved. The catalogue view uses the existing owner-only upload
contract; additional administrators cannot import operation reviews.

Migration 0011 repairs known read-only API resource ceilings created after 0009.
New resource seeds use the same stable ceiling; active flags still constrain
registration/token access. No client, consent or token scopes are widened and
custom resource policies are untouched. No SQL table is added.

## Classification and acceptance

Optional feature defaults remain off. Administration is browser-session-only,
installation-bound and unavailable to ordinary members/model/API credentials.
No new provider operation, arbitrary proxy, approval mechanism or source
redistribution is introduced. This work addresses T01/T02/T06/T07/T08/T09/T10,
T19/T20 and S11 protected web/runtime compatibility.

Local verification uses synthetic identities and credentials only. The shared
contract covers defaults, strict inputs, dependencies, masking/encryption,
revision conflicts, reset/fallback, role boundaries, registration eligibility,
in-flight restriction and real OAuth family fencing. Additional checks cover
SQLite and actual workerd/D1 storage restarts, encrypted backup/restore and key
rotation. Playwright uses the existing pinned owner harness against the built
Node application on desktop/mobile, including an actual process restart.

Browser plugin not available; regular Playwright is used. Screenshots and test
logs remain in `/tmp`. These local checks do not establish real email delivery,
Fortnox/hosted-client acceptance or production deployment. No independent
sandbox acceptance-review claim is made.

## Local verification — 2026-11-18

Toolchain: Node 24.19.0 and npm 11.17.0. Root and owner-harness dependencies were
installed from existing offline caches with unchanged lockfiles and lifecycle
scripts disabled. Local servers/workerd/Chromium needed loopback access outside
the execution sandbox; all data remained synthetic and no deployment occurred.

| Check | Observed result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `git diff --check` | Passed |
| `npm run build`, `npm run test:build` | Passed; 11 artifact and 3 native runtime/recovery tests |
| `npm run test:node -- --maxWorkers=1` | All 538 tests passed across 37 files |
| `npm run test:worker -- --maxWorkers=1` | All 459 tests passed across 9 files |
| After the final owner-email guard: Node settings/owner, operator, restart, API and ledger checks | All 39 selected tests passed; 293 intentionally skipped |
| Final Node and Worker settings/owner compatibility checks | All 27 selected tests passed in each runtime; 291 intentionally skipped in each |
| `cd spikes/s00-oauth && npx playwright test --config playwright.owner.config.ts` | All 24 desktop/mobile tests passed |
| Relative links in changed Markdown / current operation source hashes | 308 links and 116 hashes checked |

The browser checks include actual Node-process restart with unchanged ENV,
configuration conflicts across tabs, source resets, encrypted-key masking,
catalogue upload, admin changes, member denial, disabling non-owner access,
Swedish/English and preserved owner access. Desktop/mobile screenshots were
visually inspected and contain only synthetic installation data. The new flow
has no unexpected page/console errors. Existing harness colour-environment
warnings do not affect the app.

The full Node/Worker and 24-case browser runs preceded the final owner-email
provenance guard. The affected checks above were rerun after it, together with
the final build/artifact suite and the two extended desktop/mobile settings
flows (both passed). Those browser flows additionally show an admin key blocking
owner recovery and an owner-entered key restoring it. No real email was sent.
The final flows also exercise a UI-only Worker projection: an inherited realtime
flag can be turned off, while enabling realtime stays unavailable. The matching
dependency change is verified separately against actual local workerd/D1.
Built runtime checks were repeated after the Node startup initialization change.

An initial overlapping broad run found constructor-validation/error-shape
regressions and hashes changed during implementation; these were corrected.
Worker payroll/offline and the 100,000-movement case also reached their time
budgets under overlapping load. Final runtime verification runs serially below;
none of these observations changes provider acceptance or support classification.

The last artifact rerun also encountered the existing isolated-register fixture's
two-second startup lease under overlapping test load. An isolated rerun passed
without changing its lease or any production safety gate.
