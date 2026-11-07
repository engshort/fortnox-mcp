# S00 owner review and remount — 2026-11-07 (G02)

Status: **owner-reported actual ChatGPT approval and completed-card recovery;
one persisted consumed record independently observed**. Full
[G02 #32](https://github.com/engshort/fortnox-mcp/issues/32) remains open.

## Deployment identity and scope

A separate synthetic-review installation was provisioned on 2026-11-06 from
source `1198f7746049bc3115f680836b5b22a2ad8e5545`, without changes to the S00
implementation or dependency pins. It uses its own synthetic owner and D1;
neither the earlier S00 installation nor the product database was replaced.
The original operator files for the earlier installation were unavailable on
this host. No earlier owner, signed cookie or secret was reconstructed.

| Field | Recorded value |
| --- | --- |
| Worker version | `db775032-db39-4040-ab69-7f910cdffe50` |
| Deployment | `e3af9e6c-b95b-443e-9446-085d8ebf1498`, 100% of traffic |
| Uploaded JavaScript SHA-256 | `ab02e5d9b4f425f1880fe75f7911e9b3a2b8b9c2f616095ea5f23d0aa4704843` |
| Runtime | Hosted workerd/D1; compatibility date `2026-11-06`, `nodejs_compat` |
| Server SDK / OAuth provider | `@modelcontextprotocol/server` 2.3.1; Better Auth/provider 1.7.10 |
| Client | Actual ChatGPT; owner-reported interaction on 2026-11-07; exact browser build and negotiated MCP version not captured |
| Enabled experiment | Synthetic review only; synthetic files disabled; no Fortnox credentials |

The deployment API was checked again at **14:50:49 Europe/Stockholm** on
2026-11-07. It still routed all traffic to the recorded Worker version. The
configuration exposed only the isolated auth database, auth/owner secret
bindings, origin and synthetic feature flags. Private operator files and
login codes remain outside Git. No capability, cookie or token is included
in this evidence.

## Observations and attribution

1. A local Windows Chrome agent registered the separate private test app on
   2026-11-06 and reached the intended login domain. It stopped before entering
   the code because its computer tool could not establish the current URL.
   That attempt did not establish a completed login, rendered card or approval.
2. On 2026-11-07 the owner reported successful login, followed by the actual
   embedded card and its completion message: one synthetic approval recorded,
   no Fortnox action. This is owner-reported human interaction, separate from
   the earlier automated QA click documented in the original review record.
3. A read-only query of this installation's synthetic-review table returned
   exactly one row, in `consumed` state. Only ID/state/expiry were read; neither
   capability nor owner/proposal hashes were fetched. The private evidence
   retains the synthetic row reference for subsequent comparisons.
4. The owner reopened the same ChatGPT conversation and reported that the
   completed card still showed an already registered approval and a disabled
   button, without preparing another proposal or submitting another approval.
   The follow-up D1 read at 14:50:49 showed the same single consumed row.

The UI report and persisted state support completed-card recovery without
additional consumption in this scenario. The row has no consumed-at timestamp
or attempt counter: a snapshot alone cannot reconstruct every request or
establish physical human presence. No concurrent-view, double-click or forged
model-call scenario was performed in this actual-host run.

The independent operator login check at 14:47:05 returned HTTP 200 using its
own synthetic code; the code issued for the owner was not consumed by that
check. An earlier isolated login/replay check returned 200 then 400. These
checks establish the tested server login behavior, not all OAuth continuation
or browser error causes. The earlier generic browser error remains unattributed.

## Remaining acceptance and product boundary

The owner could not establish whether restrictive custom-app CSP was enabled.
Asked to list available tools without calling them, ChatGPT reported only
`prepare_synthetic_review` in its current conversation context and said neither
`commit_synthetic_review` nor `read_synthetic_review_status` was exposed as an
ordinary model tool. It explicitly declined to confirm the complete app catalog
without new discovery. This is a limited model self-report, not an independent
complete-catalog capture or proof that capabilities never enter model context.

Actual-host concurrent views, expiry,
lost commit response, failed status retrieval, another browser and real-device
coverage also remain open. The existing local browser/backend regressions are
recorded in the [2026-11-05 recheck](S00-review-acceptance-2026-11-05.md); they
do not substitute for these host checks.

The conforming host must keep the UI capability outside model context and
enforce app-only routing. Visibility is not a cryptographic human-presence
proof against a malicious host holding the same grant/capability. Existing
server-side owner/company/hash/policy/expiry and atomic-consumption checks
remain required.

This adds zero Fortnox operation coverage and approves no financial rule or
voucher creation. Product `reviewHost=false`, `writes=false` and provider
`validation_verified=false` remain in force. #32, #76 and #93 retain their own
acceptance; full G06/#36 and G07/#37 are unaffected.
