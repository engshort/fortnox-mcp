# Milestone 4 — receipt workflow implementation and evidence

In progress, 2026-11-07. Tracks M14–M17 (#68–#71), G08/#38 and the
file-operation slice of G06/#94. Full G06/#36, G02/#32, G03/#33 and financial
G07/#37 retain their independent acceptance. No release or production account.

## M14: bounded product file adapter

`ReceiptFiles` authorizes the current owner/client grant, explicit company,
connection generation and policy before source access and after staging/readback.
`mcp:files` is separate consent, with no widening of existing tokens/clients.
Read-only denies staging. The server creates an opaque workflow and file IDs;
client IDs, filenames, URLs and document text are not persisted or echoed.

SQLite and D1 share parameterized SQL. Migration `0006_receipt_files.sql` adds
private temporary manifests and encrypted chunks and updates only recognized
resource scope metadata, leaving grants untouched. A transaction/batch inserts
the manifest and chunks, with a durable four-file owner limit. A failed ingestion
removes only its own workflow, including when the second file fails. Files are
AES-GCM encrypted with external versioned credential keys; authenticated data
binds owner, client, company, generation, policy, workflow, file identity, MIME,
byte count, hash, expiry and chunk index. Chunk/order/digest checks precede output.

Product limits: one or two files, 1 MiB each, two million image pixels, ten pages,
15-second source deadline and a 55-minute reference lifetime. Content is decoded:
PNG CRC/structure, JPEG bounded decode and plain PDF 1.0–1.7. Encrypted PDF is
reported explicitly; compressed/object-stream, scripted/action/embedded PDF is
unsupported. These are conservative supported formats, not all Fortnox formats.
No OCR or external model key is introduced.

Only exact reviewed HTTPS origins can enter the source adapter. IP literals,
local names, credentials, custom ports, redirects and non-public DNS answers are
rejected. The Node transport pins checked DNS results to the socket while keeping
TLS hostname verification and forwarding no incoming cookies/credentials. Worker
source access has no unpinned fallback: without a separately verified secure
transport it returns `FILE_TRANSPORT_UNAVAILABLE`. Existing S00's failed direct
Worker TLS approach is not reused.

Authenticated MCP resources provide original bytes without a public permanent
URL. Output format support in actual ChatGPT still requires the human test below.
File operations are absent from product discovery by default, with the runtime
activation gate false. An ENV variable cannot assert successful host acceptance.
Source origin lists start empty.

Node startup and five-minute cleanup, and the Worker scheduled handler, physically
remove expired manifests/chunks even while ingress is disabled. Expiry denies
reads immediately. Scheduler outages can delay deletion until recovery. Retain
old key versions until temporary files have expired and cleanup has completed;
connection key rotation alone does not reencrypt staged file chunks.

## M15: immutable per-item preparation and review

The receipt service prepares up to ten explicitly interpreted items, each with a
company/workflow/file reference and its own exact-money voucher validation. It
never pools totals or infers accounts, tax, dates or missing amounts. Missing
facts, invalid/unverified vouchers or expired/unreadable files return per-item
`needs_input`; unauthorized companies fail closed before foreign proposals are
created. Same-company file hashes produce duplicate candidates. An explicit
separate-transaction resolution permits legitimate duplicates rather than banning
all matching hashes. This is bounded local candidate detection, not a guarantee
against rescans or duplicates outside retention.

Each canonical voucher hash and encrypted proposal authenticated data now bind
batch, item, workflow, file and SHA-256. Old ordinary proposals retain their
original hash/format. The server stores no cleartext voucher in batch metadata;
only encrypted proposals and bounded operational references/state. Four batch
manifests per company, twelve pending receipt proposals and twelve staged files
per owner allow the ten-item recovery scenario; ordinary preparation retains its
eight-proposal ceiling. All share the existing bounded connection snapshot.
The M14 four-file capacity above describes its original commit; M15 raises that
bounded limit to twelve and reruns the concurrency contract.

Receipt-bound proposals cannot execute through ordinary manual-voucher routes.
The existing accounting service requires an internal receipt guard before claim
and immediately before dispatch, as well as the same company-specific policy,
capability, fresh references and one-time durable intent. Both proposal and review expiry are capped by the actual staged-file expiry. File expiry or a changed
company/generation/policy/hash invalidates the review. A concurrent preparation
rechecks duplicate candidates at the durable batch claim rather than losing a
warning from a stale snapshot. No model argument supplies
a replacement voucher or human approval.

`prepare_receipt_batch` returns separate immutable items/totals and UI-only
capabilities in `_meta`; `get_receipt_batch` never creates a new capability. Both
start disabled in the product. The embedded view renders every receipt's own
company, file identity/hash, date/year/series, rows, warnings and totals. It uses
text nodes, restrictive script/style hashes, no external network and no browser
storage. Per-item controls never approve a pooled batch. Missing capability,
status failure, stale review or a changed selection disables execution. The
upload/book/link dispatcher is the subsequent M16/M17 scope; this preparatory
commit does not enable or claim that provider flow.

Local Chromium QA used the actual review HTML in a sandboxed loopback host at
`http://127.0.0.1:8795/`. Browser plugin was unavailable; the already installed
Playwright/Chromium was used. Desktop 1280×900 and mobile-sized 390×844 rendering,
page identity/nonblank/no overlay, correct Swedish text, two separate totals,
keyboard single-item selection, double-click suppression, remount without private
capability and status-failure disabling passed with zero page/console errors.
Screenshots and the temporary harness/results remain outside Git under `/tmp`.
The mobile table scrolls within its row container; the page has no horizontal
overflow. This trusted synthetic host is not actual ChatGPT, a real phone, or
proof of physical human presence. G02 remains unchanged.

## M16: separate provider upload, link and authorized readback

`ReceiptAttachments` stores a durable per-item upload/link claim before dispatch.
Concurrent calls cannot claim it twice. Completed and uncertain steps return their
saved outcome; a persisted `submitting` state is uncertain after restart, even if
the process may have stopped before network dispatch. A late answer can retain a
minimal provider reference but cannot restore credentials, policy or a disconnected
connection. A storage failure after dispatch is also uncertain.

The provider adapter uses four fixed operations, recorded with exact source
fingerprints in the [file-operation ledger](../reference/mvp-receipt-operations.json):

| Operation | Authorization and contract | Effects and retry |
| --- | --- | --- |
| `POST /3/inbox?path=Inbox_v` | Current company/generation/policy, `mcp:files`, `mcp:write`, provider `inbox`; exact staged content/hash and generated filename | One multipart upload; save `File.Id`. No automatic POST retry. |
| `POST /3/voucherfileconnections?financialyear=…` | Provider `connectfile`; successful saved upload and voucher, owning-voucher read; exact file/year/series/number | Link only. A failed link never recreates the voucher. |
| `GET /3/voucherfileconnections/{FileId}` | Company-bound ID, explicit year; exact returned relationship | Positive exact evidence can reconcile a lost link answer. Absence does not prove a previous write was unapplied. |
| `GET /3/inbox/{Id}` | Owning voucher and exact relationship checked before and after read | Bounded original bytes as an authenticated MCP resource; no public URL or original name. |

All calls share the durable client/tenant limiter. Writes have a 15-second budget
and bounded JSON responses. Dispatched HTTP errors, redirects, timeouts, malformed
answers and lost responses remain uncertain unless dated operation evidence
explicitly proves rejection without effect. The classification lists are separate for upload and link and start empty.
Tests configure a synthetic unapplied link HTTP 400 while the same upload status
remains uncertain.
Binary reads enforce 1 MiB, decode content, reject redirects and mismatched types,
permit one authentication renewal and at most three bounded read attempts.

`upload_receipt_file`, `link_receipt_attachment` and `get_receipt_attachment` accept
typed item/provider references, never arbitrary URLs or replacement voucher
content. Execution-time authorization is repeated even when a tool was discovered
earlier. Completed, partial and uncertain results are derived from durable
accounting executions rather than an expired proposal body. A successful voucher
with an incomplete link advertises `repair_link_only`.

The product gates remain false individually; formats and proven-unapplied rejection
classifications start empty. Local PNG/JPEG/plain-PDF and 1 MiB limits are
conservative server limits, not verified Fortnox endpoint limits. In particular,
availability of the Inbox binary endpoint after linking still needs actual
provider evidence; there is no guessed archive fallback. This commit adds no
financial dispatcher or supported/default-enabled provider coverage. M17 connects
the separate steps under the existing human-review policy.

## M17: execution and safe per-item recovery

`ReceiptWorkflow` coordinates upload → the existing accounting service → link.
Review mode validates the UI-only capability before uploading and again inside
the financial service. The same company policy, fresh financial references,
file/hash binding and durable voucher intent govern every financial entry point.
An explicitly owner-selected `client_managed` company has a separate model tool;
it cannot downgrade another company's `review_required` policy. All product
workflow/provider/host gates remain false.

`commit_reviewed_receipt_item` is app-only metadata plus the existing server-side
capability contract; visibility alone is not evidence of human presence.
`resume_receipt_batch` takes an explicit immutable company/batch/hash and 1–10
distinct item IDs. It never uploads or creates a voucher. It can reconcile an
uncertain voucher by an already trusted exact provider reference, reconcile an
uncertain link by positive exact evidence, or repair a pending/proven-unapplied
link after a successful voucher. Missing provider records and unknown answers
never permit another financial submission.

If the process stops after upload but before financial dispatch, resume leaves
the voucher untouched. `review_receipt_item_again` can rotate a capability for
the same unexecuted, still-live immutable proposal, returning it only in `_meta`.
It does not approve anything. The person must review and click again; a prior
capability becomes invalid. Existing successful, failed or uncertain voucher
executions cannot be replaced through this route. Expired files require new
attachment/preparation instead. The durable claim compares the currently saved
capability hash so a concurrent renewal cannot leave an old review usable.

Results include each step's state/reference, requested/completed/partial/failed/
unknown/needs-input/prepared counts and a next action. Invalid inputs retain their
own reason when another file expires. Unknown financial outcomes outrank expiry.
One item's error cannot turn the whole batch into success or authorize another
item. The review view shows step results and separates status investigation,
link-only repair and fresh review; none is an automatic approval on remount.

Unresolved upload claims and financial reconciliation context are never evicted
to make capacity. Successful voucher references with unfinished attachment repair
also survive normal 30-day execution retention. A completed link marks that
operational hold resolved. Four receipt batches and 32 voucher executions remain
hard capacity limits, failing closed when unresolved work fills them. Completed
temporary bytes are deleted per file only when every retained reference to that
file is completed; other items keep their bytes until completion or the existing
55-minute expiry/scheduled cleanup. No local cleanup reverses Fortnox effects.

## Verification and remaining work

The shared Node/actual-local-workerd contract tests two independent PNG/JPEG byte
round trips; authorizations; policy/disconnect races; concurrency/capacity; scoped
failed-workflow cleanup; expiry; wrong keys and key rotation; corrupt/mismatched
content; PDF restrictions; private URLs/IPs; redirects and oversized responses.
`tests/node/receipt-restart.test.ts` closes/reopens SQLite and restarts actual
workerd/D1, recovers both original files without refetch and deletes expired bytes.

M17 local verification is complete. Synthetic tests do not establish actual
client file transfer, provider file rights or live G08 acceptance.
M14 verification on 2026-11-07: root `typecheck`, `lint`, `build` and `test:build`
passed (six original artifact cases and two native product/recovery cases). The
full root suite passed 106 Node cases and 90 workerd cases before the final two
shared MCP/tamper checks and two restart checks were added. The final file subset
then passed 12 Node cases, the same 12 cases in actual local workerd/D1, and two
SQLite/workerd restart cases. Product Wrangler dry-run passed; no deployment was
performed. No actual client or provider test is inferred from these results.

The dependency audit found five existing development-toolchain vulnerability
entries (Vitest/Miniflare/Wrangler transitive dependencies); the newly pinned
format/address libraries were not listed. No blind dependency upgrade was made.
Final aggregate checks and CI will be rerun for the complete milestone patch.

## Human client acceptance (pending)

1. In the separate authorized test installation, enable only the reviewed file
   transport/origins and obtain fresh `mcp:files` consent. Keep financial writes
   disabled until their own gates pass.
2. Attach two synthetic files through actual ChatGPT's file picker (not typed
   source URLs). Record their local SHA-256/length, then stage for one explicitly
   selected test company. Compare both returned digests and lengths.
3. Retrieve both authenticated outputs in the client. Download and compare the
   actual bytes with both originals; a visible link or HTTP 200 alone is not proof.
4. Check conversation reload, Reload tools, expiry, foreign-company/workflow
   denial and a bad second file. Record client/version/CSP, exact deployment and
   source commit, outcome and limitations without publishing private file IDs,
   URLs, document contents or test-company identities.
5. Disable ingress after the trial; keep cleanup running and verify both
   manifests and chunks disappear. Confirm scheduler recovery after an outage.

## Sources and rights

Current file descriptor shape was checked against the official
[OpenAI reference](https://developers.openai.com/plugins/reference#define-file-inputs)
on 2026-11-07: the top-level array declares all four file properties, requiring
only `download_url` and `file_id`. This is documentation evidence, not client proof.
[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
provides transactional ordered execution; actual local D1 tests cover this adapter.
The project-authored S00 format/transport mechanisms are reused with the same
pinned MIT/BSD libraries. No provider specification or generated code is copied.

M16 provider contracts were independently compared on 2026-11-07 with the official
[voucher attachment guide](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers),
[API reference](https://apps.fortnox.se/apidocs) and
[scope table](https://www.fortnox.se/developer/guides-and-good-to-know/scopes).
The guide describes Inbox_v upload followed by voucher-file connection; the scope
table assigns `inbox` and `connectfile` separately. `connectfile` requires an
applicable Bokföring, Anläggning or Arkivplats license. Actual user rights and
endpoint formats/limits remain unverified. The privately supplied OpenAPI snapshot
was reference input only; its SHA-256 is recorded in the operation ledger, without
redistributing the document, derived descriptions or generated code. #35 remains
independent.

## Human provider acceptance (pending)

1. Use only the two explicitly authorized synthetic test tenants. Obtain fresh
   Fortnox consent for `inbox` and `connectfile` and fresh MCP file/write consent;
   existing grants must not broaden automatically. Record exact deployment,
   source commit, service/user mode and applicable licenses privately.
2. First complete the separate financial/reference and review-host requirements
   (#76/#92/#93 and #32). No environment flag can assert those requirements have
   passed. Enable only the individual operations and formats with applicable
   evidence, using a reviewed test configuration.
3. Stage two actual client files and compare hashes. Review each exact synthetic
   proposal separately. Verify upload, existing voucher identity, connection and
   retrieved original bytes independently in both companies. Confirm the binary
   endpoint remains available after linking; stop rather than guess if it does not.
4. Test missing scope, missing applicable license/user right and foreign-company
   references. Record redacted classifications, not raw provider payloads. Confirm
   denial before foreign file retrieval and distinguish unknown rights from a
   proven missing permission.
5. In a controlled test adapter, lose each response and restart. Compare stored
   minimal references with Fortnox before any retry. A known successful upload or
   voucher must remain single; repair only a proven-unapplied link. An absent
   lookup does not authorize resending an uncertain operation.
6. Verify provider format/size limits and actual client output downloads. Keep
   original files, tokens, URLs, IDs and tenant identities out of public evidence.
   #94 and #38 stay open until their applicable evidence is complete.

M15 automated checks, 2026-11-07: the full root suite passed **118 Node** and
**100 actual local workerd/D1** cases, including the ten-item preparation scenario,
per-item acceptance with an internal guard, rejection of swapped capabilities and
ordinary-route bypass, independent imbalance, missing facts, duplicate resolution,
expiry, policy changes and foreign inputs. Root typecheck/lint passed. Build and
all eight built-artifact/native cases passed on the final source, including the
expiry binding and concurrent duplicate-warning guard. The final shared subset
passed 21 cases in Node and the same 21 in actual workerd/D1.
The accounting ledger source fingerprints were updated; every provider operation
retains its prior unverified status and dated live-evidence boundary.

M16 automated checks, 2026-11-07: the full root suite passed **132 Node** and
**111 actual local workerd/D1** cases. The final endpoint-specific rejection
classification was then checked with the same **31 shared receipt cases** in each
runtime and both source-ledger checks in Node. Four SQLite/workerd restart cases
passed in the full Node run, including lost upload answers with no replay.
Typecheck, lint, build and all eight built-artifact/native tests passed on the
final M16 source. Product Wrangler dry-run and relative documentation file targets
were checked; no test installation was deployed and no actual Fortnox file was
uploaded, linked or retrieved. No provider or human acceptance is inferred.


M17 automated checks, 2026-11-07: the full root suite passed **150 Node** and
**125 actual local workerd/D1** cases. Eight receipt restart cases cover both
SQLite and restarted workerd/D1: original bytes/expiry, uncertain uploads, partial
link repair and uncertain financial writes. The final concurrent capability
rotation case then passed in the shared receipt subset (**46 cases per runtime**,
plus both source-ledger cases in Node). Old review rotation after validation but
before claim cannot dispatch a voucher.

Root typecheck/lint/build, all eight built-artifact/native cases and both Wrangler
dry-runs passed. The existing OAuth package's typecheck/lint and **all 26 Chromium
browser cases** passed, including eight product receipt desktop/mobile cases and
18 existing review regressions. Receipt cases use the actual product HTML under
its restrictive CSP, Swedish outcome/actions, original per-item totals, keyboard
selection, link-only repair, public remount, explicit re-review, status/selection
failure and the real 15-second bridge timeout. No relevant page/console errors;
screenshots were inspected and remain outside Git in the temporary directory.
This synthetic host is not actual ChatGPT or a physical mobile device. Relative
documentation file targets and whitespace passed. No deployment or actual
Fortnox write was performed; live #38/#94 and host/file/financial gates remain open.
