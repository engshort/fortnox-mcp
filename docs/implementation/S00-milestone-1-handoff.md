# Milestone 1 — verified client and technology handoff

Updated **2026-11-05**. Scope: G01–G05 (#31–#35), with the early M23/G09 subset
needed to classify the runtime. **The milestone remains open.**

The subsequent [actual ChatGPT acceptance run](S00-client-acceptance-2026-11-05.md)
records restrictive-CSP review/double-click/remount evidence, saved-answer retry
recovery, fresh-client refresh, old-client scope mismatch and actual G03
transport failure after exact source-origin review.
[PR #90](https://github.com/engshort/fortnox-mcp/pull/90) contains the scoped
consent correction, bounded diagnostics and evidence. It does not close G01–G03.
G05 remains open by the owner's instruction.

## Reviewable deliveries

Review these stacked PRs in order; each uses the preceding delivery as its base.
No PR was merged and no package/release was published.

| Delivery | Review | Result and remaining acceptance |
| --- | --- | --- |
| G01 maintenance | [#85](https://github.com/engshort/fortnox-mcp/pull/85) | Fresh-client read/refresh and old-client revocation verified. Saved answers need explicit retry; old-client reconnect rejects new scopes. Full #31 remains open. |
| G02 recovery | [#86](https://github.com/engshort/fortnox-mcp/pull/86) | Local 18 browser regressions plus scoped actual CSP/double-click/consumed-remount evidence. Lost-response injection and independent-browser acceptance remain open in #32. |
| G03 file probe | [#87](https://github.com/engshort/fortnox-mcp/pull/87) | Scoped actual file calls fail in Worker transport after exact source-origin review. Cleanup of an expired sentinel passed; successful bytes/output/retention remain open in #33. |
| Runtime subset | [#88](https://github.com/engshort/fortnox-mcp/pull/88) | Actual Node/Worker measurements, source-pinned evidence and a conservative 1 MiB Worker file boundary. #77 is partial; full #39/G09 remains open. |
| G05 evidence packet | [Owner request](S00-source-rights-request.md) | Current official terms rechecked; acquisition record and applicable source/generated-output rights are still missing. #35 stays blocked. Nothing was sent to Fortnox. |

G04/#34 remains closed only for the existing isolated service/user feasibility
probe. No new Fortnox access, consent, token lifecycle or financial test was run.
S00/S01, production bootstrap/authentication, full runtime/SIE acceptance and
prerelease gates retain their separate scope.

## Current executable state

The isolated Worker now runs the consent correction and bounded hostname
and transport diagnostic at source `303e03977e3a65dd09d1317286f0e9610b0c412f`; see the
[client record](S00-client-acceptance-2026-11-05.md) for its deployed version.
The earlier source-pinned [runtime measurements](S00-runtime-evidence-2026-11-05.md)
retain their dated scope. Synthetic review retains its explicit opt-in. After
the client tests, file ingress and temporary diagnostics are off, the origin
allowlist is empty, and the verified five-minute cleanup cron remains active.
File/chunk counts are zero; one consumed synthetic review remains.

The earlier runtime handoff reported removal of the benchmark secret. The
current settings inventory still exposes a pre-existing secret binding name;
it was preserved, its value was not read, and no runtime deadline is active.
Do not infer secret deletion from the earlier handoff.

At the earlier runtime checkpoint, owner/client/token counts matched its
starting installation. The later client test added a separate consented private
file client and revoked the old status client's grant. File/chunk and
benchmark-intent tables were cleaned. One previously expired synthetic review
record was removed by the first benchmark's ordinary review-retention path;
the [dated record](S00-runtime-evidence-2026-11-05.md#cleanup-and-an-observed-retention-side-effect)
documents that side effect and the final owner/company-scoped fix. No approval
or financial state was fabricated. Private operator credentials used for
benchmarking were deleted after revocation.

The product's remote MCP and Fortnox modules remain disabled. `review_required`
is unchanged, with no fallback to client-managed execution. All public evidence
uses synthetic files and aggregate/allowlisted results.

## Evidence and next owner-assisted checks

Local verification: locked Node 24.19.0/npm 11.9.0; OAuth typecheck/lint/build,
42 backend tests, three final targeted retention tests, 18 browser tests and
Wrangler dry-run. Root typecheck/lint, 40 Node, 30 workerd and four artifact
tests passed. Chromium desktop and Pixel 7 emulation are local test environments;
no real-device/second-browser-family or ChatGPT acceptance is implied.

1. In an authenticated browser on the intended ChatGPT account, complete G01's
   saved-answer/reload/refresh/revocation/reconnection checklist using the existing
   corrected client. Cloudflare administration cannot supply this browser proof.
2. Complete G02 with restrictive custom-app CSP, a fresh synthetic proposal,
   one consumed record, remount/replay, timeout/status failure and another browser.
   The supported host remains trusted; no cryptographic human-presence claim.
3. Follow [file activation prerequisites](S00-files-evidence.md#activation-and-actual-host-exit):
   verify the actual CDN socket path, reviewed origin and five-minute cron before
   enabling ingress; obtain new `mcp:files` consent and upload/retrieve two
   known-hash synthetic files within the 1 MiB Worker limit.
4. Supply/review the acquisition and rights evidence in the G05 packet. If it
   remains unavailable, keep #35 and milestone 1 open while independent work
   continues. Never vendor restricted source as a shortcut.

Read [Swedish instructions](../users/klientprov.sv.md) for operator/user limits.
These outstanding requirements are not passed by merged code, a tool HTTP 200
or the local harness. Close issues only on their actual acceptance; no new
production or publication authorization is implied.
