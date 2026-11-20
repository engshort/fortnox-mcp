# Office contacts v1

Version: `office-contacts-v1`. Optional, default off. This contract adds a narrow
contact projection to `/api/v1`; it does not establish live provider acceptance.

## Registration, company consent and renewal

Enable `REST_API_ENABLED`, `INSTALLATION_ACCESS_ENABLED`, the existing finance
client's `REST_BRIDGE_ENABLED` prerequisite, and `OFFICE_CONTACTS_ENABLED=true`.
The contacts routes themselves never execute through the reviewed REST bridge.
Use the existing owner-approved confidential finance backend registration and its
`client_secret_basic` client-credentials exchange at `/auth/oauth2/token`, with
`resource=<PUBLIC_ORIGIN>/api/v1` and
`scope=api:read api:office:contacts:read`. Tokens last five minutes and have no
refresh token. Existing OAuth offline clients and provider-token renewal retain
their existing rules. No employee/owner session is transferred to the backend.

The installation owner explicitly approves each company/source under
`/admin/integrations`. The existing management endpoint
`POST /admin/integrations/data` accepts:

```json
{
  "action": "change",
  "id": "<installation-grant-UUID>",
  "expected_revision": 1,
  "office_contacts": [
    {"company_id": "<company-UUID>", "sources": ["customer-register"]}
  ]
}
```

`office_contacts` replaces the entire contact selection. An empty array revokes
all contact access. `allow_writes` remains independent and may be omitted on a
contact-only change. The server records each selected connection's generation
and access revision. Updates advance the installation revision and fence older
tokens; acquire a new token after saving. Old installations, clients, tokens and
company connections receive no contact authority implicitly. New/reconnected or
access-revised companies require fresh explicit contact consent. Revocation and
rotation retain existing installation lifecycle and restore protections.

Use `company-onboarding-v1` separately for the bureau company. Its MCP registration
and token remain distinct from the finance API registration. Verify the exact
returned company UUID using `GET /api/v1/companies/{company_id}/profile` with an
authorized API token. Customer-register reads use the bureau company UUID;
payroll and integration-user reads use the relevant customer's UUID. Office owns
the customer/bureau association; this API never guesses or redirects it.

Enable missing customer/payroll programs and provider scopes through the existing
protected program/connection extension flow. Changing backend consent does not
request provider scopes or activate unrelated capabilities.

## Requests and responses

Only authenticated GET requests are supported. Every route requires `api:read`,
`api:office:contacts:read`, an active installation registration, and current
company/source consent. Unknown or duplicate query parameters fail with 400.
No caller-selected tenant, integration, provider URL or method is accepted.

Paths relative to `/api/v1/companies/{company_id}/office-contacts`:

| Path | Source and mapping |
| --- | --- |
| `/customer-register?organisation_number=<10 digits>` | `GET /3/customers`, scope `customer`; exact normalized `OrganisationNumber`, then verified `GET /3/customers/{CustomerNumber}`. `id=CustomerNumber`, `name=YourReference`, `email=Email`. |
| `/payroll?continuation=<optional opaque UUID>` | `GET /3/employees`, scope `salary`; only `Inactive=false`. `id=EmployeeId`, `name=FullName` or joined `FirstName`/`LastName`, `email=Email`. |
| `/integration-users?continuation=<optional opaque UUID>` | Developer API users-v1 for the server-bound published integration and verified customer tenant. `id=externalSourceId`, `name=name`, `email=email`. |

```json
{
  "status": "ok",
  "company_id": "<UUID>",
  "data": {"records": [{"id": "...", "name": "...", "email": null}]},
  "evidence": {"complete": true},
  "continuation": null
}
```

`name` is nonempty. Missing/blank email becomes null. No invoice reference,
invoice email/address, customer/company name, personal identifier, salary amount,
bank field or administrator role is returned as a fallback or extra field.

Customer searches inspect every filtered page before establishing uniqueness.
Normalization removes whitespace and hyphens and then requires exactly ten
digits; country prefixes and twelve-digit identifiers are not guessed. No exact
match, a unique inactive customer, or a unique active customer with empty
`YourReference` returns a complete empty list. Multiple distinct exact customer
numbers are ambiguous, including inactive duplicates. A detail identity mismatch
fails. The search budget is five pages/500 rows and fifteen seconds; exceeding it
never returns an apparently unique match. This route has no continuation input.

Payroll returns at most one provider page of 100 rows per request, after active
filtering. An empty page can still have `complete=false` and a continuation.
Unknown active status or a missing active employee name fails the source.

A continuation is valid for ten minutes, binds owner, stable OAuth client,
installation revision, resource, company, connection/access revisions and source,
and survives application recreation. At most 32 live contact continuations per
owner are retained. Storage contains only paging metadata, not contact payloads
or source responses; scheduled cleanup removes expired entries. Every page checks
current authorization. The final page marks traversal completion, not an atomic
snapshot. Missing or contradictory provider pagination is never complete.

## Developer API binding

Fortnox documents users-v1 for active users of a published integration purchased
through Fortnox, requiring `developerapi`; it is not a company-wide user directory.
See [Fortnox Users](https://api.fortnox.se/apidocs#tag/Users).

An operator verifies the published integration/client association in the provider
portal and configures private `OFFICE_CONTACTS_DEVELOPER_BINDING` JSON:

```json
{
  "company_id": "<verified-developer-company-connection-UUID>",
  "generation": 1,
  "provider_client_id": "<verified-published-integration-client-id>",
  "integration_id": "<published-positive-numeric-integration-id>"
}
```

The developer connection must be active, hold `developerapi`, and use that provider
client. The target customer connection must use the same verified provider client.
The adapter derives the target tenant from its authorized connection and calls
only `GET /api/integration-developer/users/users-v1/{integrationId}/{tenantId}`.
It rechecks both connections before/after I/O and uses the developer connection's
existing encrypted credentials and renewal. No specialist credentials are exposed
to Office. Missing configuration, mismatched registration/generation, denied or
missing source returns `OFFICE_CONTACTS_SOURCE_UNAVAILABLE`.

The documented endpoint returns one array with no pagination parameters. The
bounded adapter returns it completely (maximum 1000 records and existing 256-KiB
transport limit) or fails; it never truncates or invents a next-page mechanism.
An arbitrary continuation is rejected. A successful empty array is complete only
after the verified provider request succeeds.

## Errors and privacy

Use the existing REST error envelope:
`{status:"error",error:{code,reason,provider_code,correlation_id}}`.
No provider body, parser message or credential is returned. Responses are
`Cache-Control: no-store`. Raw payroll responses and contacts are never persisted
or logged. Request URLs containing organization numbers must also be excluded
from deployment access logs.

| HTTP | Stable code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Invalid UUID, query or organization-number input |
| 400 | `OFFICE_CONTACTS_INVALID_CONTINUATION` | Expired, unknown or incorrectly bound continuation |
| 401 | `AUTH_REQUIRED` | Invalid/expired/revoked token or installation revision |
| 403 | `CAPABILITY_UNAVAILABLE` | Missing contact scope or non-Office principal |
| 403 | `COMPANY_FORBIDDEN` | Company/connection identity denied |
| 403 | `OFFICE_CONTACTS_CONSENT_REQUIRED` | Missing or stale company/source consent |
| 403 | `OFFICE_CONTACTS_SOURCE_UNAVAILABLE` | Missing program/scope, denied source or unavailable developer binding |
| 409 | `OFFICE_CONTACTS_AMBIGUOUS_CUSTOMER` | Multiple exact customer numbers |
| 409 | `RECONNECT_REQUIRED`, `CONNECTION_DISCONNECTED` | Existing connection recovery needed |
| 429 | `RATE_LIMITED` | Existing shared provider/read budget exhausted |
| 502 | `OFFICE_CONTACTS_INVALID_RESPONSE` | Invalid contact projection or pagination |
| 502 | `UPSTREAM_UNAVAILABLE` | Temporary/network/malformed provider response |
| 503 | `OFFICE_CONTACTS_INCOMPLETE` | Search budget exhausted or completeness cannot be established |

An upstream 403 cannot distinguish missing license, scope or user permission;
`SOURCE_UNAVAILABLE` must not be displayed as a proven missing-license diagnosis.
Successful source requests establish current readability, not future license
availability. Neither source access nor OAuth scopes confer payroll write access
through this API. No contact operation is an MCP tool or generic bridge operation.

## Shared consumer contract check

Run `npm run test:office-contacts:contract` with
`OFFICE_CONTACTS_CONTRACT_CONFIG=/absolute/private/file.json`. The file must have
no group/other permission bits (for example mode 0600) and contain:

```json
{
  "origin": "https://installation.example.invalid",
  "access_token": "<current-contact-scoped-API-token>",
  "bureau_company_id": "<bureau-UUID>",
  "customer_company_id": "<customer-UUID>",
  "organisation_number": "<customer-10-digits>",
  "allow_integration_users_unavailable": true
}
```

Use only authorized sandbox companies for acceptance. Obtain the token immediately
before testing. The check validates company binding, strict contact-only envelopes,
no-store, completeness and continuation traversal. Customer and payroll sources
must succeed; the specifically documented unavailable integration-user source is
reported separately when allowed. Output contains only source/outcome/page/record
counts, never contacts or identifiers. Record both repositories' exact revisions,
runtime/provider, and independent reviewer assessment alongside the result.
The same check runs against synthetic product HTTP routes in both runtime suites;
that does not establish a cross-repository or live-provider pass.
