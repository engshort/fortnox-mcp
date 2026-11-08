# M14 explicit host file picker

Scope: #68, with related #24/#33 evidence in shared PR #105. Provider/file,
financial and review-host gates remain unchanged. Actual client acceptance
is incomplete.

## Observed client attempt — 2026-11-08

The five-tool experiment on source `6489588` ran as version
`4041004b-0984-479d-aaac-bc5eeec61acb`, deployment
`644ce144-a528-42b4-8b23-5cadea4d46eb`. Independently retrieved module bytes
matched SHA-256 `4e46d8490afcc68e94858c08f37a53df055d1c29249a5f9d9c97665ee5c4834e`.

The owner manually redeemed the operator-issued recovery code. D1 confirmed
consumption and the unchanged persistent owner; local Chrome confirmed owner
login, two active connections and unchanged `review_required`. The specifically
authorized transfer used verified SSH/SFTP. Both temporary code copies and import
SQL were removed after consumption; no code/credential is included here.

A fresh client had effective consent and active refresh scope exactly
`mcp:read mcp:files offline_access`, the correct MCP resource and both current
company generations. Its allowed-scope catalog also included `mcp:write`, which
was **not granted**. Authenticated discovery returned both allowed companies.

Chrome selected two synthetic originals through the real file picker. Both a
follow-up-message attempt and an edited same-message attempt with an explicit
app mention stopped **before** `ingest_receipt_files`: the client reported no
usable authentic file arguments. The edited wire message still carried both
PNG/PDF attachments. No server file-error code or actual MCP download origin was
observed. Internal previews, and an exact PDF download from the client's own
uploaded-file preview, do not establish product input/output acceptance.

The ordinary clean `6489588` product was restored as version
`8f6a44f8-19b5-4a3a-90ef-2dd2e5dab038`, deployment
`a1a6c36a-2a61-40d2-b9d5-c607a9b5d507`. Independent readback matched all
5,036,115 bytes, SHA-256
`f42461610b7a15cdb97da654c019cb891f8d5a05321a1811ad1d05dd24e12925`.
Transport is `none`; experiment deadline/source origins/helper settings are
absent. No helper/tunnel was started. Final D1 manifests/chunks: **0/0**.

## Resulting implementation

The optional `open_receipt_file_picker` tool opens a company-authorized MCP Apps
view without source fetch/staging. It follows the documented
[OpenAI file APIs](https://developers.openai.com/plugins/reference#define-file-inputs):
feature-detected `selectFiles` and `getFileDownloadUrl`, with native file-input
and `uploadFile` fallback. Missing host APIs disable the controls. Selecting
files and requesting temporary staging are separate actions.

Only host-returned file IDs/URLs enter the view. The test operator can inspect
origins before starting the existing bounded relay. The view performs no direct
fetch, copies no session cookies and accepts no model-created file URL.
Server-side scope/company/generation/policy/read-only/source restrictions still
apply through the same staging and readback tools. This enables no voucher,
provider-file operation or proof of human approval.

Saved widget state contains only bounded company/workflow/file references and
MIME/size/hash/expiry, without source URL, host ID, original name or bytes.
Remount never replays staging. Authenticated readback checks URI/MIME/byte length
and SHA-256 before exposing a memory-only Blob download link. The actual host's
sandbox and final downloaded bytes still need verification, particularly PDF.
The synthetic browser host explicitly permits downloads; ChatGPT support is not
inferred. Ordinary product discovery remains file-free.

## Next actual acceptance

Local verification on 2026-11-08 passed: root typecheck/lint, **182 Node / 137
actual workerd/D1 tests**, build, **nine artifact/native tests** and all **three
Wrangler dry-runs**. Node ran with one test worker to avoid restart-test resource
contention. Full Chromium regression: **34 passed**, including eight new picker
cases. The 25 source fingerprints, relative file targets and whitespace passed;
Markdown anchors were not mechanically checked. Exact pushed-head CI is separate.

The Browser plugin was unavailable; existing Playwright/Chromium was used on the
synthetic loopback host. Flow: company context, host selection, explicit staging,
authenticated hash/length checks, actual Blob download, saved-reference remount.

| Rendered check | Result |
| --- | --- |
| Host identity and meaningful picker content | Passed |
| Static view without framework overlay | Passed; visually inspected |
| Picker page/console errors | None observed in the main interaction case |
| Desktop and mobile-sized screenshots | Captured and inspected outside Git |
| Selection vs staging, upload fallback and missing APIs | Passed |
| Original PDF-byte download, corrupt result and lost-answer/remount behavior | Passed in the synthetic host |

The first browser launch lacked shared libraries; they were extracted only under
temporary test storage before the successful run. An initial parallel Node run
found a stale expected policy version in the new test and a restart timeout;
the test now reads current policy and the final serial full suite passed. No
production behavior was weakened to accommodate these verification failures.

After a clean committed build, passing CI and separately verified deployment:
Reload tools in the already consented file client, open the new picker for an
explicit company, select the two synthetic originals and observe host API
availability/source origins. Start the short-lived reviewed relay only when
ready, then stage once and compare authenticated server and actual downloaded
bytes. Test the second company, foreign references, reload/Reload tools and
expiry/cleanup. Restore normal disabled file behavior afterward.

No test result in this document closes #68/#33, broad #24, or provider/recovery
gates #94/#38. Exact source, local checks and later CI/client results are recorded
in #68/PR #105.
