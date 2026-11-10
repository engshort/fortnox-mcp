# Financial data and deterministic analytics

## Required breadth

Expose all available ledger accounts and balances, not a fixed handful of invoice KPIs. Support booked assets, liabilities, equity, income, expenses, period movements, receivables/payables and liquidity inputs. Preserve drill-down to vouchers, source documents and available attachments.

The client interprets the data. The server performs explicit deterministic calculations and reports evidence. It must not require a separate model key, invent missing balances or label incomplete data as a complete balance sheet.

## Source strategy

The supplied OpenAPI contains `BalanceBroughtForward` and `BalanceCarriedForward` on accounts, vouchers with rows, fiscal years and `/3/sie/{Type}`. It does not establish a generic ready-made balance-sheet/profit-and-loss report endpoint. Use accounts, verified movements and SIE exports as the data basis.

Fortnox documents SIE1 yearly balances, SIE2 monthly movements, SIE3 object balances and SIE4 transactions. An export covers one fiscal year or a subset of it. For multi-year analysis, retrieve each relevant year and preserve boundaries. Verify API selection/encoding and export semantics against the test company, not only the UI help page.

Do not interpret a year-end account field as a balance on any arbitrary date. For an as-of date, use verified opening balances plus the relevant posted movements. Reconcile to provider/SIE balances for the same boundary. Determine the actual reporting precision and sign conventions through fixtures and provider tests.

## Calculation definitions

| Result | Definition and required disclosures |
| --- | --- |
| Account balance at D | Opening balance for the fiscal year plus signed effective posted movements up to D; exclude removed/superseded rows according to verified semantics |
| Period movement | Signed effective movements within inclusive date bounds; no hidden current-year default |
| Assets/liabilities/equity | Group account balances by a documented mapping and sign convention; preserve unmapped/custom accounts in a visible category |
| Revenue/cost/result | Deterministic grouping of posted income/expense movements with documented display signs; distinguish ledger revenue from invoice sales |
| Receivables/payables | Verified unpaid/open amounts and due dates at the supported observation point; don't reconstruct historical status from current status without historical evidence |
| Liquidity overview | Booked cash/bank balances plus explicitly identified expected receivable/payable flows; separate observed figures from projection assumptions |
| Comparisons | Per-company/per-period values with matching definitions; disclose differences in years, currency, mapping and completeness |

Use documented company account metadata/mappings. A BAS-like number range may help propose a classification, but arbitrary/custom accounts must not be silently misclassified. No automatic tax filing, tax correctness or legal consolidated accounts claim is part of this feature. Combining company totals is not statutory consolidation; do not eliminate intercompany transactions or convert currencies without explicit supported rules.

Unbooked items, omitted/closed fiscal years, missing opening balances, provider access restrictions and pending postings are material limitations. Inactive accounts with historical balances remain in scope. Include zero-balance accounts when the user requests all accounts; validate `exportall`/other filters rather than assuming they do so.

## Evidence envelope

Return: company identity, fiscal-year ID and dates, requested/as-of interval, currency, source operations/record identifiers, retrieval timestamp/range, calculation and account-mapping versions, pagination/export coverage, reconciliation outcome and limitations. Computed values are labeled as computed; provider values as provider-supplied.

Fortnox reads across multiple endpoints may not form an atomic snapshot. Record the retrieval window; if concurrent changes can materially invalidate reconciliation, flag it or repeat the necessary bounded read. Do not guarantee snapshot consistency without provider support.

When account-list and SIE balances disagree, retain both source references and
report the affected opening/closing field as unknown with the corresponding
source-disagreement limitation. Do not choose a source merely because it was read
first. Independent account-detail reads remain provider observations, not proof
that the combined report has reconciled.

## Large-data behavior

Paginate or stream with explicit limits. Return partial status and continuation rather than dumping an entire ledger into model context. Support focused account/range/date queries and drill-down. Temporary analytical results expire under storage policy; source records remain in Fortnox.

## Acceptance examples

- Every account in a synthetic year, including inactive/zero-balance/custom accounts, can be retrieved without silent omission.
- Opening `1000.00` + debit movement `250.00` − credit movement `100.00` yields `1150.00` under the documented sign convention.
- A partial-year query differs correctly from the full-year closing field.
- Cross-year and non-calendar-year requests do not double-count opening balances.
- An incomplete page, missing year or unreconciled SIE result is visibly incomplete.
- A booked bank account is never described as a live bank balance.

Sources: [F09–F11](../reference/sources.md). See [verification gates](../reference/verification-gates.md).
