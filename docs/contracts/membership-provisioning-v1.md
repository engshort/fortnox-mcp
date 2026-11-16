# Membership provisioning v1

Wire version: `membership-provisioning-v1`. This installation-local, generic
REST contract implements the owner's 2026-11-16 team-access request. It has no
dependency on M2X, a hosted control plane, SCIM or external SSO. The
[OpenAPI description](../reference/membership-provisioning-v1.openapi.json)
defines inputs and responses. [Implementation and evidence](../implementation/team-access.md)
distinguish local tests from actual consumer acceptance.

## Installation and authority

Both `MULTI_USER_ENABLED` and `MEMBERSHIP_PROVISIONING_ENABLED` default to false.
Enable the former for team accounts and the latter for the backend API. Create a
source under Administration → Integrations (Membership integrations). The installation returns
an opaque `source-id.secret` credential once. Keep it in the consumer backend's
secret store. Only its SHA-256 digest is retained. Rotation immediately replaces
the credential; revocation stops provisioning without deleting provisioned users.

Sources have an explicit company allowlist. Only the protected installation owner
can delegate administrator provisioning. That delegation permits full-installation
administrators, even when the source's member-company allowlist is narrower.
Ordinary administrators can manage local administrators and member-only sources;
they cannot rotate a source with owner-delegated administrator authority.
To change a source's company ceiling, create a replacement source and explicitly
transfer memberships. Do not assume that adding a Fortnox company widens a source.

Backend requests use `Authorization: Bearer <source-id.secret>`, HTTPS and JSON.
Cookies and Origin headers are rejected; browser CORS is not enabled. These
credentials cannot call MCP, connect Fortnox companies or use the admin API.
MCP tokens and existing company-onboarding credentials cannot provision users.
Every source is installation-bound. No request accepts an owner or installation ID.

## Identity, roles and lifecycle

An external user is keyed by `(source_id, external_id)`. External IDs contain
1–128 ASCII letters, digits, `_` or `-`; they are case-sensitive and stable.
Email is normalized to lowercase and unique within the directory. It is never
proof that an integration controls an existing login. Existing accounts require
an administrator's explicit email-matched link; the installation owner cannot
be linked or provisioned. Activated accounts' email cannot be changed through
this API. Display name, active status, role and assignments can be updated.

`role` is `member` or `admin`. Each company assignment is `read` or `read_write`.
Administrators have installation-wide authority; company assignments constrain
members. Company read-only mode, program/provider scopes and voucher review
policy still apply. New users remain unlinked until invitation acceptance or
explicit account linking. There is no password field or public signup.

Each membership has exactly one managing source, `local` or a source ID. External
sources cannot take over another source's membership or a matching local email.
Local administrators may transfer ownership and always retain an emergency block.
Provisioning preserves that block, even when the source sets `active: true`.
Set `active: false` explicitly to deactivate; omitted users are never removed.
There is no hard-delete or full-snapshot deletion operation.

Changed membership revisions invalidate old OAuth approvals and token families;
unblocking/reactivation cannot revive them. An identical desired-state update
preserves the revision, so periodic unchanged syncs do not disconnect users.
Members must consent again after changes and when assigning additional companies.
Client authorizations and private work are separated by authenticated user and
OAuth client. Existing owner grants remain owner-only and keep their original keys.

## Read and replace

`GET /api/membership-provisioning/v1/users?limit=50&after=<external-id>` returns
the source's users sorted by external ID, with `next` or null. Limit is 1–50.
`GET .../users/{external_id}` returns `{version,user}` and `ETag: "<revision>"`.
Foreign and missing IDs return the same 404. Listings contain identity, assignments,
source, revision, block and invitation-pending status, but no token/hash/password.

`PUT .../users/{external_id}` replaces the desired membership:

```json
{
  "email": "synthetic-user@example.invalid",
  "name": "Synthetic user",
  "role": "member",
  "active": true,
  "companies": {"00000000-0000-4000-8000-000000000001": "read"}
}
```

All fields are required; unknown fields are rejected. Use `If-None-Match: *` to
create (201), or `If-Match: "<revision>"` to replace (200). Include a new UUID
`Idempotency-Key` for each logical mutation. Save the desired input, precondition
and key before dispatch. Responses include `{version,user}` and the resulting ETag.
On revision conflict, read current state before choosing another update.

An identical retry returns the original result for 24 hours, even after later
updates. Reusing the key for changed input, a different user or another operation
returns `IDEMPOTENCY_CONFLICT`. Results represent that operation's outcome; GET
retrieves current state. After retention expires, reconcile with GET before another
write. Creation cannot overwrite an existing user without its current revision.

## Invitations and interrupted activation

`POST .../users/{external_id}/invitation` accepts `{}`, `If-Match` and a new
`Idempotency-Key`. It returns `{version,invitation_url,expires_at,revision}`.
The existing revision advances; an identical retry returns the original invitation.
Pending source authorization is rechecked before issuance. Only active, unblocked,
unlinked users can receive an invitation. Deliver the link through the consumer's
existing secure user flow; invitation emails are not required or sent automatically.

The invitation secret is in the URL fragment. The page removes it from history
after mounting and posts it with the user's chosen password to the exact-origin
`/api/invitations/accept`. It lasts at most 24 hours and is durably claimed once
before account creation through Better Auth. Source/UI listings never reveal it.
Only the hashed invitation is kept on the membership; idempotent machine results
are encrypted under the installation vault with source/operation binding.

Lost activation responses require status inspection or login with the chosen
password. Do not automatically replay account creation. If a library-created
account exists but linking was interrupted, an administrator explicitly links
that exact account. If no account was created, issue a replacement invitation.
Existing-account collisions never reset passwords or silently attach the account.

## Bounds, errors and recovery

The first slice supports 100 memberships, 16 sources, 50 company assignments per
member/source, 128 retained idempotent operations and 128 audit events, within a
120,000-character operational snapshot. Capacity returns 503 without eviction of
live results or partial membership changes. Audit records contain actor/source/
target IDs, action and time, not passwords, secrets, payloads or financial data.
The API permits 60 authenticated requests per source per minute. Invitation
acceptance has a separate durable installation budget of ten attempts per minute.

Errors use `{version,error}`. Statuses: 400 `VALIDATION_FAILED`, 401
`AUTH_REQUIRED`, 403 `COMPANY_FORBIDDEN`, 404 `MEMBER_NOT_FOUND`/`NOT_FOUND`,
405 `METHOD_NOT_ALLOWED`, 409 `CONNECTION_CONFLICT`/`IDEMPOTENCY_CONFLICT`,
428 `PRECONDITION_REQUIRED`, 429 `RATE_LIMITED`, 503 `CAPABILITY_UNAVAILABLE`.
Disabled features return 404. Errors never echo credentials or request bodies.

SQLite and D1 persist the same versioned CAS directory in `product_state`; no
financial database or re-encryption of company connections is introduced.
Cleanup removes expired invitation/idempotency state. Vault rotation invalidates
temporary invitations/results. Restore additionally blocks non-owner memberships
and revokes source credentials for explicit owner review. Actual financial
write/reconciliation state remains unchanged by membership operations.

## Consumer integration, including M2X

Use stable local user IDs as `external_id`; map installation company handles to
the consumer's verified company/customer assignments. Do not use Fortnox tenant
IDs or organization numbers as authorization. Initial connect/reconnect remains
the separate [company-onboarding-v1](company-onboarding-v1.md) flow. Store its
credentials separately from the provisioning source credential.

For each desired user: GET current state, create or replace with its precondition,
then deliver an invitation if needed. Explicitly send deactivation for removed
members. A 404 means missing or inaccessible, not permission to adopt a matching
email. Handle conflicts and local blocks visibly. M2X uses this same contract;
its implementation and real cross-repository acceptance are separate work.
