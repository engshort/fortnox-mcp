# S00 actual ChatGPT acceptance — 2026-11-05

This is the dated first run. The [2026-11-06 transport correction](S00-G03-transport-2026-11-06.md)
supersedes its G03 blocker: explicit Node relay ingress/server hashes passed,
while exact Chrome PDF delivery remains unaccepted. Native Worker egress is
unavailable. G05 remains open.

Scope: G01–G03. **Partial; the gates remain open.** G05 remains open by the
owner's instruction. No Fortnox operation, merge or release is authorized here.

## Environment and implementation

The owner-controlled personal ChatGPT account was exercised in Windows Chrome
156.0.8078.80. The hosted client date is 2026-11-05; no immutable ChatGPT build
identifier is exposed. A separate browser family has not been tested.

The existing isolated Worker and D1 were reused. The consent-copy correction
is source `359ea991fa3b36d1e575bb15f8f8e3b58163b377`, initially deployed as version
`8a70193e-d683-4d94-9026-bf9f97022f2e`. The subsequent hostname-only diagnostic
began at source `048040df52b67dd1d8cd9844ad5669311bffdfb7`. Fixed transport-stage
and redacted failure classifications followed; final executable source is
`303e03977e3a65dd09d1317286f0e9610b0c412f`, deployed as version
`b18cce0f-13c1-44b1-b602-a88b5df757e4`. SDK 2.3.1, Better Auth/provider 1.7.10,
compatibility date 2026-10-18 and the original owner, secret and D1 bindings were
preserved. The deployment used `--keep-vars` and the verified five-minute cron.

With Node 24.19.0/npm 11.9.0, typecheck, lint, build, all 42 backend tests and
deployment dry-run passed. The file-consent regression executes real signed
consent pages on Node and local workerd/D1. This is not a new browser-suite or
root-workspace test claim. Windows checkout CRLF caused an initial formatting
failure; LF normalization for validation introduced no unrelated source diff.

A subsequent bounded operator file-source diagnostic emits only a syntactically
safe HTTPS DNS hostname after the file-scope check, with the same opt-in
15-minute maximum deadline and a separate 64-event per-isolate budget. It never
receives path/query/credentials/IDs and does not authorize a download. Its
regression verifies denied-origin behavior, secret omission, no emission from
unscoped MCP calls and harmless sink failure. All 43 backend tests, typecheck,
changed-source lint, build and deployment dry-run passed for that follow-up.
The final transport-stage/redacted-failure source passed all **44 backend
tests**, none skipped, plus typecheck, changed-source lint and deployment.
Final-head CI results must be assessed separately.

## G01: status, metadata and token lifecycle

- The corrected existing status client was reconnected using the original
  operator files and the existing bounded local renewal command. No owner,
  secret, OAuth grant or database was reseeded. The login code was not printed.
- The first saved status answer and the follow-up after administrative
  **Reload tools** both displayed **Det här svaret kunde inte läsas in**.
  This reproduces a failure of automatic saved-answer loading.
  At the final recheck, **Läs in svaret igen** recovered both original status
  answers without a new tool invocation. This is explicit retry recovery,
  not seamless saved-answer acceptance.
- Administrative reload was exercised in both existing clients. A bounded
  filtered trace observed authenticated modern `server/discover`, `tools/list`
  and `resources/read` requests returning 200. An earlier anonymous unrecognized
  preflight returned 400. No explicit durable UI success receipt was captured;
  HTTP success does not close administrative/UI acceptance.
- The follow-up status request had an authenticated MCP 200 with observed
  `2026-07-28` header and token-endpoint 200. No negotiated-version or visible
  result claim is inferred from that trace.
- On 21:29:33 UTC, actual ChatGPT disconnect invoked revocation with 200. For
  the status client's registration, the count of unrevoked, unrotated refresh
  records changed from one to zero and one access-token record was removed.
- Reconnection of that older registration failed visibly with
  `invalid_scope` for `mcp:review`. Its registered scopes remain only
  `mcp:read offline_access`; the reviewed catalog now includes review/files.
  Existing client registrations and grants were not widened to hide this.

A new private **Fortnox MCP – S00 filprov** client was registered for the current
catalog's four scopes, with `mcp:read offline_access` as required base scopes.
The owner completed its corrected consent page. Its refresh record from
21:44:47 UTC was rotated/revoked at 21:51:21, after the five-minute access TTL;
one replacement refresh record remained current. A subsequent actual ChatGPT
status call visibly returned `dataset: s00-oauth`, `authenticated: true` and
`fortnoxEnabled: false`. This verifies scoped fresh-client refresh/read behavior.
A new registration is not evidence that the older client's lifecycle passed.
The new client's visible status also failed automatic loading after full reload
and recovered through **Läs in svaret igen**.

## G02: restrictive CSP, double click and remount

The ChatGPT **Tillämpa CSP för anpassade appar** setting was enabled and observed
checked. The widget declares empty connect/resource domain allowlists. This
account setting remains enabled; it is not a claim of a captured wire CSP header.

Actual ChatGPT rendered the synthetic company, two balanced 125.00 SEK rows,
zero difference, immutable reference and expiry. After reopening, the status
read initially failed and approval remained disabled. Following the review
client's own catalog refresh and full conversation reload, the same proposal
recovered to ready. No new proposal was sent during that recovery.

A real UI double click on **Godkänn testförslaget** displayed one successful test
approval. D1 changed from one prepared record to exactly one consumed record.
A second Chrome tab of the same saved result initially failed to render; its
**Försök igen** action recovered the widget, which displayed the same consumed
result with approval disabled. There was no second consumption. These are two
tabs, not two browser families or a proven simultaneous network race.

The saved model answer initially failed after full reload. At the final recheck,
**Läs in svaret igen** recovered that text, and the widget's **Försök igen**
recovered the already consumed result with approval disabled. D1 still contained
exactly one consumed record and no prepared record. Recovery required explicit
host retries; seamless saved rendering is not established.

Actual-host dropped-commit-response injection and an independent browser remain
unverified. A separate unsigned-in session was prepared, then closed when the
owner directed further work to Chrome. Existing local fault/concurrency tests
are separate evidence and do not replace those actual-host cases.

## G03: prerequisites and staged client test

Known synthetic fixtures were generated locally and uploaded in actual ChatGPT:

| Fixture | Bytes | SHA-256 |
| --- | ---: | --- |
| PNG | 76 | `ac4041569d830a589c73868d1c873c56cf6b6ca2f1288027266e20feee5df3dd` |
| PDF | 863 | `8e6f164255cb59b1ba46733b07afcbede4873eee24090c106da85bb5fad4397d` |

The owner explicitly approved and manually enabled the ChatGPT Chrome
extension's local-file URL access after the browser tool rejected opening the
internal extension-settings URL. No alternate automation bypass was used.
Actual upload completion was observed for both files; that alone is not proof
that their bytes reached the MCP server.

The five-minute cron was created at 21:22:21 UTC. A dedicated already-expired,
non-file synthetic sentinel and its linked chunk were inserted at 21:22:57.
They remained present at 21:30:32 and both were absent by 21:31:06, without a
manual cleanup call. This verifies initial scheduled deletion after propagation;
it does not measure sustained retention or a genuine uploaded file's expiry.

File metadata was first enabled with an **empty origin allowlist**. The older
review client correctly required new file
authorization; its registration lacks `mcp:files`. The new private file client
declares that scope before separate consent. No old token was edited.

The consent screen originally omitted a description of file capability. The
correction describes only the scopes in the verified signed request, including
download/readback, encryption, owner/company binding, 55-minute references and
cleanup/outage behavior. The new page was visually inspected before consent.

After the new owner's consent, actual ChatGPT displayed
`INVALID_ARGUMENT / RuntimeException / FILE_URL_DENIED`. Separate bounded tests
with only the visible attachment-image origin `https://chatgpt.com`, then only
`https://files.oaiusercontent.com`, returned the same error. The latter is a
reviewed candidate from OpenAI's official
[file-service documentation](https://developers.openai.com/api/docs/actions/sending-files),
not proof of this MCP request's source origin. The model could not expose the
host-injected `download_url`; signed URLs were not extracted or logged. No
wildcard origin or unpinned fallback was introduced.

A new bounded hostname-only operator trace then identified the actual
host-injected source as one specific Azure Blob origin. Only that exact
observed origin was enabled. The subsequent actual ChatGPT attempts progressed
past URL authorization but returned `FILE_FETCH_FAILED`. At 22:15:58 UTC the
authenticated modern `tools/call` returned HTTP 200, while fixed transport
markers reached resolving, connecting, securing, requesting and reading, then
failure. No HTTP response-header marker was observed. The coarse redacted
failure category was `other`; it does not establish a TLS, DNS, provider or
parser root cause. An independent public DNS lookup succeeded, but is not proof
of the Worker's network path.

The actual displayed file error and zero stored files are the outcome. HTTP
success is not file transfer. D1 contained zero file records and zero chunks at
cleanup. Successful CDN socket acceptance, server byte/hash comparison, client
output download and uploaded-file expiry remain blocked/unverified. They cannot
be exercised without a successful ingress. No G03 completion is claimed.

## Follow-up and cleanup

Keep all three gates open until their remaining actual-host criteria pass.
File ingress was restored to off and the origin allowlist emptied after the
bounded test; scheduled cleanup remains active. Temporary diagnostics
were disabled and verified at 22:16 UTC. Original D1/owner/secret bindings were
preserved. A fresh anonymous private tool call returned 401; public metadata
returned 200 and no longer advertised file tools. Never replace the pinned
socket transport with an unpinned fallback to force CDN success.

Screenshots and allowlisted operator trace summaries are retained privately
outside Git. No token values, private capabilities, signed file URLs, real
receipts or unrelated browser content are included in this record.
