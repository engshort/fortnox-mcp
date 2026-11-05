# S00 actual ChatGPT acceptance — 2026-11-05

Scope: G01–G03. **Partial; the gates remain open.** G05 remains open by the
owner's instruction. No Fortnox operation, merge or release is authorized here.

## Environment and implementation

The owner-controlled personal ChatGPT account was exercised in Windows Chrome
156.0.8078.80. The hosted client date is 2026-11-05; no immutable ChatGPT build
identifier is exposed. A separate browser family has not been tested.

The existing isolated Worker and D1 were reused. The consent-copy correction
is source `359ea991fa3b36d1e575bb15f8f8e3b58163b377`, deployed as Worker version
`8a70193e-d683-4d94-9026-bf9f97022f2e`. SDK 2.3.1, Better Auth/provider 1.7.10,
compatibility date 2026-10-18 and the original owner, secret and D1 bindings were
preserved. The deployment used `--keep-vars` and the verified five-minute cron.

With Node 24.19.0/npm 11.9.0, typecheck, lint, build, all 42 backend tests and
deployment dry-run passed. The file-consent regression executes real signed
consent pages on Node and local workerd/D1. This is not a new browser-suite or
root-workspace test claim. Windows checkout CRLF caused an initial formatting
failure; LF normalization for validation introduced no unrelated source diff.

## G01: status, metadata and token lifecycle

- The corrected existing status client was reconnected using the original
  operator files and the existing bounded local renewal command. No owner,
  secret, OAuth grant or database was reseeded. The login code was not printed.
- The first saved status answer and the follow-up after administrative
  **Reload tools** both displayed **Det här svaret kunde inte läsas in**.
  The saved answer is therefore a reproduced actual-host failure, not accepted.
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
Its separate owner consent and subsequent acceptance are tracked below. A new
registration is not evidence that the older client's lifecycle passed.

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

The saved model answer still failed to load after full reload even when the
widget recovered. Actual-host dropped-commit-response injection and an
independent browser remain unverified. Existing local fault/concurrency tests
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

File metadata was enabled with an **empty origin allowlist**. All upstream
downloads remain denied. The older review client correctly required new file
authorization; its registration lacks `mcp:files`. The new private file client
declares that scope before separate consent. No old token was edited.

The consent screen originally omitted a description of file capability. The
correction describes only the scopes in the verified signed request, including
download/readback, encryption, owner/company binding, 55-minute references and
cleanup/outage behavior. The new page was visually inspected before consent.

Actual CDN socket acceptance, server byte/hash comparison, client output
download and uploaded-file expiry remain pending. No G03 completion is claimed.

## Follow-up and cleanup

Keep all three gates open until their remaining actual-host criteria pass.
Record final file-test outcomes and restore file ingress/temporary diagnostics
to off after the bounded test. Keep scheduled cleanup available. Never replace
the pinned socket transport with an unpinned fallback to force CDN success.

Screenshots and allowlisted operator trace summaries are retained privately
outside Git. No token values, private capabilities, signed file URLs, real
receipts or unrelated browser content are included in this record.
