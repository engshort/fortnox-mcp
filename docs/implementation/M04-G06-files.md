# File-specific G06 — milestone 4 provider verification packet

Acceptance operator update (2026-11-11): an AI operator and a separate AI reviewer
may execute and assess all previously human-operated test steps under the
[owner-approved procedure](../implementation/ai-reviewed-acceptance-2026-11-11.md).
Actual client/provider/runtime execution, original evidence, proposal binding and
all policy/validation/recovery requirements remain mandatory. Historical results
are preserved; a rewritten criterion does not pass a pending test.

Scope: #94, preserving the file-operation requirements split from #75/#36.
The implementation and local verification exist; **actual provider/client
acceptance is not run**. All four operations remain `implemented_unverified`,
unsupported and disabled by default. Full G06/#36, G08/#38, G02/G03 and financial
G07/#37/#76 retain their independent acceptance. No release or production account.

## Exact operation and source matrix

The [machine-readable ledger](../reference/mvp-receipt-operations.json) records
source fingerprints, operation IDs, context, effects, tests and missing evidence.
It is independently authored project metadata, not a redistributed/generated
provider specification. On 2026-11-07 the implementation was compared with the
official [API reference](https://apps.fortnox.se/apidocs),
[voucher workflow guide](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers)
and [scope table](https://www.fortnox.se/developer/guides-and-good-to-know/scopes).
The local private input identity is SHA-256
`10600267abe8addf88b240337317d666fedc7d469a419e18443d3cf63c4d10e7`.
No raw input, generated implementation or derived schema catalog is distributed;
the acquisition/distribution question in #35 retains its separate status.

| Local operation / upstream ID | Fixed method/path | Scope, context and effect | Contract and activation evidence |
| --- | --- | --- | --- |
| `inbox_upload` / `InboxController_doCreate` | `POST /3/inbox?path=Inbox_v` | `inbox`; current owner/client/company/generation/policy; file write | Exact staged bytes/hash, generated filename, multipart file, returned `File.Id`. Actual provider format/size/rights and accepted write semantics still unverified. |
| `voucher_file_link` / `VoucherFileConnectionController_doCreate` | `POST /3/voucherfileconnections?financialyear=…` | `connectfile`; saved upload and successful exact voucher; attachment write | FileId plus explicit voucher year/series/number; owning-voucher read; exact returned relationship. No assumed transaction or POST retry. |
| `voucher_file_read` / `VoucherFileConnectionController_doShow` | `GET /3/voucherfileconnections/{FileId}?financialyear=…` | `connectfile`; explicit company/year/file; bounded read | Exact file/year/series/number must match. A negative lookup never authorizes resending an uncertain operation. |
| `inbox_read` / `InboxController_doShow` | `GET /3/inbox/{Id}` | `inbox`; owning voucher plus exact relationship before/after read; bounded binary read | Original content is validated and returned through an authenticated MCP resource. Availability and bytes after linking must be observed; no guessed archive/URL fallback. |

The scope table assigns no specific product license to `inbox`; `connectfile`
requires an applicable Bokföring, Anläggning or Arkivplats license. The **product
workflow** additionally verifies the owning voucher through `bookkeeping`; an
endpoint's license row alone does not establish all combined rights. Actual user
rights/licenses must be recorded independently for both token modes. A 403 with
unknown cause remains unknown; it is not evidence of a particular missing license.

Local supported staging bounds are 1 MiB, PNG/JPEG and restricted plain PDF,
two million pixels/ten pages, with short encrypted retention. These are
conservative project bounds, not verified endpoint maxima or client download
support. The private Inbox read schema and binary response description disagree;
actual binary behavior is required before activation. The guide's format prose
and example are also insufficient to certify all accepted formats. No operation
is promoted merely because its fixture matches the request mapping.

## Authentication, effects and failure rules

Every entry point checks current server-side identity/grant and explicit company;
typed IDs are not authorization. Upload/link require write/file scopes and reject
read-only policy. Reads verify the owning record and relationship, and reject
foreign companies, generations, years/files and unsafe resource targets. Token
acquisition follows the connection's stored scopes and separate service/user
lifecycle. No `/me.SysAdmin` or organization-number equality establishes ownership.

Provider requests have fixed HTTPS origins/registered paths, manual redirects,
bounded time/size and the shared durable client/tenant limiter. File writes are
single POST attempts with durable item claims before dispatch. Parsed late IDs
may be retained as minimal reconciliation evidence, never as restored credentials.
The operation-specific proven-unapplied status lists start empty. HTTP errors or
lost responses do not become safe retries through configuration or a missing GET.
Read renewal/retry remains bounded. No generic API executor, delivery operation,
file deletion, invoice/email/eprint or archive fallback is introduced.

## Preparing fresh file consent

`FORTNOX_RECEIPT_CONSENT=false` is the default. An owner may explicitly prepare
`true` only in the isolated two-tenant test configuration with accounting reference
consent enabled. New owner-initiated provider consent then requests the fixed
additional names `inbox connectfile`. This flag enables **no file tool, provider
write, financial validation or approved review host**.

Existing stored connections retain their scope lists and tokens. Pending consent
uses its saved requested set; existing MCP grants never broaden automatically.
Obtain new provider consent for each allowed test company, verify tenant again
and obtain the current explicit MCP file/write grant as needed. Reconnection
invalidates old generations/grants. Use authenticated administration; do not paste
codes, states or credentials into public evidence. Both service and user renewal
are covered by shared Node/workerd tests, including old narrow connections under
the newly configured broader consent.

## Concrete original-byte readback utility

`npm run test:receipts:attachments` calls only `list_companies` and
`get_receipt_attachment`. It cannot upload, approve, create a voucher, link,
reconcile or change policy. Normal OAuth renewal and read pacing may occur on
the server. It compares the exact authenticated resource URI, MIME, byte length
and SHA-256 against independently known originals for both allowed companies.
It never follows a file URL or writes returned bytes to disk.

1. Copy [the private-config template](../examples/m4-provider-attachments.example.json)
   to ignored `.data/m4-provider-attachments.json` and make it mode 0600. Its source
   SHA, token, company/file/voucher references and expected byte values are
   intentionally unusable placeholders. No year or voucher number may be guessed.
2. Use the exact selected test origin/deployed source and a fresh private MCP
   access token. Provide exactly the two allowed company handles and 2–4 original
   attachment samples, with at least one sample in each company. Keep provider IDs
   and original content private. Obtain exact voucher references from actual
   successful/reconciled executions, not date/amount searches.
3. Compute expected length/SHA-256 from each **original local synthetic file before
   upload**, not from the server's reported hash. Fill actual MIME and exact
   financial-year/series/number/file references. Verify deployment/source identity
   independently; the script labels its source SHA as operator supplied.
4. Run `RECEIPT_ACCEPTANCE_CONFIRM=test-companies-only npm run test:receipts:attachments`.
   `ACCEPTANCE_CONFIG` can select another private file. Responses are capped at
   2 MiB JSON/1 MiB decoded file and a 60-second request budget, without automatic
   retry or redirects. Only aggregate counts/byte totals/MIME names and source SHA
   are printed. No company, voucher, file ID, URL, token, blob or receipt text is
   emitted. Malformed/noncanonical/foreign/mismatched resources fail the command.
5. Independently download both outputs in actual ChatGPT and compare their bytes.
   A successful operator MCP read does not prove the client download is unchanged;
   S00 previously observed a PDF transformation. Leave that format/client claim
   unverified until its own byte comparison passes.

The utility's success is positive authenticated readback evidence for the exact
samples, not full provider acceptance. Its result explicitly grants no complete
acceptance and requests no bookkeeping/file mutation.

## Pending actual provider/client acceptance matrix

All rows here are **not run** in the product. Use only the two explicitly allowed
test tenants and synthetic originals, with the prerequisite reviewed test build.
Ordinary product flags remain off while preparing this evidence.

| Check | Required observation and limits |
| --- | --- |
| Source/deployment | Exact source fingerprints, dependency/runtime/client versions and deployment ID; raw/private specification absent from artifacts. |
| Positive service and user | Separately consent and test upload, existing-voucher link, relationship read and original bytes in each tenant. Record exact private provider IDs and mode. |
| Scope negatives | Deny missing `inbox`, `connectfile` and owning-record `bookkeeping` where applicable. Scope declarations alone are not provider permission proof. |
| User right/license | Establish applicable rights and licenses separately. Test a real permitted negative where possible; leave unavailable/unknown cases unverified. Do not infer cause solely from a generic 403. |
| Tenant/year/file negatives | Foreign handles and swapped exact relationship references yield no foreign bytes. A deliberate invalid-input case is distinct from a provider-year contract test. |
| Formats/size | Independently observe accepted/rejected endpoint formats and limits within local bounds, including content/MIME mismatches. No fixture or prose/example inconsistency settles this. |
| Post-link retrieval | Observe the actual supported binary endpoint after link, with original length/digest. Stop rather than guess an archive URL, redirect target or missing scope. |
| Failure/recovery | Complete the applicable [G08 protocol](M04-G08-recovery.md), including actual accepted/lost writes and proven-unapplied link repair. No blind financial or file resend. |
| Client/runtime | Actual two-file input/output, reload/Reload tools and byte comparison on the exact source; distinguish temporary helper-assisted transport and local workerd from native/public-edge claims. |

Attach redacted evidence to the exact operation's ledger entry only after review.
Enable verified operations/formats individually, keeping unknown siblings off.
Do not close #94 merely because source/contracts or synthetic cases pass. Full
#36, source-rights #35, host/files #32/#33, recovery #38 and financial #76/#92/#93
retain their own requirements. AI-operated verification now follows the separate
reviewer procedure above; no pending actual test is asserted as performed.

## Local packet validation

Shared product cases cover explicit protected consent, default scope preservation,
both token lifecycles and invalidation of old grants after reconnect. Node reader
cases cover exact two-company original bytes, wrong identity/MIME/digest/base64,
maximum bounded binary size, malformed/foreign config, protocol/error/redirect/
response-size failures and private CLI error redaction. They make no actual
Fortnox or browser request. The four operation statuses and supported flags remain
unchanged in the source ledger.

Checks on 2026-11-07: full root `test` passed **177 Node** and **132 actual local
workerd/D1** cases. The shared product subset passed 52 cases in each runtime,
including fresh receipt consent, scope preservation through service/user renewal
and old-grant invalidation after reconnect. Six attachment-reader cases and seven
G08 reader cases also passed together (13 Node cases), including canonical 1 MiB
byte handling without an unbounded base64 regex. Root typecheck/lint/build, all
eight built-artifact/native cases and both Wrangler dry-runs passed. Relative file
targets, JSON template and whitespace were checked; private input paths are not
tracked. No actual provider/ChatGPT readback, scope/license negative or consent
was performed; no deployment or production use. Exact-head CI is tracked in PR
#105 separately.
