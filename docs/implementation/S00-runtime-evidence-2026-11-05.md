# S00 Node and hosted Worker budgets — 2026-11-05

Status: **early M23/G09 measurements completed; full G09 remains open**.
Tracks [#77](https://github.com/engshort/fortnox-mcp/issues/77), with the
[reproducible operator probe](S00-runtime-probe.md) and
[synthetic measurements](S00-runtime-results-2026-11-05.json).

## Environment and workload

The existing isolated Worker/D1 was reused with its owner/auth secret/grants
preserved. A D1 Time Travel bookmark was obtained before the additive file
schema was applied; no restore was exercised. No Fortnox request or root-product
deployment occurred. Node 24.19.0/npm 11.9.0, SDK 2.3.1, Better Auth 1.7.10,
decimal.js 10.6.0 and Worker compatibility date 2026-10-18 were retained.

Measured executable source: `911ca76889f7bd0c7e152eb109b9e4db93a3ebfd`, deployed
as version `c972f13a-98f2-46e3-a026-855a45d25fb4` at 19:36:07 UTC.
The final hardened source `e38134d3a3a47b84596562ffe5d5e7fbd388ba5f` was deployed
as `48a714b0-dd11-48a3-ae89-2f682bb65308` at **19:43:49 UTC**, disabling the
operator endpoint and adding the conservative actual-file budget/retention fix.

Each workload sent two actual synthetic PDF byte streams over HTTPS to the
operator endpoint, serialized 405 original synthetic tool descriptors (133,946
bytes), added `0.01` exactly 5,000 times, validated/encrypted/stored/read both
files and raced 16 claims against one durable intent. The client independently
checked both original hashes, lengths, decimal total and single winner.
All six final hosted workload runs returned HTTP 200 and matched these checks.
Separate protected reads confirmed consumed state, including earlier intents
after deployment to the new code version. Local workerd process restart is
tested separately; no physical hosted isolate restart was observed or inferred.

## Observations

| Bytes per file (two files) | Node workload ms | Node CPU ms | Hosted workload ms, two runs | HTTPS round-trip ms, two runs |
| --- | ---: | ---: | ---: | ---: |
| 1 KiB | 202.84 | 131.465 | 240 / 252 | 635 / 631 |
| 1 MiB | 295.91 | 198.472 | 479 / 342 | 682 / 540 |
| 5 MiB | 1236.34 | 796.639 | 905 / 1072 | 1353 / 1540 |

These are individual observations, not statistical percentiles or latency SLOs.
Workload timings exclude final deletion; the HTTPS round trip includes it.
Node's end-of-workload heap was about 28 MiB at the large workload; RSS was
about 243 MiB, including native libraries/SQLite. These are not peak-memory
measurements and cannot be mapped directly to Worker memory.

The early portable base64 implementation produced much larger Node allocations
and an intermittent hosted HTTP 503 at two 5 MiB files. Cloudflare recorded
`exceededResources`; the evidence does not establish a more specific cause.
Its two staged encrypted files (160 chunks) were explicitly removed before
retesting. Native runtime codecs improved the allocation behavior and both
subsequent large runs passed, but this does not establish safe memory headroom.

The [GraphQL metrics](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/)
were queried with stored logs off. Schema introspection confirmed CPU quantiles
are microseconds and `memoryUsageBytes` is V8 isolate usage in bytes. Successful
native-code buckets included CPU p99 up to 319.261 ms and memory p99
162,635,020 bytes; buckets also include adjacent state reads. They are not
per-operation samples. Worker `performance.now()` returned zero for pure CPU
phases; those zeroes are not evidence of zero CPU usage.

## Selected boundary and limitations

Actual Worker file ingress/egress is capped at **1 MiB per file**, enforced in
the downloader, socket response limit, storage reads and advertised descriptor.
Node retains the 5 MiB upper bound. Larger Worker requests remain diagnostics,
not an enabled client-file promise. Memory is per isolate, so concurrent large
transfers require further profiling/coordination before expanding this limit.

The account reports usage model `standard`. The exact billing subscription
could not be inspected: the OAuth connection lacks Billing Read. No plan or
limit was purchased or changed. Current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
give Free 10 ms CPU and both Free/Paid 128 MB memory. Observed CPU exceeds that
Free budget; do not advertise this path as free-tier-compatible. Before enabling,
verify an adequate paid CPU budget and the measured 1 MiB profile. Paying does
not remove the memory limit. Larger work needs streaming/reduced buffering or
separately verified Node hosting; no silent truncation/resume claim is made.

No actual ChatGPT file transfer, client CDN socket compatibility, SIE parsing,
representative complex provider schemas, saturation test or Node/Docker hosting
acceptance was performed. #77 retains this precise partial evidence; full G09
and release-candidate remeasurement remain separate.

## Cleanup and an observed retention side effect

Both temporary operator bindings were removed, and the old key then received
404. Anonymous MCP tool calls still received 401. File ingress remains off and
stored observability/temporary protocol diagnostics remain off. Final D1 counts:
one owner, three clients, 47 access-token rows, 50 refresh-token rows, zero staged
files and zero chunks. All 11 benchmark intent rows were explicitly deleted.

The first benchmark reused the ordinary review adapter, whose existing expiry
cleanup also removed **one previously expired synthetic review record**. No
financial record existed. This was an unintended side effect; no approval was
fabricated or reconstructed. The final benchmark adapters clean only their own
owner/company records, and SQLite/workerd tests verify preservation of unrelated
expired reviews. Owner/client/token rows were unchanged throughout.

## Verification

The OAuth package passed typecheck, lint, build and 42 backend tests with no
skips; the final scoped-retention change additionally passed all three targeted
runtime tests. Its 18 restrictive-CSP browser tests passed on desktop Chromium
and Pixel 7 emulation. Root checks independently passed typecheck/lint, 40 Node
tests, 30 workerd tests, build and four artifact tests. Dry-run packaging passed.
No actual ChatGPT acceptance, package publication, merge or release is implied.
