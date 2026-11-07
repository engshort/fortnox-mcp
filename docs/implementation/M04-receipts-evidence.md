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

## Verification and remaining work

The shared Node/actual-local-workerd contract tests two independent PNG/JPEG byte
round trips; authorizations; policy/disconnect races; concurrency/capacity; scoped
failed-workflow cleanup; expiry; wrong keys and key rotation; corrupt/mismatched
content; PDF restrictions; private URLs/IPs; redirects and oversized responses.
`tests/node/receipt-restart.test.ts` closes/reopens SQLite and restarts actual
workerd/D1, recovers both original files without refetch and deletes expired bytes.

M16 provider operations and M17 step recovery are still being implemented. No test result here establishes those scopes, actual
client file transfer, provider file rights or G08. M14 verification on 2026-11-07: root `typecheck`, `lint`, `build` and `test:build`
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
