# S11 — Company views and incremental program connections (#117)

Scope: the approved C design and company/program structure in #117, including
S02/S03 consent and authorization. This implementation is based on PR #118 at
`3530f0395439672ef3b9763cbf89083e08bc0997`, as requested by the owner. It preserves
that PR's isolated, expiring register profile, credential verification/forgetting
and session-bound consent cancellation. It does not enable new provider operations.

Status: implementation and local verification complete. The owner explicitly
excluded actual Fortnox acceptance from this delivery. No live provider test is
required to finish this task, and none is reported as performed or passed.
Existing operation classifications and activation gates remain unchanged.
Merge, deployment and release publication remain outside this delivery.

## Owner application

Visual references: [approved overview](https://raw.githubusercontent.com/engshort/fortnox-mcp/3528e0eb4242ba1111bb00a4d530b6bfd027d68d/docs/design/company-program-connections/overview-c.png) and [drawer sketch](https://raw.githubusercontent.com/engshort/fortnox-mcp/3528e0eb4242ba1111bb00a4d530b6bfd027d68d/docs/design/company-program-connections/connect-invoicing-c.png).

The same-origin React/Vite application has company search, company selection and
URL-addressable overview, bookkeeping, invoicing, order/quote, payroll and access
views. Global navigation separates companies, AI clients, settings, operations
and help. `/admin` redirects to `/admin/companies`; every private page and API
requires the current owner session. The older API-credentials URL remains valid. Operations lists minimal unresolved
accounting, register/document and receipt references across generations; it never
hides uncertainty on disconnect. Current-generation voucher attestation retains
its existing guarded form.
Browser history and reload preserve company context. Navigation and returning
window focus refresh the local state; a later request supersedes an older response. Company layouts remount on
company change; late dialog responses cannot replace another company's preview.

The approved white/forest-green design uses shared CSS tokens and native semantic
controls. Mobile navigation and company tabs scroll within their own containers.
A native modal drawer has explicit accessible naming, a keyboard focus loop,
Escape dismissal, restored focus and a full-width mobile layout. Submitting a
consent start temporarily prevents dismissal. Connection status and operation
verification are separate: stored scopes are not proof of a license or support.

## Program and consent boundary

`packages/core/src/programs.ts` is the common program/function manifest. Accounting
references require the existing explicit test gate. Customer/article and supplier
register consent uses only the currently enabled operations of #118's isolated
profile; shared reference scopes are derived from that profile. Expiry is checked
again before processing a pending extension. Invoice/order/payment provider
lifecycles and payroll remain unavailable; no payment permission is requested.

A new company requests only `companyinformation profile`. A company extension
requests the union of that connection's existing scopes and expressly selected
supported features. It never uses another company's selection. The flow binds
owner, session, company, generation, policy, program revision and requested scopes;
PKCE and one-time claiming remain in the existing OAuth adapter. The authenticated
company-information response must match the intended tenant before service-token
issuance. Partial or unexpected explicit scope responses fail closed.

The existing company ID, read-only mode and voucher policy survive a successful
extension. Replacement credentials are encrypted before an atomic snapshot update;
generation and policy version advance, old proposals are discarded and old client
grants remain stale. Active credentials are retained until verified replacement.
A provider that independently invalidates them is detected by the existing token
renewal/reconnect behavior; local preservation is not an upstream guarantee.

Legacy snapshots derive program/feature selections from their recorded scopes
without changing credentials, generations or grants. The first explicit program
change persists the optional selection and revision in the same bounded snapshot;
there is no SQL migration or financial replica. Local disable retains upstream
scopes and current grants, removes that program's features and invalidates
proposals. Domain and provider adapters check current selections before calls.
Reconnecting another feature cannot resurrect a disabled feature. Shared scopes
remain usable for another enabled program, subject to its operation gates.

Program replacement and local disable refuse any submitting/unknown accounting,
business or receipt step until reconciliation, including uncertainty appearing
while consent is pending. This avoids making the required recovery path stale.
Ordinary disconnect remains the existing immediate local revocation path; its
separate recovery contract and live acceptance are not changed by this slice.

## Interfaces

Owner-only APIs, with strict JSON and exact Origin on POST:

- `GET /admin/companies/:companyId/programs`: safe local program/function status.
- `POST .../programs/preview`: `{program, features, expected_revision}`; returns
  existing/added/requested scopes and selected programs, never credentials.
- `POST .../programs/start`: same validated selection; recomputes the preview and
  returns the Fortnox authorization URL. The server chooses connection credentials.
- `POST .../programs/disable`: `{program, expected_revision}`; local inactivation.
- `GET /admin/clients`: at most 100 owner-bound grants, company names and current
  generation status, with explicit partial-list indication. This is not a token
  liveness report and returns no tokens or secrets.

`/admin/state` adds organization numbers and safe program status. MCP
`diagnose_connection` adds manifest-derived program summaries. Model-callable
tools cannot administer program selection or grant themselves consent.
Browser callbacks redirect to the selected company on success or a bounded failure
notice on failure; protocol callers retain the existing structured error response.

## Verification and delivery boundary

Shared Node/SQLite and actual local workerd/D1 contracts cover minimal initial
consent, owner/origin/company authorization, service and user extension, two
companies and simultaneous sessions, stale generations/revisions/policies,
replay, cancellation, expiry, wrong tenant, partial scopes, legacy migration,
unknown-write preservation and local program/feature blocking before provider use.
The existing financial, file, restore and register suites remain required.

The existing owner Playwright suite exercises the actual built Node UI in desktop
(1487 × 1058) and Pixel 7 Chromium: bootstrap/login, credentials/forget, bilingual
navigation, company search/switching, reload/history, drawer preview, keyboard
focus/Escape, failure display and a real local program disable. The company data
is seeded synthetically in an isolated SQLite file. The continuation error is
intercepted; no Fortnox endpoint or production account is used. The integration
"approved" presentation case remains explicitly UI-mocked; its real matching
behavior is tested independently in both adapters.

Browser plugin availability: absent; use the repository's Playwright workflow.
The host uses the existing Node 24.19.0 toolchain and extracted Chromium system
libraries under `/tmp`; these are test-environment prerequisites, not app assets.

Final local verification on this change:

- `npm run typecheck`, `npm run lint` and `npm run build`: passed.
- `npm test`: 256 Node/SQLite tests and 196 local workerd/D1 tests passed after
  synchronizing the two latest #118 register-read fixes.
- `npm run test:build`: 10 artifact tests and 3 native Worker/CLI tests passed.
- Owner Playwright: all 4 desktop/mobile cases passed, including unresolved
  business outcomes remaining visible after disconnect and navigation refresh.
- Both approved design references were compared directly with the rendered
  desktop/mobile overview and drawer screenshots. Browser checks reported no
  unexpected page errors or console errors; the intentional HTTP 409 was excluded.
- Documentation links and `git diff --check`: passed. The local workerd harness
  emits source-map and form-body interpretation warnings; these are not evidence
  of provider acceptance.

Actual service-account scope extension, provider cancellation/invalidation,
licenses, negative permissions and hosted client reconsent were not exercised.
These are separate evidence gaps for future capability acceptance, not unfinished
work in this owner-approved delivery scope. Synthetic UI or domain results do not
promote provider coverage, complete the corresponding gates or authorize deployment.

## S04/S05 acceptance handoff

Use `codex/company-programs` (implementation through `1c259d4`, consent/domain
commit `0ab6d11`) and this new company/program interface as the UI base for
continued S04/S05 work. Preserve the #118 operation allowlist, expiry and
separate test database. Build future invoice/order/payment adapters behind their
own classified manifest features; never enable a program from a green OAuth
connection alone. Add new scopes through company-bound preview/consent and retain
stale-grant, uncertainty, restore and local-disable regressions. Browser acceptance
should navigate through Companies → company → program, not the retired setup tabs.
Actual Fortnox acceptance was explicitly skipped for this #117 delivery; any later
live S04/S05 session needs its own authorized test-company scope.
