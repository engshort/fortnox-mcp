# Company onboarding v1

Wire version: `company-onboarding-v1`. Agreed with the M2X #11 implementation
chat on 2026-11-15. Implementation and acceptance evidence are tracked separately;
this document does not claim that cross-repository or real-provider tests passed.

## Setup and boundaries

Configure the installation, installation owner and Fortnox integration first.
Register a dedicated OAuth client with `client_secret_basic`, authorization-code
and refresh grants, exact HTTPS callback and `mcp:read offline_access` scopes.
Registration uses the existing `/auth/oauth2/register` endpoint and installation
callback allowlist (`MCP_REDIRECT_URIS`). Privately store the returned client
credentials in the consumer backend. Set `EXTERNAL_APP_ONBOARDING_ENABLED=true`
and `EXTERNAL_APP_ONBOARDING_CLIENT_IDS='["<registered-client-id>"]'` on the
installation. The feature defaults off and the client list defaults empty.
This setup is per installation/client, never per company.

The backend-only restriction applies exclusively to this new API. Existing public
MCP clients, ordinary OAuth/PKCE, ChatGPT and standalone company onboarding retain
their existing contract. The consumer administrator is not the installation
owner; starting an attempt gives no company or installation administration rights.
No provider credentials or owner cookies are forwarded to the consumer.

## Start

`POST /api/company-onboarding/v1/attempts`, `Authorization: Basic ...`,
`Content-Type: application/json`, `Idempotency-Key: <UUID>`:

```json
{
  "action": "connect",
  "redirect_uri": "https://consumer.example.invalid/fortnox/callback",
  "state": "cryptographically-random-consumer-state-at-least-32-characters",
  "code_challenge": "<43-character-base64url-SHA256-PKCE-challenge>",
  "code_challenge_method": "S256",
  "scope": "mcp:read offline_access"
}
```

`action` is `connect` or `reconnect`. Reconnect requires `expected_company_id`
(UUID); connect forbids it. Scope is exactly `mcp:read` or
`mcp:read offline_access`. State is 32–256 ASCII unreserved characters;
redirect URI is at most 1024 characters and must exactly match both allowlists.
Only original fields are accepted. Store local administrator/session binding,
state, verifier and idempotency key durably **before** dispatch.

201 response (also returned for an identical idempotent retry):

```json
{
  "version": "company-onboarding-v1",
  "attempt_id": "<UUID>",
  "attempt_revision": 1,
  "authorization_url": "https://installation.example.invalid/connect/company/<UUID>?revision=1",
  "expires_at": "2026-11-15T12:30:00.000Z",
  "retain_until": "2026-11-16T12:00:00.000Z"
}
```

Navigate the browser to `authorization_url`. The installation handles owner
login, existing-company selection or Fortnox connection/tenant verification,
then **explicit client company consent**. The full intended company selection
is displayed: adding B retains current, previously approved A. An expired/stale
previous selection is not silently promoted to a newer connection/access version.
Provider state/PKCE is separate from consumer state/PKCE.

Connecting a company never enables a financial module or changes voucher policy.
An existing tenant is not added as another technical company. Reconnect is bound
to the expected company; selecting another tenant cannot replace it.

## Callback, code exchange and result

Success returns to exactly `redirect_uri` with the existing OAuth provider's
`code`, `state` and `iss`. Cancellation returns standard `error=access_denied`,
state and issuer. Browser flags/IDs are not evidence. The consumer checks its
current administrator/session, exact state and issuer (`<installation>/auth`).
The backend exchanges the code at `/auth/oauth2/token` with
`grant_type=authorization_code`, `code`, `code_verifier`, exact `redirect_uri`,
`resource=<installation>/mcp` and its `client_secret_basic` credentials. Request
form encoding and discovery follow existing OAuth metadata. There is no second
or custom token issuer. With persistent access, verify receipt of a refresh token.

Then `GET /api/company-onboarding/v1/attempts/{attempt_id}/result` with the
consumer's own `Authorization: Bearer <MCP-access-token>` returns:

```json
{
  "version": "company-onboarding-v1",
  "attempt_id": "<UUID>",
  "attempt_revision": 1,
  "outcome": "completed",
  "company_id": "<stable-opaque-UUID>",
  "generation": 1,
  "access_revision": 0,
  "grant_revision": 1,
  "connection_status": "active",
  "completed_at": "2026-11-15T12:05:00.000Z",
  "retain_until": "2026-11-16T12:00:00.000Z"
}
```

Result lookup rechecks owner, installation, OAuth registration, current immutable
approval, attempt revision and company generation/access/policy. It is repeatable
while retained and authorized. It cannot use the first `list_companies` item or a
before/after difference. Use exactly this `company_id` with existing
`get_company_profile` and `get_connection_status` through `/mcp`; obtain the
verified company name/organization number from the profile. Preserve the existing
MCP result/error envelope. The consumer owns local customer matching/access rules.

## Recovery and renewal

`GET /api/company-onboarding/v1/attempts/{id}` with Basic returns only `version`,
`attempt_id`, `attempt_revision`, `status`, `recovery_action`, `expires_at` and
`retain_until`. It returns no company identifiers, profile, code or tokens.
Statuses: `pending_owner`, `provider_pending`, `provider_outcome_unknown`,
`company_verified`, `approval_pending`, `authorized`, `cancelled`, `expired`,
`failed`. A successful redirect or `authorized` status alone is not consumer
completion; the bearer result and MCP reads are required.

`POST /api/company-onboarding/v1/attempts/{id}/resume`, Basic and a **new**
`Idempotency-Key`, takes:

```json
{
  "expected_attempt_revision": 1,
  "state": "new-cryptographically-random-consumer-state",
  "code_challenge": "<new-43-character-S256-challenge>",
  "code_challenge_method": "S256"
}
```

Persist the new local state/verifier/key before calling. 200 returns the same
start-response shape with the new revision and browser URL. Identical retries
return that operation's original result even when its expected revision is now
old; changed content with the same key gives `IDEMPOTENCY_CONFLICT`. Start keys
are client-bound; resume keys additionally bind the target attempt/operation.
This does not make `/auth/oauth2/token` idempotent.

Resume works after lost callback/exchange response, owner-session expiry,
consumer restart, cancellation or completed authorization, within retention.
The owner authenticates/binds the new browser continuation and explicitly approves
again. A verified company is retained; no second provider consent is dispatched.
Old browser and code bindings cannot complete the newer revision. Pending or
unknown provider exchange requires owner review, not automatic resume/replay.
An owner may cancel an unused, unclaimed provider flow or explicitly verify an
existing company; a claimed exchange cannot be cancelled. If no verified local
result/connection exists, unknown provider outcome needs operator investigation.
Never claim the original exchange failed merely because its response is missing.

Refresh uses the existing token endpoint with Basic,
`grant_type=refresh_token`, `refresh_token` and `resource=<installation>/mcp`.
Persist a renewal claim before dispatch and atomically save the replacement pair.
Do not retry an uncertain rotating refresh or consumed code. Invalid grant and
network/unknown response are different outcomes; use authenticated status and
resume for fresh explicit client authorization to the same verified company.

Adding B creates a new immutable approval for the displayed A+B selection. Old
access/refresh tokens and unspent codes become invalid under the existing renewal
contract. Serialise consumer token activation/refresh and atomically replace its
current pair. Do not reactivate an old A pair after the new approval. Changed grant
revisions fail with conflict and require a new review; other clients are untouched.

## Limits, errors and operations

Interactive attempts last 30 minutes. Results/recovery last 24 hours from start;
resume never extends that retention deadline. Existing OAuth codes last 10 minutes,
access tokens 5 minutes, refresh tokens 24 hours with rotation. Times are ISO 8601
UTC strings; revision fields are integers. At most 16 retained attempts per owner,
8 per client and 8 idempotent operations per attempt are retained. Capacity and the
installation request budget fail explicitly rather than evicting live attempts.
Use server-to-server API requests without owner/browser cookies; no CORS relaxation
or arbitrary return URL is provided. Local browser fixtures may directly configure
loopback origins under the existing explicit test harness policy; deployed ENV
callback validation remains HTTPS-only.

New API errors are `{version,error,recovery_action}` with fixed values:

| HTTP | Error |
| --- | --- |
| 400 | `INVALID_REQUEST`, `REDIRECT_DENIED`, `INVALID_SCOPE` |
| 401 | `AUTH_REQUIRED` |
| 404 | `ATTEMPT_NOT_FOUND` (including foreign or purged attempt) |
| 409 | `ATTEMPT_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CONSENT_IN_PROGRESS`, `OUTCOME_UNKNOWN` |
| 410 | `ATTEMPT_EXPIRED` (retained but expired browser continuation) |
| 429 | `RATE_LIMITED` |
| 503 | `TEMPORARILY_UNAVAILABLE` |

`recovery_action` is `none`, `wait`, `resume`, `owner_review` or `restart`.
Ordinary OAuth endpoints keep their standard OAuth error responses.

Attempts are bounded operational state, not another company/financial database.
Sensitive transaction inputs are encrypted using the existing installation vault.
Cleanup removes expired records. Restore and credential-key rotation invalidate
onboarding continuations/results while preserving actual companies and retained
financial work. After such maintenance start a new attempt and explicitly choose
the existing company. Logs must exclude codes/tokens, raw callback queries,
provider/company identity and request payloads. No merge, release, deployment,
production-company access, SSO or financial capability follows from this contract.
