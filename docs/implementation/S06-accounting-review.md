# S06 — Accounting invariants and manual review

Status: milestone 3's bounded creation/review implementation has synthetic
Node/workerd evidence; actual provider/financial/client acceptance remains open.
See [M03 evidence and rule matrix](M03-accounting-evidence.md). Broader S06 and
verified G02 remain requirements, not implied by this slice.

## Deliver

Read accounts, years, series, locked period and vouchers. Implement the rule register in [validation](../contracts/validation.md), including exact decimal balancing, explicit year selection and dimension/reference checks. Provide useful field-level errors without silent repairs.

Implement manual-voucher proposal, embedded review and execution under [approval](../contracts/approval.md). Show each immutable voucher and its company; commit only the reviewed selection. Enforce owner policy across UI/model/batch paths. Client-managed mode uses the same financial checks.

## Acceptance

Run T03–T10 with synthetic data and authorized Fortnox test-company evidence. Include one-cent imbalance, non-calendar year, stale policy, changed proposal, replay, double click and lost upstream response. Test actual locked-period boundary and removed/correction-row semantics before enabling those cases.

Prove the documented host/server boundary; do not claim cryptographic human presence from tool visibility. An unsupported review client cannot book in review mode.

## Handoff

Commit the rule-to-test matrix, review evidence and unknown-outcome recovery instructions. Expose only supported accounting mutations; editing/deleting manual vouchers needs its own classified review behavior.
