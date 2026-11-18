# Authentication and company authorization

[Live installation settings](installation-settings.md) are readable/writable
only by browser-authenticated owners/current administrators. Members, MCP/API
tokens and provisioning credentials cannot administer them. Owner-only catalogue
installation and administrator-provisioning delegation remain separate. Feature
activation and client allowlists never grant scopes, companies or voucher approval.

The opt-in [REST resource](rest.md) uses `/api/v1`, separate read scopes and
explicitly selected company grants. MCP and REST tokens are not interchangeable.
New financial MCP reads require fresh `mcp:finance:read` consent; migration 0008
advertises that scope without updating existing clients or tokens.
Activation update (2026-11-11): [ordinary product activation](../implementation/product-activation-2026-11-11.md) supersedes historical default-off/test-only statements in this document. Acceptance evidence remains unchanged; authorization, policy, validation, source completeness and recovery requirements still apply.

The protected owner application uses same-origin Hono routes and built React/Vite
assets. `/admin/state` requires an owner or active installation-administrator session; MCP bearer tokens cannot
administer the installation. `/admin/fortnox/configuration` accepts strict,
write-only credentials with the exact browser Origin and encrypts them using the
existing vault, bound to the installation owner. Status returns only
`configured`/`source`. Operator ENV credentials take precedence and cannot be
overwritten through the UI. New consent uses these settings; existing connections
retain their original encrypted credentials until explicitly reconnected.

The product integration uses Better Auth 1.7.10, a ten-minute one-time operator bootstrap and subsequent owner email/password login. Public signup is not exposed. Password-reset requests remain unavailable unless the operator explicitly enables account email. Sessions are database-validated and admin browser POSTs require the exact installation Origin. See [implementation and remaining acceptance](../implementation/M02-connections-evidence.md).

## Optional account email

Resend account email is disabled by default (`RESEND_ENABLED=false`). Explicit
activation requires `RESEND_API_KEY` and a bare verified sender address in
`RESEND_FROM`. Node also supports the mutually exclusive `RESEND_API_KEY_FILE`.
The key is server-only and is never returned through admin state or MCP.

The [account-email adapter](../implementation/account-email.md) sends a welcome
message only after a successful owner bootstrap, a reset code issued by the
maintained auth component, and a notification after a successful password reset.
The installation keeps one protected owner. Optional team management is a
separate feature under [membership provisioning](membership-provisioning-v1.md); public signup remains closed. Recipients come from the registered account, never an
arbitrary model-supplied delivery target. No email-sending MCP tool is exposed.

When configured, `POST /auth/request-password-reset` accepts only an email address,
requires the exact installation Origin and checks a durable installation-wide
limit of three attempts per hour before account lookup. This authentication
recovery endpoint intentionally works without an existing session. Only the
active owner or, with team access enabled, an active unblocked member can receive a reset code. The endpoint returns the same
generic acknowledgement for unknown addresses, unauthorized accounts and uncertain
delivery; it does not assert that mail arrived. Tokens last ten minutes, are
single-use and revoke existing sessions on successful redemption. Redirect
destinations and caller-supplied message content are rejected.

Each email attempt has a ten-second timeout and a Resend idempotency key. Unknown
delivery is not retried automatically or promoted to confirmed delivery. Welcome
or password-change notification failure cannot roll back completed account
creation/password reset. Operator recovery remains available. Provider errors,
tokens and message contents are never logged; SDK debug mode is rejected. No
durable outbound queue, bounce webhook or inbox-delivery guarantee is added.

Operator reset issuance requires installation access and remains available with
email disabled. The D1 [operator recovery bridge](../implementation/M02-owner-recovery.md) imports a library-issued ten-minute verification record only when the existing owner ID/email match; it never replaces the owner. The public fixed `/reset-password` form redeems operator- or email-issued codes through the maintained auth component, with exact Origin checks and admin-session revocation.

Sources: [F01–F04, F06 in sources](../reference/sources.md). OAuth between the AI client and this server is separate from OAuth between this server and Fortnox.

## Identities

| Object | Meaning |
| --- | --- |
| Installation owner | Protected bootstrap principal and stable installation data partition |
| Installation administrator | Active member authorized to administer the installation, except protected owner controls |
| Member | Active unblocked subject with explicit read/read-write company assignments |
| MCP client authorization | A subject/client-specific grant intersected with current membership and company rights |
| Fortnox connection | Provider credentials, tenant identity, granted scopes, account type and status |
| Company handle | Opaque stable local ID mapping to a connection the caller may use |

The server resolves allowed connections from authenticated identity. It checks this for every list, read, write, file, proposal, continuation and status lookup. An organization number, provider ID or local company handle supplied by the model never grants access.

## Optional team access

The [membership contract](membership-provisioning-v1.md) defines roles, invitations,
source ownership, generic provisioning and revocation. `MULTI_USER_ENABLED=false`
preserves the original owner-only boundary. Team access distinguishes the
installation owner/data partition from the acting subject, both server-derived.
Members use `/app` and `/api/me`; they cannot call admin routes. With team access
enabled, successful email login returns a server-selected `redirect` (`/app` or
`/admin`) alongside `ok`; inactive or blocked subjects receive no session cookie. Browser mutations
require the exact Origin. Service provisioning credentials cannot authorize MCP.

Each non-owner OAuth approval and code family binds a subject and membership
revision. Company access is the intersection of current membership, explicit
client approval and existing scopes/program/policy checks. Read-only membership
also blocks preparation and file ingestion. Changed rights invalidate old
approvals, even after reactivation; identical desired-state sync does not.
Installation administrators may consent to current/future companies. Members
select explicit companies; added assignments require renewed consent. The existing
external company-onboarding flow continues to require the protected owner.
Historical owner-only descriptions below apply to legacy/single-user operation.

## Installation bootstrap

The owner establishes an authenticated admin identity before entering secrets or connecting companies. S00 selects a maintained authentication component appropriate to both runtimes; do not invent OAuth cryptography. Bootstrap uses a one-time, expiring secret delivered outside model context, then is disabled. Bind admin sessions and CSRF protection to that identity.

Admin operations and MCP tool grants are separate: a model-callable bearer token must not authorize owner-policy edits or secret export. No admin tool is published to the model. The owner can revoke client grants and disconnect companies.

## AI client → MCP server

Implement the authorization requirements of each supported MCP protocol revision using a tested OAuth component: HTTPS, protected-resource/authorization-server metadata, appropriate issuer/audience/resource checks, PKCE, exact registered redirect validation, expiring codes and tokens, and client registration/metadata compatibility where required. Never accept a Fortnox access token as this server's own access token.

Restrict each MCP grant to its authenticated subject, current membership and authorized capabilities. Legacy grants remain owner-only. Do not implement transparent token passthrough. A valid token for one audience or installation must fail on another. Record the actual supported discovery and refresh behavior in the client matrix.

## MCP server → Fortnox

Only one unexpired Fortnox consent may be pending per authenticated admin
session. A second start returns `CONSENT_IN_PROGRESS` before provider navigation;
finish the first flow or explicitly cancel it in Operations, then start fresh.
Claimed exchanges remain protected from cancellation. Independent sessions
retain the four-flow owner-wide bound. This prevents overlapping starts from
the same admin session without weakening callback binding. Actual provider
continuation and post-deployment recovery remain separately verified.

Each installation registers its own integration and redirect URI in the Fortnox developer portal. Client ID is public; Client Secret is stored as a secret and never delivered to a widget or model. Request scopes for enabled modules and require reauthorization when adding scope.

Preferred long-lived connection: service account, where the authorizing person has the necessary Fortnox system-administrator rights. After service-account consent, Fortnox supports client-credentials token issuance with Client ID/Secret and numeric TenantId. Obtain the tenant through the authenticated activation flow and Company Information; bind `state` to the initiating owner/session and use PKCE where supported/configured. Do not accept an arbitrary webhook or model-supplied tenant as proof of consent.

Optional user-account connection: authorization-code flow with rotating refresh tokens. This remains necessary where service-account consent is unsuitable. Fortnox documents one-hour access tokens, 45-day refresh-token validity and invalidation of the old refresh token after rotation. Serialize refresh, save the replacement atomically and mark an expired/revoked connection as requiring reconnection.

Client-credentials access does not mean a user can connect any tenant without consent. Keep company grants and scope checks even when no refresh token is stored.

## Company identity and privilege

After activation, verify the company identity through an authorized provider response and display its name/organization number to the owner. Never infer ownership solely by decoding an unverified JWT. `/3/me` includes a `SysAdmin` field in the supplied specification, but service-account identity and the human administrator are not interchangeable. S00 tests semantics before using it for any privilege decision. Policy administration is assigned to the installation owner and, when team access is enabled, active installation administrators. An upstream token never establishes this authority.

Different connections must not share mutable headers, selected company or fiscal-year state. If the same tenant is connected twice, deduplicate deliberately or require owner resolution; do not let duplicate aliases bypass rate limits, write intents or approval policies.

## Failures and revocation

- `401`: refresh/reacquire once where appropriate, without blindly replaying an uncertain write.
- Missing scope/license/permission: explain the missing capability; never escalate or reconnect automatically with broader scope.
- Revocation/disconnection: disable use immediately in local state, invalidate pending approvals and remove stored credentials. Revoke upstream where the verified API permits it.
- Wrong `state`, redirect, issuer, audience, owner or company: fail closed without disclosing credentials.

The isolated [S00 OAuth probe](../../spikes/s00-oauth/README.md) exercises a maintained
provider's real authorization-code, refresh and revocation endpoints on local
Node/SQLite and workerd/D1. It uses only a synthetic owner and read-only fixture.
[Evidence](../implementation/S00-oauth-evidence.md) also records successful live
ChatGPT owner consent, an authenticated synthetic tool call and remote refresh
rotation. It distinguishes these results from pending lifecycle checks and the
S02 production implementation.

## Company program consent (S11 / #117)

The [2026-11-13 access renewal](../implementation/access-renewal-2026-11-13.md)
classifies program changes as no-op, local selection or provider consent. Local
selection with existing scopes advances a separate access revision, leaving
provider credentials/generation and voucher policy intact. Safe additive reads
can coexist with unknown writes; in-flight writes still block them. Selected-company
approvals become stale; installation-wide approvals follow the owner-managed
connections and their current program selections.

Ordinary OAuth consent explicitly authorizes all current and future connections
of the installation owner (`companyAccess: owner_connections`). The consent page
names the current companies and explains future access. Its focused responsive
layout reuses the administration's brand, CSS tokens and controls; requested
read/write/file/refresh capabilities are listed separately. File-retention and
policy disclosures remain visible. The server resolves
company membership on each request; neither a supplied company ID nor the mere
existence of an OAuth registration grants access. An empty installation may be
approved before the first company is connected. Owner-authorized program changes
and verified reconnects are available through the existing client authorization.
Disconnection immediately blocks that company. OAuth read/write/file scopes,
provider scopes, program availability, read-only and voucher policy still apply.
This does not revalidate proposals, approvals, files or intents bound to older
company/generation/access/policy versions.

Older approvals retain their selected companies and exact connection/access
versions until the owner explicitly chooses **Allow all current and future
companies** in AI clients. The owner-session-only, exact-Origin endpoint
`POST /admin/clients/company-access` binds the observed registration, approval
identity and revision. It changes company membership for that authorization
without replacing tokens, extending expiry or adding OAuth capability scopes.
The model's bearer token cannot perform this upgrade. Legacy unversioned grants
use CAS on their existing row; versioned grants update their bounded, expiring
approval record. Expired approvals cannot be revived. External application
onboarding approvals remain selected-company grants and cannot be upgraded by
this endpoint or by adding the installation-wide flag to onboarding consent.

A new explicit OAuth approval can still renew the same registration and replaces
the authorization identity/revision. Tokens, refresh families and unspent codes
from older approvals cannot acquire the replacement's rights. Installation-wide
domain authorization checks the current registration as well, fencing in-flight
requests after replacement. Successful refresh retains company access mode for
the actual library token lifetime. Hosted-client acceptance remains separate;
see [implementation and evidence](../implementation/installation-company-access.md).

Initial product consent requests `companyinformation profile` only. Additional
access uses the existing company connection, not a separate service account for
each program. The shared program/function manifest derives the per-company union
from existing scopes and explicitly selected, currently allowed features. Owner
APIs accept program IDs and a revision, never arbitrary scopes or credentials.
Every private deep link and program/grant API requires the owner session; browser
POSTs require the exact installation Origin. MCP bearer tokens cannot administer
programs.

An extension binds owner/session/company/generation/policy/program revision and
requested scopes. The authenticated provider tenant must match before replacement;
partial scope responses fail closed. Replacement advances generation and invalidates
old proposals and selected-company grants while retaining the stable company ID and current policy.
Cancellation/failure does not delete the working local credential. Actual upstream
invalidation remains subject to provider acceptance and normal reconnect handling.
Local disable retains provider scopes but blocks current domain/provider calls;
shared scopes remain usable by other enabled programs. Reactivation requires a new
explicit consent flow. Uncertain writes block changes to affected programs and all local disable operations. A narrowly additive payroll consent may proceed with an older tenant-bound register/document outcome, preserving that outcome and its write block. In-flight, unbound, bookkeeping, receipt and payroll uncertainty still block it. Owner-only same-origin reconciliation uses a temporary read-only internal identity; recovery does not widen MCP grants or change intent identities.
See [implementation and acceptance boundaries](../implementation/S11-company-programs.md).

## External application company onboarding (#146)

The opt-in [company-onboarding-v1 contract](company-onboarding-v1.md) composes confidential-client initiation, protected owner connection actions and explicit OAuth company consent. The backend-only requirement applies only to this new API. Existing public MCP clients and standalone onboarding retain their existing boundaries.


### Optional confidential-backend offline policy

`MCP_OFFLINE_CLIENT_IDS` defaults to an empty JSON list. Active pre-registered
`client_secret_basic` backends with explicit `offline_access` consent may receive
30-day rolling refresh tokens; their pair is independent of owner web sessions
and retained onboarding attempts. Access tokens still last five minutes.
Successful issuance/rotation persists the actual library row expiry/session
binding and matching immutable approval/family expiry before returning the pair.
No scope/company right is added; revoked or superseded families cannot be renewed.
Policy removal fences detached families immediately. Existing pairs are not
rewritten at boot; expired or uncertain pairs need fresh explicit app consent.
See [migration, recovery and bounded verification](../implementation/onboarding-continuity.md).
