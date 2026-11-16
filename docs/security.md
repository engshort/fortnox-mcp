# Security design

## Assets and trust boundaries

Protect Fortnox secrets/tokens, owner/member/client identities, company financial/payroll data, receipt files, approval state and write-reconciliation evidence. The AI model, uploaded documents and provider free-text fields are not authorities for permission or policy.

| Threat | Required control |
| --- | --- |
| Cross-user access | Current active membership plus subject/client-specific grants; member read-only overrides writes, preparation and file ingestion; revocation fences in-flight domain checks |
| Provisioning escalation | Dedicated source credentials, explicit company ceiling, owner-only administrator delegation, one source per membership and local emergency blocks; no automatic account adoption by email |
| Cross-company access | Server authorization for every object, proposal, file, continuation and batch item; company partitioned caches and credentials |
| Approval bypass | Central policy service; no model admin tools; exact immutable proposal, expiry, replay protection and documented host trust boundary |
| Prompt injection in invoices/docs/receipts | Treat content as data; no automatic command execution or policy changes; restrict tool capabilities |
| Secret disclosure | Secret storage, encryption and redacted logs/results; never return upstream tokens or client secrets |
| SSRF/file exfiltration | Verified file-origin policy, private-network rejection, redirect limits, bounded downloads and no forwarded credentials |
| OAuth confusion | Separate MCP/Fortnox grants, issuer/audience/resource validation, state/PKCE, bound installation/subject and exact redirects |
| DNS rebinding/CSRF | Origin validation for HTTP, localhost binding for local development, authenticated POST mutations and CSRF checks in admin UI |
| Duplicate financial writes | Durable intent, concurrency control, unknown-outcome handling and reconciliation |
| Malicious dependency/spec update | Locked dependencies, provenance, reviewed diffs and license/security checks |
| Resource exhaustion | Request/file/page/time budgets, shared tenant rate limits, bounded batches and cleanup |

## Deployment protections

Production HTTP uses HTTPS and authenticated access. A public URL does not mean anonymous company access. Restrict bootstrap and admin endpoints, protect cookies and avoid putting bearer tokens in query strings. Use restrictive UI CSP and the host's supported sandbox conventions.

Disable unimplemented/unclassified write operations by default. Fortnox scopes generally include both read and write; a local read-only mode must enforce operation semantics, including GET endpoints with side effects.

Do not expose raw endpoint execution, arbitrary shell/SQL or unrestricted documentation crawling as developer assistance. Diagnostics should identify missing scope/license and connection health without disclosing secrets or fetching arbitrary user-supplied internal URLs.

## Data and recovery

Follow [retention](contracts/storage.md). Financial records stay in Fortnox; operational backups are still sensitive. Test restore without replaying pending submissions. Revoke access on disconnect and invalidate related proposals. Record minimal audit metadata sufficient to explain who/which client initiated what against which company and under which policy.

The project does not claim that its license or validation makes an installation legally compliant. Operators choose appropriate hosting and data-processing arrangements. Product documentation must describe actual data flows and retention, not copy a generic compliance promise.
