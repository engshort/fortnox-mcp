# REST bridge implementation and evidence

Date: 2026-11-16. Scope: S03 generic REST transport; common S04–S09 domain
boundaries; S11 installation and operational recovery. The owner explicitly
requested a native-format bridge across the known Fortnox catalogue, catalogue
updates before unknown endpoints execute, and direct writes with idempotency keys.
See the [contract](../contracts/bridge.md) and [Swedish guide](../users/rest-brygga.sv.md).

## Implementation

The portable bridge service owns authorization and durable claims. The REST adapter
mirrors HTTP requests; the Fortnox adapter validates private source schemas and
uses the existing connection/token/pacing services. The authenticated owner can
replace a complete private catalogue; it is never bundled into public artifacts.
Effect classification is explicit, including delivery GETs. Expanded OAuth scopes
need new consent. New claims bind stable registration and subject independently
of rotating grant-family identifiers.

Manual voucher creation uses the existing exact voucher validator and company
policy. Document replacements fence their original source and explicit row set.
Unknown outcomes fence company writes through existing domain entry points too.
Existing-target PUT recovery reads the exact target and compares the retained
desired-field digest. Other uncertain effects remain unknown without evidence.
No new MCP proxy tool, financial replica or automatic action retry is introduced.
The [transport ledger](../reference/bridge-api-operations.json) records this slice
without marking provider operations verified.

## Verification record

The shared original synthetic contract runs on Node/SQLite and actual local
workerd/D1. It covers complete/hash-bound reviews, source methods, delivery effects,
native exact-number bodies, scoped company access, strict inputs, concurrent keys,
retained unknown outcomes, service recreation, exact-target recovery, manual review
denial, unbalanced vouchers, multipart/binary files and revocation during I/O.
The actual OAuth-library contract covers PKCE, expanded REST consent, token
permissions, refresh and revocation. The additive resource-policy migration is
tested twice without changing existing client/consent/token scopes.

Private local source inspection imported all 451 operations of the already
supplied snapshot into a disabled review template. No source or derived content
was committed, and no capability was enabled. This proves parsing/import coverage,
not executable support or verification for those operations.

Local full-suite/build results and any final integration corrections are recorded
in the delivery PR. The first workerd attempt was prevented by filesystem/log and
loopback sandbox restrictions; actual local workerd checks were rerun with local
process permissions. All fixtures are synthetic. Actual hosted consumer and live
Fortnox bridge acceptance have not been established by these tests.

The focused bridge/OAuth/migration checks pass on Node/SQLite and local workerd/D1.
The complete Node product contract also passed (300 tests before the final
pre-dispatch marker case; the expanded focused contract has 16 cases). Typecheck,
lint, build, 11 built-artifact checks and three native Worker/recovery checks pass.
Broad concurrent local runs reached existing receipt-restart/payroll timeouts;
all four matching restart cases passed in isolation. Complete CI on the PR's
immutable head remains the delivery check; local timing failures are not passes.

## Limits and acceptance boundaries

The public distribution deliberately ships no provider specification or active
catalogue. The owner must obtain authorized source and review each operation.
Unknown schemas/parameter encodings, unimplemented domain profiles, unsupported
file formats and unavailable specialist credentials cannot be activated merely
by routing an HTTP request. Manual vouchers retain the existing narrow SEK/new-row
profile; editing/deletion is not implemented. Provider acknowledgements and
terminal local metadata do not imply exactly-once delivery or downstream receipt.

Historical provider observations remain tied to their original commits. This
transport does not promote the existing coverage ledgers to verified support.
