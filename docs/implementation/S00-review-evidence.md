# S00 embedded review experiment (G02)

The [2026-11-07 owner recheck](S00-review-acceptance-2026-11-07.md) records a
separate deployment's actual ChatGPT approval and completed-card remount,
corroborated by the same single consumed D1 record. Full host acceptance remains
open; this does not activate product bookkeeping.

Status on 2026-10-18: **local server boundary and a live ChatGPT review/click
verified; restrictive-CSP and reload/replay acceptance remain open**. This default-off addition to the isolated OAuth probe
records synthetic test approvals only. It has no Fortnox connection and cannot
execute a financial operation. The root product remains disabled.

## Mechanism

The model-callable `prepare_synthetic_review` returns one fixed synthetic
proposal with company identity, fiscal year/date/series, description, rows,
debit/credit totals, difference, currency, receipt reference and warnings. It
also returns the immutable proposal ID/hash and ten-minute expiry. A random
256-bit one-time capability is delivered only in result `_meta`; it never
appears in model-visible text or `structuredContent`.

The `ui://s00/review-v1.html` resource uses standard MCP Apps metadata and MIME
type `text/html;profile=mcp-app`. Its dependency-free vanilla view uses the
standard JSON-RPC `postMessage` bridge, initializes UI protocol `2026-01-26`,
receives tool results and calls `commit_synthetic_review` only after its visible
button is clicked. It requests no external assets or network domains. Swedish
and English labels, keyboard controls, readable proposal fields and an explicit
expiry/error state are provided. No external approval page is substituted.

The commit tool is app-only through `_meta.ui.visibility: ["app"]`. Its strict
input accepts only the proposal reference/hash, exact expiry and capability;
replacement rows, `confirmed=true` and `origin=ui` are not accepted. SQLite or
D1 atomically changes the prepared row to consumed only when authenticated
owner, fixed synthetic company, canonical hash, policy version, capability
digest and unexpired timestamp all match. A duplicate/concurrent request cannot
consume it twice. No provider call follows consumption. A lost database response
returns an unknown-outcome error and the view does not retry.

Both prepare and commit require the separately granted `mcp:review` scope in
addition to the normal owner/resource/read authorization. Existing read-only
grants cannot obtain a capability. The catalog/resource/extra scope are absent
unless the operator explicitly enables the review experiment. The policy is
fixed to review-required version 1; no model-callable policy editor exists.
Per-owner unexpired rows are bounded at 32, and expired synthetic metadata is
removed on preparation. This is not production proposal retention or encryption.

## Trust boundary

A conforming trusted host must keep `_meta` out of model context, hide app-only
tools from the model and deliver the capability only to the intended embedded
view. The server enforces proposal/owner/company/policy/expiry/one-time binding.
It **cannot prove a physical human click against a malicious host** holding the
same OAuth grant and UI capability. An unsigned UI-origin claim is not used as
authorization. These assumptions follow the [approval contract](../contracts/approval.md).

The live rendering/click and model-catalog observations below provide scoped
host evidence. They do not establish physical human presence or all client
configurations. G02 remains open for restrictive-CSP and remount/replay checks;
review-required product execution remains disabled.

## Observed checks

Local Node 24.19.0/SQLite and actual workerd/D1 tests cover wrong owner,
changed hash/expiry, forged capability, replacement rows,
expired/replayed approvals and concurrent consumption. MCP tests verify app-only
metadata and exclusion of the capability from model-visible results. Actual
OAuth requests on Node and workerd deny a read-only grant, allow a separately
consented review grant, and reject a replay across fresh HTTP handlers.
SQLite checks additionally reject changed company/policy version and enforce
the per-owner outstanding-record bound.

In Chrome on Windows, a temporary loopback-only host harness exercised the
actual widget in a sandboxed iframe: prepare → labeled company/details and
balanced row table → click → one recorded synthetic approval with the button
disabled. Changing language updated the labels and retained the completed state.
Opening the resource without a parent host displayed the unsupported-client
message with approval disabled. No error/warning console entries were observed;
the page was nonblank with no framework overlay. Screenshots and the harness
remain outside tracked source. This was a desktop viewport only, using CUA in
the user's selected Chrome; it is **not** a ChatGPT rendering/visibility test.

The package's 21 tests, strict typecheck, Biome and Worker build passed locally.
Hosted checks also passed on source `918210d`:
[S00 OAuth](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39144567943),
[S00](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39144567941), and
[S01](https://github.com/alex-engvall/fortnox-mcp/actions/runs/39144567962).

That source deployed successfully to the existing isolated test Worker after
applying only the synthetic-review table. The operator explicitly enabled the
review flag there; public metadata advertised the three scopes and the expected
three-tool catalog, with app-only commit visibility. A separate private native
ChatGPT client was created with all three mandatory base/default scopes. The
owner completed consent personally. The first issued tokens nevertheless
omitted `mcp:review`: the provider's default insert-only resource seed retained
the old two-scope database row. Safe metadata queries confirmed the client and
consent had all three scopes but the stored resource allowlist did not.

The probe now selects the maintained provider's `resourceSeedMode: "merge"`.
This updates only configured resource-policy fields; this isolated probe has
no resource-policy administration API and its explicit configuration owns the
allowlist. A regression starts with the earlier two-scope resource in Node and
D1, then verifies review opt-in, separately consented issuance and callback
authorization. Existing issued tokens are not broadened; a fresh authorization
is required. Missing review scope returns the standard tool-level
`mcp/www_authenticate` insufficient-scope challenge, including resource metadata,
an error description and all required scopes; no capability is returned. This
lets a conforming host request fresh authorization instead of retrying an old
read-only refresh family.

With the scope-policy fix deployed, a first actual ChatGPT prepare request using
the earlier read-only refresh family created no proposal. After deploying the
tool-level challenge at `34e577f`, another request displayed ChatGPT's
**Reconnect** card and its account-link dialog. This establishes that the host
honored the runtime challenge. The connected-app tool catalog in Codex exposed status and
prepare, while the app-only commit was absent. This is additional catalog
evidence, not a human-presence result.

### Actual ChatGPT view and click — 2026-10-18

After the owner completed the fresh authorization, safe D1 metadata at
16:53:08 UTC showed a new grant containing `mcp:read offline_access mcp:review`
and refresh access. ChatGPT resumed the pending prepare request and rendered
the actual embedded view in Chrome on Windows, using source `34e577f` on the
isolated Worker. It showed the synthetic company, year/date/series, balanced
125.00 SEK debit/credit rows, receipt reference, immutable reference details
and ten-minute expiry.

Clicking **Godkänn testförslaget** in the actual embedded view displayed
**Testgodkännandet registrerades en gång. Ingen Fortnox-åtgärd utfördes.** The
button became disabled. A subsequent aggregate D1 query returned exactly one
consumed proposal and no prepared proposal. One transient D1 API authorization
error cleared on a single retry; no credential or grant was changed. This
records a real host-to-server synthetic commit, not a Fortnox write or an
exactly-once upstream-delivery claim. The click was automated during QA and
therefore is not evidence of physical human presence.

When asked to inspect its available tools without calling anything, the
ChatGPT model listed only status and prepare and said commit was unavailable
as an ordinary tool. The Codex connected-app catalog likewise omitted commit.
Together with the resource/tool metadata and local forgery tests, this is
scoped evidence for the trusted-host boundary; model self-report alone is not
an authorization guarantee.

The account's existing developer setting **Tillämpa CSP för anpassade appar**
was off. It was inspected and left unchanged. The resource declares empty
connect/resource domain allowlists, but enforcement in ChatGPT under the
restrictive global setting was not tested. No weaker setting was enabled to
make this test pass.

Reloading the whole conversation after completion produced an empty embedded
view and **Det här svaret kunde inte läsas in** for the saved assistant answers.
No second commit control was available, so live replay after remount was
**not tested**. SQLite/D1 replay and concurrent-consumption tests still pass;
they do not replace this missing host check. Desktop screenshots were saved
outside tracked source. Mobile layout and a second host/browser were not tested.

Temporary protocol diagnostics were removed after the bounded tail ended;
stored observability remains off. The loopback UI harness was stopped and its
tabs closed. Only the isolated synthetic Worker remains enabled for the
remaining client checks.

The live view/click above used SDK 1.32.1 and the existing maintained OAuth
provider. A subsequent [dual-protocol follow-up](S00-oauth-evidence.md#dual-protocol-follow-up-and-direct-connected-app-comparison)
uses SDK 2.3.1 in this isolated probe and adds cross-era Node/D1 boundary tests;
the root workspace remains on SDK 1. This does not extend the recorded UI
acceptance to a new production client. The UI bridge is adapted narrowly
from the [official vanilla MCP Apps quickstart](https://developers.openai.com/plugins/build/app-quickstart),
using the [MCP Apps trust model](https://modelcontextprotocol.io/extensions/apps/overview).
Current ext-apps 2.x peers require SDK 2.x; helpers are not required for the
standard metadata/bridge used by this pinned SDK experiment.

## Explicit operator enablement

Run `node --import tsx scripts/prepare-review.ts`. Apply its ignored
`.data/review.sql` to the **same isolated probe D1**, then add
`PROBE_SYNTHETIC_REVIEW: "true"` to the private Wrangler vars and deploy the
probe. Never apply this to the root app database. The public example leaves
the experiment off. Local Node can set `reviewEnabled: true` in its ignored
config; it initializes the synthetic table in that local database.

A live review client must explicitly request `mcp:read offline_access mcp:review`
and the owner must complete its consent personally. Existing grants are not
silently broadened. Disabling the flag removes the tools/resource and stops
advertising the extra scope; no grant should be considered product acceptance.

## Local remount and uncertain-outcome follow-up

The [G01/G02 follow-up](S00-client-maintenance-evidence.md) adds an app-only
read-only status tool and server-backed remount handling. The view cannot renew
capabilities, ignores duplicate tool results and reconciles lost responses
without an automatic second commit. A reproducible synthetic-host browser suite
checks restrictive hash-based CSP, actual bridge timeout, concurrent views,
missing metadata and disabled unknown/expired/unsupported states. Desktop and
mobile-emulated Chromium checks are local evidence; actual ChatGPT CSP/remount,
another browser and real-device acceptance remain open. The earlier live
deployment/result above is unchanged.
