# Authentication and company authorization

The protected owner application uses same-origin Hono routes and built React/Vite
assets. `/admin/state` requires an owner session; MCP bearer tokens cannot
administer the installation. `/admin/fortnox/configuration` accepts strict,
write-only credentials with the exact browser Origin and encrypts them using the
existing vault, bound to the installation owner. Status returns only
`configured`/`source`. Operator ENV credentials take precedence and cannot be
overwritten through the UI. New consent uses these settings; existing connections
retain their original encrypted credentials until explicitly reconnected.

The product integration uses Better Auth 1.7.10, a ten-minute one-time operator bootstrap and subsequent owner email/password login. Public signup and password-reset requests are not exposed. Sessions are database-validated and admin browser POSTs require the exact installation Origin. See [implementation and remaining acceptance](../implementation/M02-connections-evidence.md).

Reset issuance requires installation access. The D1 [operator recovery bridge](../implementation/M02-owner-recovery.md) imports a library-issued ten-minute verification record only when the existing owner ID/email match; it never replaces the owner. The public fixed `/reset-password` form only redeems that private code through the maintained auth component, with exact Origin checks and admin-session revocation.

Sources: [F01–F04, F06 in sources](../reference/sources.md). OAuth between the AI client and this server is separate from OAuth between this server and Fortnox.

## Identities

| Object | Meaning |
| --- | --- |
| Installation owner | The one human principal authorized to administer the initial installation |
| MCP client authorization | A client-specific grant to invoke allowed tools for that owner |
| Fortnox connection | Provider credentials, tenant identity, granted scopes, account type and status |
| Company handle | Opaque stable local ID mapping to a connection the caller may use |

The server resolves allowed connections from authenticated identity. It checks this for every list, read, write, file, proposal, continuation and status lookup. An organization number, provider ID or local company handle supplied by the model never grants access.

## Installation bootstrap

The owner establishes an authenticated admin identity before entering secrets or connecting companies. S00 selects a maintained authentication component appropriate to both runtimes; do not invent OAuth cryptography. Bootstrap uses a one-time, expiring secret delivered outside model context, then is disabled. Bind admin sessions and CSRF protection to that identity.

Admin operations and MCP tool grants are separate: a model-callable bearer token must not authorize owner-policy edits or secret export. No admin tool is published to the model. The owner can revoke client grants and disconnect companies.

## AI client → MCP server

Implement the authorization requirements of each supported MCP protocol revision using a tested OAuth component: HTTPS, protected-resource/authorization-server metadata, appropriate issuer/audience/resource checks, PKCE, exact registered redirect validation, expiring codes and tokens, and client registration/metadata compatibility where required. Never accept a Fortnox access token as this server's own access token.

Restrict each MCP grant to the installation owner and authorized capabilities. Do not implement transparent token passthrough. A valid token for one audience or installation must fail on another. Record the actual supported discovery and refresh behavior in the client matrix.

## MCP server → Fortnox

Each installation registers its own integration and redirect URI in the Fortnox developer portal. Client ID is public; Client Secret is stored as a secret and never delivered to a widget or model. Request scopes for enabled modules and require reauthorization when adding scope.

Preferred long-lived connection: service account, where the authorizing person has the necessary Fortnox system-administrator rights. After service-account consent, Fortnox supports client-credentials token issuance with Client ID/Secret and numeric TenantId. Obtain the tenant through the authenticated activation flow and Company Information; bind `state` to the initiating owner/session and use PKCE where supported/configured. Do not accept an arbitrary webhook or model-supplied tenant as proof of consent.

Optional user-account connection: authorization-code flow with rotating refresh tokens. This remains necessary where service-account consent is unsuitable. Fortnox documents one-hour access tokens, 45-day refresh-token validity and invalidation of the old refresh token after rotation. Serialize refresh, save the replacement atomically and mark an expired/revoked connection as requiring reconnection.

Client-credentials access does not mean a user can connect any tenant without consent. Keep company grants and scope checks even when no refresh token is stored.

## Company identity and privilege

After activation, verify the company identity through an authorized provider response and display its name/organization number to the owner. Never infer ownership solely by decoding an unverified JWT. `/3/me` includes a `SysAdmin` field in the supplied specification, but service-account identity and the human administrator are not interchangeable. S00 tests semantics before using it for any privilege decision. V1 policy administration is assigned to the installation owner, not automatically to whoever presents an upstream token.

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
