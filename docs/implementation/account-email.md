# Optional account email — 2026-11-15

Scope: the owner requested Resend for application mail, including new-account
and password-recovery messages. This extends S02/S11 account delivery without
adding public signup, multi-user management or financial/provider capabilities.
The owner's final configuration preference is disabled by default.

## Behavior and acceptance criteria

- Install the pinned MIT-licensed Resend SDK and share its Web API adapter between
  Node and Worker. No email API key or provider response reaches public state/MCP.
- Send Swedish plain-text welcome mail only after the owner bootstrap commits,
  reset codes only to the registered active owner, and password-change notices
  after successful reset. No credentials or codes appear in welcome/change mail.
- Require explicit `RESEND_ENABLED=true`, `RESEND_API_KEY` and `RESEND_FROM`.
  Disabled email performs no send and keeps operator recovery. Node supports
  file-mounted keys with conflict checks; Worker uses secrets.
- Expose a bounded same-origin reset request only when configured, without
  claiming delivery or disclosing whether an address belongs to an account.
  Retain one-time expiry, owner identity, session revocation and default-off
  behavior. Bound reset requests to three attempts per installation per hour.
- Use the fixed Resend API origin, ten-second sends and event-specific
  idempotency keys (hash reset codes in headers). Do not retry uncertain sends,
  emit provider error text or roll back completed account actions for failed mail.

The browser's reset page offers a separate code-request form and the existing
code/password redemption form. Operator-issued codes remain usable with email
disabled. This module sends no bulk marketing, invoices or bookkeeping content.
There is no durable mail queue or delivery-status webhook; a successful API
response is not proof that the recipient's inbox received the message.

## Sources

Reviewed 2026-11-15: [Resend Node SDK setup](https://resend.com/docs/send-with-nodejs),
[send API](https://resend.com/docs/api-reference/emails/send-email) and
[idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).
The installed Better Auth types/source establish the maintained issuance and
post-reset hooks. Resend's 24-hour idempotency retention is not a permanent
exactly-once guarantee.

Dependency review: `resend@6.38.1`, `standardwebhooks@1.1.1` and
`@stablelib/base64@1.0.1` use MIT. The SDK also bundles
`postal-mime@2.7.6` (MIT-0) and `fast-sha256@1.3.0` (Unlicense).
Their installed `LICENSE.txt` / `LICENSE` texts were inspected before adding
MIT-0 and Unlicense to the runtime license inventory. The build still rejects
unreviewed license identifiers and retains the original license texts for all
bundled runtime components.
The standardwebhooks archive lacks its parent MIT license; the exact published
source revision's original notice is retained with a hash-bound fallback. See
[dependency provenance](../../THIRD_PARTY_NOTICES.md#optional-resend-account-email-2026-11-15).

## Verification

Shared tests in `tests/shared/product-auth.ts` run with actual Node/SQLite and
local workerd/D1, using synthetic account data and intercepted email transport.
They cover default-off/invalid setup, active-owner delivery, same-origin checks,
strict request bodies, durable request limits, one-time redemption, session
revocation, welcome failure/replay, failed change notification and uncertain-send
redaction. They establish local behavior, not actual Resend/DNS/inbox delivery.

Final local verification used Node 24.19.0 and npm 11.9.0 from a temporary
toolchain; the host's Node 22 was not used for project checks.

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | Passed all four TypeScript projects |
| `npm run lint` | Passed |
| `npm run test:node -- tests/node/product.test.ts tests/node/product-runtime.test.ts` | 259 passed after integration with current main, including actual Node start/restart and secret-file checks |
| `npm run test:worker -- tests/worker/product.test.ts` | 255 passed after integration with current main in actual local workerd/D1 |
| `npm run build` | Passed with runtime license inventory and original notices |
| `npm run test:build` | 13 passed, including native Worker and recovery CLI checks |
| Temporary runtime-notice fixture | Original notice retained byte-for-byte; altered notice and unreviewed version rejected |
| Relative documentation links and `git diff --check` | Passed |

The focused owner contract also passed ten cases in each runtime before the full
product runs. The first sandboxed Worker attempt could not bind a loopback port;
the successful runs used local execution with loopback permission. Workerd emitted
dependency source-map and form-body text warnings; these did not fail its tests.

A temporary Playwright 1.64.1 harness exercised the built Node app on desktop and
Pixel 7 viewports. It created a synthetic owner, observed one welcome message,
requested and redeemed a reset code, observed one password-change message and
signed in with the new password. All email transport was intercepted locally.
Both viewports passed page identity, meaningful content, no framework overlay,
no console/page errors, no horizontal overflow and the complete interaction.
Screenshots were retained outside the repository. Browser plugin was unavailable;
regular Playwright used the existing cached Chromium.

Actual provider delivery has not been tested. No real email, Fortnox call,
production deployment, package publication or merge is part of this work.

## CI source-ledger follow-up

The first PR run failed three core ledger tests because the existing operation
matrices still pinned the pre-email versions of shared product runtime files.
The source diffs were reviewed: product composition adds only the optional email
adapter, the Worker entry adds its ENV types, and owner administration adds the
welcome/reset-delivery paths. These edits change no Fortnox operation mapping,
company policy, activation classification or provider/client acceptance evidence.

Seven stale hash bindings across the connection, receipt, register, sales and
analysis/payroll matrices were refreshed to the reviewed source bytes. All other
matrix fields, including operation evidence and review dates, were preserved.
The ledger assertions remain enabled; the initial failures were reproduced
locally before refreshing the hashes.

After the refresh, `npm run test:node -- tests/core` passed all 36 tests across
nine files. A complete matrix audit matched all 102 source bindings and verified
that every non-hash field was unchanged. Lint and whitespace checks passed.
