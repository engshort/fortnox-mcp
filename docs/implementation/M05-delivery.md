# Milestone 5 delivery and acceptance

Baseline: `5a49f8e425aa3060f1b85db2169460e7b5e14672`, 2026-11-08.
Owner-approved delivery target: one Node application, Docker Compose, SQLite
and an existing host Nginx. Systemd and APT are documentation-only future work.
Worker domain/storage regressions remain required; no new hosted Worker claim.

## 1. Node runtime (#72, #74)

The existing product entry accepts `HOST`, `DATA_DIR` and `NODE_PROXY_MODE`.
Local defaults remain loopback/8787/`.data`; `PRODUCT_DATABASE` overrides the
default database location. Secret `_FILE` inputs fail closed on missing files,
oversized files or conflicting inline values. They are not printed.

The Node-only Nginx adapter requires the exact configured authority and a single
`https` forwarded protocol. It preserves the actual browser Origin. Enable it
only behind the documented loopback-published proxy boundary. It must not be
used to trust arbitrary Internet-supplied forwarding headers.

Migrations are shared with the existing SQLite/D1 schema. SIGTERM stops new
requests, drains HTTP connections and closes SQLite. A 30-second deadline exits
unsuccessfully rather than claiming pending external writes have failed safely.
Existing durable claims remain subject to reconciliation after restart.

Verification on Node 24.19.0/npm 11.17.0: root typecheck and four focused runtime
cases passed. The actual Node process was bootstrapped through synthetic proxy
headers; foreign Origin was denied, the cookie was Secure, and the same owner
session survived SIGTERM/restart while bootstrap replay remained denied.
No Fortnox or actual client request occurred. Full aggregate checks and image
acceptance are recorded with the later delivery parts.

## 2. Docker and Nginx (#72, #77, #78)

Multi-stage packaging, non-root UID, private named-volume state, file-mounted
secrets, bounded logs/resources and an Nginx example are implemented. Docker
builds accept an explicit source revision without including Git metadata.
The dedicated CI builds the image and verifies real synthetic HTTPS/proxy,
bootstrap, OAuth metadata, private MCP denial, SIGTERM and persistent recreation.

Docker access on the owner-selected Linux test host was verified on 2026-11-08
after the operator added the account to the Docker group. The existing session
retained its old supplementary groups; an authorized `sg docker` subprocess
activated the new membership without sudo or a password. The actual local
image/Compose/isolated Nginx smoke passed; details and limits are recorded below.

The first supported platform target is Linux amd64. Systemd and APT remain
documentation only in the [Linux deployment guide](../deployment-linux.md).

## Acceptance tracking

The owner [accepted the delivered MVP and authorized a bounded prerelease](M05-release-authorization-2026-11-09.md)
on 2026-11-09, conditional on green CI. #108 has since merged; the remaining stack
is consolidated in #114 against main. The draft-PR statements below describe the
earlier review snapshot. The new source-packet CI prepares immutable artifacts
from the tagged commit; publication follows separate maintainer verification.

The [actual session matrix](M05-actual-acceptance.md) records remaining operator,
ChatGPT, provider and private-reporting evidence. A separate Node-only direct-file
acceptance artifact is built explicitly; the normal image contains no such entry.
Actual acceptance is pending and no milestone/release gate has been closed.

The [2026-11-09 issue review](M05-issue-review-2026-11-09.md) documents 51 related
issues and closes six bounded implementation tasks: #55/#56/#57/#72/#73/#74.
All seven delivery PRs remain drafts; these closures do not place the changes on
main. #42/#54/#77/#78 and the remaining actual acceptance stay open.

Implementation and actual acceptance are separate. Do not close #42/#77/#78 or
broader parent gates from these runtime checks. Writes, review-host acceptance
and provider-file operations retain their existing gates. No image, release
or package has been published.

## 3. Protected owner setup (#72)

Hono composes existing Fetch/domain handlers; React/Vite assets are served from
this installation. Owner-only status and write-only credential configuration reuse
Better Auth and the vault. ENV values remain operator-managed. Company policies,
disconnect/reconnect and unknown-reference investigation reuse existing services.
The UI supports Swedish/English, bootstrap, login, reset, connection setup,
ChatGPT guidance and current capability status. All financial/provider-file gates
remain unchanged. Optional Worker assets preserve the portable route contract;
Docker/Node is the installation target.

Synthetic Node authorization/connection suite: 55 passed. Desktop and Pixel 7
Chromium: bootstrap, credential persistence without readback, disabled connection
without allowlist, language switching, logout/login and overflow checks passed.
Browser plugin was unavailable, so the existing Playwright installation was used.
Visual QA at 1487×1058 and mobile compares the generated reference with actual
screenshots: header/navigation copy, two-column layout, type scale, white/petrol/
gold palette, field/button spacing and stacked mobile layout. Functional copy
adds the required allowlist restriction, new-consent explanation and accessible
connection-type legend; callback text reflects the real installation origin.
The reference is a design aid, not a shipped image or a product support claim.

Workerd parity suite: 55 passed. Docker CI run
[42517870927](https://github.com/engshort/fortnox-mcp/actions/runs/42517870927)
passed the real image + Nginx HTTPS smoke test on 2026-11-08. The later
owner-selected Linux host result is recorded below.

## 4. Connection diagnosis (#73)

`diagnose_connection` and the protected owner action share a bounded service.
It uses the existing company/grant authorization, token lifecycle and durable
provider budget, with a second authorization check after I/O. Fixed status/reason
codes separate disconnect, scope, upstream failure, unknown rights/license,
not-implemented payroll and blocked verification. A successful profile check
never enables financial or file writes. No raw payload/name/token leaves this
result. The separate fixed M14 experiment catalog is unchanged.
Shared synthetic cases cover foreign company denial before I/O, local scope/gate
checks, durable budget use, redaction, 403 unknown classification and late-response
disconnect. This establishes no live provider/ChatGPT acceptance.

## 5. Offline operations and restore (#74)

Runtime and operator commands share Linux flock; maintenance cannot race a running
server. The image carries a bundled operator CLI for encrypted backup, candidate
restore, credential rotation, pre-migration backup/upgrade, expiry cleanup, private
bootstrap/password recovery and explicit restore-interval reconciliation.
Restore revokes sessions/OAuth grants/provider tokens and all old reviews,
preserves known/unknown execution evidence and blocks all affected dispatch until
the missing history interval is independently reconciled. A policy change cannot
clear this block. Rotation covers connection, proposal, configuration and receipt
chunk encryption transactionally, including new-key-only file readback.

Synthetic focused cases: six operations cases plus four actual Node runtime
cases passed, including backups before/after booking and unknown outcome, later
history/token rotation absent from an older backup, old approval denial,
wrong-key rejection before replacement, persisted session/token revocation,
matching-interval-only reconciliation and library-issued private owner reset.
These do not replace the actual two-company recovery scenarios.

Aggregate verification on 2026-11-08: Node 200/200 (21 files), actual local
workerd/D1 144/144 (6 files), typecheck and lint passed. Built-artifact suite
9/9 passed after adapting the native Worker key-denial check to the protected
JSON data route (the new static shell deliberately contains no company data).
The detailed Docker operations smoke is checked separately at the exact PR head.

## 7. Draft release preparation (#77, #78, #54)

The candidate preparer requires a clean source commit, an explicit prerelease
version, matching build hashes and a new output directory outside the checkout.
It prepares corresponding Git source, runtime dependency SBOM/original license
texts, Swedish/English installation guides, pending acceptance, versioned notes,
a manifest and SHA-256 checksums. Optional Docker preparation verifies both image
revision/version labels and byte-identical Node/admin artifacts before saving the
image. Node/OS package inventories and original notices accompany the JS SBOM.
Unknown runtime dependency licenses/missing original texts fail preparation.
No external specification or private fixture is included. #35 and full image
rights review remain separate; the manifest always says distribution unapproved.
No registry push, tag publication, GitHub release, merge or package is performed.

Docker CI measures its actual Linux/kernel/CPU/RAM/Engine/Compose configuration,
one non-root container's memory/CPU sample and twenty HTTPS health requests at
concurrency four. Configured limits are CPU 1, RAM 512 MiB, PIDs 128, two files per
call/1 MiB each, twelve active temporary files, 128 KiB operational rows and 64 MiB
backup snapshots. These are declared limits, not proven provider/client capacity.
The health-only measurements cannot close broader G09. The exact CI head/result
and observed numbers must be recorded before claiming measured installation
acceptance. The operator-host clean-room/two-receipt session remains pending.

Part 6 head `a7b53019221bc15a2722f0bad0ee4417fba8f6c4` passed all four CI workflows,
including actual Docker/HTTPS/maintenance [run 42520355411](https://github.com/engshort/fortnox-mcp/actions/runs/42520355411)
and [S01 regression/build checks](https://github.com/engshort/fortnox-mcp/actions/runs/42520355385).
Actual ChatGPT/Fortnox/financial/private-report delivery acceptance is still pending.

The first candidate preparation correctly refused the nested
`@better-auth/utils` 0.5.0 archive because its original license text is absent.
The runtime lock now selects exact 0.5.1 (already used by the other auth packages),
which includes its original MIT notice. No retroactive license assumption is made
about 0.5.0; see upstream issue #38. Auth/OAuth/recovery regressions are repeated
for this dependency patch before accepting the candidate evidence.

## Review handoff, 2026-11-08

| Delivery part | Draft PR |
| --- | --- |
| Node configuration/shutdown | [#108](https://github.com/engshort/fortnox-mcp/pull/108) |
| Docker/existing Nginx | [#109](https://github.com/engshort/fortnox-mcp/pull/109) |
| Protected Hono/React setup | [#110](https://github.com/engshort/fortnox-mcp/pull/110) |
| Redacted diagnosis | [#111](https://github.com/engshort/fortnox-mcp/pull/111) |
| Offline maintenance/recovery | [#112](https://github.com/engshort/fortnox-mcp/pull/112) |
| Bounded Node file trial/pending actual acceptance | [#113](https://github.com/engshort/fortnox-mcp/pull/113) |
| Draft candidate/artifact/measurement preparation | [#114](https://github.com/engshort/fortnox-mcp/pull/114) |

These are stacked review branches; none was merged into main. A source-ledger
conflict caused by the earlier evidence correction was resolved by retaining each
part's actual fingerprints. Stack ancestry was aligned without a source-tree
change. Full final delivery remains subject to the actual acceptance matrix.

Candidate source head `a69bc94028131bb4a950e60063cd2de1aa1e51fc` and its tested CI
merge source `6de27cac79cc7c1742ce1407c9edec4a227dd3f3` passed
[S01 run 42520952597](https://github.com/engshort/fortnox-mcp/actions/runs/42520952597):
Node 200, actual workerd 144, built artifacts 11, typecheck/lint/build and all
three existing Worker dry-run checks. Owner Chromium desktop/mobile passed 2/2
locally after the auth patch. A loaded local aggregate run had one existing
20-second workerd-restart timeout (199 passed); the isolated file passed 8/8
without a timeout change, and the complete CI run passed all 200.

The matching [Docker run 42520952562](https://github.com/engshort/fortnox-mcp/actions/runs/42520952562)
passed real TLS/Nginx/bootstrap/origin/cookies/MCP denial, SIGTERM/recreation,
offline maintenance/session revocation, missing-secret startup and full draft
candidate creation, including byte-for-byte comparison of image/local artifacts.
Observed at 2026-11-08T20:36:59Z on Linux `7.0.0-1017-azure`, x64,
AMD EPYC 7763 (4 visible CPUs, 16,760,344,576 host RAM bytes), Docker 28.0.4,
Compose 2.38.2, configured Nginx 1.28 Alpine and Node 24.19.0. Container sample:
71.14 MiB / 512 MiB, CPU 0.02%, 19 processes. Twenty HTTPS health reads,
concurrency four: median 3.254 ms, maximum 9.472 ms. These measurements cover
synthetic health/runtime only, not provider/ChatGPT workloads or G09.

Local draft preparation produced a source archive (469 entries), 33 runtime
components with original notices, bilingual guides, pending acceptance, versioned
notes and a manifest with `image=null`, `distribution_approved=false`. Every
`SHA256SUMS` entry passed; prohibited Git/private/specification paths were absent.
CI additionally saved a matching image plus Node/OS inventory/notices locally on
its temporary runner. Neither packet was published or granted acceptance.
Runtime `npm audit --omit=dev --json` on 2026-11-08 reported zero advisories in the
installed root runtime graph; this is not a repository-wide/security-report gate.

## Owner-selected Linux host, 2026-11-08

Source `ea2013739524727cd832833613610f8eaa496c51` passed
`node scripts/docker-smoke.mjs` on the selected host, observed at
2026-11-08T21:25:53.470Z. The run built the non-root image, initialized a fresh
private configuration/volume and verified real TLS through an isolated Nginx,
Origin rejection, Secure cookies, OAuth metadata, private MCP denial, clean
SIGTERM, persistent recreation, live-process maintenance lock refusal, encrypted
backup, key rotation, upgrade, restore/session revocation and missing-secret
startup failure. This used synthetic data and made no provider calls.

Linux `6.12.115+deb13.1-cloud-amd64`, x64, AMD EPYC 7763, 4 visible CPUs and
25,203,036,160 host RAM bytes; Docker 29.9.2, Compose 5.7.0, configured Nginx
1.28 Alpine and Node 24.19.0. Limits remained CPU 1, RAM 512 MiB and PIDs 128.
Container sample: 73.45 MiB / 512 MiB, CPU 0.03%, 19 processes. Twenty HTTPS
health reads at concurrency four: median 5.611 ms, maximum 13.066 ms. These
measurements establish only the synthetic health/runtime scope, not G09 capacity.

The local draft packet contains the matching image, source archive, 33 runtime
components/original notices, Node/OS inventories/notices, bilingual guides and
measurement record. All 146 checksum entries passed. Image ID:
`sha256:54ddb2986f7e40364d338fc964fff68438d75f0772bd2dd76dd84e9bfde7d1fd`;
Linux amd64, 341,927,137 bytes. The packet remains local under
`/tmp/fortnox-m5-nebula-20261108`, with `distribution_approved=false` and actual
acceptance pending. Its source/docs are the exact tested commit above.
The run's containers, named volume and temporary image tag were removed.

The HTTPS smoke used an isolated Nginx and a locally trusted test certificate.
The owner subsequently supplied a public hostname. Its proxied DNS record and a
dedicated same-account Cloudflare Tunnel are configured; the tunnel has four
healthy connections. The persistent app is healthy on loopback, with all gates
unchanged and no provider credentials copied from the earlier Worker installation.

A dedicated loopback TLS vhost, pinned origin certificate, bounded Compose
overlay and create-only/rollback installer were prepared privately. The operator
ran the installer as root, passed the host's Nginx 1.26.3 configuration check and
reloaded the existing service. The resulting path is public Cloudflare HTTPS →
dedicated tunnel → verified TLS to host Nginx on loopback/8443 → Node on
loopback/3000. No existing tunnel or global Cloudflare security setting changed.
The short-lived test origin certificate expires on 2026-12-08 and needs renewal
before further use after that date; its CA is explicitly pinned by the connector.

Public target-domain checks on 2026-11-08 passed: health/setup 200; exact tested
JS/CSS asset bytes; resource and authorization-server metadata with correct
external HTTPS endpoints; unauthenticated admin/MCP 401; foreign-Origin bootstrap
403; and overwritten spoofed forwarding headers. Health/private responses are
`no-store` and the edge reports DYNAMIC. An independently verified local TLS call
reproduced 403 only when the internal port 8443 was included in Host; the exact
public authority is accepted. `/` is not an application route (404); use `/setup`.
The standard Python urllib user agent initially received edge error 1010; a
descriptive application user agent reaches the configured origin. The subsequent
owner-reported ChatGPT reads are recorded below; broader compatibility remains
unverified.

The owner completed bootstrap/login and saved Fortnox credentials through the UI.
Read-only operator inspection confirmed an active owner, one encrypted integration
record and an OAuth client/consent. The two pre-existing private test-tenant IDs
were added to the Docker test configuration without copying integration secrets.
The recreated container retained owner/configuration/consent state. Accounting
references and provider receipt consent remain false; file transport remains none.

The owner then completed both provider connections: one service and one user
connection are active with encrypted provider credentials, read-only access and
`review_required`. No names, tenant IDs, token values or financial records were
written to this evidence. Consumed bootstrap copies were removed. Refresh,
disconnect/reconnect, diagnosis failure cases and recovery acceptance remain pending.

The client's initial company grant was created before the connections and still
contains zero companies. The owner subsequently completed a second registration
and consent: its new grant contains exactly both active companies with matching
connection generations. The original grant was not widened. This version requires
a new MCP client registration for a changed company set.

Public MCP initialization with protocol `2025-06-18` and tool discovery both
returned 200; the catalog contains company listing/status, diagnosis and profile.
The newly tagged plugin's tools are still not exposed in this chat, so no
authenticated model tool call is claimed from operator/discovery checks. The
owner subsequently provided separate-chat read results, recorded below. See the
[official connection/refresh instructions](https://developers.openai.com/plugins/build/app-quickstart#connect-your-mcp-server-in-chatgpt).

Remaining client lifecycle/isolation cases, human receipt review and private-report
delivery remain pending. All financial/provider-file/review activation gates remain
unchanged. Private host configuration and tokens are excluded from Git and release
artifacts. This is partial connection evidence, not closure of the live gates.

## Owner-reported client reads and persisted tenant binding (2026-11-08)

The owner supplied results from a separate ChatGPT conversation: `list_companies`
returned both companies; `diagnose_connection` reported available company
information for both, manual vouchers/provider files blocked with
`verification_pending`, and payroll `feature_not_implemented`.
The owner also reported two successful `get_company_profile` calls with the
expected distinct company names, one service connection and one user connection.
The reported profile observation was 2026-11-08 22:14 UTC. According to the owner's
sandbox confirmation, the shared organization number is expected. It is not used
as the tenant key. No company names or organization numbers are reproduced here.

Provenance: these are owner-reported actual-client results, not tool calls made
by this implementation chat. Raw tool traces and the ChatGPT client version have
not been collected. Accept the bounded successful-read observation without
promoting broader provider coverage or lifecycle/isolation acceptance.

An independent read-only inspection at 2026-11-08T22:18:09.449Z confirmed that the
two requested handles resolve to distinct Fortnox tenant IDs, exactly matching
the private two-tenant allowlist, expected names/modes and the same installation
owner. Both are active, read-only and `review_required`, with separate encrypted
credential records and a two-company grant matching current generations. Only
aggregate checks were emitted; no provider request, credential decryption,
database change or new OAuth identity was performed. The sanitized report remains
in the ignored private installation directory.

Source inspection confirms that the [profile handler](../../packages/mcp/src/companies.ts)
authorizes the requested handle, obtains that connection's credentials/token and
rejects a response whose `CompanyInformation.DatabaseNumber` differs from the
bound tenant. The [credential vault and connection service](../../packages/core/src/connections.ts)
bind encryption to owner, connection ID, generation and mode. Persisted metadata
and source inspection do not independently capture the actual upstream credential
selection or establish all negative isolation cases. Those client/provider tests
remain pending; no financial, file or review gate changed.

At 2026-11-08 22:21 UTC the owner explicitly confirmed a separate negative client
test: access using a company handle outside the client's granted companies was
denied and no company information was returned. This bounded denial observation
is owner-reported passed. The exact invocation, error code and raw tool trace were
not supplied; do not infer additional cross-owner, credential-swap, batch, file or
write-path isolation results. Refresh/revocation, reconnect and the remaining
acceptance matrix were pending at that observation. No gate or client grant was changed.

## Local Chrome lifecycle follow-up (2026-11-08)

The [dated local client report and server correlation](M05-client-lifecycle-2026-11-08.md)
record fresh two-company reads, client-account disconnection/reconnection,
saved-answer reload and renewed reads after the 300-second access lifetime.
Read-only inspection confirmed refresh revocation at 22:39:31 UTC and a
replacement token pair/rotation at 22:46:44 UTC after the prior access expired.
The tested runtime image/Node bytes, two active read-only provider connections
and all activation gates remained unchanged. Reported tool-success counts come
from the local ChatGPT result observations; no raw request trace was retained.
Old bearer rejection, revoked/rotated refresh replay and the remaining actual
acceptance matrix remain pending. This is scoped lifecycle evidence only.

## Provider renewal and isolated old-token follow-up (2026-11-08 UTC)

The [dated renewal evidence](M05-token-renewal-2026-11-08.md) records actual
service client-credentials reacquisition, natural-expiry user refresh rotation,
encrypted replacement readback and successful tenant-checked profile reads.
The local Chrome report then observed three new successful listing/profile reads
after the server probe. Connection identities, generations, policies, grants and
activation gates were preserved. Original ChatGPT tokens are absent from the
available evidence; the separate old-token checks use only synthetic identities
in the exact unchanged image. The positive control and four negative cases passed;
natural expiry was tested after 307 seconds without changing the clock or expiry.
These results do not close original-token replay acceptance.
