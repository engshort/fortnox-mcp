# Operational storage and retention

Milestone 4 adds separate encrypted temporary file manifests/chunks through migration `0006_receipt_files.sql`. Owner capacity is atomically bounded; references expire in 55 minutes and Node/Worker cleanup physically deletes bytes. Old encryption key versions must remain until file cleanup completes. See [receipt evidence](../implementation/M04-receipts-evidence.md).

M16 keeps only upload/link attempt state and opaque provider references in the
existing connection snapshot. The claim is persisted before the provider write;
an interrupted claim remains uncertain after restart. It retains no source URL,
original filename or duplicate receipt bytes. Late responses can record minimal
reconciliation evidence without restoring a disconnected connection. Deleting
local state never reverses an upload, voucher or link in Fortnox.

M17 marks a successful voucher's attachment hold complete only after its exact
link succeeds. Uncertain executions and successful vouchers awaiting link repair
are retained beyond the ordinary 30-day execution window, within the existing
32-record capacity. Their receipt batch cannot be evicted merely because its
preparation lifetime expired. No expired encrypted proposal or receipt bytes are
kept for this hold. Completed bytes are deleted per file after all retained
references are completed; other references and expiry cleanup remain independent.

Milestone 3 stores encrypted proposals and minimal intents within the connection
CAS snapshot, atomically checking policy/generation/hash and consumption. Eight
ordinary pending proposals and 32 intents per company share the existing size bound.
Receipt preparation allows twelve total pending proposals and four bounded batch
manifests per company, while staged file capacity is twelve per owner.
Expired bodies and old terminal metadata are cleaned; unknown outcomes survive.
See [retention and recovery](../implementation/M03-accounting-evidence.md#encryption-bounds-and-retention).

The milestone 2 adapter uses versioned CAS records for a bounded 20-company connection set, four pending ten-minute consent flows and 32 ten-minute continuations per owner. SQLite and D1 share the same SQL behavior; credentials and pending PKCE/client secrets use external-key AES-GCM. Node and Worker schedule five-minute temporary-state cleanup. See [implementation and verification limits](../implementation/M02-connections-evidence.md).

An encrypted owner-bound key-check marker protects company metadata even after disconnect deletes all credentials. Private snapshot reads verify that marker and all retained credential key versions. Wrong or missing keys fail closed before list/status metadata is returned. The marker rotates atomically with the connection snapshot. Earlier experimental snapshots acquire it by CAS only after their retained credentials decrypt successfully; snapshots without any cryptographic key proof require operator recovery.

Fortnox is the system of record for financial records and retained receipt attachments. This server stores only what is necessary to connect, enforce policy and recover safely.

## Data classes and initial defaults

These are initial engineering defaults, configurable by the owner within the stated constraints. They are not statutory bookkeeping-retention advice.

| Data | Storage and retention |
| --- | --- |
| Installation owner and client grants | Persist while active; revoke/delete through administration |
| Fortnox credentials/connections | Secret store or encrypted records while connected; remove on disconnect |
| Per-company policy and version | Persist while connection exists; minimal metadata for policy-change audit |
| Pending proposals | Encrypted operational storage, expire after 24 hours by default; shorter approval capability expiry (15 minutes) |
| Temporary receipt bytes | Stream where possible; if staged, private encrypted storage, delete on completion/failure cleanup or after 1 hour by default |
| Execution/reconciliation records | Minimal intent/hash/provider IDs/state for 30 days by default, without full voucher/file content |
| Unresolved write outcomes | Retain minimal reconciliation metadata until resolved or owner explicitly acknowledges retirement; never auto-forget and retry |
| Diagnostic logs | Redacted metadata, 7 days default; no raw payloads, receipts or secrets |
| Analytical cache | Request-local by default; optional short bounded TTL with company/year/query/source context |

If a proposal outlives its staged file, expire that file-dependent proposal or request reattachment and new review; do not imply the receipt is still available. Longer-term original storage belongs in Fortnox after a verified upload.

## Required primitives

Storage adapters provide atomic state transitions, unique execution keys, tenant/owner partitioning, expiry cleanup and backup/restore semantics. Approval consumption and submission intent must survive process restarts. Use a monotonic state transition or transaction, not an eventually consistent cache flag.

Encrypt secrets using an external deployment secret/key; never put the decryption key next to the encrypted database in public artifacts. Backups containing credentials/proposals need equivalent protection. Test key rotation and restore; fail safely if secrets are unavailable.

## Data minimization

An execution record needs connection/company IDs, operation, proposal hash, timestamps, state and provider references. It does not need the receipt image, full invoice, full payroll row or model conversation. Do not use financial payloads in metric labels, trace names or URLs.

Disconnecting disables pending work and removes credentials. Retained minimal execution metadata must not authorize future calls. Provide owner-visible cleanup and retention controls, with a warning before deleting unresolved reconciliation state.

After retention expiry, persistent duplicate detection is limited. Document this limit; a deleted local key does not prove that an old financial action never happened. Re-uploaded historical receipts may need provider lookup and human review.
