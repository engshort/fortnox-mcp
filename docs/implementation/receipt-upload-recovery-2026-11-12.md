# Receipt upload recovery — issue 134

Scope: bounded post-dispatch diagnostics and positive, non-dispatching upload
reconciliation. Actual recovery of the owner's retained unknown remains pending.
No passing synthetic test establishes that the original provider upload exists.

`reconcile_receipt_upload` uses current authenticated owner/client/company,
file/read scopes, bookkeeping/file capabilities and the original connection
generation. It checks the saved batch hash/manifest and original item/file/hash/
proposal references. Historical policy and expiry may differ for this metadata
reconciliation only; ordinary batch/file/review execution retains its strict
checks. No policy, proposal, review capability or staged bytes are restored.

Discovery uses only fixed GET requests to the authorized company's Inbox. The
[official Inbox reference](https://api.fortnox.se/apidocs) documents GET `/3/inbox`
as a Folder tree without paging parameters. This first implementation accepts
only an explicit flat `Inbox_v` leaf: Files and an empty Folders array must be
present. Opaque/deeper folders, unknown leaf fields, pagination or range/link
headers fail closed. It does not enumerate arbitrary folders or follow URLs.

Exactly one candidate must match the server-generated original filename. Its
bounded binary content must validate, match declared size, sniffed extension and
the saved original SHA-256. A second listing must preserve the sole candidate's
ID/name/size. Competing local upload attempts for the same file/hash reject
reconciliation; the generated filename identifies a staged file, not an attempt.
An existing trusted provider reference may never be replaced by a different one.

Only positive evidence permits a CAS update of upload unknown to succeeded.
Voucher/link remain pending, historical versions stay unchanged and no file or
financial resource write or new approval follows. Missing/ambiguous/mismatched evidence
retains unknown; failures, empty lists and expired bytes never authorize resend.
The whole inspection has a 15-second deadline, bounded JSON/binary reads and the
shared provider limiter. Ordinary authenticated token acquisition/renewal may
still occur during a read; this is separate from file/business resource writes.
General attachment retrieval still requires its voucher
and verified relationship; there is no archive fallback or arbitrary HTTP proxy.

Future uncertain results retain only fixed failure stage and HTTP status, with
separate bounded attempt/created/dispatch-marker metadata. No body, URL, token,
customer name or original document is logged. A dispatch marker means the
durable pre-dispatch boundary was crossed, not that Fortnox accepted a request.
Legacy original attempts lacking these fields are not retroactively diagnosed.

## Verification and actual original attempt

[PR #135](https://github.com/engshort/fortnox-mcp/pull/135) was independently
reviewed on exact head `35519460e9887034a24fa475bbceb548a3adfaf7` and merged as
`6b0d08a81c180e800a26977a8723ff73da7af40f`. All six PR checks passed, including
374 Node/SQLite and 307 actual local workerd/D1 tests. All 65 targeted receipt
tests and application/Worker/test/admin TypeScript checks passed. The independent
review checked 78 committed source-hash bindings and 151 relative file targets.
The broader Windows run was stopped after workerd access violations and
platform/CRLF-sensitive failures; it is not passing runtime evidence.

[Deploy Nova 43236837461](https://github.com/engshort/fortnox-mcp/actions/runs/43236837461)
passed on attempt 1. External public HTTPS returned 200 with the exact merge
revision. The separate main S01 run
[43236837701](https://github.com/engshort/fortnox-mcp/actions/runs/43236837701)
initially passed all 374 Node tests but four existing Worker payroll cases
exceeded their five-second limits (303 passed). Attempt 2 passed all checks,
with unchanged code and test requirements. The deployment's own validation also
passed; no financial action was taken while the separate run was investigated.

The existing native ChatGPT client initially lacked the new tool in its cached
catalog and made zero reconciliation calls. Its supported **Reload tools**
setting refreshed the same app/account without a new registration or grant.
The visible tool dialog then included `reconcile_receipt_upload`. Fresh private
runtime/grant observations confirmed the original client/generation, policies,
unknown step, immutable bindings and history before the first actual call.

That one native call returned the conversation's public result:

```json
{"status":"ok","data":{"state":"outcome_unknown"}}
```

No provider reference or positive recovery was returned. The saved client DOM
and private runtime after-projection were independently reviewed within this
bounded scope. The original uncertain step, complete batch, A/B file bindings,
grants, generation/policy, read-only settings, 12 business/2 ordinary voucher
executions and zero pending proposals/submitting were preserved. Item B's three
steps remained pending. No upload, voucher, link or retry was requested.

Full credential/state identity is **not** claimed: the target company's encrypted
credential envelope and connection-set marker changed. Company identity,
tenants, scopes and program selections stayed identical. This is consistent
with ordinary token renewal, but the encrypted contents and actual cause were
not independently decrypted/verified. No raw provider response or original
upload HTTP diagnostic was recovered.

## Authenticated provider-UI follow-up

The owner completed BankID login and left the intended sandbox open. The AI
operator verified its company name and tenant-specific archive mailbox in the
actual native Fortnox UI. The independently reviewed read-only search then
observed an empty **Archive → Inbox → Vouchers** list: zero files and zero bytes,
with an empty search field. No original candidate was available to download or
hash. This is an observation of that UI, not proof of non-application.

A separately reviewed extension inspected the same company's linked-file
categories and trash without changing them. The linked-file view exposed only
the bank-file category; this does not prove absence throughout the archive.
Trash was configured at zero percent and supplied no recoverable-file history.
No restore, move, delete, configuration change or export was performed.

The visible treatment-history UI was searched for the original date in archive
and linked-file programs. Both returned no events and explicitly indicated that
all history had been fetched. A further integration-user/all-program search
returned 26 events; the supported **Load more** action reached the explicit end
without adding events. No original generated filename or correlating file event
was found. Missing history does not establish a rejected upload or guarantee
that this UI logs every provider file operation.

**Issue #134 remains open for actual positive original recovery.** The login
prerequisite is now complete, but these reads supplied no trusted file reference
or original outcome. Further synthetic writes remain stopped. Provider-owned
historical evidence must uniquely correlate the original attempt to its
file/outcome; no support message has been sent. Moved/archived files need an
independently reviewed typed correlation/read contract before they can replace
the current positive evidence path. Expired financial reviews are never revived
by reconciliation. No additional reconciliation call or upload resend was made
during this UI follow-up.
