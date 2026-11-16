# S02 — Owner, authorization and companies

Original baseline status: not started. See [M02 evidence](M02-connections-evidence.md) for delivered owner/company behavior. The owner-authorized [2026-11-16 team extension](team-access.md) implements optional administrators, members and generic provisioning with local acceptance; it does not promote remaining provider/client gates.

## Deliver

Implement secure owner bootstrap/admin sessions, MCP authorization, encrypted Fortnox connection storage and provider consent flows from [authentication](../contracts/authentication.md). Support multiple companies and stable owner-bound company handles. Implement disconnect/reconnect, scope/license status, read-only and manual-voucher policies with versioning.

Use client credentials for consented service accounts and a rotating refresh-token path for user accounts. Keep grants, tenant identity and token sources separate. Add company listing/profile/status tools with no secret fields.

## Acceptance

Test T01/T02/T08: wrong company, wrong audience, forged identity/state, expired code, replay, concurrent refresh and revocation. One company cannot reuse another's file/proposal/status handles. The model's token cannot call admin policy or secret operations. Verify company identity through authenticated provider responses.

In the authorized test company, connect/reconnect and report missing permissions accurately. Record that service-account admin status does not establish a human principal.

## Handoff

Provide connection fixtures, actual setup instructions and a clear grant/connection schema. No accounting write tools are enabled by this scope.
