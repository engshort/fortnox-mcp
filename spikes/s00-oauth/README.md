# S00 authenticated MCP feasibility probe

The [2026-11-05 maintenance update](../../docs/implementation/S00-hosted-maintenance-2026-11-05.md)
is deployed with the original bindings and grants preserved. Actual-host
acceptance remains open. An additional [default-off file experiment](../../docs/implementation/S00-files-evidence.md)
implements `probe_synthetic_files`, `read_synthetic_file` and protected file
resources with separately consented `mcp:files`. It is locally verified only;
read its format, DNS/socket, encryption and cleanup prerequisites before enabling.
No existing grant is widened and no Fortnox operation is added.

Experimental and isolated. The hosted MCP/OAuth server remains synthetic-only;
the separate local G04 operator process can read an explicitly allowed Fortnox
test company's identity after owner consent. This is not the product's S02 auth
implementation. It preserves the unauthenticated loopback transport baseline in
`../s00-mcp` and does not change the root Worker or existing test installation.

By default the probe exposes one `read_synthetic_status` tool behind OAuth. An
explicitly enabled [G02 experiment](../../docs/implementation/S00-review-evidence.md)
adds a synthetic embedded proposal, app-only approval and read-only status tools, with a separate
`mcp:review` grant; it cannot execute a financial operation. Better Auth
`1.7.10` and its OAuth provider handle S256 PKCE, exact redirects, RFC 8414/9728
discovery, RFC 9207 issuer identification, expiring single-use authorization
codes, resource-bound opaque tokens, refresh rotation and revocation. A
server-only provider extension validates tokens against the same database on
every MCP request, then checks issuer, resource, scope and the provisioned owner.
No passwords, bootstrap codes, cookies or bearer tokens are model-callable.

The original 22 local tests passed, including SDK 2 modern/SDK 1 legacy interoperability,
bundled workerd/D1 OAuth and review flows,
five operator-only Fortnox checks, and proposal/capability isolation. A separate
HTTPS test instance and database were deployed. In a personal ChatGPT Pro
account, metadata/DCR discovery, owner login/consent and a real synthetic tool
call succeeded. Automatic refresh after expiry, disconnect/revocation and
immediate reconnection also succeeded. A later idle check found the reconnected
grant lacked `offline_access`. A replacement native client requiring both base
scopes preserved refresh access through reconnection and expiry. Its final
ChatGPT saved answer still fails to load despite an authenticated MCP 200;
a later direct Codex call worked after an earlier unknown-tool failure.
The optional review view rendered in actual ChatGPT and a click consumed one
synthetic D1 proposal. Restrictive-CSP and remount/replay checks remain open;
see the [G02 evidence](../../docs/implementation/S00-review-evidence.md).
The isolated SDK 2.3.1 follow-up passed a direct connected-app call with
`2026-07-28` traffic and automatic token refresh; saved-answer/remount and
administrative reload acceptance were not retested after that deployment.
Before that SDK migration, the account's Reload tools action failed on
a preflight unrecognized by the JSON-RPC adapter; its current result is unverified.
See the evidence record for remaining protocol/lifecycle limits; this is not
production client support.

The [G01/G02 maintenance follow-up](../../docs/implementation/S00-client-maintenance-evidence.md)
adds bounded diagnostics on both protocol paths, server-backed review status and
browser regression checks for CSP, remount and uncertain outcomes. It has not
been deployed or accepted in the actual ChatGPT host; G01/G02 remain open.

The HTTP adapter forwards an explicit auth endpoint allowlist. Public signup,
password login/reset, token generation, OAuth administration and the internal
verification endpoint are unavailable. Browser mutations require a same-origin
owner cookie. Only the one-time-token verification may start without that
cookie. The operator generates a five-minute, single-use code outside the model.
OAuth login still requires a separate consent action. MCP tokens cannot become
admin sessions. The probe supports bearer tokens only; it rejects DPoP-bound
tokens instead of silently discarding sender constraints.

## Repeatable checks

Use Node `24.19.0` and npm `11.9.0`, from this directory:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run build
npm test
npx --no-install wrangler deploy --dry-run --config wrangler.example.jsonc
```

Tests use synthetic fixtures and real Better Auth endpoints. One test runs
the bundled Worker in local workerd with D1; it is not a Node mock. Runtime
budgets and hosted-client behavior require separate evidence. `npm test`
requires the Worker bundle from `npm run build`.

Run the reproducible UI suite separately:

```sh
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

For a preinstalled compatible Chromium, use
`PROBE_CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. The test-only host
binds `127.0.0.1:8794`; it uses synthetic SQLite state and a sandboxed iframe
with script/style hash CSP and no network access. Desktop and Pixel 7 emulation
exercise the actual widget. Results/screenshots are outside Git under `/tmp`;
set `PROBE_BROWSER_OUTPUT` to override the runner output directory. This is not
actual ChatGPT acceptance or a real mobile-device/browser-family test.

The app-only `read_synthetic_review_status` takes the original proposal ID/hash/
expiry and requires `mcp:review` plus normal OAuth owner/resource authorization.
It never returns or renews the private capability. Remount reads the server
state before enabling approval; a missing capability leaves a prepared proposal
read-only. A lost commit response triggers only a status read; an unresolved
mounted view remains disabled and offers **Check status** without resubmitting.
Expired/deleted records cannot establish that a previous commit failed.

For a bounded live protocol check, the Worker accepts the optional
`PROBE_PROTOCOL_DIAGNOSTICS=true` variable **and**
`PROBE_PROTOCOL_DIAGNOSTICS_UNTIL` as a UTC ISO timestamp with milliseconds
within the next 15 minutes. It emits fixed HTTP/content-type, authorization,
transport and RPC-method categories, observed protocol header and response status
on modern and legacy paths; unknown input becomes `other`. An observed header
is not a negotiated-version or reload-success claim. No payloads, RPC IDs,
tool names, URLs, credentials or raw headers are logged. Emission ends at the
deadline or after 64 events per isolate, not a global cross-isolate limit.
It is off by default. Keep stored observability disabled,
filter a short-lived operator tail to these allowlisted fields with Wrangler
disk logging disabled, then turn the variable off again. This does not add a
model-callable diagnostic or change protocol selection.

The same opt-in deadline also gates a separate `s00_file_source` diagnostic,
bounded to 64 events per isolate. Only a successfully scoped file invocation can
reach it. It emits a syntactically safe HTTPS DNS hostname, without scheme,
path, query, credentials, client file ID or original name. This helps the
operator review an exact origin after a deny; it does not add an origin to the
allowlist or bypass public pinned DNS/TLS checks. It is off by default along
with request diagnostics. Use synthetic files only and keep stored logs off.

Fixed protocol/tool schemas are public for ChatGPT's metadata refresh:
`initialize`, `notifications/initialized` and `tools/list`. All other methods,
including every tool call and resource request, require OAuth. Every member of
a batch must be public to qualify, and invalid supplied credentials fail closed
instead of falling back to anonymous metadata. This exposes no owner data or
financial capability; it is specific to this static synthetic catalog.

## Local Fortnox connection probe (G04)

This separate operator-only process is not exposed by the Worker or MCP tool.
Create an unpublished integration with enforced PKCE, service authorization,
redirect `http://localhost:8789/callback`, and only `companyinformation profile`.
Create a dedicated sandbox and accept its invitation. Verify its numeric tenant
ID in the portal before configuring the local allowlist. Do not use a production
company or infer a tenant ID from an unverified token.

Write ignored `.data/fortnox-operator.json` with your public integration Client
ID, verified test tenant ID and local display name:

```json
{"clientId":"YOUR_CLIENT_ID","testTenantId":"YOUR_NUMERIC_TEST_TENANT","testName":"Your S00 sandbox"}
```

Run `node --import tsx src/fortnox-operator.ts` and open
`http://localhost:8789`. Enter Client Secret yourself in the password field,
then choose service mode and complete Fortnox login/consent personally. The
process holds the secret only in memory, binds loopback only, requires same-host
session/CSRF protection and stops after 30 minutes. Its trust boundary is the
local operator/OS; it is not a production admin UI. Run the user-mode probe
separately to test refresh rotation. Only aggregate, identity-free results are
saved to `.data/fortnox-evidence.json`; no tokens are persisted. Stop the process
when finished. The result does not establish durable rotation or expiry recovery.

Five offline checks cover callback/state/PKCE, concurrent replay, wrong-tenant
denial, request mapping/result privacy and actual loopback form protections.
They do not alone prove live Fortnox acceptance. On 2026-10-18 the owner also
completed both live consent flows in a dedicated sandbox. Service/client
credentials and user refresh rotation passed with matching tenant identity;
`/me` returned `SysAdmin: false` for service and `true` for this user. This closes
G04 for the two selected identity scopes. Expiry recovery, durable rotation,
concurrency, revocation and broader provider use remain unverified. See
[G04 evidence and prerequisites](../../docs/implementation/S00-fortnox-evidence.md).

## Operator-only provisioning

Use a **new isolated** Worker and D1 database named `fortnox-mcp-s00-oauth`.
Do not point this spike at the root application's database or a real company.
The example Wrangler config contains a placeholder database ID and cannot
provision a usable installation by itself.

After Wrangler login and creation of the separate D1 database:

```sh
node --import tsx scripts/seed.ts https://YOUR-TEST-WORKER.workers.dev
node --import tsx scripts/prepare-deployment.ts YOUR_ACCOUNT_ID YOUR_NEW_D1_ID
npx --no-install wrangler d1 execute fortnox-mcp-s00-oauth --remote --file .data/seed.sql --config .data/wrangler.json
npx --no-install wrangler deploy --config .data/wrangler.json
npx --no-install wrangler secret bulk .data/secrets.json --config .data/wrangler.json
```

The seed command creates a synthetic owner with an undisclosed random password
and issues a Better Auth one-time login token. Its code expires in five minutes;
finish deployment and enter it promptly at `/sign-in`. Do not send it to chat.
The HTTP adapter never allows that random password or public signup to log in.
No owner can be claimed by visiting an uninitialized public server. Missing
secrets/owner binding return 503. Re-running seed against existing state fails.
The private config retains the original 24-hour operator cookie. While it is
valid, `node --import tsx scripts/mint-login.ts` writes a fresh code and a
single-row `.data/login.sql`. For a Worker, import that file into the same
isolated D1 database before using the code. For local Node/SQLite, including a
local server reached through a tunnel, the code is already in the database and
no D1 import is needed. Production owner recovery and lifecycle remain out of scope.

### Recover an expired local operator session

An `APIError: Unauthorized` from `mint-login.ts` means the saved operator
session was rejected. Repeating it cannot restore an expired session. The script
now explains this without printing a library stack or credentials. On the
original operator machine, use the original matching private config/database:

```sh
node --import tsx scripts/mint-login.ts --renew-operator-session
```

This explicit **local-only** command verifies the original signed cookie with
Better Auth and requires the configured synthetic owner to exist. Better Auth
creates/signs a new 24-hour operator session and issues a five-minute, single-use
code. The existing owner, secret, OAuth clients/grants, resource/review scopes,
review records and extra config fields are preserved. No remote endpoint or MCP
tool exposes this operation. No credential is printed. It cannot repair an
expired/revoked OAuth grant or recover missing/mismatched private files.

For a **Worker**, `.data/login.sql` now contains two new rows (session and
verification). Import only this file, never the old full seed:

```sh
npx --no-install wrangler d1 execute fortnox-mcp-s00-oauth --remote --file .data/login.sql --config .data/wrangler.json
```

For **local Node/SQLite**, the new login is ready immediately. Open the private
code file in an editor and enter it at `/sign-in`, then resume the saved ChatGPT
connection and consent. On Windows PowerShell, from `spikes/s00-oauth`:

```powershell
node --import tsx scripts/mint-login.ts --renew-operator-session
notepad .data\bootstrap-code.txt
```

Use the project's tested Node 24.19.0/npm 11.9.0 setup. An older Node version is
not itself an explanation for a returned auth-library `401`. Windows filesystem
execution of this follow-up remains unverified; the CLI tests use portable Node
file/process APIs on Linux. Tunnel origin/proxy setup is separate and is not
verified by issuing a code.

Do not delete `.data`, change `AUTH_SECRET`/the private secret, or rerun `seed.ts`
against an existing installation to fix this error. Missing original state
requires its private backup; the script deliberately refuses silent reseeding.
See [operator recovery evidence](../../docs/implementation/S00-operator-recovery-evidence.md).

All provisioning files, SQL dumps and databases remain under ignored `.data/`.
They contain credentials. Keep them private, apply local access controls and
remove the disposable test environment when finished. Never upload these files
or logs to GitHub. This prototype is not a backup/restore or production bootstrap
solution.

For a local run, use the default seed origin `http://127.0.0.1:8790`, then `npm run dev`.

## ChatGPT acceptance

In ChatGPT, use Plugins → plus → Add custom MCP server, enter the verified HTTPS
`/mcp` endpoint and choose OAuth/DCR. Set base scopes `mcp:read offline_access` and default scopes
`mcp:read offline_access`. Review the risk notice and create the private plugin,
then complete account linking, the one-time login and consent. Resume the saved
connection rather than creating a duplicate if the browser flow is interrupted.
If a signed login link expires, do not edit or reuse it. Sign in first on the
short `/sign-in` page with a fresh local code, then resume Connect in ChatGPT to
obtain a fresh signed consent request. Login and OAuth consent remain separate.
The portable archive generated by `scripts/package-plugin.ts` is separate; the
observed catalog marks its raw MCP connection desktop-only, so importing that
archive alone does not prove a ChatGPT connection.

This probe advertises
RFC 9207 and permits only the exact stable ChatGPT callback
`https://chatgpt.com/connector_platform_oauth_redirect`. DCR metadata is not proof
that the registrant is ChatGPT; the owner must review the client before consent.
No client-metadata URL fetching or arbitrary callback URL is enabled.

Record actual discovery, browser consent, tool discovery/call and reconnection
before closing G01. The isolated probe now pins `@modelcontextprotocol/server`
`2.3.1`: the maintained per-request handler serves `2026-07-28`, while a separate
SDK-classified stateless JSON leg preserves `2025-11-25`/`2025-06-18` behavior.
Both legs share the same token/owner/resource/scope checks and server factory.
Only fixed public metadata, including modern `server/discover`, is anonymous;
resources and tool calls remain protected. The modern handler uses automatic
response shaping; the current tools emit no progress, so results are JSON.
SDK 2 client `2.3.1` and SDK 1 `1.32.1` are development-only test dependencies.
The root workspace and first transport spike remain on SDK 1. No CIMD, full provider,
embedded review, file-transfer or production-auth acceptance follows from this
probe. See [the evidence record](../../docs/implementation/S00-oauth-evidence.md).

Primary implementation references:
[OpenAI OAuth](https://developers.openai.com/plugins/build/auth),
[Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider),
[one-time token](https://better-auth.com/docs/plugins/one-time-token).

Protocol migration follows the official SDK's
[dual-era serving guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
No custom protocol codec or OAuth implementation was introduced.
