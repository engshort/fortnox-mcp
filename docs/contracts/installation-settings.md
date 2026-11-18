# Installation settings

Scope: S11 administration and S02 identity. The owner approved implementation
of the settings plan on 2026-11-18. These are installation capabilities, not
model-callable tools or evidence of verified Fortnox/provider support.

## Values and precedence

| App field | Server default |
| --- | --- |
| `emailEnabled` | `RESEND_ENABLED` |
| `emailApiKey` | `RESEND_API_KEY` (Node also supports `_FILE`) |
| `emailFrom` | `RESEND_FROM` |
| `multiUser` | `MULTI_USER_ENABLED` |
| `membershipProvisioning` | `MEMBERSHIP_PROVISIONING_ENABLED` |
| `restApi` | `REST_API_ENABLED` |
| `restBridge` | `REST_BRIDGE_ENABLED` |
| `restSync` | `REST_SYNC_ENABLED` |
| `fortnoxEvents` | `FORTNOX_EVENTS_ENABLED` |
| `externalAppOnboarding` | `EXTERNAL_APP_ONBOARDING_ENABLED` |
| `onboardingClients` | `EXTERNAL_APP_ONBOARDING_CLIENT_IDS` |
| `offlineClientIds` | `MCP_OFFLINE_CLIENT_IDS` |
| `financialAnalysisContexts` | `FINANCIAL_ANALYSIS_CONTEXTS_ENABLED` |
| `financialLargeReads` | `FINANCIAL_LARGE_READS_ENABLED` |

Each field resolves app override, then server configuration, then its existing
default (false, empty list/string). False and empty values are overrides. Reset
removes an override; clearing the email key instead stores an encrypted empty
string, which suppresses an ENV key. A missing key field preserves the key.
No ENV file or Worker binding is rewritten.

The server records whether an app key was supplied by the authenticated owner.
Administrators may edit all fourteen fields, but their key cannot transport
owner password-reset codes: an administrator may otherwise read those codes in
the provider account. Operator ENV keys remain trusted for owner recovery. The
owner can enter a known key to restore email recovery; unrelated owner edits
do not approve an administrator's key. The stamp is server-generated, not a
request field, and is preserved by key rotation. Reset uses the operator default.
App keys without a provenance stamp are not trusted for owner recovery.
Other account emails and member recovery retain their existing role boundaries.

## Protected HTTP interface

The installation owner and current administrators can read/change settings.
Members, MCP/API tokens and provisioning credentials cannot. POST requires
the exact installation Origin and JSON content type. Both methods return
`no-store` responses with the existing private security headers.

`GET /admin/settings` returns `revision`, `values`, per-field `sources`
(`app`, `server`, `default`), feature `availability`, safe `runtime` metadata,
`can_install_catalog` and catalogue revision/operation count. `emailApiKey` is
only a configured boolean. HTML navigation to the same URL returns the protected
React shell; API callers must not request `text/html`.

`owner_recovery_email` reports whether current email configuration can carry
owner reset codes. Public reset responses remain opaque, including when this
protection blocks sending; the private operator-code recovery path remains.

Unreadable catalogue metadata is reported as `catalog.unavailable` and
`catalog_unavailable`, while the settings page remains usable for repair. It
never advertises a readable or active catalogue after a storage failure.

`POST /admin/settings` accepts only:

```json
{
  "expected_revision": null,
  "changes": { "restApi": true, "restBridge": true },
  "reset": []
}
```

The initial revision is null, subsequent revisions are positive integers.
Changes and reset keys cannot overlap. At most fourteen known fields are
accepted, with the existing 16 KiB JSON request limit. A successful response is
`{"ok":true}`. Read status after a lost response before resubmitting.
Conflicts return 409 `CONNECTION_CONFLICT`; validation returns 400
`VALIDATION_FAILED` with field names only; missing browser authorization returns
401. Origin failures return 403. Unreadable configuration fails closed with 503.

`GET /admin/settings/clients?after=<client-id>` returns up to fifty registered
clients (`client_id`, name, onboarding/offline eligibility) and nullable `next`.
No credentials, token bodies or grants are returned. New list selections require
active `client_secret_basic` clients, authorization-code/refresh grants and
the relevant registered scope ceiling. Existing stale selections remain visible
and removable. Unchanged lists do not prevent unrelated settings repairs.

The existing owner-only `PUT /admin/fortnox/bridge-catalog` remains authoritative
for reviewed private catalogue uploads. Administrators see metadata but cannot
upload. The UI does not create operation reviews or clear unavailable reasons.

## Dependencies and immediate effect

Provisioning requires multiple users. Bridge requires REST API. Sync requires
both. Events require all three and Node. Analysis contexts require analysis
storage. Email activation requires a valid Resend key and sender. Dependencies
are validated on the complete effective configuration and saved atomically.

Every HTTP request resolves durable configuration. Node swaps application
instances on changes and serializes event-collector stop/start. Worker resolves
the same state per request and never starts sockets. Disabling multiple users
preserves the directory and owner access, while denying non-owner principals.
Administrative saves recheck current membership and the multiple-user policy.

Requests with an older configuration are fenced before further provider I/O and
before returning protected results when a feature or allowlisted client has been
removed. This is conservative: an unrelated in-flight provider workflow can also
be interrupted by a restriction. Already dispatched effects remain in existing
domain intent/recovery state. Configuration changes never retry them. Email
callbacks check the current enabled flag, key and sender before sending.

REST resource scope ceilings are stable for known capabilities. Migration
`0011_settings_resource_ceiling.sql` repairs known read-only resource rows created
after migration 0009; custom policies, registrations, consents and tokens are
untouched. Runtime flags still constrain registration and access. Existing clients
must obtain any additional scopes through supported registration and consent.

## Persistence and operational limits

`installation-settings-v1` uses one owner-partitioned schema-1 CAS record in
`product_state`. The email key is separately AES-GCM sealed with owner/field
binding. Invalid schema/ciphertext or unavailable keys never trigger fallback.
Node credential rotation reencrypts this key transactionally with existing data.
Encrypted backups preserve overrides; restore authenticates the key and retains
the existing member, session, grant and uncertain-write invalidation rules.
No new SQL table or bookkeeping replica is introduced.

Infrastructure, auth/encryption keys, callback allowlists, file sources/transport
and acceptance-only flags remain operator configuration. Safe public status is
shown under Operations; private paths, source credentials and relay tokens are
not returned. Existing operator locking of Fortnox credentials is unchanged.

Manual-voucher policy, company ownership, read-only, program/scope checks and
uncertain-write recovery retain their existing shared domain authority.
