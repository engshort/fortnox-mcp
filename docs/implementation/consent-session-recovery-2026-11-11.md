# Browser-session consent recovery — 2026-11-11

Scope: #127 and the connection/concurrency requirements in #117/#58.

## Actual observation

At application revision `99238b710090a2f5d36f19f9045e3be97ffa07ab`, an AI
operator started an invoicing extension for sandbox A, then completed a separate
invoicing extension for sandbox B in another tab of the same browser session.
Returning to the first tab and selecting A led to the Fortnox lobby without
successful program completion in the owner application. A remained pending,
with its existing bookkeeping access preserved and invoicing absent; B retained
its distinct invoicing selection. No mixed-company access or financial write
was observed. An independent AI reviewer inspected the original browser
observations and confirmed the incomplete continuation and preserved isolation.

The root cause of the upstream continuation interaction is undetermined. Browser
state does not prove that every intermediate callback request was absent. This
record does not claim a provider security defect or successful concurrent flow.
Raw snapshots, timing and provider identities remain private.

## Resulting behavior

The durable consent reservation now permits one unexpired flow per authenticated
admin session. Competing tabs receive `CONSENT_IN_PROGRESS` before a second
provider redirect. The owner UI explains how to complete or cancel the existing
flow in Operations before starting fresh. Add-company, program extension and
reconnect use the same common provider-consent reservation.

Independent sessions retain the owner-wide four-flow bound. Expiry removes old
reservations; explicit cancellation removes only unclaimed flows of the current
owner/session. An exchange already claimed cannot be replaced through cancel.
Company identity, PKCE/state, generation/policy checks and atomic credential
replacement remain unchanged.

If the process crashes after claiming an exchange, that session can remain
blocked until the existing ten-minute flow expiry. Cancellation deliberately
cannot remove a claimed exchange. Deploying this change does not invalidate old
flows; actual retesting must first explicitly cancel unclaimed pending flows.

## Verification

Shared Node/SQLite and workerd/D1 contracts cover competing same-session starts,
independent sessions/owners, cancellation/fresh start, expiry, the four-flow
limit, claimed-flow protection and structured authenticated HTTP errors. The
stale simultaneous-change case uses separate sessions and retains its generation
conflict assertion. The owner browser harness checks the actionable message
without navigating away from the selected company.

Observed local checks on Windows:

- All four project TypeScript configurations passed using the installed compiler
  directly; this host has no `npm` launcher on PATH.
- The focused Node/SQLite consent/program suite passed 24 cases.
- The production build completed, and Biome passed for all eight changed
  TypeScript/React files.
- The local Worker attempt ran zero tests: workerd crashed during startup with
  an access violation/stack overflow. It is not recorded as a Worker pass.
- A full Windows lint attempt reported line-ending errors outside the changed
  files; no unrelated source was reformatted. Linux CI remains required.
- Whitespace and 59 relative documentation file targets passed.

The independent AI code review found no blocking risk. Full CI, actual hosted
recovery and its independent evidence review remain pending at this checkpoint.
Synthetic tests do not establish actual post-deployment recovery.
