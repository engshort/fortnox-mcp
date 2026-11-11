# Implemented-function acceptance audit — 2026-11-11

Scope: the owner's unattended audit of implemented features without complete
acceptance evidence, restricted to the two explicitly authorized Fortnox
sandboxes. Execution used an AI operator and a separate AI reviewer under the
[owner-approved procedure](ai-reviewed-acceptance-2026-11-11.md). A connected
program or a passing local test does not establish provider/client acceptance.

## Environment and evidence

Actual requests used the public HTTPS Node/Docker installation and Chrome's
native ChatGPT client. Public hosting uses the existing reverse proxy, without
Cloudflare Tunnel. Local workerd/D1 and CI results are identified separately.
The initial live revision was `99238b710090a2f5d36f19f9045e3be97ffa07ab`;
later authenticated tests used `1804ad650dac9e154f65270a9eddd5ffa8b0aaed`.
Preserved-intent recovery and final business cleanup used
`c6a04800b449990b81de8ae9181400b8c12eebe7` after PR #132.
The HTTP runner checked the deployment revision before each MCP request.

Private original observations, provider references, immutable proposal inputs,
review decisions, OAuth credentials and files remain outside Git. Public
evidence records observations and limits; it contains no real receipts or
financial/customer data. Only the two owner-designated companies were connected.
No production company, external customer delivery or real payment was used.

## Actual observations

| Scenario | Result and limit |
| --- | --- |
| Eight public negative requests | Anonymous private owner state/private MCP, invalid-bearer private calls/tool listing and anonymous mixed batch returned 401; public signup returned 404; unapproved DCR redirect returned 400; foreign-Origin owner write returned 403 without an owner cookie. The last case proves the early Origin guard, not authenticated CSRF coverage. |
| Two-company/program administration | Actual provider consent, company identity/profile reads, program expansion and local disabling were exercised. Final consent covered bookkeeping/files/invoicing in both sandboxes and order/offer/payroll in one. Consent is not operation acceptance. |
| Local disable enforcement | Authenticated MCP customer listing was denied after local invoicing disable; shared currency reads and the other company's permitted reads remained available. No missing provider license was inferred. |
| Consent overlap and recovery | The pre-fix overlap failure was reproduced. PR #128 serializes consent per authenticated admin session. Post-deployment overlap denial, explicit cancellation, fresh correct-company consent and preserved other-company access passed independent review. #127 is closed for this bounded recovery behavior. |
| Client generation changes | Existing native ChatGPT reconnect did not recover a stale company-generation grant. The other company's read still worked. Fresh DCR plus explicit owner consent restored reads; ordinary same-client reauthorization did not. This remains an open client lifecycle defect, #129. |
| Native ChatGPT connection | A fresh native custom MCP app completed OAuth; exact two-company listing and both statuses succeeded, and the embedded receipt picker rendered. This is actual ChatGPT execution, not the portable plugin manifest or an HTTP-only test. |
| Sales create/read/update attempt | An independently reviewed synthetic unsent offer was created and exact-ID readback matched the intended fields, row and totals. Nullable email defaults failed the projected header schema; comment-only update preparation failed closed. After #132, the explicitly addressed draft's projected header and rows passed their schemas but it still had `editable=false`. A further raw-source guard remains unidentified; #130 stays open. An initial read with an unsupported year parameter was an operator input error, preserved separately from the corrected successful read. |
| Known-reference sales uncertainty and recovery | A second, explicitly addressed synthetic create returned `outcome_unknown`; exact readback isolated the difference to empty CC/BCC returned as null. #132 normalized only explicitly present null CC/BCC. On the deployed fix, the original client/intent/hash/trusted reference and one-attempt execution survived; ordinary exact-reference reconciliation matched the immutable expected digest and returned `succeeded`, without another create or direct state repair. Separately reviewed cancellation and final customer inactivation both succeeded and were independently read back. #131 is closed for this bounded recovery. |
| Business-write uncertainty controls | While that intent remained unknown, register-update and offer-cancel preparation in the same company both returned `OUTCOME_UNKNOWN`; the other company's profile read still succeeded. This proves the shared BusinessWrites preparation block across those two paths, not a universal block over every separate voucher/receipt flow or an actual response-loss injection. |
| Current read matrix | 26 requests: 23 successful inner results, including 17 complete and six explicitly incomplete results, plus three expected unavailable-program denials for order/offer/payroll in the other company. Empty collections prove authenticated empty reads, not detail/write behavior. |
| Exact validation | A balanced exact-decimal voucher passed pure validation. Imbalance, non-finite amount text (`NaN`), outside-year date, invalid calendar date, nonmanual series, numeric rather than string amounts, unsupported precision and negative amounts were rejected. A read-only preparation attempt was denied. Locked-period and mandatory-dimension provider cases remain separate. |
| Register writes | Synthetic customer, supplier and service article each passed independently reviewed immutable create, exact-ID readback, separately reviewed name/description update and inactivation, and exact-ID readback. The first six basic writes succeeded; no uncertain register outcome was observed. A seventh, separately reviewed customer reactivation then enabled the synthetic sales test. Provider defaults are observations, not approved future tax/account choices. |
| Register input bounds | Empty-name clearing and an unsupported field were rejected by SDK input validation. These are actual errors, not passing results inferred from missing structured content. |
| Manual native review | One synthetic ordinary manual voucher was prepared, independently reviewed against exact ID/hash, actual selected account references, generation/policy and client binding, then booked with one native MCP Apps button click. UI status and reload preserved the successful reference and disabled commit. A minimal read-only server projection confirmed one succeeded/dispatched durable execution and no remaining proposal. Exact provider readback matched the date and all three account/debit/credit rows. No attachment was involved. |
| Synthetic reversal | A second, separately reviewed ordinary manual voucher reversed the three test rows. Native UI and exact provider readback succeeded. The six observed rows have zero net test effect per selected account. This is not a formal Fortnox correction link or a statement about the whole ledger balance. |
| Cross-client proposal reads | A separate authorized MCP client could not read the native proposal; replacing the company also failed with `INTENT_CONFLICT`. The second case changes client and company together and does not isolate the company check by itself. These are read denials, not forged-commit/replay tests. |
| MCP OAuth lifecycle | Actual access/refresh rotation returned replacement values; an old refresh replay returned `invalid_grant`. An original access token observed after expiry returned 401, with effects not isolated in that earlier case. A later isolated cleanup test used only the audit HTTP client: fresh access succeeded, advertised refresh-token revocation returned 200, the same still-unexpired access returned 401 with about 300 seconds remaining, and refresh replay returned 400 `invalid_grant`. The separate native client was not targeted. This is MCP OAuth, not Fortnox provider-token rotation. |
| Supplied photographs | The local product validator rejected nine originals as too large and accepted one JPEG. No original was resized or uploaded. These are local validation observations, not native transport or financial acceptance. |
| Synthetic receipt inputs | Two fictional receipts were generated as separate test events. PDF/PNG alternatives for each event passed local limits and visual review. They must not be treated as four separate financial events. |
| Actual file selection and staging | The embedded local chooser timed out, including after the owner confirmed Chrome file access. Ordinary ChatGPT upload followed by host-library selection supplied the two exact PNG originals. With temporarily reviewed Node direct-source configuration, one explicit staging click succeeded: 64,629 and 64,615 bytes and both SHA-256 values matched the originals. Initial library failure text was transient during asynchronous selection. No original photograph was used. |
| Authenticated file readback and model handoff | Both sequential native UI reads produced links only after resource URI, MIME, byte length and SHA-256 verification. Saved modelContent exposed the correct ordinary company/workflow/file references, hashes and expiry to ChatGPT; a private manifest projection matched them and the original client/generation/policy. No UI-only approval capabilities or signed source URLs were exported. |
| Actual file download | The first normal link click produced no captured download in ten seconds and no expected output was found in the default Downloads directory. Supported browser export reported embedded-frame Blob downloads unsupported. No downloaded disk file was available for independent hashing. This is incomplete native disk egress, not an isolated product root cause or full G03 acceptance. |
| File negative controls | Seven raw HTTP MCP controls on restored `none`/empty-origin configuration failed closed with no resource bytes: other-client access to an existing file (`COMPANY_FORBIDDEN`), combined other-client/company access (`FILE_UNAVAILABLE`), IP-literal/non-HTTPS/unapproved-origin input (`FILE_URL_DENIED`), read-only ingress (`CAPABILITY_UNAVAILABLE`) and three-file SDK rejection. Errors were unstructured MCP error text. URL denials do not independently prove DNS or redirect handling. |
| Per-item receipt preparation and first execution | Actual ChatGPT prepared one immutable two-item batch with distinct proposals/hashes, original-file bindings, totals and review expiries. Both exact vouchers validated and were independently reviewed. Only the first item's supported button was clicked once after exact metadata review. Upload became `outcome_unknown` without a trusted provider reference; voucher/link remained pending and runtime projection confirmed zero voucher executions. The second item was not executed. #134 tracks the missing upload reconciliation and diagnostic evidence; no upload was resent. |
| Retained uncertainty and review expiry | Ordinary native batch status and one selected-item resume retained the unknown upload and untouched second item. Existing code returns before dispatch when upload is not successful; no upload recovery exists. The second item's commit control was observed disabled after its review expiry on unchanged policy. No expired financial commit was attempted. |
| Owner UI language and keyboard subset | Actual owner Operations preserved the unresolved item while switching Swedish to English and back. Enter on Skip to content focused the content region; Tab from Companies focused AI clients. This is a small actual keyboard/language sample, not full accessibility, contrast or real mobile acceptance. |
| Restored-policy reference controls | The same native client subsequently listed exactly two active read-only companies, both `review_required`. The old batch returned structured `INTENT_CONFLICT`; the old file returned plain `COMPANY_FORBIDDEN` without bytes. Owner Operations still displayed the unresolved receipt step. Denial of old references is not positive upload recovery. |

The manual voucher's test premises explicitly define a fictional bank debit and
full test VAT deductibility. Neither was inferred from a receipt image. A
balanced voucher alone does not establish appropriate tax/account treatment.
The analytical voucher read retains `row_semantics_verified=false`; its exact
row match is not broad SIE, removed-row or correction-semantics acceptance.

## Partial financial and runtime results

The packaged restore/backup/restore/status commands passed in a private Docker
clone with maintenance mode, no network and no published port. The source was an
older encrypted snapshot, not a fresh backup of the current active installation.
Its source snapshot was created at `2026-11-11T19:36:33.629Z`.
Restore/backup/second restore took 721/774/693 ms; peak test cgroup memory in
the successful run, including helpers, was 106.2 MiB. The active container's two point observations
were 108.7 MiB; this is not a peak or representative-load measurement. Runtime:
Node 24.19.0, SQLite 3.53.3, Docker 29.9.2. Wrong backup/credential keys were
rejected without changing DB/WAL/SHM; sessions/consents/grants/flows were removed
and reconnect/restore blocking was recorded. The snapshot contained no uncertain
writes, receipts, proposals or access/refresh tokens: their recovery and actual
dispatch blocking were not exercised. Test containers/volumes were cleaned;
the active database and application were not restored or restarted by this
isolated restore procedure.
The first attempt failed on environment-file quoting before a test database was
created; the corrected run passed. Its earlier helper peak was about 110.6 MiB,
so 106.2 MiB must not be presented as the maximum of the entire procedure.

Receivables/payables report returned-page-only totals and unverified balance
semantics. Financial analysis/movements retain incomplete source coverage;
period comparison is compatible but incomplete. Liquidity uses selected
accounts, returned pages and an explicit `due_date_only` assumption. These
results pass honest limitation reporting, not full financial correctness.

PR #128's exact reviewed head passed all six CI checks: 362 Node/SQLite tests,
295 actual local workerd/D1 tests and six desktop/mobile owner-UI cases. The 67
checked hash bindings in three source ledgers matched committed LF bytes. The main deployment
[43087683005](https://github.com/engshort/fortnox-mcp/actions/runs/43087683005)
succeeded and public health identified `1804ad6`. Windows local workerd crashed
before tests; CRLF-sensitive whole-checkout checks also failed locally. These
attempts are not recorded as passing Worker or lint runs. Emulated mobile CI is
not evidence of a real mobile ChatGPT session.

The bounded empty-copy fix in [PR #132](https://github.com/engshort/fortnox-mcp/pull/132)
was independently reviewed on exact head
`67a3c0b08881594ac810cf4edb0c0267eb73f34c`; all 78 checked source-hash
bindings in four ledgers matched committed Git bytes. All six CI checks passed, including 365 Node/SQLite and 298
actual local workerd/D1 tests. The merge is
`c6a04800b449990b81de8ae9181400b8c12eebe7`. Deployment
[43102735885](https://github.com/engshort/fortnox-mcp/actions/runs/43102735885)
passed on attempt 2. Attempt 1 stopped before SSH/runtime mutation when two
existing Worker payroll cases exceeded their five-second limits; 296 passed
and two failed. No test requirement was removed for the retry.
The controlled restart preserved the original unknown intent's immutable
metadata, generation/policy/client bindings, trusted reference and single
execution. Ordinary same-client reconciliation then changed only its terminal
state to succeeded after the expected/observed content digests matched.
Independent review checked original provider/client responses and private
runtime projections, not only the operator's summary.

Current retained state: the synthetic customer, supplier and article
are inactive, both synthetic unsent/unbooked offers are cancelled and the
known-reference sales execution is reconciled. A subsequent receipt upload is
unknown, with no receipt voucher created; its batch/file bindings and historical
proposal references are retained while pending encrypted proposals were removed
(zero remain). All new business writes are stopped. Both companies
are read-only and manual vouchers remain `review_required`. Restoring the first
company's read-only setting through ordinary owner UI increased policy version
8 to 9 and invalidated pending proposals. The uncertain receipt step remains
visible in owner Operations; its historical policy-8 batch/file bindings were
not rewritten. Ordinary old references can no longer authorize that workflow.
This prevents further financial execution without falsely resolving the upload.
The open outcome and missing supported recovery remain explicit blockers.

The temporary Node direct-source window used the same reviewed `c6a0480` image:
start `22:26:45` UTC, ready `22:26:52`, restored `22:31:33` on 2026-11-11.
Separate review checked the exact corrected operator script, fresh pause
acknowledgements and original runtime evidence. Only two source configuration
keys changed; identity, grants, generation/policy, credentials, keys, mounts and
operational history fingerprints were preserved. Probe-based interruption
estimates were 1.406 and 1.416 seconds, with request-start sampling estimates of
1.610 and 1.620 seconds. These are not strict outage or complete public
availability bounds. Full window duration was 287.932 seconds; normal rollback took 7.178
seconds. Final transport is `none`, origins empty, and public HTTPS health
identified the same revision. This proves normal coordinated pause/restore,
not absent-container/fault recovery or automatic expiry. The settings have no
built-in TTL. The earlier operator script was rejected before mutation for
rollback/recovery guard defects and was never run.

## Issue disposition

| Issues | Disposition and remaining requirement |
| --- | --- |
| #127 | Closed after independently reviewed CI, deployment and actual serialized-consent/cancellation/recovery regression. This does not certify unrestricted provider-side parallel consent. |
| #129 | Open, reproduced stale-generation reconnect defect; fresh registration is a tested workaround, not a fix. |
| #130 | Open, reproduced sales draft editability failure, also on the addressed draft after its projected header and rows passed the schemas. The remaining raw-source guard needs isolation. No update was dispatched. |
| #131 | Closed after the narrow null-CC/BCC fix, exact-head review/CI, deployment, actual same-client preserved-intent reconciliation and independently reviewed supported cleanup. Broader sales lifecycle and G08 remain open. |
| #134 | Open: the first actual reviewed receipt upload is unknown without a trusted reference; voucher/link never started. Existing resume/link/attachment APIs cannot positively reconcile this upload. No specific HTTP, format, timeout or parse cause is established. |
| #117, #28 | Actual UI/provider/disable evidence added; complete lifecycle, operation and runtime acceptance remain. |
| #19, #20, #58–#60, #62, #75 | Actual two-company, isolation, MCP lifecycle and fresh consent evidence added. Current Fortnox user-mode renewal/fault/revocation, complete reconnect and distinct provider rights/license cases remain. |
| #21, #92 | Register create/update/readback/cleanup and selected accounting references have new actual evidence. Complete scope, reference/price behavior, provider rights/year/period cases and recovery still require their own evidence. |
| #22 | Sales reads and a bounded offer create/read passed; update hit #130. Full document lifecycles and remaining supplier-invoice/payment implementation are separate. |
| #23, #24, #37, #38, #76, #93 | Exact validation and a native reviewed ordinary voucher now have actual evidence. Full financial rules, supported-client adversarial cases, corrections and uncertain-write recovery remain open. |
| #32 | Native rendering, explicit AI-reviewed click, status, successful remount and an expired-review UI control have bounded evidence. Forged/replay/concurrent/backend-expiry/lost-response/other-browser and actual runtime criteria remain; do not close from one successful voucher. |
| #33, #68, #69 | Actual ChatGPT two-file ingress, exact-byte staging, authenticated UI readback and ordinary model-reference handoff passed bounded review. Disk egress, PDF/expiry/adversarial file cases and full per-item receipt acceptance remain incomplete. |
| #70, #71, #94 | First reviewed provider upload produced retained uncertainty before financial dispatch; #134 blocks further writes. Complete upload/link/retrieval, partial failure and safe link-only recovery remain unverified. |
| #25, #26, #40 | Actual bounded reads and honest partial-data results added; complete analysis/source semantics, payroll write prerequisites and lifecycle cases remain. An empty employee list cannot supply a synthetic employee for code-11 writes. |
| #27 | Bounded diagnostics passed; source rights and full negative/provider semantics remain independent. |
| #18, #39, #42, #77 | Local/CI checks and public hosting do not establish hosted Worker budgets, complete operational recovery or actual confidential-report delivery. |
| #16, #17, #29, #35, #36, #41, #54, #78 | Parent/prerelease/source-rights requirements remain; no stable release or legal acceptance is inferred. |
| #83 | Documentation exists, but the specifically registered Labstride canary timed out. A separate documentation PR does not replace the required native coordinator result. |
| #30, #43–#52, #106, #107 | Deferred/unimplemented scope, including native systemd/APT, requires implementation before acceptance. |
| #53 | Legal review, contributor signing and required-check setup remain external prerequisites. AI review is not a signature. |

Use the [Swedish remaining-test instructions](../users/acceptansprov.sv.md)
for the next constrained test session. Unknown outcomes must be reconciled
before any resend; fresh consent must not silently widen an existing client
grant. No issue is complete merely because its implementation merged.
