# Persistent installation access

Scope: S02/S11, owner-requested on 2026-11-18. This is a separate application
principal, not an employee session or a Fortnox customer service account.
`INSTALLATION_ACCESS_ENABLED=false` by default. Issuance also requires the REST
API and reviewed REST bridge to be enabled. Existing OAuth approvals and tokens
are never converted automatically.

## Owner administration

The protected `/admin/integrations` page is linked from AI clients.
`GET /admin/integrations/data` requires the installation owner's current session.
It returns configuration status, up to sixteen installation grants, configured
offline client IDs and company scope/feature coverage. These are stored facts,
not proof of provider readability or successful Office scheduler execution.

`POST /admin/integrations/data` requires that session, exact Origin, JSON and one
of these strict actions:

- `create`: `name`, `allow_writes` and optional `onboarding_client_id`.
- `change`: `id`, `expected_revision`, `allow_writes`.
- `revoke` or `rotate`: `id`, `expected_revision`.

Create makes a dedicated confidential OAuth client and returns 201 with
`integration`, `client_id` and a one-time `client_secret`. Rotate returns the new
secret in a 200 response. Other successful actions return `{ok:true}`.
The client credential stays in the consumer's backend secret store. Listing never
returns it. A lost response is resolved by reading saved status and explicitly
rotating a lost secret, not repeating creation on chance.

Only the owner can approve, replace, rotate or revoke these grants. Neither
members, administrators, API/MCP tokens nor provisioning credentials can do so.
The optional onboarding client must be an active confidential registration.
One active integration may supply the default profile for that onboarding client.

## Finance profile and customer consent

`agency_finance_v1` selects bookkeeping and invoicing, with references, financial
analysis, customer invoices and supplier invoices. Its provider scopes are
`companyinformation profile bookkeeping settings costcenter project invoice
supplierinvoice`. Payroll and file access are excluded. Fortnox scopes are not
read-only permissions: the product separately enforces write consent, current
company read-only settings and manual-voucher review.

Company onboarding accepts optional `connection_profile: agency_finance_v1`.
An explicitly linked integration supplies this default when the field is absent.
The effective profile is frozen when the onboarding attempt starts; later default
changes do not alter that attempt or invalidate replay of its idempotency key.
The owner sees the categories before provider navigation or existing-company
selection. New connections use service-account consent and verify TenantId through
authenticated provider responses. Scopes and program selection are saved with
the connection. Existing service connections are reused; missing local selections
can be explicitly added without provider consent. Missing scopes require a bound,
tenant-verified extension of the existing connection. Program and generation
changes, policy, pending writes and uncertain outcomes retain common safeguards.
User-account connections are not silently converted into service connections.

Customer onboarding retains its selected-company OAuth approval. It does not
replace or widen the separate installation grant. REST browser OAuth can also
explicitly approve `companyAccess: owner_connections`, using the existing
current/future-company rules. Ordinary members still select assigned companies.
Old selected-company grants retain their exact versions until an explicit
upgrade or reapproval.

## Backend token exchange and authority

Use `POST /auth/oauth2/token`, form encoding, `client_secret_basic`,
`grant_type=client_credentials` and `resource=<PUBLIC_ORIGIN>/api/v1`.
Optional `scope` must be a subset of the approved ceiling and include `api:read`.
The read ceiling is `api:read api:finance:read api:bridge`; an explicit, initially
unchecked write approval adds `api:write`. No refresh, file, payroll, MCP or owner
administration authority is issued. Access tokens last five minutes.

The maintained OAuth provider authenticates the client and issues opaque tokens.
The product binds its actual token row to the observed installation grant revision
before returning it. Unfinalized tokens fail. Every request checks the current
client, resource, scopes and active grant revision. The server derives the owner
data partition and a distinct installation subject; it never impersonates the
owner or transfers an employee's grants. Company membership resolves from current
owner connections, with current program, scope, policy and generation checks.

Both normalized finance resources and reviewed native bridge operations are
supported. With this opt-in feature enabled, the implemented normalized finance
modules are available under their existing explicit OAuth and company checks;
acceptance evidence is not promoted. Native operations additionally remain within
the profile's provider scopes and exclude files. GET delivery actions remain
writes. Writes use the common validator, durable intent, exact decimal rules and
unknown-outcome recovery. `review_required` cannot be satisfied by installation
consent, a model flag or a self-issued approval.

Grant changes fence old access immediately, including in-flight requests at their
next authorization boundary and before protected results return. Revocation
clears write approval. Rotation first disables the current revision; a partial or
unknown rotation stays disabled until explicit owner recovery. A later approval
does not revive old token revisions. A single bounded `installation-access-v1`
CAS record retains at most sixteen grants; no financial replica or custom token
format is introduced. No SQL migration is needed. Database restore disables every
grant, clears write approval and advances its revision alongside session/token recovery
rules. Stable integration identities remain available for explicit recovery of
retained write outcomes. Permanent revocation remains available while the feature
or REST is disabled.

## Provider failure boundary

Service-token network failures, 429, 5xx, malformed replies and unclassified
authentication failures retain encrypted client credentials. Missing scopes and
invalid integration credentials remain separate from a terminal tenant grant
denial. A verified terminal denial marks only that company reconnect-required.
User refresh rotation retains its conservative uncertain-outcome handling.

Normalized failures retain the structured error envelope and fixed reasons.
Native reads may reacquire once after 401; writes never use this replay path.
Native error responses retain provider status/body and receive
`X-Fortnox-MCP-Error-Source: provider`. Product API authentication challenges use
`X-Fortnox-MCP-Error-Source: integration`. A native upstream 401 alone does not
prove customer consent was revoked.

Local disconnection is enforced immediately. Actual detection latency for
revocation inside Fortnox, including cached provider tokens, requires provider
acceptance; no authenticated consent-webhook contract has been established here.
Office remains responsible for employee/customer rights, hourly checks, actual
last-successful-financial-read reporting and administrator-facing recovery.

## Optional Office contacts

[Office contacts v1](office-contacts-v1.md) adds an independently approved contact
scope and explicit company/source selections to this same registration. The
finance profile, write approval and client-credentials renewal remain separate.
Payroll contact reads do not extend the native finance bridge profile.
