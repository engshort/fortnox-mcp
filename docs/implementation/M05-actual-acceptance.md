# M05 actual acceptance session — pending

Scope: #42, #54, #72–#78; applicable evidence from #32/#33, #55–#62,
#75/#76, #92–#94 and #38. Implementation, local checks and code merge do not
complete this session. No scenario below has been run by this document.

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
| Clean installation | Fresh private config/volume, migrations, TLS, non-root, health, missing-secret failure | Not run on operator host |
| Owner setup/recovery | Private one-time bootstrap, login/logout/reset, operator-managed credentials | Not run in target installation |
| Two connections | Service/user modes as applicable; exact tenant verification, refresh, disconnect/reconnect | Pending #55–#62/#75 |
| ChatGPT OAuth/MCP | Actual login/consent, two selected companies, foreign-company denial, refresh/revocation, reload/remount | Pending #32/#33 |
| Reference validation | Company/year/accounts/series/locked period evidence; no guessed rules | Pending #92/#93 |
| Two originals | Same original for client interpretation and server staging/readback, no URL/name/token disclosure | Pending #33 |
| Two separate reviews | Trusted human action per item, capability isolation/replay/remount/CSP | Pending #32/#76 |
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
No test-host connection or private acceptance configuration has been supplied.
Consequently #42/#54/#77/#78 and the applicable live gates remain open.
