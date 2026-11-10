# S04 — Registers and reference data

Status: the [bounded register implementation](S04-register-evidence.md) adds
customer/supplier/service-article maintenance and ten reference collections,
disabled in ordinary installations. Actual acceptance remains pending.
[Milestone 3](M03-accounting-evidence.md) accounting references retain their
existing gates and open provider evidence in #92. Depends on S03.

## Deliver

Read and supported common maintenance of customers, suppliers and articles; retrieve required terms, currencies, units, cost centers, projects, price references and other dependencies of stable workflows. Use resource-specific schemas and actual provider constraints.

Resolve references within company context and expose useful search/filter/pagination. Distinguish an absent record from inaccessible data or an unsupported filter. Do not create missing accounts/reference records automatically to satisfy another write.

## Acceptance

Verify create/read/update flows in the test company for enabled writable registers. Cover required fields, inactive references, unsupported values, cross-company identifiers, duplicate intent and partial page results. Ensure customer/supplier search output does not leak unrelated data.

Update the operation ledger, source overlays and bilingual examples. Only verified operations become advertised capabilities.

## Handoff

Provide reusable authorized reference resolvers for document/accounting scopes. Do not implement global mutable current-company selection.
