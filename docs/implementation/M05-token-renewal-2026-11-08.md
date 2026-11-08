# M05 provider renewal and isolated old-token checks — 2026-11-08 UTC

Scope: the owner's explicit follow-up requested old MCP-token checks and actual
Fortnox service/user token renewal on the two authorized test connections. Keep
existing company bindings, generations, grants, policies and activation gates;
perform no financial operation. This follows the
[local client lifecycle session](M05-client-lifecycle-2026-11-08.md).

## Runtime and original MCP-token availability

The actual installation remains on source
`ea2013739524727cd832833613610f8eaa496c51`, image
`sha256:54ddb2986f7e40364d338fc964fff68438d75f0772bd2dd76dd84e9bfde7d1fd`,
version `0.1.0-mvp.5.0`. Its Node bytes matched the previously verified build.
The domain source used by the private provider driver is unchanged from this
runtime source. The application image and deployed configuration were not rebuilt
or replaced for these checks.

The product does not override Better Auth's `storeTokens: "hashed"` default.
The installed provider hashes access and refresh tokens before persistence and
also hashes presented tokens for lookup. The inspected private evidence contains
no original access/refresh tokens from the ChatGPT client run. Consequently no
original token was replayed and no stored hash was substituted for an original.
Do not infer actual original-token denial from the isolated results below.
No refresh replay targeted the active ChatGPT client family.

## Actual Fortnox provider renewal

A read-only vault inspection at 22:56:23 UTC returned expiry metadata only:
service expiry 23:56:16.642 UTC and user expiry 22:57:22.030 UTC. Neither original
tokens nor token hashes were emitted. The user connection was already within
the ordinary sixty-second renewal margin; by its actual renewal the old access
token had expired naturally. The recently renewed service connection used the
owner-authorized normal force-refresh argument.

The private operator driver reused `Connections.renew`,
`FortnoxConnections.token`, the existing encrypted vault/SQLite CAS storage and
the actual `get_company_profile` handler through an in-process MCP client. It
authorized each company using the existing exact two-company grant. This is an
operator/domain probe, not a remote ChatGPT tool call or a new OAuth identity.
Its fetch boundary allowed only the existing token endpoint and
`GET /3/companyinformation`; no arbitrary proxy or new application route exists.

| UTC | Mode/path | Result |
| --- | --- | --- |
| 22:57:46.640–22:57:47.995 | Service, normal explicit force-refresh/client credentials | Access token changed; persisted replacement matched the returned token; tenant-checked profile succeeded; new expiry 23:57:47.235 |
| 22:57:48.003–22:57:49.079 | User, normal renewal after natural access expiry | Access and refresh tokens changed; persisted replacement matched the returned token; tenant-checked profile succeeded; new expiry 23:57:48.384 |

The driver observed exactly one client-credentials exchange and one refresh-token
exchange, plus four Company Information GETs: verification within each renewal
and subsequent profile reads. Credentials were saved by the normal reserved CAS
path as one encrypted record; both renewal reservations were cleared. Independent
read-only inspection in a new process at 22:59:57 UTC read the same replacement
expiries. No credential expiry, clock, scope or token field was manually changed.
No crash/fault-injection test was performed on the actual provider refresh.

Both connections retained their identity/tenant, generation, scopes, state,
read-only flag, policy version and `review_required`. The existing company grant
was unchanged. Source/runtime financial, provider-file, file and trusted-review
gates remained off. Temporary driver/input files were removed from the live
container after the readback; sanitized reports remain private.

## Actual Chrome follow-up after provider renewal

The authorized local Chrome test chat sent a new uniquely time-bounded request
after the server probe completed at 22:57:49.082 UTC. The operator observed its
submission and pending answer, then the completed ChatGPT result: exactly two
companies and 3/3 new successful calls (listing and both profiles), without new
login/consent. Profile times in the rendered answer were 22:58:57 and 22:58:59 UTC.
These counts/times are client-reported, not raw transport logs. An earlier
five-call request was excluded because it could not be bounded after renewal.

A fresh admin reload retained active service/user connections, read-only and
human-review requirements, and all four operation activation gates off. No
settings or company connections were changed and nothing was booked.

## Isolated synthetic old-token checks

The test uses the exact same image's unmodified `product-node.js` in a separate
non-root, network-disabled, read-only-root container with disposable tmpfs state.
No live installation volume, credentials or grant is mounted. It bootstraps a
synthetic owner and separate synthetic OAuth clients through the actual HTTP
registration/PKCE/consent/token/revocation endpoints; bearer checks invoke the
actual `/mcp` authentication path. The synthetic consent is not real owner consent.
It neither accesses Fortnox nor changes the live ChatGPT family. No synthetic
expiry field or runtime clock is edited.

| Case | Observed response | Scope |
| --- | --- | --- |
| Valid synthetic access control | HTTP 200 | Positive authentication control |
| Explicitly revoked synthetic access token | HTTP 401 | Actual MCP bearer verification |
| Reused rotated synthetic refresh token | HTTP 400, `invalid_grant` | Isolated client family only |
| Revoked synthetic refresh token | HTTP 400, `invalid_grant` | Separate isolated client family |
| Naturally expired synthetic access token | HTTP 401 after 307 seconds | Actual unchanged lifetime; no manual expiry edits |

HTTP is loopback inside the isolated container with the configured proxy headers;
this is not an additional actual-client/TLS acceptance result. At
23:04:39.583 UTC (00:04:39 on 2026-11-09 Europe/Stockholm), the natural-expiry case
completed: all four negative cases and the positive control passed. Container
inspection confirmed the exact image, user `10001:10001`, network mode `none`,
read-only root and zero host mounts. The disposable container and tmpfs state
were removed after completion; private sanitized reports retain the results.

## Remaining acceptance

Original ChatGPT-token replay remains unperformed because original tokens were
not retained. The isolated results do not prove immediate invalidation of every
older original bearer token, cross-client/owner/company isolation, or every
refresh-family replay behavior in the actual connected client. Provider renewal
does not establish provider disconnect/reconnect, permission failures, uncertain
refresh recovery or broader provider support. Keep these and the remaining
[M05 actual acceptance](M05-actual-acceptance.md) open, including original-file
transfer, human review, verified financial/file results, recovery and confidential
security-report delivery. No merge, release or operation activation is implied.
