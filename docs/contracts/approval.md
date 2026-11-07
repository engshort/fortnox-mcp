# Manual-voucher approval policy

The [milestone 3 service/view](../implementation/M03-accounting-evidence.md)
implements immutable encrypted proposals and one-time UI-only capabilities.
Product reviewed execution stays disabled pending G02/#32 and operation-specific
G06/G07 evidence. Persisting a proposal is a mutation: read-only permits pure
validation, not preparation or booking.

Milestone 4 adds receipt-bound voucher hashes and encrypted proposal bindings for
the exact batch/item/workflow/file identity and SHA-256. Each item has its own
capability and totals. The ordinary voucher routes reject a receipt proposal
without the internal file guard; the guard runs again before dispatch. See
[receipt evidence](../implementation/M04-receipts-evidence.md#m15-immutable-per-item-preparation-and-review).
The preparatory UI does not activate the later upload/book/link dispatcher.

## Policy

Per company:

- `review_required` (default): prepare a proposal, display embedded review, and execute only through the verified review interaction.
- `client_managed`: permit model-callable manual-voucher execution; the AI client's own approval settings apply.
- Read-only access, when configured, overrides both and denies every mutation.

Only the authenticated installation owner can change policy through administration, not through model-callable tools. Increment a policy version and invalidate affected pending approvals when it changes. A policy change cannot retroactively authorize an old request.

Normal actions retain standard client approvals. Do not silently extend the manual-voucher rule to every action or relax it through a generic endpoint tool. Any operation that creates/changes manual-voucher accounting rows must enter the same protected domain service. Future support for editing/deleting manual vouchers needs an explicit review/validation classification before exposure.

## Embedded review contract

Show company name and stable identity, fiscal year, date, series, description, each accounting row, debit/credit totals, difference, currency, linked receipt and warnings. Batch review provides per-item selection and individual totals, not only a pooled batch balance.

The server stores a short-lived canonical proposal and hash. The model cannot set its approval state. A UI-specific commit endpoint/tool accepts a server-generated proposal reference, not replacement accounting rows. At commit, verify owner/company, proposal hash/version, policy version, expiry, one-time execution intent and current provider constraints.

Changing amount, account, date, company, attachment identity or selected set invalidates the previous review. A double click must not create two writes. A partial batch approval authorizes only selected immutable items.

## What the protocol does and does not establish

MCP Apps supports tools visible only to the app via `_meta.ui.visibility: ["app"]`. ChatGPT supports embedded views and UI tool calls. This separates model and UI capabilities in a conforming host; it is not, by itself, server-verifiable proof of a physical human click.

S00 must establish the exact supported-host trust model. Investigate UI-only metadata/capabilities and authenticated interaction binding without revealing approval capabilities to model context. Test forged ordinary tool calls, a fabricated `confirmed=true`, replay and changed proposals. A client-provided claim such as `origin=ui` or an unsigned user identity is not sufficient.

Do not claim protection against a malicious/modified host that possesses the same credentials and UI capabilities unless a separately verifiable human-presence mechanism is implemented and tested. Document that limitation plainly. The accepted product requirement is an explicit user review in supported clients, with enforceable server proposal/policy checks; it is not a universal cryptographic proof of humanness.

If the available platform cannot meet that boundary, keep `review_required` execution disabled and record the blocker. Bring any proposed product change back to the owner. Do not silently substitute an external browser approval flow, and do not default to `client_managed` to make a demo work.

## Unsupported clients and failures

Clients without the verified UI/review mechanism may read and prepare proposals. Final manual booking returns `CLIENT_UNSUPPORTED` in review mode. The owner may deliberately select client-managed mode; a tool cannot do that for them.

Expired/stale proposals require renewed preparation/review. Upstream record changes can invalidate a proposal. A timeout after submission enters `outcome_unknown` and is reconciled; the user is not asked to click the same commit repeatedly.

Acceptance evidence records client/version, protocol version, UI mechanism, server checks, host assumptions and adversarial test outcomes. See [verification gates](../reference/verification-gates.md).
