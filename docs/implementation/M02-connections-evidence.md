# Milestone 2 implementation and acceptance

This record separates executable product integration from actual hosted/client/provider acceptance. All fixtures are synthetic. No financial write is enabled. G01 #31 remains closed within its owner-accepted scope; product acceptance is separate. G05 #35 and full G06 #36 remain separate.

## M01 — owner bootstrap (#55)

The product admin handler claims an expiring operator-provisioned bootstrap using a durable CAS. Only the winning request invokes Better Auth signup; restart never reopens bootstrap. Public signup is not forwarded. A failure after claiming requires operator investigation of the existing account before recovery, never deletion/reseeding of the owner.

Better Auth 1.7.10 manages password hashing, cookies, sessions and ten-minute single-use password resets. Installation-wide durable login budgets supplement its database-backed rate limiter. Admin sessions expire after 24 hours, are not cookie-cached and are revoked by password reset. MCP bearer tokens cannot authenticate admin requests.

Run root `npm run typecheck`, `npm run lint`, `npm test`. The shared owner contract runs in Node/SQLite and local workerd/D1: concurrent bootstrap, replay, expiry, origins, password login, recreated handler, logout and operator reset. Hosted deployment, browser accessibility and actual owner lifecycle are not established by these tests.

The operator command reads an ignored private JSON file, never credential arguments. Migrations must be applied first. `bootstrap` provisions only an empty installation; `reset` verifies the existing owner's email and writes the library-issued token privately. The command operates on local SQLite; D1 provisioning uses a reviewed, private conditional insert as described in the user guide. Never copy the probe's owner/grants into the product installation.

Worker/D1 recovery now has a separate [operator bridge](M02-owner-recovery.md): the pinned library issues a verification record in an ephemeral in-memory owner projection, then private SQL imports only that record conditional on the actual installation owner/email and unexpired lifetime. The same-origin `/reset-password` form redeems it through Better Auth. Native workerd/D1 tests cover guarded import, expiry, replay, CSRF, session revocation, new-password login and unchanged owner identity. A CLI subprocess verifies private output modes and no capability/identity/secret in logs. Actual hosted owner redemption remains pending.

Observed M01 checks (2026-11-06): root typecheck passed; three shared owner cases passed on Node/SQLite and three on local workerd/D1. Miniflare required loopback access outside the filesystem/network sandbox. Hosted acceptance was not run.

## M03 — encrypted company connections (#57)

The portable core owns the connection policy and vault. SQLite/D1 share one bounded JSON/CAS operational store. Each owner's connection set is limited to 20 companies and 128 KiB; reaching capacity fails explicitly. A single CAS enforces tenant uniqueness and atomic credential replacement. Company grants bind owner, client and connection generation. The model-supplied handle never establishes permission.

AES-256-GCM uses a fresh 96-bit nonce and authenticated owner/company/generation/mode binding. Key IDs select external deployment keys; decrypt failures disclose no ciphertext or credentials. Rotation decrypts/re-encrypts a complete bounded snapshot and commits by CAS, retaining the previous snapshot on failure. Keep both keys until rotation and restore have been verified; remove the retired key afterward. Read-only and `review_required` are immutable defaults in this read-only milestone.

An owner-bound encrypted key-check marker now protects metadata reads as well as credential access. Snapshot reads verify that marker and all remaining encrypted credentials, including mixed key versions; removing or replacing a still-required key blocks private company/status metadata. The marker remains after all credentials are disconnected, and rotates in the same CAS as the snapshot. Earlier experimental snapshots gain the marker by CAS only after every available credential decrypts successfully, preserving company handles, generations and grants. An earlier snapshot with neither a marker nor any encrypted credentials fails closed because it cannot prove the configured key; operator recovery is required rather than silently trusting a replacement key.

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

A grant for the immediately preceding generation receives `CONNECTION_DISCONNECTED` after explicit disconnect, with no profile or provider call. This is only a denial reason, not permission to read connection metadata. Unknown/ungranted companies remain `COMPANY_FORBIDDEN`, and an old grant remains forbidden after reconnect. Company lists omit the disconnected connection while retaining other authorized companies. This distinguishes local disconnection from a connection that requires new provider consent.

Reconnect repeats PKCE consent and authenticated tenant verification. The same tenant retains its company handle with a new generation; selecting another allowed tenant creates a separate handle and leaves the old connection disconnected. A stale reconnect flow cannot overwrite a later generation. Registration-bound grants never inherit the new connection; a new MCP registration/consent is required. Minimal existing execution-intent metadata is left intact; financial proposal/execution tools remain unavailable and must adopt generation/policy binding in their later scopes.


## M08 — company tools, runtime and private configuration (#62)

The product server exposes strict `list_companies` and `get_connection_status` contracts and an explicitly opt-in test-only `get_company_profile`. Each call resolves the database-backed MCP identity and immutable company generation grant. Every provider attempt, including retry, rechecks current connection state. Profile responses check DatabaseNumber against the selected verified tenant; only modeled fields reach the client. No raw credentials/provider error messages are returned.

`dev:product` starts a distinct loopback Node/SQLite product entry. The separate `apps/worker/wrangler.product.jsonc` entry is disabled by default; it never reuses S00 resources. `.env.example` documents configuration; actual `.env` and editor swap files are ignored. A ready private .env was generated locally and owner-populated values validated without printing any values or sending provider requests. HTTPS hosting and actual consent remain separate.

Expired temporary consent/continuation state is cleaned at Node startup/every five minutes and by the Worker five-minute scheduled handler. Cleanup preserves unresolved financial metadata. The local tests verify the cleanup function, not actual hosted scheduling.

Owner-authenticated consent failures report a fixed stage and domain reason, plus an allowlisted OAuth error and numeric status when the maintained library supplies them. Library errors, messages, causes, descriptions and response bodies are never attached. The shared HTTP regression starts consent through the product route, checks authorization denial and token-exchange failure redaction, and proves callback replay does not repeat an exchange. This supplements the earlier domain-level consent tests.

`test:integration` now runs opt-in two-company reads through authenticated MCP using `.data/acceptance.json` with private `origin`, `accessToken`, two `companyIds` and `serverCommit`. Set `FORTNOX_ACCEPTANCE_CONFIRM=test-companies-only`. It prints aggregate results only; the supplied source commit must be verified against deployment separately. `test:clients` validates a private manual evidence record (set `ACCEPTANCE_CONFIG`): serverCommit, observedAt, client, runtime, limitations and checks for ownerLogin, oauthConsent, listTwoCompanies, readBothProfiles, wrongCompanyDenied, refreshAfterExpiry, revocation, renewableReconnect, savedAnswer, conversationReload and reloadTools. Record validation does not execute or prove a browser action. Missing evidence fails with a nonzero exit.

### Observed offline verification — 2026-11-06

Node 24.19.0, npm 11.9.0. Root typecheck, lint and build passed. `npm test`: **58 Node/domain tests and 46 actual local workerd/D1 tests** passed, including the shared sixteen-case product contract, modern SDK 2 and legacy HTTP access to two synthetic companies. `npm run test:build`: **six built-artifact cases** passed with dynamic code generation disabled, including actual Node startup/migrations/bootstrap. Product Wrangler dry-run passed (about 3,464 KiB / 615 KiB gzip); this is bundle evidence, not hosted CPU acceptance. Shared local regression uses the foundation test configuration; the narrower hosted checks on the product target's newer compatibility date are recorded below.

A runtime dependency audit initially found transitive Zod 4.6.5. Root Zod is now explicitly pinned to the project's existing 4.6.7; `npm audit --omit=dev` reports zero findings. Development-only toolchain audit findings remain separate from product runtime support. No broad dependency upgrade was performed.

At this offline checkpoint, actual product owner lifecycle, Fortnox consent/expiry/revocation/two-tenant reads and ChatGPT saved-answer/reload/Reload tools had not been verified. Subsequent hosted observations are recorded below. Remaining lifecycle requirements prevent closing live-acceptance issues or claiming broader support. No merge, release or production account was used.

S00 reuse regression: rebuilding the probe's ignored Worker bundle and running its existing `npm test` passed all **47** cases. The first run used a stale pre-main bundle and failed one file-consent copy assertion; rebuilding resolved it without changing probe source. No probe deployment or live account action was performed.

### Hosted infrastructure verification — 2026-11-06

The owner-selected Cloudflare account received a new, separate `fortnox-mcp-product-test` Worker and D1 database. Existing S00 and infrastructure installations were preserved. All four additive migrations were applied and recorded. The initial deployed executable source was `b070455fa5d76b9180668e565ef96a7ca573a218`, deployment `b09aba14866c4f5293a0486914940808`, using compatibility date `2026-11-06` and `nodejs_compat`. These initial checks predate the consent-diagnostic follow-up below.

The [HTTPS test installation](https://fortnox-mcp-product-test.alexander-c06.workers.dev) enables only the explicit two-tenant acceptance mode with private credentials and the owner's allowlist. This is not a general activation or a production deployment. Stored observability and preview URLs are disabled. The five-minute cron configuration was accepted; actual scheduled expiry/deletion after owner initialization remains unverified.

Direct hosted HTTP checks observed:

| Check | Result |
| --- | --- |
| `/health` and `/setup` | 200, no-store and CSP headers |
| Protected-resource and authorization-server discovery | 200; fixed public metadata |
| Anonymous `/admin` and private MCP tool call | 401 |
| Mixed public/private MCP batch | 401 |
| Invalid bearer on public MCP discovery or admin | 401; no anonymous fallback |
| Public email signup with the installation Origin | 404 |
| Foreign-origin setup request | 403 |

Signup without an Origin was first denied with 403 by the earlier origin guard; repeating with the correct Origin verified the route itself is unavailable (404). No account was created. A short-lived bootstrap was provisioned privately and can be renewed conditionally while unused. No actual owner password, Fortnox consent, provider read or ChatGPT interaction was performed by these checks. Hosted password-hashing/resource budgets remain unverified.

GitHub Actions passed all three pull-request workflows on that source: [S01 CI](https://github.com/engshort/fortnox-mcp/actions/runs/42162829898), [S00 CI](https://github.com/engshort/fortnox-mcp/actions/runs/42162829905) and [S00 OAuth CI](https://github.com/engshort/fortnox-mcp/actions/runs/42162829896). This adds hosted CI evidence to the local results; it does not replace live client/provider acceptance.

### Owner bootstrap and consent troubleshooting — 2026-11-06

The owner reported completing bootstrap in the actual test installation. A subsequent bounded D1 query confirmed phase `active` and presence of a persistent owner identity, without extracting email, sessions or credentials. This establishes the initial hosted bootstrap path; session expiry, reset and broader owner lifecycle acceptance remain pending.

Initial Fortnox callbacks returned `invalid_scope`. Three unauthenticated authorization preflights for each requested scope and their combination also returned that error; redirects were not followed and no grant was created. Private comparison confirmed the deployment matched the owner's local integration settings. After the owner corrected a missing redirect URI in the developer portal, a new callback contained an authorization code but product completion still failed. The failure's exact step was not observable from the original generic response. Neither a code callback nor this error establishes successful token exchange or tenant verification.

The diagnostic follow-up passed typecheck and **59 Node/domain plus 47 actual local workerd/D1 tests**, including the new HTTP consent failure/replay contract. Hosted retry must use a newly owner-started flow; a consumed authorization code is never replayed to diagnose a failure. Further hosted results and exact deployment identity are recorded in PR #95 and the affected issues before acceptance is claimed.

### Native Worker fetch regression — 2026-11-06

The diagnostic deployment isolated the owner's next failure to `code_exchange`. An isolated workerd reproduction established that calling its native global `fetch` through the stored configuration object's property raises `Illegal invocation`. Node's fetch and the earlier injected test transports did not reproduce this native receiver constraint. The product now wraps the default global fetch in an arrow function at the runtime composition boundary, covering both token and company reads without changing fixed origins or retry policy.

The new built-Worker test starts a fresh synthetic D1 installation, bootstraps an owner through HTTP and completes service consent through the actual native fetch boundary. A Miniflare outbound handler supplies all token and Company Information responses; it permits no live provider access. The old unwrapped bundle fails with the same `code_exchange` result; the corrected bundle completes with HTTP 303, two token calls and two tenant-verification calls. Actual hosted provider acceptance still requires the owner's next fresh consent.

`test:build` retains all six existing cases with Node string code generation disabled, followed by this additional native workerd case. Miniflare's Node-side D1 proxy itself requires string code generation, so that harness runs separately; Worker application code runs under workerd's own restrictions. Local workerd supports only the foundation compatibility date, so this test uses `2026-10-18`, while the hosted target remains `2026-11-06`. An attempted local run with the newer date failed at runtime startup and was not counted as application verification.

### Initial two-company product activation — 2026-11-06

On executable source `81569ec11f6d7e85b1a8d108d00ab6b6e28d9e45`, deployment `247de725e7c94a438fb5308b1582a03c`, the owner completed both actual Fortnox connections after the native-fetch fix. A bounded D1 aggregate query confirmed two active records, two distinct verified tenants, two distinct opaque handles and two encrypted credential records. One connection uses service credentials and the other user refresh rotation. No tenant values, company names, ciphertext or tokens were extracted by this check. This establishes both initial activation paths; expiry, provider renewal, revocation and reconnection acceptance remain pending.

The owner's subsequent ChatGPT setup created one OAuth client and one owner-bound grant containing two companies. D1 aggregates showed three refresh records, two already rotated/revoked, and three refresh-bound access records. This establishes observed MCP refresh rotation, but does not establish Fortnox refresh rotation or prove either provider token expired.

The owner explicitly confirmed that actual ChatGPT listed two companies, read both profiles successfully and reported both active. The owner then confirmed saved-answer persistence, conversation reopening and administrative Reload tools, with new profile/status calls after both reload steps. An exact synthetic unknown company UUID returned `COMPANY_FORBIDDEN`, with no profile, fallback company or subsequent call. Evidence is the owner's actual client run and reported results; the agent did not independently inspect the browser. Private company names, organization numbers, handles and correlation identifiers are omitted from public evidence. The reported initial-read time was 06:18 Europe/Stockholm on 2026-11-06.

A single expired synthetic continuation marker was inserted into the test owner's bounded continuation map, preserving existing entries. A later aggregate check found zero markers within 231 seconds. The configured `*/5 * * * *` schedule was confirmed unchanged; product request handlers do not clean that map, and the company-profile tools do not create continuations. This verifies one actual hosted scheduled expiry cleanup without manipulating credentials or financial recovery state. It does not establish the full retention/backup lifecycle.

All three GitHub workflows passed on this executable source: [S01 CI](https://github.com/engshort/fortnox-mcp/actions/runs/42166801889), [S00 CI](https://github.com/engshort/fortnox-mcp/actions/runs/42166801895), [S00 OAuth CI](https://github.com/engshort/fortnox-mcp/actions/runs/42166802010). The private client evidence record remains incomplete until every required manual check has actually been observed; validating its shape is never a substitute for executing those checks.

### Final integration acceptance hardening — 2026-11-06

Acceptance review found that the earlier wrong-key tests covered credential reads but company metadata could still be listed. The snapshot key-check and mixed-key verification above close that gap, including after credentials are deleted. Shared tests additionally verify a CAS upgrade from the earlier encrypted snapshot without changing handles/generations/grants, a persisted expired admin session after handler recreation, and a genuine maintained-library MCP token rejected on admin GET and consent-start POST. The real product OAuth contract now also verifies distinct disconnected-company denial, no provider call for the disconnected company, an unaffected company list and continued reads of the other company. Root typecheck and **61 Node/domain plus 49 actual local workerd/D1 tests** passed on this follow-up. Earlier hosted evidence remains pinned to its executable source; a new deployment/retest is recorded separately.

The built native workerd case also restarts the product with a wrong external key: authenticated admin metadata access is denied with 503 and no company name. Restoring the correct key and restarting again preserves D1 and the session, returns 200 and the synthetic company, and performs no additional provider calls. The six original no-eval artifact cases and this native workerd case pass, as does the product Wrangler dry-run.


## M21 — scoped G06 acceptance (#75)

The owner approved the tracking split: #75 covers connection/auth and company reads; original later MVP reference/voucher/file acceptance is retained in #92/#93/#94. Full G06/#36 and G05/#35 remain separate. The [machine-readable matrix](../reference/mvp-connection-operations.json) pins independent adapter/tool source hashes and names exact methods, paths, scopes, authentication, parameters, envelopes, effects and tests. It does not import or distribute the external OpenAPI snapshot. Unknown upstream operation IDs and unverified product permissions/licenses are explicitly missing evidence, not presumed approval.

No entry is marked verified from offline tests or an historical single-company probe. Actual product two-company/provider and hosted-client evidence must be appended before closing #75 or claiming supported provider coverage. Follow-up references and the PR/issue acceptance map preserve the original MVP obligations.
