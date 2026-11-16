# M05 actual acceptance observations and remaining scenarios

Acceptance operator update (2026-11-11): an AI operator and a separate AI reviewer
may execute and assess all previously human-operated test steps under the
[owner-approved procedure](../implementation/ai-reviewed-acceptance-2026-11-11.md).
Actual client/provider/runtime execution, original evidence, proposal binding and
all policy/validation/recovery requirements remain mandatory. Historical results
are preserved; a rewritten criterion does not pass a pending test.

Owner acceptance was approved on 2026-11-09, together with conditional merge and
publication authorization. See the [recorded decision and release scope](M05-release-authorization-2026-11-09.md).
The scenario states below describe actual evidence; unperformed tests remain
pending and operation activation gates stay unchanged.

Scope: #42, #54, #72–#78; applicable evidence from #32/#33, #55–#62,
#75/#76, #92–#94 and #38. Implementation, local checks and code merge do not
complete this session. Row states distinguish completed observations from pending
actual scenarios.

## Session prerequisites

Use a dedicated authorized Linux Docker host, existing Nginx, HTTPS domain and
two authorized Fortnox test tenants. Record exact source commit, image digest,
artifact checksums, UTC date, Linux/CPU/RAM/Docker/Compose/Nginx versions and
ChatGPT client/version. Keep tenant IDs, identities, originals, credentials,
signed URLs, screenshots with private data and execution evidence outside Git.
The owner performs login, provider consent, client/company selection, individual
human review and the private security-report delivery test. No production data.

## Original-file test build

The default image contains no file-test entry. Build the **explicit**
`--target acceptance` Docker stage from the same clean reviewed source and set
the separate local test image in Compose with `FORTNOX_MCP_IMAGE`.
Only that entry reads `M14_FILE_TEST_UNTIL` (UTC, at most one hour ahead).
It requires two-tenant test mode and `RECEIPT_FILE_TRANSPORT=node-direct`, with
privately reviewed exact source origins in `RECEIPT_FILE_ORIGINS`. DNS and address
pinning remain in the existing Node transport. No relay or Worker file transport
is introduced by this delivery. Ordinary `product-node.js` ignores the lease.

Obtain a fresh client grant including `mcp:files`; never edit old scopes in SQL.
Use `open_receipt_file_picker` in the actual ChatGPT card. Verify that the original
shown/interpreted by ChatGPT has exactly the same SHA-256, length and MIME as the
server-staged original and authenticated downloaded output. Test two files at
most, each no larger than 1 MiB and within the existing PNG/JPEG/PDF restrictions.
No file/receipt/financial acceptance is inferred from the synthetic picker host.
At expiry MCP fails closed while setup/login/recovery remain available. Restore
the ordinary image after the session and clean expired encrypted input bytes.

This file-only build does **not** enable vouchers, provider file writes or trusted
review execution. Their existing G02/G06/G07 gates remain closed. A subsequent
scoped financial test artifact requires the exact operation evidence and human
review boundary to be established; changing owner policy is insufficient.

## Required observations

| Scenario | Evidence/exit criterion | State |
| --- | --- | --- |
| Clean installation | Fresh private config/volume, migrations, TLS, non-root, health, missing-secret failure | Selected-host synthetic smoke passed; persistent public TLS/existing Nginx/health/setup verified; owner/provider acceptance pending |
| Owner setup/recovery | Private one-time bootstrap, login/logout/reset, operator-managed credentials | Owner completed bootstrap/login/credential save; persisted active owner/encrypted record verified; remaining recovery cases pending |
| Two connections | Service/user modes as applicable; exact tenant verification, refresh, disconnect/reconnect | Distinct allowlisted service/user tenants; actual client-credentials reacquisition and user refresh rotation/persisted profile readback passed; provider reconnect/failure/recovery cases pending #55–#62/#75 |
| ChatGPT OAuth/MCP | Actual login/consent, two selected companies, foreign-company denial, refresh/revocation, reload/remount | Local Chrome reports reads, disconnect/reconnect, saved-answer reload and reads after expiry; server confirms refresh revocation/rotation. Four isolated synthetic old-token rejections passed; original-token replay and remaining client isolation/UI cases are pending. Historical actual Reload tools evidence retains its original scope in #56. |
| Reference validation | Company/year/accounts/series/locked period evidence; no guessed rules | Pending #92/#93 |
| Two originals | Same original for client interpretation and server staging/readback, no URL/name/token disclosure | Pending #33 |
| Two separate reviews | Explicit interaction per item with independent AI review permitted; capability isolation/replay/remount/CSP | Pending #32/#76 |
| Provider results | Exact verified voucher and attachment references/readback for each item | Pending #76/#94 |
| Lost answer/restart | Unknown result retained and reconciled, no second booking or upload | Pending #38 |
| Link failure | Known voucher/upload retained; repair link only after proof of no effect | Pending #38/#94 |
| Backup/restore/rotation | Before/after review/booking/unknown/token rotation; old reviews revoked; missing interval blocked | Pending actual operator test |
| Private security report | Owner submits a harmless synthetic report privately and verifies maintainer receipt | Pending #42 |
| Final clean-room run | New installation, two companies, two individually reviewed receipts and all recovery cases | Pending #42/#77/#78 |

Record each actual result with its UTC observation, exact source/image/client,
redacted conclusion, private evidence reference and limitations. Leave unperformed
or blocked cases explicitly pending. Validate existing connection/accounting/file/
recovery records using the repository's `test:clients`, `test:accounting:record`,
`test:receipts:record` and applicable read-only provider probes; these validate only
their documented scope and never automatically grant acceptance.

Private reporting being enabled is insufficient: the owner/maintainer must
verify confidential delivery. Do not send a report or notification to another
person without the owner's explicit instruction for that test.

## Current evidence

Synthetic Docker CI proves its exact-head image/proxy/runtime cases only; local
Node/workerd/browser checks prove their recorded scope. No live Fortnox or
ChatGPT financial scenario was executed in this implementation session.
The owner selected the current Linux host. On 2026-11-08, source
`ea2013739524727cd832833613610f8eaa496c51` passed the synthetic Docker/isolated
Nginx/HTTPS and packaged maintenance smoke there. See the exact image, environment,
measurements and limitations in [delivery evidence](M05-delivery.md#owner-selected-linux-host-2026-11-08).
Its resources were removed after the test. The owner has since supplied a public
hostname: DNS and a separate Cloudflare Tunnel are configured, and a persistent
Docker app is healthy on loopback. The operator installed the staged TLS vhost as
root, validated Nginx and reloaded it. Public health/setup, exact admin assets,
OAuth metadata, unauthenticated rejection, foreign Origin and overwritten spoofed
proxy headers now pass through the full verified TLS chain. The owner completed
bootstrap/login/credential save and connected both privately allowlisted test
tenants, one in service mode and one in user mode. Read-only operator checks
confirmed active connections, encrypted integration/provider records and unchanged
financial/file/review gates. No private identifiers or token values were emitted.
Only the existing private two-tenant allowlist was reused; Worker credentials were
not copied. Consumed bootstrap files were removed after the owner became active.

The initial client registration retains its zero-company grant. A second
registration/consent now has exactly two companies with matching active connection
generations. The original grant was not widened. Public MCP initialization
(`2025-06-18`) and discovery passed with the four expected read/diagnosis tools.
The tagged plugin's tools remain unavailable in this implementation chat.
The owner subsequently supplied results from a separate ChatGPT chat: listing,
`diagnose_connection` and `get_company_profile` succeeded for both connections.
This is owner-reported client evidence, not an independent tool invocation here.
See the [dated report and read-only tenant-binding check](M05-delivery.md#owner-reported-client-reads-and-persisted-tenant-binding-2026-11-08).
The owner subsequently confirmed that a handle outside the client's granted
companies was denied without company information being returned. Record that
bounded denial check as owner-reported passed. Its exact method/error, raw tool
traces and the exact browser version have not been collected. A subsequent
[local Chrome lifecycle report with read-only server correlation](M05-client-lifecycle-2026-11-08.md)
records client disconnection/reconnection, saved-answer reload and successful reads
after access expiry. Server metadata confirms refresh revocation at 22:39:31 UTC
and rotation after expiry at 22:46:44 UTC. Old-token rejection/replay, explicit
tool reload and remaining isolation/provider/recovery scenarios stay pending.
The shared sandbox organization number is expected according to
the owner; it is not the tenant identifier or evidence of cross-company access.
Consequently #42/#54/#77/#78 and the applicable live gates remain open.

The [subsequent token follow-up](M05-token-renewal-2026-11-08.md) records actual
service/user provider renewal and a fresh local Chrome read report after renewal.
Old original MCP tokens were not retained; only isolated synthetic old-token
checks were possible from the available evidence. All four isolated negative
cases passed, including natural access expiry after 307 seconds. Original replay and the remaining
provider/client/receipt/recovery cases are not inferred from those checks.

The [2026-11-09 issue review](M05-issue-review-2026-11-09.md) closes bounded
implementation #55/#56/#57/#72/#73/#74 and records the remaining work for all
51 related issues. These tracking updates do not complete this actual session,
merge the draft delivery PRs or close #42/#54/#77/#78. Actual two-receipt human
review, provider references, financial/file recovery and private-report delivery
remain pending.
