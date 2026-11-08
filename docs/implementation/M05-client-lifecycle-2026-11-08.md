# M05 actual client lifecycle observations — 2026-11-08

Scope: bounded ChatGPT read access, client disconnection/reconnection, saved
answer reload and OAuth renewal for #32/#33/#42/#72. This is partial acceptance,
not a support, financial-operation or milestone-completion claim.

## Installation and provenance

- Runtime source: `ea2013739524727cd832833613610f8eaa496c51`.
- Image: `sha256:54ddb2986f7e40364d338fc964fff68438d75f0772bd2dd76dd84e9bfde7d1fd`,
  version `0.1.0-mvp.5.0`.
- Runtime Node artifact SHA-256:
  `fefda6f5c1fc425926fb2c3222837e69c447e8b0d5a0869a2bdc768f37e75b8f`;
  matched the previously verified local build during read-only inspection.
- Client: ChatGPT web in local Chrome on Windows; plugin UI reported development
  version `1.0.0`. Exact Chrome version and actual MCP protocol were not captured.
- Browser observations were supplied by the authorized local test chat, which
  operated through the Chrome extension. The Windows Computer Use URL action
  failed; direct Chrome-extension access worked. The owner performed renewed
  login/consent. This implementation chat did not invoke the plugin itself.
- Window: 2026-11-08 22:38–22:48 UTC (23:38–23:48 Europe/Stockholm).

The local report observed fresh ChatGPT-rendered results and UI transitions.
Its 5/5, 5/5 and 3/3 counts are reported tool results, not independently counted
MCP transport logs. Raw request traces, token values, company identifiers and the
private ChatGPT conversation reference are excluded from this document.

## Observations

| UTC | Observation | Conclusion and limit |
| --- | --- | --- |
| Approximately 22:38–22:39 | Fresh listing plus diagnosis/profile for both companies reported 5/5 successes; exactly two active, read-only service/user companies with `review_required` | Actual-client successful reads reported; no independently retained request/status trace |
| Approximately 22:39–22:40 | Disconnecting the ChatGPT client account displayed account disconnected and Connect; the existing chat then reported no registered tool and no API request | Client-side blocking observed; `tool_unavailable` was response text, not an observed server error code |
| 22:39:31 | Server metadata marks the then-current refresh token revoked, with no rotation timestamp; zero access-token rows remain linked to that refresh token | Persisted server-side refresh revocation corroborates disconnection; not proof that every previously issued bearer token immediately failed |
| Approximately 22:40–22:41 | Owner completed reconnection; the same chat reported five new successful listing/diagnosis/profile calls and exactly two companies | Bounded reconnect passed; Fortnox company connections were preserved |
| After reconnection | Full conversation reload retained the saved read answer | Plain saved-answer reload observed; embedded review-card remount/CSP/replay remains separate |
| Request submitted 22:46:30 | After more than five minutes, the same chat reported three new successful listing/two-profile reads without further login/consent | Continued access beyond the configured token lifetime observed; server rotation correlation below strengthens this result |
| After the final reads | Fresh admin view retained both active, read-only service/user connections and `review_required`; writes/provider files/review host/files remained off | No financial/file/review activation or provider disconnection was performed |

Diagnosis continued to report `company_information` available with
`bounded_read_verified`, manual vouchers/provider files blocked with
`verification_pending`, and payroll `feature_not_implemented`. These observations
do not promote supported provider coverage.

## Read-only server correlation

Inspection at 22:48:36 UTC used SQLite read-only mode and selected only OAuth
metadata, never token values. No provider request, database/configuration change,
token replay, new consent, connection change or container restart was performed.
The exact tested image and Node bytes still matched. Both distinct allowlisted
tenants remained active/read-only with one service and one user connection; the
existing two-company grant matched their active generations.

For the matching client, the observation window contains 14 retained access-token
issuance records with a 300-second lifetime, 15 refresh records created and 14
recorded rotations. These counts describe issuance/rotation, not successful tool
calls. A concrete renewal after reconnection correlates as follows:

| Metadata | UTC |
| --- | --- |
| Prior access token expired | 22:46:08 |
| Prior refresh token marked revoked/rotated | 22:46:44 |
| Replacement refresh and access tokens created | 22:46:44 |
| Replacement access token expiry | 22:51:44 |

The old and replacement records have the same client, owner and non-empty
authorization-code binding. This records an actual refresh rotation after access
expiry, consistent with the later client read report. Additional rotations at
22:46:50 and 22:46:51 were retained. Rejection of a reused old refresh token was
not tested; rotation timestamps alone do not establish replay protection.

At disconnection the refresh record has `revoked` at 22:39:31 and `rotatedAt`
absent. Its linked access rows are absent, matching the maintained provider's
revocation behavior. The existing client/consent/company grant remains present:
client-account disconnection is not evidence that those records were deleted.
Immediate rejection of all older bearer tokens and a subsequent refresh attempt
with the revoked token remain untested. The pre-disconnection access lifetimes
had already ended before this inspection, so expiry must not be misreported as
revocation proof.

The application emitted zero Docker log bytes within the window; request logging
was not enabled to obtain retrospective evidence. Mutable provider-budget
timestamps for the two latest reads were 22:46:50.943 and 22:46:52.821 UTC. These
are scheduling state, not a retained authenticated-request success audit. Thus
there is no independent per-tool HTTP success count or exact request/protocol
correlation from existing server logs. Fortnox provider-token renewal was not
inspected or inferred from MCP OAuth renewal.

Sanitized inspection reports and the local browser report remain in the ignored
private installation directory. No confidential identifiers or credentials enter
Git or release artifacts.

## Remaining acceptance

Keep immediate old-bearer rejection, revoked/rotated refresh replay, remaining
cross-owner/company isolation, explicit tool reload, provider disconnect/reconnect
and the remaining [actual acceptance matrix](M05-actual-acceptance.md) pending.
Two original receipt files, trusted individual review, verified voucher/file
references, lost-answer/restart/link recovery, private security-report delivery
and final clean-room acceptance have not been completed by these read tests.
No activation gate, policy, grant, source-rights approval, merge or release changes.
