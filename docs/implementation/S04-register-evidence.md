# S04 register implementation and acceptance boundary

Scope: #21 register/reference implementation, following the shared foundation in
#116 (`2bddeaf`). Actual acceptance and issue completion remain pending.

## Implemented bounded profile

Customers, suppliers and articles have focused list/detail, prepare/create and
prepare/update MCP tools. Updates retain omitted fields, show the modeled
before/after/diff and compare a hash of the entire provider source (including
unmodeled fields) immediately before claiming execution. Unsupported fields,
empty strings and `API_BLANK` are rejected. Provider reads preserve optional
text fields returned as `null`; this does not authorize clearing a field in a
write. Omitted fields remain outside the update payload. Field clearing needs separate
per-field acceptance. Article creation explicitly selects `SERVICE`; stock
adjustment and bank-instruction maintenance are outside this profile.

Reference list/detail operations cover payment/delivery terms, delivery methods,
currencies, units, cost centers, projects, price lists, selected article prices
and payment methods. Existing fiscal-year/account/lock references remain in the
accounting module with their existing gates. References are resolved within the
selected company's current grant; inactive parties/centers and non-ongoing
projects cannot satisfy a write. Missing provider records are distinguished from
unknown scope/license/permission rejection. No defaults are invented.

Search uses only explicitly modeled provider filters. Lists stop at five pages,
500 records, 256 KiB or 15 seconds; `complete=false` describes partial results.
Missing pagination metadata on paged resources cannot imply completeness.
`next_page` resumes the same explicit query and company, without a snapshot
consistency guarantee. Documented non-paged reference collections use their own
bounded envelopes. Price tiers use the selected price-list/article sublist;
a detail lookup explicitly selects base quantity zero.

The [32-operation matrix](../reference/s04-register-operations.json) records
source hashes, routes, scopes, effects, rights, precision, retry and missing
actual evidence. The private supplied specification remains excluded from git
and artifacts. Public developer docs were rechecked on 2026-11-10; mappings and
schemas were written independently, without generating provider code.

## Durable recovery

Every write enters `BusinessWrites`. The intent retains only the known target,
submitted field names and normalized digest, alongside existing owner/company,
client, tenant/generation and execution metadata. No field values are retained
after consuming the encrypted proposal. Readback compares exact decimal values
without converting prices through JavaScript Number.

A lost answer or unverified dispatched rejection remains `outcome_unknown`.
Reconciliation reads only a trusted returned or preselected identity and compares
the intended field digest. Unknown generated identities, mismatches and absence
remain unresolved, blocking new business writes in that company. No search by
amount/name/date, automatic resend or exactly-once guarantee exists. In-flight
claims have a two-minute minimum before read-only reconciliation; terminal state
cannot be overwritten by a competing reconciliation. Successful reconciliation
establishes matching current register content, not attribution of other actors'
changes. No manual-voucher approval is created.

## Isolated test build

Ordinary product configuration does not enable these tools. The separately built
`dist/register-test-node.js` requires `REGISTER_TEST_DATABASE` to differ from the
ordinary database path, explicit `REGISTER_TEST_OPERATIONS` (JSON array), a real
source commit, and `REGISTER_TEST_UNTIL` no more than one hour in the future.
It requires existing two-tenant test mode. All provider requests recheck the
allowlist, lease, grant, generation and scope; writes additionally enforce
read-only and restore restrictions. Only selected scopes enter new consent.
The profile never activates accounting, provider-file or trusted-review gates.
After expiry MCP returns 503 while setup/admin access remains available.

Keep credentials, approved recipient configuration, created provider IDs and
correction/cleanup records in ignored private files. An ordinary build ignores
these profile variables. Do not point the test profile at an installed database
or replace a permanent installation with it.

## Verification and outstanding acceptance

Eleven shared behavioral cases passed in Node/SQLite and actual local
workerd/D1 before the final profile checks: create/read/update, whole-source
conflicts and preservation, exact prices, partial pages and filters, company
reference isolation, inactive references, permissions/read-only/lease expiry,
unknown-write reconciliation, ambiguous identity retention, redacted errors,
late disconnect, selected prices and actual MCP calls against synthetic HTTP.
The common intent suite adds concurrency, key rotation, cleanup, restore block,
service recreation, SQLite reopen and actual workerd/D1 restart coverage.

Built-entry checks distinguish ordinary configuration from the expiring isolated
profile and verify that only the selected database is opened. Full CI, Docker,
actual provider rights/precision/state behavior and actual ChatGPT evidence must
be recorded individually on the immutable revision before promotion. None of
these synthetic checks completes #21, #36, #38 or #92.

## Owner setup follow-up (2026-11-10)

The isolated build at `f541bd8` received two new allowlisted test connections
through the owner's actual login and Fortnox consent. This proves setup only;
no register/document operation or actual MCP client acceptance is established.
An anonymous authorization probe initially rejected the newly selected scopes,
then accepted the unchanged 18-scope request after the owner saved the portal
settings. This is an observation, not a guaranteed propagation interval.

API credentials now have a separate owner-authenticated page at
`/admin/fortnox/api-credentials`. The installation page shows approval only when
the saved configuration matches an active owned connection. Saving alone does
not prove approval. Forgetting uses the observed configuration revision and
removes that configuration's ciphertext, cancels unused owner consent flows,
and preserves connected companies, their credentials, policies and grants.
Operator-managed configuration cannot be forgotten through HTTP. Node/SQLite
and local workerd/D1 contracts verify ownership, Origin, stale revisions,
connection preservation and saving again after forgetting. Browser checks use
synthetic data; they do not inspect the owner's browser or establish ChatGPT
acceptance.

## First actual register run (2026-11-10)

At `d27afa6`, a standard OAuth/PKCE-authorized Node MCP SDK client completed
39 successful read calls across the two allowlisted test companies. Customer,
supplier and article lists were empty and complete. Payment/delivery terms,
delivery methods, currencies, units, price lists and payment methods passed
list/detail checks. Cost-center and project lists were empty; their detail
operations and article-price reads were not established. Two read-only write
attempts and a foreign-company read were denied. This is actual provider/MCP
evidence, not ChatGPT acceptance or a negative provider-license test.

After the owner enabled writes for the first company, one synthetic customer
create reached Fortnox. Its readback rejected optional text fields returned as
`null`, leaving the durable execution `outcome_unknown`. No customer create was
resent. A bounded diagnostic read returned HTTP 200 and identified the nullable
fields without publishing their values. The nullable-read correction has a
shared regression for preserving provider nulls, rejecting caller null-clearing,
and updating only an explicitly supplied name. Read-only reconciliation of the
original intent is required before any further writes in that company.

Private evidence retains timestamps, provider identities, intent references,
response hashes and cleanup rules outside git. These partial observations do
not promote an operation, complete #21 or establish the remaining permission,
precision, filter, pagination and client cases.
