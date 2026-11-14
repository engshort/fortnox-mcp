# S08 — bounded SIE correction and comparison-year compatibility

Scope: T04, T15/T16 and T20. Addresses two independent whole-export rejections:
an optional correction signature present only on `#RTRANS`, and comparison-year
balances whose account has no `#KONTO` declaration. No provider write, policy
change, new operation or general financial verification is introduced.

The parser compares every paired posting token through quantity, allows only the
optional signature to differ, counts the effective row once, and exposes the
signature variation. Missing counterparts, altered posting fields and invalid
structure remain failures. This is an explicit provider-compatibility rule, not
a claim of strict token-identical SIE conformance.

Undeclared comparison accounts retain their number, exact source balances and
`name=null`. Current-year report assembly excludes these historical-only
references unless the current chart independently contains the account. Missing
metadata is an explicit limitation; no name, zero opening or current account is
inferred. Undeclared current-year postings/balances and undeclared years remain
invalid. Historical period balances follow the same declaration boundary.

The [SIE specification](https://sie.se/wp-content/uploads/2026/02/SIE_filformat_ver_4C_2025-08-06.pdf)
describes positional optional signatures and correction pairs. The implementation
keeps all other paired fields exact rather than assuming additional equivalence.

## Verification

Synthetic shared parser and authenticated provider/report cases cover a missing,
empty or changed optional signature; exact movement counts; altered accounts,
dimensions, amounts, dates, text and quantities; missing counterparts; preserved
historical balances/periods; invalid current-year references and undeclared years;
and unchanged current-year report movements with explicit incomplete status.

Node 24.19.0 verification: typecheck, lint, 419 Node cases, all 352 workerd/D1
cases, build and 13 built-artifact/native-Worker checks passed. The source-ledger
test first detected the changed source hashes; after updating only those hashes,
that case passed separately. A stronger trusted-profile regression was then
rerun successfully in both runtimes. No operation evidence/support gate changed.

## Actual read-only verification, 2026-11-14

The owner requested the fix, verification against two explicit calendar years,
and a PR. Code commit `6cf4997ff342cb3784f2a60fcbbf63e1a1b72b64` was deployed to
the affected Node/Docker installation using its existing locked receiver and
encrypted predeploy backup. Local-tested and deployed application/operations
bundle digests matched. The service is healthy, SQLite integrity passed, and
other installations retained their original container IDs. No financial writes,
company-policy changes, new scopes, merge or release were performed.

Connected MCP financial-analysis reads succeeded for 2025-01-01–2025-12-31 and
2026-01-01–2026-11-14. Matching `get_account_balances` calls for each interval's
end date returned the same whole-selection totals. All account pages for the
2025 selection were exhausted with stable source version/totals and no duplicate
accounts. For 2026, all report pages calculated from one fresh, authorized,
read-only provider basis passed the same MCP output schema. The temporary basis
was held in memory only; this is calculation/schema evidence, not a substitute
for connected-client pagination.
One earlier 2026 traversal correctly rejected continuation after its source
changed; the observation was not combined with the new source version.

Some connected-MCP continuation calls returned internal MCP errors; smaller
pages worked in several cases, but did not resolve every failed continuation.
The 2025 analysis traversal completed using supported page sizes 50 and 25.
Complete connected-client analysis pagination for 2026 is not claimed.
This is distinct from the resolved SIE parser failures. The native diagnostic
validated every 2026 report page at size 50 against the same output schema.
A separate connected `get_account_balances` traversal also stopped with an
explicit source-version conflict while the 2026 basis was changing. Its initial
report and whole-selection totals succeeded; pages from different versions were
not combined. Complete connected 2026 pagination remains unverified.

An external HTTPS/TLS check verified the code revision, health, OAuth issuer,
HTTP redirect and anonymous admin/MCP denial. The actual connection retained
read-only mode and its recorded manual-voucher policy.

Both fixes' limitations remain visible. Missing openings, unverified export/row
semantics, currency-default disclosure and existing balance-source disagreements
still prevent financial completeness/reconciliation. Real source exports,
account identifiers, names and amounts remain private and are never fixtures or
PR attachments. These are read-only availability observations, not proof of full
export coverage, correction semantics, reconciled statements or completed books.
