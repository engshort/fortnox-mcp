# Client compatibility and embedded UI

Activation update (2026-11-11): the ordinary product enables the existing
conforming-host MCP Apps review and implemented file tools. See the
[activation and host trust boundary](../implementation/product-activation-2026-11-11.md).
Historical default-off claims below no longer describe activation. Actual host
acceptance and unsupported native Worker file egress retain their recorded limits.

The [2026-11-08 M05 local Chrome report](../implementation/M05-client-lifecycle-2026-11-08.md)
records actual-client two-company read results, client disconnect/reconnect and
saved-answer reload. Read-only metadata on the tested Docker installation
corroborates refresh revocation and rotation after access expiry. Raw MCP traces,
old-token rejection/replay, explicit tool reload and embedded review/file cases
remain unverified. This is scoped evidence, not complete product-client support.
The [subsequent token follow-up](../implementation/M05-token-renewal-2026-11-08.md)
adds actual provider renewal and subsequent client reads; its old-token checks
are isolated synthetic cases because original ChatGPT tokens were not retained.

The [2026-11-06 G03 correction](../implementation/S00-G03-transport-2026-11-06.md)
verifies scoped two-file relay ingress and exact server readback. Chrome PNG
download passed, but downloaded PDF bytes differed. The native Worker socket
assumption was retired; complete client/file acceptance remains open.

**2026-11-05:** [maintenance was deployed](../implementation/S00-hosted-maintenance-2026-11-05.md)
with original bindings/grants preserved; [review regressions passed again](../implementation/S00-review-acceptance-2026-11-05.md).
The [optional file probe](../implementation/S00-files-evidence.md) is implemented
and locally verified. Actual-host G01/G02/G03 acceptance remains open; the dated
historical observations below are not new client-support claims.

Production client support remains a target. The [S00 spike](../implementation/S00-spike-evidence.md) tests the official SDK client locally, while the separate OAuth probe below records limited live ChatGPT evidence. Neither enables Fortnox operations.

The separate [OAuth probe](../implementation/S00-oauth-evidence.md) adds local
Node/workerd/D1 auth evidence. In a personal ChatGPT Pro account, OAuth discovery,
owner login/consent and a real authenticated synthetic tool call succeeded on
2026-10-18; remote aggregates also showed refresh rotation. The initial live
protocol revision was unobserved. Refresh after expiry, client-initiated
revocation and immediate reconnection succeeded. The reconnected grant then
expired without refresh access. A replacement native client requiring both
base scopes retained refresh access through reconnection and expiry. Its final
ChatGPT saved answer fails to load despite an authenticated MCP 200. An earlier
Codex unknown-tool error cleared on a later direct call; its cause is unknown.
Administrative tool reload remains unverified. A subsequent bounded trace
observed a `2026-07-28` request rejected by the legacy adapter, then successful
authenticated requests with `2025-11-25`. After migrating only the isolated
probe to SDK 2.3.1, a direct connected-app call here succeeded and the filtered
trace showed successful authenticated `2026-07-28` traffic and token refresh.
The exact methods were not captured, and the saved-answer UI was not retested.
The product client is not yet marked supported.

The [G02 experiment](../implementation/S00-review-evidence.md) rendered and
recorded one synthetic approval in actual ChatGPT. Commit was absent from the
model catalog. The existing global custom-app CSP setting was off and left
unchanged; restrictive-CSP and replay after remount remain unverified. A full
conversation reload left the saved widget blank, so this is scoped functional
evidence rather than supported product UI acceptance.

The [G01/G02 maintenance follow-up](../implementation/S00-client-maintenance-evidence.md)
adds local regression coverage for server-backed review status, remount,
duplicate results, uncertain outcomes and a restrictive-CSP synthetic host on
desktop/mobile-emulated Chromium. It is not deployed or actual-host acceptance;
saved-answer rendering and administrative Reload tools still need a ChatGPT run.

| Client | Priority | Required initial acceptance | Extra capabilities to verify |
| --- | --- | --- | --- |
| ChatGPT | First | Remote connection/auth, company discovery, read/write tools, accurate approval annotations | Embedded manual-voucher review, multi-file ingress, file output, UI-only tool boundary |
| Claude | Next | MCP connection/auth and core tools | Actual deployed-client MCP Apps/file support; no assumed feature parity |
| Codex/other MCP clients | Compatibility target | Standard schema/results and allowed core operations | Transport, file and approval capabilities per client/version |

## Protocol and transport

Remote installations expose authenticated Streamable HTTP. Verify supported protocol revisions and backwards compatibility with the actual target client. The MCP `2026-07-28` revision changes core interaction patterns; do not copy legacy session/SSE examples uncritically. If multiple protocol eras are supported, test both, share domain authorization and document lifecycle differences.

The isolated S00 experiment is local-only and unauthenticated, with synthetic data only. Its pinned SDK 1.32.1 reports `2025-11-25` as the latest supported revision. Offline initialization/discovery covers that revision and `2025-06-18`; `2026-07-28` is not implemented by this SDK. It uses stateless Streamable HTTP with JSON responses, without persistent SSE, sessions or resume support. This does not select a production protocol era or relax the remote authentication requirement.

The separate authenticated OAuth probe now uses SDK 2.3.1 for both protocol
eras. Node and actual workerd/D1 interoperability tests cover modern-only SDK 2
and legacy SDK 1 clients with shared OAuth/scope/revocation/one-time boundaries.
Its successful live modern connected-app call is scoped evidence; the original
transport spike and root workspace remain on SDK 1.

ChatGPT needs an accessible remote endpoint or a documented supported connection mechanism; a stdio process or localhost port is not, by itself, a ChatGPT connection. S00 records plan/account/workspace prerequisites from current official guidance rather than promising all features on every account.

## UI

Use standard MCP Apps metadata where supported: a `ui://` resource and `_meta.ui.resourceUri`; restrict commit tools with `_meta.ui.visibility` as appropriate. Keep UI input separate from model-visible results when sensitive capability material is involved. Follow the [approval contract](approval.md); visibility alone is not proof of human consent.

The review view must work with keyboard navigation, readable labels, explicit company identity and responsive layouts. Show per-item status and actionable errors. Do not hide a changed total, silently preselect a different company or make a declined action recur automatically.

User-facing UI and help should support Swedish and English. Tool identifiers/developer schemas are English; values and original document text retain their source language. Do not rely on a translated label to identify a company or account.

## File compatibility

Record each client's actual file input/output schema, supported formats, expiry and size limits. Verify a two-receipt upload, expired file URL, failed download, returned receipt and voucher link. Do not claim that simply pasting an image into any MCP client makes its bytes available to the server.

## Capability negotiation and degradation

Read-only tools can remain available when UI/files are unsupported. Disable only the affected action with an actionable explanation. `review_required` manual writes must remain blocked when the verified review path is absent. A client may not select `client_managed` for the owner.

## Evidence to record

For each tested release: server commit, SDK/protocol, client name/version or hosted test date, plan/workspace prerequisites, auth method, supported UI/files, test company, synthetic scenarios, results and unresolved limitations. Do not infer conformance from successful tool discovery alone.
