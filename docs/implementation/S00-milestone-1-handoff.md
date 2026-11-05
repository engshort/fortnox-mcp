# Milestone 1 — verified client and technology handoff

Updated **2026-11-05**. Scope: G01–G05 (#31–#35), with the early M23/G09 subset
needed to classify the runtime. **The milestone remains open.**

The subsequent [actual ChatGPT acceptance run](S00-client-acceptance-2026-11-05.md)
records restrictive-CSP review/double-click/remount evidence, the reproduced
saved-answer failure, old-client scope mismatch and staged G03 checks. It does
not close G01–G03. G05 remains open by the owner's instruction.

## Reviewable deliveries

Review these stacked PRs in order; each uses the preceding delivery as its base.
No PR was merged and no package/release was published.

| Delivery | Review | Result and remaining acceptance |
| --- | --- | --- |
| G01 maintenance | [#85](https://github.com/engshort/fortnox-mcp/pull/85) | Existing Worker updated with owner/secret/grants preserved. Actual ChatGPT saved-answer reload, administrative Reload tools and token lifecycle reacceptance remain open in #31. |
| G02 recovery | [#86](https://github.com/engshort/fortnox-mcp/pull/86) | 18 restrictive-CSP browser regressions pass locally. Actual ChatGPT CSP, review/click, remount/replay and another browser remain open in #32. |
| G03 file probe | [#87](https://github.com/engshort/fortnox-mcp/pull/87) | Default-off scoped input, format validation, encrypted temporary storage and authenticated output implemented. Actual ChatGPT/CDN transfer and scheduled cleanup remain open in #33. |
| Runtime subset | [#88](https://github.com/engshort/fortnox-mcp/pull/88) | Actual Node/Worker measurements, source-pinned evidence and a conservative 1 MiB Worker file boundary. #77 is partial; full #39/G09 remains open. |
| G05 evidence packet | [Owner request](S00-source-rights-request.md) | Current official terms rechecked; acquisition record and applicable source/generated-output rights are still missing. #35 stays blocked. Nothing was sent to Fortnox. |

G04/#34 remains closed only for the existing isolated service/user feasibility
probe. No new Fortnox access, consent, token lifecycle or financial test was run.
S00/S01, production bootstrap/authentication, full runtime/SIE acceptance and
prerelease gates retain their separate scope.

## Current executable state

The final isolated Worker runs source
`e38134d3a3a47b84596562ffe5d5e7fbd388ba5f`; see [runtime evidence](S00-runtime-evidence-2026-11-05.md)
for deployed versions, actual metrics, limitations and cleanup. Synthetic review
retains its existing explicit opt-in. File ingress and the temporary benchmark
are off. The benchmark secret/deadline were removed; the old key received 404.
Anonymous MCP tool calls still receive 401. Temporary diagnostics and stored
observability remain off.

Owner/client/token counts match the starting installation. File/chunk and
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
