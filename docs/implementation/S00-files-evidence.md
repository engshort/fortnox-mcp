# S00 bounded file-transfer probe (G03)

Recorded **2026-11-05**. **Implemented and locally verified; actual ChatGPT
two-file input/output acceptance remains open.** Tracks
[G03 #33](https://github.com/engshort/fortnox-mcp/issues/33).

## Behavior and interfaces

The isolated OAuth probe adds optional `probe_synthetic_files`,
`read_synthetic_file` and `s00://files/{id}` resources. Files are default-off
and require separately consented `mcp:files` plus the normal OAuth owner/resource
checks. The server selects the synthetic company; supplied company IDs do not
authorize access. No financial operation or publicly accessible file URL exists.

The top-level `files` array follows the [OpenAI file-input contract](https://developers.openai.com/plugins/reference):
`download_url` and `file_id` are required, `mime_type` and `file_name` are
declared but optional. Each result includes actual byte length, SHA-256,
expiry, an authenticated resource URI and explicitly synthetic receipt/voucher
references. The original bytes can be read through MCP with the same owner,
company, expiry and file-scope checks. Actual ChatGPT rendering/download of
these resource results is still unverified.

Limits: one or two files, 5 MiB each, a 15-second total DNS/body deadline,
two million image pixels and ten PDF pages. The bounded probe accepts decoded
JPEG, 8-bit non-interlaced PNG with CRC/decode validation and plain PDF 1.0–1.7.
Compressed/object-stream PDFs, encryption, embedded actions and unsupported
PDF encodings are explicitly rejected. This is a narrow synthetic format set,
not a general receipt parser or OCR service.

Only exact operator-reviewed HTTPS origins are accepted; the allowlist starts
empty. IP literals, local names, credentials, custom ports, redirects and
non-public DNS answers are denied. Node pins the checked DNS result in its HTTPS
socket while retaining TLS hostname verification. The Worker uses bounded
DNS-over-HTTPS, a pinned public Cloudflare TCP socket and TLS with the expected
hostname. A maintained HTTP parser handles framing; no incoming credentials
are forwarded. There is no unpinned fetch fallback. Cloudflare socket restrictions
can make some client CDN origins unusable; verify the actual origin before
enabling this path. Socket fixtures do not prove hosted CDN compatibility.

## Temporary state

SQLite and D1 share transactional SQL and storage contracts. AES-256-GCM
encrypts 64 KiB chunks with fresh nonces and authenticated owner/company/workflow/
file metadata. HKDF derives a purpose-specific key from the deployment secret.
At most four unexpired files per owner can be staged atomically. A failed batch
removes its own staged files. URLs, client file IDs and original names are not
stored or echoed; exceptions become fixed error codes.

References expire after 55 minutes. Node cleans every minute while running;
Workers require a five-minute scheduled trigger and the explicit operator
assertion `PROBE_FILE_CLEANUP=scheduled-5m` before ingress can activate.
Expired references cannot read bytes even if cleanup is delayed. Physical
deletion within one hour depends on the runtime/cron running; outages require
cleanup on recovery. Keep cleanup active after disabling ingress.

## Verification

Linux, Node 24.19.0 and npm 11.9.0: typecheck, lint, build and all **38 backend
tests passed**, none skipped. New coverage includes byte-for-byte two-file
output; complete MCP schemas/default-off discovery; real Node/workerd OAuth
file-scope consent and revocation; owner/company isolation; wrong key and
ciphertext tampering; concurrent capacity; failed-batch cleanup; SQLite and
actual workerd/D1 restart; expiry deletion; oversize, mismatch, broken content,
page/pixel limits; the real 15-second timeout; private/mapped DNS addresses;
pinned TLS hostname and credential-free socket requests.

Actual workerd executes the format validator, encryption and D1 operations with
synthetic upstream bytes. No actual ChatGPT transfer or hosted DNS/TLS result is
inferred. The point-in-time runtime dependency audit reported zero known
vulnerabilities; this is not an exhaustive security audit. Pins, integrity and
licenses are in the lockfile and [notices](../../THIRD_PARTY_NOTICES.md).

## Activation and actual-host exit

1. Review/backup existing isolated D1 state. Apply only the additive `fileSchema`
   tables/index, never the auth seed. From the probe directory run
   `node --import tsx scripts/prepare-files.ts` to write ignored `.data/files.sql`.
   Preserve owner, secrets and grants.
2. Verify a five-minute Worker cron; configure exact reviewed origins,
   `PROBE_SYNTHETIC_FILES=true` and the cleanup assertion. Node uses
   `filesEnabled: true` and comma-separated `fileOrigins` in private config.
3. Obtain new owner consent for `mcp:files`; never edit grants to widen tokens.
4. Upload two known-hash synthetic fixtures in actual ChatGPT. Compare both
   lengths/hashes, retrieve each output file/resource, exercise expiry and failure
   recovery, and distinguish visible results from HTTP success.
5. Verify actual socket/CDN compatibility, scheduled deletion and measured runtime
   limits. Disable ingress/temporary diagnostics afterward; keep cleanup active
   until no staged bytes remain.

Generate two known-hash fixtures outside Git with
`node --import tsx scripts/prepare-file-fixtures.ts`; it prints only synthetic
paths, byte lengths and hashes.

No actual-host file upload/download, hosted origin acceptance or scheduled
cleanup result is claimed. G03 remains open until that evidence exists.
