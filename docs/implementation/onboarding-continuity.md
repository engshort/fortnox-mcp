# Onboarding continuity and optional server offline access

Scope: S02/S11, company-onboarding-v1 follow-up requested on 2026-11-15,
based on `402e442`. The owner requested natural login continuation and an
explicit longer-lived server authorization policy. This implements the supplied
Fortnox-side brief; it does not deploy an installation or change M2X operation.

## Browser and trust boundary

A retained expired continuation displays the shared HTML frame with **Continue
in <registered app name>**. The button posts only the observed revision to the
local `/connect/company/{id}/return` route. The server authenticates the owner,
checks exact Origin, retained attempt/current revision and configured client,
decrypts the saved request and revalidates its exact callback against both current
allowlists. Only then does it return that callback with `interaction_required`,
the attempt's current state and exact installation `/auth` issuer. Neither a
return URL nor state supplied by the browser/model is accepted. A purged attempt
has local guidance only. A still-active different owner session cannot take over.

OAuth/consent and provider return after login loss navigate to the local attempt
and revision. The provider lookup is navigation-only: it cannot exchange a code,
change session bindings or grant access. No raw provider callback/code is saved
as a login target. Missing retained provider state falls back to local login.
Ordinary OAuth HTML errors, disabled onboarding and unknown guide routes also
render bounded HTML. Server API/POST contracts remain JSON.

Pending provider exchange stays `provider_pending`/`wait` even after the browser
continuation expires. The guide displays the saved state; an active claimed
exchange has no recovery/return action. Uncertain outcomes retain owner review,
with no automatic provider replay. Login, returning to the consumer and resume
create no company consent. Resume still requires new consumer state, PKCE and
operation key; the verified company survives while the owner explicitly approves
again. Old revision/code bindings fail. Consumers remain responsible for checking
their own administrator/session, issuer and state before resume.

## Optional policy and migration

`MCP_OFFLINE_CLIENT_IDS` supplies the server-default JSON list (maximum 16 IDs),
default `[]`. Register the dedicated backend first and then configure its ID.
Owners/administrators can override the list through [protected installation settings](../contracts/installation-settings.md).
Only active `client_secret_basic` registrations with explicit `offline_access`
consent qualify. Public clients and clients outside the list retain the ordinary
24-hour refresh policy. The consent page discloses 30 days and session independence
for qualifying backends. The access token remains five minutes; code expiry and
rotation/replay rules remain unchanged.

The maintained Better Auth/OAuth provider 1.7.10 still authenticates clients,
validates code/PKCE/resource/scopes, mints opaque tokens and atomically consumes
refresh tokens. Its built-in opaque token rows support nullable session bindings.
Before exposing a successfully issued pair, the existing server-only finalizer
checks the active owner, immutable grant/family revision and exact refresh row.
For a qualifying pair it persists refresh expiry as issuance time + 30 days and
removes the access/refresh rows' browser-session bindings. It then retains the
same approval and family to the actual stored expiry. Each server-side successful rotation advances this inactivity deadline. A lost
response may leave a persisted replacement pair, or a finalizer failure may leave
partial finalization. Neither proves consumer completion or permits replay: the
consumer must recover through explicit consent without resending the old token.
This is an explicit product policy applied to library storage, not a new issuer,
custom token format or refresh-token reuse window.

There is no SQL migration or dependency change. Previously issued tokens are not
rewritten on startup. A still-valid pair can acquire the configured policy upon
successful rotation; an expired/revoked/uncertain pair requires fresh explicit
app consent. Session logout/expiry and attempt cleanup do not revoke qualifying
pairs. Removing the ID from the policy immediately fences detached families in
product validation and refresh; restoring the setting can re-enable still-valid families and is an explicit owner/admin policy change,
not permanent revocation or consumer recovery. Permanently revoke a grant/token
through the existing revocation boundary to require fresh consent. Explicit grant/token revocation, disabled registration,
company disconnection, current company versions/scopes and restore invalidation
continue to apply. Adding B preserves explicitly approved current A; superseded
pairs/codes cannot acquire the replacement grant. No employee authorization is
implemented here: M2X must continue to enforce its current customer assignments.

An uncertain rotation must not be sent again. While retained, authenticate status
and resume the same verified company, then explicitly approve and atomically
replace the consumer's pair. After purge, start a new attempt and explicitly
choose the existing company. No provider reconnect is needed solely to renew
client consent. This is the documented recovery mechanism; no replay endpoint or
exactly-once guarantee is introduced.

## Verification and remaining acceptance

New shared `onboarding-continuity` scenarios run through actual library
registration, consent, code exchange and rotation on Node/SQLite and local
workerd/D1, with synthetic upstream Fortnox responses. They check a simulated
73-hour idle interval, logout, attempt cleanup, rolling refresh-row expiry and matching approval/family retention,
while access tokens remain five minutes, scope/company isolation, revocation,
policy removal, expiry and lost-response recovery. The actual storage-restart
tests close/reopen SQLite and dispose/restart local workerd/D1 before rotating
the retained pair after a simulated 73-hour stop.

The existing browser fixture now validates `interaction_required` and persists
new state/verifier/operation before real HTTP resume. Desktop (1487×1058) and
Pixel 7 Chromium cover expiry before/during login, a retained verified company,
new revision, explicit consent and authenticated profile/status result. This is
a synthetic consumer fixture, not the actual M2X backend. Browser plugin not
available; the existing pinned Playwright harness is used.

Operator: implementation AI. Reviewer: separate `continuity_review` AI. The
reviewer inspected the diff, original command logs and desktop/mobile screenshots,
independently reran the tampered-state rejection and disabled/unknown/OAuth HTML
cases, and found no remaining code blocker. This is **AI-executed, independently
AI-reviewed local synthetic acceptance**, not real M2X/Fortnox acceptance.

| Check | Result |
| --- | --- |
| Node 24.19.0, locked root and OAuth-harness install | Passed using the existing offline npm cache; no dependency changes |
| `npm run typecheck`, `npm run lint`, `git diff --check` | Passed |
| `npm run build`, `npm run test:build` | Build, 10 artifact and 3 native Worker/recovery checks passed |
| `npm run test:node -- --maxWorkers=2` | Initial broad run: 469/471 passed; 30 unaffected files passed. The D1 restart exceeded its initial 10-second test budget, and the HTML test still expected a direct error instead of the library's valid local redirect |
| Final `test:node -- tests/node/product.test.ts tests/node/offline-restart.test.ts --maxWorkers=1` | All 265 passed after correcting the redirect assertion and giving the new two-runtime-start test a 30-second budget; no product timeout changed |
| Final `npm run test:worker -- --maxWorkers=1` | All 8 files / 399 tests passed in actual local workerd/D1; the earlier concurrent broad run was terminated with exit 143 and is not counted as a pass |
| Owner `playwright.owner.config.ts` (desktop + Pixel 7) | All 20 passed, including the 4 new continuity cases |
| Documentation links/current source pins | 215 relative targets and 102 hashes matched after the evidence update |

The new browser cases cover unfinished attempts, including company verification
before expiry; completed/lost-refresh consent recovery is covered separately by
the shared API scenarios. Expected 404/410 navigation messages and the existing
workerd form-body/source-map warnings are distinguished from app runtime errors.
The browser suite found no unexpected page/console errors or horizontal overflow.

Original final screenshots (synthetic identities only):

| Artifact | SHA-256 |
| --- | --- |
| Expired verified attempt, desktop | `4452116fdec36e58c8f581856ad2b0b1504b24ca0795adaaa6ffcbd232107647` |
| Resumed consent with offline disclosure, mobile | `d5442de159ed885f6ebb9fbf4a2624b5f17a04beab8c235b46928f397402f786` |

Remaining joint acceptance from the supplied brief: actual M2X scheduler rotations
for at least 72 wall-clock hours, separate M2X/provider process restarts with
private keys/databases preserved, actual authorized Fortnox reads, broken real
network responses and employee/customer-assignment revocation. Simulated time
and synthetic transport do not establish these. An anonymous public HTTPS health/navigation probe was attempted but the
connection was refused before any HTTP response. The latest deployment workflow
reported success for `402e442` ([run](https://github.com/engshort/fortnox-mcp/actions/runs/43733385530)),
but the current responding revision and original user's Accept header remain
unverified. No hosted support is
promoted, and no merge,
release, deployment or production data operation is included.

## Separate persistent integration option (2026-11-18)

The [installation access contract](../contracts/installation-access.md) adds an
explicitly approved backend principal that can acquire new access without a
refresh token. The rolling policy and its existing employee/browser grants remain
unchanged; migration is an explicit owner action, not automatic recovery.
