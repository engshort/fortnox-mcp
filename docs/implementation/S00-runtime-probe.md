# S00 synthetic runtime budget probe

Tracks [M23 #77](https://github.com/engshort/fortnox-mcp/issues/77) under G09.
This is an early representative subset, not full Node/Worker/SIE acceptance.

`npm run benchmark` in `spikes/s00-oauth` runs three workloads on Node: two
plain synthetic PDFs of 1 KiB, 1 MiB and 5 MiB each. The same portable workload
serializes 405 original synthetic tool descriptors, performs 5,000 exact decimal
additions, validates/encrypts/stores/reads both files and checks that 16 concurrent
claims produce one durable winner. All staged file bytes are removed afterward.
State uses a separate synthetic company/hash and cannot authorize a real review.
Node reports actual process CPU, RSS, heap and wall time; these are single-process
observations, not a multi-replica or maximum-memory guarantee.

## Optional hosted measurement

The existing isolated Worker has default-off `/s00-runtime/{small,representative,limit}`
operator endpoints and a protected state read. They are not MCP tools. Activation
requires a separate random 256-bit `PROBE_RUNTIME_TOKEN` secret and
`PROBE_RUNTIME_UNTIL` within the next 15 minutes. Requests authenticate with that
secret, must match the configured origin and cannot select an owner, company,
URL or arbitrary operation. Fixed file byte sizes and a 15-second upload deadline
bound the request. The owner provisions this short-lived permission through
Cloudflare administration; no approval capability is exposed or bypassed.

Apply only the additive file schema to the original isolated D1 database.
Preserve its existing owner/auth secret/grants and review flag. Keep file ingress
disabled while measuring; the benchmark supplies its own synthetic HTTP bytes
and does not depend on a ChatGPT file grant or perform a CDN download.

Create an ignored private JSON file with `origin` and `token`, then run
`npm run benchmark -- /absolute/path/to/private-config.json`. The script sends
two actual binary files over HTTPS per workload, reports HTTP status and client
round-trip time, and independently reads the durable consumed state afterward.
Worker CPU and memory are reported as unavailable unless platform telemetry
supplies them; wall time must never be relabeled CPU time. No credential or
response payload from another API is printed.

After measuring, remove both temporary bindings, verify the endpoint returns
404, verify no staged file/chunk rows remain and delete only the benchmark's
synthetic review-state rows. Existing owner/client grants and review rows must
be preserved. No stored request logs or diagnostics are needed.

Record exact deployed source, plan/limits, workload, versions, timings, bytes,
state outcomes and failures in a dated evidence record. A successful local run
does not establish hosted acceptance. A platform limit failure is evidence for
that exact workload, never permission to truncate it or claim the whole G09 gate.
