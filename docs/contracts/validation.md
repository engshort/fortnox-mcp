# Validation and accounting invariants

The [milestone 3 implementation](../implementation/M03-accounting-evidence.md)
enforces a narrow new-voucher profile with exact cents, ordinary unsigned rows,
explicit company/year and fresh complete references. Unverified precision, lock
boundaries, corrections and foreign references fail closed. Its rule-to-test
matrix does not replace financial live acceptance under #76.

Reference reads can report `information: "UNKNOWN"` when the provider's account
list returns a numeric transaction-information setting whose meaning is not
verified. This preserves an observed unknown; it does not map any numeric value
to an allowed/required/forbidden rule. `complete=true` describes retrieval only.
Any `UNKNOWN` account rule blocks voucher validation even if another component
mistakenly marks the reference set verified. Approval cannot override it.

The provider's named `MANDATORY` rule normalizes to the domain's `REQUIRED`
rule for cost center, project and transaction information. Numeric, omitted or
null transaction-information settings remain `UNKNOWN`; none means optional or
forbidden by default. Missing required values are rejected, and supplied
dimensions must still resolve to active company-bound references.

Validation is executable domain behavior, not an instruction asking the model to be careful. Rules apply to UI, model, batch and developer entry points and cannot be disabled by approval mode.

## Rule register

| ID | Rule | Basis and expected rejection |
| --- | --- | --- |
| V01 | Caller owns the selected company/connection | Project security invariant; `COMPANY_FORBIDDEN` before any data disclosure |
| V02 | Exact finite monetary values | Project invariant; reject NaN/infinity, unsupported precision, overflow and lossy parsing |
| V03 | Effective manual-voucher rows balance exactly | Approved product rule; sum debit equals sum credit at provider-supported precision |
| V04 | Required description, date, series and valid row structure | Supplied voucher schema; validate source inconsistencies against test company |
| V05 | Date belongs to the resolved fiscal year | Fortnox voucher best practice; reject mismatch rather than using current-year default |
| V06 | Accounts exist and are active for the year | Fortnox voucher best practice; do not create accounts as a silent repair |
| V07 | Voucher series exists and permits the requested operation | Fortnox best practice plus permissions verified in test company |
| V08 | Locked-period restrictions honored | `/3/settings/lockedperiod` plus verified boundary semantics; no write into a disallowed period |
| V09 | Required dimensions/information are present | Account fields for cost center/project/transaction information; cross-check actual codes and active references |
| V10 | References resolve in the same company | Prevent foreign invoice/file/account references and cross-company approval reuse |
| V11 | Current policy and exact proposal are checked at execution | Project invariant; changed data/policy requires re-preparation as applicable |
| V12 | Invoice updates preserve intended rows | Fortnox update semantics: omitted rows can be removed; require explicit full reviewed result/diff |
| V13 | Operation respects current provider record state | Booked/cancelled/credited/paid states and upstream errors; no implicit workaround |
| V14 | Files meet verified type/size/ownership requirements | Per-endpoint contract; no implicit upload of arbitrary URLs or mismatched content |

Balance example: debit `1250.00`, credit `1200.00` must fail with a `50.00` difference. Decimal arithmetic must correctly handle `0.10 + 0.20 = 0.30`. Reject an unsupported sub-cent amount instead of quietly rounding it into balance. Use currency/endpoint-specific precision; do not impose two decimals on quantities or all possible currencies without evidence.

The definition of effective rows must account for provider correction/removed-row semantics. These are a verification gate, not permission to accept every row where a model supplied `Removed=true`. Test signed values and debit/credit combinations against documented provider behavior before hard-coding additional constraints.

## Limits of validation

A balanced voucher can still be posted to the wrong account or use wrong tax treatment. Only implement accounting/tax rules with a documented authoritative basis and an identified applicable context. Flag unsupported cases. The client may suggest a treatment, but the server must not invent missing facts or claim a complete accounting-law compliance engine.

Fortnox remains authoritative for final provider validation. Prechecks improve reliability but cannot eliminate races or all upstream rules. Fetch current state immediately before committing where needed, then preserve a useful provider rejection. Never mark a rejected action successful.

## Write correctness and retries

Before an upstream mutation, durably record a company-bound execution intent and a canonical input hash. Reusing an intent ID with different content fails. Use atomic state transitions to prevent two local executors sending the same intent simultaneously.

After a timeout/network loss, classify outcome as unknown unless there is evidence the request was not sent or was rejected. Reconcile using returned IDs, trusted references and provider state. A matching amount/date alone is not proof of identity. Do not assume Fortnox supports an idempotency header unless verified for that endpoint.

The system provides duplicate prevention and recovery, not unconditional exactly-once delivery. If reconciliation is inconclusive, request human review and retain the unknown state. See [receipt state machine](receipts.md) and [test strategy](../testing.md).
