# S04/S05 business write foundation

Scope: the shared authorization and durable write-intent part of #21/#22.
No provider operation or model-callable business tool is enabled by this slice.

`BusinessWrites` accepts only server-registered operations. Preparation validates
resource-specific input and seals a bounded immutable body, baseline and preview.
The binding includes owner, company, operation, client, generation, policy and
content hash. Execution revalidates current source state and authorization before
atomically consuming the proposal, then checks authorization again at dispatch.
Normal client approvals apply; this mechanism grants no manual-voucher approval.

A concurrent or repeated execution cannot dispatch the same proposal twice.
An interrupted submission or lost response remains `outcome_unknown`, including
when the process restarts or the final state write fails. No automatic resend or
exactly-once guarantee is provided. Subsequent resource-specific reconciliation
must establish exact provider identity before resolving an uncertain outcome.
Until then, new business proposals/executions in the company are blocked;
the original execution remains readable without another dispatch. This
conservative company-wide block also prevents a new proposal bypassing uncertainty.

Four pending proposals (15-minute lifetime, 16 KiB decoded body each) and 32
execution records per company share the existing bounded connection snapshot.
Capacity exhaustion rejects work rather than evicting unresolved executions.
Terminal metadata expires after 30 days; unknown/submitting records survive.
Payloads remain encrypted and are removed on consumption, expiry, disconnect,
policy change and restore. Key rotation includes every pending business body.
Restore marks in-flight executions unknown and preserves the existing shared
write block. No SQL schema migration is needed for the optional snapshot field.

Shared Node/SQLite and local workerd/D1 tests cover authorization, current scopes,
expiry, restore block,
concurrent/repeated dispatch, lost response and service recreation, changed
source state, policy change, disconnect and new-key-only proposal execution.
SQLite reopen and actual workerd/D1 restart retain unknown business intents.
Encrypted backup/restore tests discard proposals, retain successful references,
convert interrupted claims to unknown and enforce the shared restore block.
Actual provider and client acceptance remains separate.

Local verification (2026-11-10): `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build` and `npm run test:build` passed. The initial full
run contained 206 Node and 151 workerd tests; the expanded restart/restore
cases were then rerun in the three affected Node suites (74 passing tests).
The final eight business-intent cases were run in both adapters after adding
expiry, current-scope and cleanup coverage. CI and Docker evidence belong to
the PR's immutable head; none of these synthetic checks is live acceptance.

This is an implementation record, not completion of S04/S05 or G06/G08.
