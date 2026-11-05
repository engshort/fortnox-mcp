# S00 hosted maintenance — 2026-11-05 (G01)

Status: **maintenance deployed; actual ChatGPT acceptance remains open**.
Tracks [G01 #31](https://github.com/engshort/fortnox-mcp/issues/31).

## Executed update

The existing isolated synthetic Worker was inspected through the owner's
connected Cloudflare account. Its previous deployment dated from 2026-10-18.
The maintenance implementation already present in source `d9fab0f` was built
with Node 24.19.0 and npm 11.9.0 and deployed on **2026-11-05 at 19:05:38 UTC**.
The deployed version is `1ea237a7-93c3-4c21-a942-ac1b27f60bea`.

The update used the Cloudflare API's multipart module upload with strict
`inherit` bindings. The existing D1 database, `AUTH_SECRET`, `OWNER_ID`, public
origin and explicit synthetic-review flag were retained. Neither secret was
read out or replaced. No seed, migration, grant renewal, scope expansion,
Fortnox request or root-product deployment was performed.

Before/after aggregate D1 counts matched: one owner, three OAuth clients,
47 access-token records, 50 refresh-token records and one review record.
Matching counts establish that this update did not reseed these tables; they
do **not** establish that old grants are still renewable or unexpired.
Stored observability remains disabled and no temporary protocol diagnostic
window was enabled.

## Local checks

On Linux with the locked Node/npm versions:

| Check in `spikes/s00-oauth` | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm test` | 28 passed, none skipped, including actual local workerd/D1 |
| `npx --no-install wrangler deploy --dry-run --config wrangler.example.jsonc` | Passed |

The default shell's Node 22 was not used for these checks. Socket-dependent
tests required execution outside the filesystem/network sandbox. No dependency
or protocol upgrade was needed for this maintenance deployment: the executable
probe retains SDK 2.3.1 and Better Auth/OAuth provider 1.7.10.

## Actual-host acceptance still required

No authenticated ChatGPT browser session or saved S00 connected-app tool was
available in this execution environment. Cloudflare administration is not a
substitute for that client evidence. Execute the following in the intended
owner-controlled account, recording the client date, plan/workspace and exact
server version:

1. Resume the corrected saved verification client, with `mcp:read offline_access`.
   If its grant has expired, use an authorized owner login and fresh consent;
   preserve the installation rather than reseeding it.
2. Call the synthetic status tool and inspect the displayed result. Reload the
   full conversation and reopen that answer.
3. Run administrative **Reload tools**, observe visible success and make another
   authenticated call. Record protocol outcomes separately from UI outcomes.
4. Exercise refresh after access expiry, disconnect/revocation, reconnection and
   another refresh after expiry. Confirm renewable access, not just consent.
5. If bounded protocol diagnostics are necessary, use the existing deadline
   and event limit, then disable them and end all temporary tails.

An HTTP 200, a deployment result or these offline tests cannot close G01.
Keep #31 open until the actual-host checks pass. G02, G03 and G05 retain their
own independent acceptance requirements; G04 remains accepted only for its
previously documented isolated read-only test.
