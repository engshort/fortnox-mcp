# Milestone 2 implementation and acceptance

This record separates executable product integration from actual hosted/client/provider acceptance. All fixtures are synthetic. No financial write is enabled. G01 #31 remains closed within its owner-accepted scope; product acceptance is separate. G05 #35 and full G06 #36 remain separate.

## M01 — owner bootstrap (#55)

The product admin handler claims an expiring operator-provisioned bootstrap using a durable CAS. Only the winning request invokes Better Auth signup; restart never reopens bootstrap. Public signup is not forwarded. A failure after claiming requires operator investigation of the existing account before recovery, never deletion/reseeding of the owner.

Better Auth 1.7.10 manages password hashing, cookies, sessions and ten-minute single-use password resets. Installation-wide durable login budgets supplement its database-backed rate limiter. Admin sessions expire after 24 hours, are not cookie-cached and are revoked by password reset. MCP bearer tokens cannot authenticate admin requests.

Run root `npm run typecheck`, `npm run lint`, `npm test`. The shared owner contract runs in Node/SQLite and local workerd/D1: concurrent bootstrap, replay, expiry, origins, password login, recreated handler, logout and operator reset. Hosted deployment, browser accessibility and actual owner lifecycle are not established by these tests.

The operator command reads an ignored private JSON file, never credential arguments. Migrations must be applied first. `bootstrap` provisions only an empty installation; `reset` verifies the existing owner's email and writes the library-issued token privately. The command operates on local SQLite; D1 provisioning uses a reviewed, private conditional insert as described in the user guide. Never copy the probe's owner/grants into the product installation.

Observed M01 checks (2026-11-06): root typecheck passed; three shared owner cases passed on Node/SQLite and three on local workerd/D1. Miniflare required loopback access outside the filesystem/network sandbox. Hosted acceptance was not run.

## M03 — encrypted company connections (#57)

The portable core owns the connection policy and vault. SQLite/D1 share one bounded JSON/CAS operational store. Each owner's connection set is limited to 20 companies and 128 KiB; reaching capacity fails explicitly. A single CAS enforces tenant uniqueness and atomic credential replacement. Company grants bind owner, client and connection generation. The model-supplied handle never establishes permission.

AES-256-GCM uses a fresh 96-bit nonce and authenticated owner/company/generation/mode binding. Key IDs select external deployment keys; decrypt failures disclose no ciphertext or credentials. Rotation decrypts/re-encrypts a complete bounded snapshot and commits by CAS, retaining the previous snapshot on failure. Keep both keys until rotation and restore have been verified; remove the retired key afterward. Read-only and `review_required` are immutable defaults in this read-only milestone.

Local checks cover A/B and owner isolation, duplicate tenants, wrong/missing keys, ciphertext binding, key rotation and persistence across recreated services. A separate Node test closes and reopens the actual SQLite file. No financial record replica is stored. Hosted backup/restore and the full M20 lifecycle remain later acceptance.

## M02 — product MCP OAuth (#56)

Better Auth/provider 1.7.10 and MCP server 2.3.1 provide separate owner-bound OAuth and modern/legacy HTTP transports. Access tokens expire in five minutes, authorization codes in ten minutes and refresh tokens in one day. Every private request performs database-backed token verification plus issuer/resource/owner/scope checks. Invalid supplied credentials never fall back to public discovery; mixed private/public batches require authentication.

Client redirects are an installation allowlist. Company grants are immutable snapshots per OAuth client registration; adding or reconnecting a company requires a new registration/consent in this version. This deliberate restriction prevents an old access or refresh token inheriting a new connection generation. Existing consent can be reused only for the original snapshot. Public metadata contains no company identities. Administrative/password routes remain distinct from OAuth token endpoints.

The shared real-library flow checks DCR redirects, S256 code exchange, wrong verifier, code reuse, resource-bound validation, refresh replacement, access-token revocation, anonymous/mixed batch denial and invalid-token metadata denial. Actual ChatGPT saved-answer/reload and product lifecycle acceptance remain required; #31 is not reopened or re-closed by these local tests.

Observed M02 checks (2026-11-06): root typecheck and six product contract cases passed on Node/SQLite and local workerd/D1. Code-replay testing occurs after refresh: the maintained provider invalidates the affected token family on replay. No live ChatGPT or Fortnox request was made.

## M07 — bounded Fortnox HTTP (#61)

The adapter registers only Company Information and identity GET reads. No arbitrary URL/method/body surface exists; email/eprint and all mutations are unavailable. Fixed API origins/paths, manual redirect handling with explicit 3xx rejection, 5-second attempts, 64-KiB streamed response bounds and a 15-second/three-attempt read budget prevent unbounded fetches. A durable per-client/tenant CAS reserves one request per 210 ms (conservatively below 25 per five seconds). Retries honor numeric Retry-After only within the remaining budget; 401 reacquisition is bounded to one recovery path.

Pagination is endpoint-specific and a shared helper returns explicit partial results with a next-page position. Ten-minute continuations bind owner/company/generation/query; at most 32 are retained per owner, with expiry cleanup on creation. These helpers have synthetic multi-page tests; no additional Fortnox list operation is thereby enabled. Provider errors retain numeric codes only; unknown 403 causes remain `permission_scope_or_license_unknown` rather than inventing a missing license or scope.

## M04 — durable Fortnox service consent (#58)

The original oauth4webapi 3.8.8 mechanism is integrated with encrypted, owner/admin-session-bound, ten-minute PKCE flows. Four pending flows per owner are allowed; expired entries are removed when a new flow starts. A callback must match the configured origin/path, state and initiating session; a durable CAS claims it before token exchange. Errors never serialize library objects or provider response bodies.

The authenticated Company Information response must match the explicit test-tenant allowlist before client-credentials issuance. The new client-credentials token is verified against that same tenant before storage. Service refresh tokens from code exchange are deliberately discarded. Renewal uses a durable fenced lease and atomic replacement; service-account identity is never installation-owner identity. This adds no production authorization and does not expand G04's historical probe evidence.

## M05 — user refresh rotation (#59)

User consent omits service-account parameters and requires an offline refresh token. The token source never falls back to client credentials. It verifies a rotated replacement token's tenant before atomically saving access/refresh/expiry together. Expiry is supplied by the actual provider response, not an assumed lifetime.

Renewal locks are durable and fenced. Credentials are reread after reserving the current snapshot, preventing stale refresh use after another renewal finishes. An uncertain exchange, invalid replacement or persistence failure removes usable credentials and marks reconnection required where storage is available. If storage remains unavailable, the persisted dispatched lease blocks reuse after restart/expiry. No refresh call is retried blindly. Pending leases return a structured rate-limit result instead of issuing a second rotation.

## M06 — disconnect and reconnect (#60)

Disconnect atomically removes credentials/renewal state and advances connection generation and policy version. Every queued provider attempt rechecks durable authorization. A token response already in flight is fenced from saving or reactivating a disconnected connection. An upstream request already dispatched cannot be recalled.

Reconnect repeats PKCE consent and authenticated tenant verification. The same tenant retains its company handle with a new generation; selecting another allowed tenant creates a separate handle and leaves the old connection disconnected. A stale reconnect flow cannot overwrite a later generation. Registration-bound grants never inherit the new connection; a new MCP registration/consent is required. Minimal existing execution-intent metadata is left intact; financial proposal/execution tools remain unavailable and must adopt generation/policy binding in their later scopes.
