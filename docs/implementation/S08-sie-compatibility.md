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

Runtime and actual read-only report observations will be recorded after testing.
Real source exports, account identifiers, names and amounts remain private and
are never fixtures or PR attachments. Report availability does not establish
full export coverage, correction semantics, reconciliation or completed books.
