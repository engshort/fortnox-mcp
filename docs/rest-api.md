# Integrating an application with the read API

The opt-in REST API shares services with MCP. Read the [contract](contracts/rest.md)
and [coverage/evidence](implementation/REST-read-api.md) before enabling provider
operations. C bindings and a CLI are outside this version.

## Configure and register

Use the existing Node/Worker installation. Set `REST_API_ENABLED=true` and include
the application's exact HTTPS callback in `MCP_REDIRECT_URIS`, the shared client
redirect allowlist. Leave `FINANCIAL_READ_MODULES` empty for metadata only.
Provider reads retain existing test gates. For an authorized test run, select
financial modules and reconnect to Fortnox if required scopes are absent.

Fetch `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource/api/v1`. Register using
`POST /auth/oauth2/register` and this synthetic example:

```json
{
  "client_name": "Example read application",
  "redirect_uris": ["https://client.example.invalid/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "api:read api:finance:read offline_access",
  "resources": ["https://installation.example.invalid/api/v1"]
}
```

This public PKCE client needs no client secret. A server application may instead
use the maintained provider's confidential-client authentication and keep its
secret server-side. Always use PKCE; a secret does not replace it.

## Obtain consent and tokens

Generate a cryptographically random verifier and state, retain them in a
protected application session and send the owner to `/auth/oauth2/authorize`
with `response_type=code`, registered client/redirect, requested scopes,
`resource=<installation>/api/v1`, `state`, the S256 `code_challenge` and
`code_challenge_method=S256`. Validate state and issuer on the callback.

The owner signs in and selects companies on the installation's consent page.
Exchange the code with form-encoded `POST /auth/oauth2/token`, using
`grant_type=authorization_code`, client ID, exact redirect, the same resource and
original `code_verifier`. Store tokens privately. Access tokens currently last
five minutes. Refresh rotates with the existing one-day maximum lifetime, so
renewed owner authorization is eventually required. Serialize refresh and save
its replacement atomically. Never send these tokens to Fortnox or use an owner
cookie as API authorization.

## Read and renew

This server-side TypeScript example assumes an authorized API token:

```ts
const base = "https://installation.example.invalid";
const headers = { Authorization: `Bearer ${accessToken}` };
const response = await fetch(`${base}/api/v1/companies`, { headers });
if (!response.ok) throw new Error("Company lookup failed");
const result = await response.json();
// Select explicitly from result.data.companies; never guess company IDs.
```

Check `/api/v1/capabilities` for this client's enabled operations. Use the selected
company's `financial-years` endpoint to discover provider year IDs. For financial
lists, repeat the same `limit` and pass `continuation` until it is null. Inspect
`evidence.complete`; pages are not one atomic snapshot. After cursor expiry,
restart traversal and handle possible repeated records by company-scoped IDs.

Refresh with form-encoded `/auth/oauth2/token`, `grant_type=refresh_token`, the
saved refresh token, client ID and same resource. Revoke using
`/auth/oauth2/revoke` and the maintained provider's revocation flow. A revoked
token receives 401. A 403 for a missing capability does not authorize automatic
scope escalation or reconnection.

Authenticated `GET /api/v1/openapi.json` describes the API. `npm run build` also
generates `dist/openapi.json`; Docker includes `/app/dist/openapi.json`. This is
the project's own definition, not a redistributed Fortnox specification.
