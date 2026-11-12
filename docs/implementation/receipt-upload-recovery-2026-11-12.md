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
Voucher/link remain pending, historical versions stay unchanged and no POST,
financial dispatch or new approval follows. Missing/ambiguous/mismatched evidence
retains unknown; failures, empty lists and expired bytes never authorize resend.
The whole inspection has a 15-second deadline, bounded JSON/binary reads and the
shared provider limiter. General attachment retrieval still requires its voucher
and verified relationship; there is no archive fallback or arbitrary HTTP proxy.

Future uncertain results retain only fixed failure stage and HTTP status, with
separate bounded attempt/created/dispatch-marker metadata. No body, URL, token,
customer name or original document is logged. A dispatch marker means the
durable pre-dispatch boundary was crossed, not that Fortnox accepted a request.
Legacy original attempts lacking these fields are not retroactively diagnosed.

Verification is in progress. Shared Node/SQLite and local workerd/D1 contracts
exercise the behavior; actual provider/client execution and original outcome
reconciliation must be recorded separately before closure.
