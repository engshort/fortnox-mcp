# Ordinary product activation — 2026-11-11

## Owner decision and scope

The owner requested removal of the project's activation restrictions, followed
by a pull request and squash merge after green CI. This applies to the finite
implemented capabilities in S02–S09/S11. Activation no longer depends on test
mode, exactly two sandbox companies, a separately compiled acceptance entry,
an operation lease or completion of a historical verification gate.

This decision does not assert provider/client acceptance, complete financial
coverage, production readiness, stable release approval or source redistribution
rights. Historical evidence remains historical; operation status and missing
evidence are not promoted by activation.

## Behavior

- Owner-initiated Fortnox consent verifies the returned company identity before
  storing a connection. Ordinary installations accept any authorized company;
  test tenant allowlists apply only to isolated acceptance entries.
- The ordinary Node and Worker product entries enable their implemented finite
  catalogs: company reads, accounting, registers, offers/orders/customer invoices,
  financial analysis, current receivables/payables, hourly payroll input and
  receipt staging/upload/link/retrieval. There is no arbitrary HTTP proxy.
- `PRODUCT_ENABLED`, `FORTNOX_TEST_MODE`, `FORTNOX_TEST_TENANTS`,
  `ACCOUNTING_REFERENCES_ENABLED` and `FORTNOX_RECEIPT_CONSENT` no longer disable
  the ordinary product. Legacy settings can remain on an existing installation.
  Isolated acceptance builds still use their own bounded test configuration.
- Programs request new scopes only in a fresh owner-initiated consent. Existing
  company scopes, OAuth grants, read-only settings and voucher policies are not
  widened. The owner can select write access in company administration.
- Complete, fresh provider references drive validation. Historical
  `validation_verified`/license evidence flags do not disable runtime validation.
  Unknown accounts, locked periods, dimension rules, missing wages, invalid or
  unbalanced amounts and unmodeled editable content still fail validation.
- Ordinary payroll writes use the implemented hourly code-11 profile with actual
  employee/employment and dated/current wage data. They do not require private
  acceptance hashes. Unknown wage dates, other code semantics, full payroll,
  payslips and payouts are not implemented by this change.
- Sales email uses the document's explicit recipient and ordinary client
  approval. CC/BCC restrictions, immutable intents and no-resend recovery remain.
- File input still requires a configured safe transport and reviewed HTTPS source
  origins. Node can use direct DNS-pinned input; Workers require the existing
  authenticated relay. Unsupported native Worker egress is not fabricated.

## Review trust boundary

The ordinary product enables the existing MCP Apps voucher review mechanism.
`review_required` remains the default and the model cannot approve its own
proposal. The capability is server-created, immutable-proposal/owner/client/
company/policy-bound, short-lived and consumed atomically. Model-visible
responses do not contain the UI capability. A fabricated `confirmed` argument,
changed content, policy change or replay cannot authorize a write.

The supported interaction assumes a conforming MCP Apps host separates app-only
capabilities from the model and presents the explicit user review. This is not
cryptographic proof of a physical human click, and does not protect against a
malicious host holding the same credentials and UI capabilities. Clients that
cannot render/use the review cannot execute that policy; the owner can explicitly
choose `client_managed` in administration. No automatic downgrade is introduced.

## Acceptance criteria and verification

The ordinary product must connect a third synthetic tenant with test mode off,
advertise the implemented tools without a lease, retain OAuth/company isolation,
and preserve validation, policy, immutable intents and uncertain-write recovery.
Shared Node/SQLite and workerd/D1 contracts cover the ordinary activation flow
and profile-free hourly payroll lifecycle, alongside the existing negative and
recovery scenarios. CI also exercises packaging, Docker/HTTPS and browser flows.

Local typechecking passed. A broad Windows run encountered native workerd
crashes and platform-specific filesystem/permission failures; it is not recorded
as a passing full run. Actual Fortnox writes and actual ChatGPT acceptance were
not performed in this change. PR CI is the authoritative Linux regression run.

Merge triggers the repository's existing Nova deployment workflow. No release
tag, package publication or production Fortnox test is part of this change.
