# S11 — Setup wizard and deployment

Status: first infrastructure slice implemented, with one hosted installation verified in an existing account on 2026-10-18; fresh-account onboarding and lifecycle acceptance remain pending. The protected wizard depends on S02/S03; final workflow acceptance depends on S06/S07. See [the first Cloudflare slice](S11-cloudflare-first-installation.md) and [evidence](S11-cloudflare-evidence.md).

## Deliver

Implement the small owner wizard from [deployment](../deployment.md): bootstrap/login, own Fortnox credentials, company consent/status, policy settings and tested ChatGPT connection instructions. Add Swedish/English UI and documentation. Admin configuration is not exposed as model tools.

Package Node/Docker and Worker deployments with persistent operational storage, secure secret configuration, private temporary files and cleanup. Provide backup/restore, disconnect, credential rotation and upgrade steps. The owner requested an active first-test Cloudflare button from initial publication, with explicit capability and pending-verification status. Verify and record the independent-installation path before claiming it is supported.



### Protected web application baseline (D22)

For subsequent S11/M18 setup/admin UI work, introduce Hono incrementally as the shared product HTTP router and use React + Vite for interactive owner-only administration. Serve built assets on the installation origin in both Worker and Node runtimes. Keep the public GitHub Pages site static. Do not replace the existing status page or MCP Apps review view without equivalent tests and actual host/CSP/review evidence. See [D22](../decisions.md#d22--web-application-framework-proposed-2026-11-06).

## Acceptance

A new owner can follow the guide in a clean environment, connect two test companies and run read/review/file scenarios. Test restarting during pending approval and unknown write without losing recovery state. Prove parity for financial policies across runtimes.

Before a new frontend replaces existing flows, verify same-origin session and CSRF behavior, company/policy isolation, OAuth callbacks, keyboard accessibility, Swedish/English UI, asset serving and packaging in both runtimes. Embedded review requires its separate G02 client/CSP/replay evidence; an admin UI smoke test does not satisfy it.

Record resource measurements, current hosting constraints and when a paid plan/Node deployment is needed. Do not promise free unlimited hosting or direct ChatGPT access to a local stdio process.

## Handoff

Replace planned setup instructions with actual versioned commands and screenshots only after testing. Remove stale placeholders and preserve an explicit capability/status section.
