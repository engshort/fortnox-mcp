# Milestone 5 delivery and acceptance

Baseline: `5a49f8e425aa3060f1b85db2169460e7b5e14672`, 2026-11-08.
Owner-approved delivery target: one Node application, Docker Compose, SQLite
and an existing host Nginx. Systemd and APT are documentation-only future work.
Worker domain/storage regressions remain required; no new hosted Worker claim.

## 1. Node runtime (#72, #74)

The existing product entry accepts `HOST`, `DATA_DIR` and `NODE_PROXY_MODE`.
Local defaults remain loopback/8787/`.data`; `PRODUCT_DATABASE` overrides the
default database location. Secret `_FILE` inputs fail closed on missing files,
oversized files or conflicting inline values. They are not printed.

The Node-only Nginx adapter requires the exact configured authority and a single
`https` forwarded protocol. It preserves the actual browser Origin. Enable it
only behind the documented loopback-published proxy boundary. It must not be
used to trust arbitrary Internet-supplied forwarding headers.

Migrations are shared with the existing SQLite/D1 schema. SIGTERM stops new
requests, drains HTTP connections and closes SQLite. A 30-second deadline exits
unsuccessfully rather than claiming pending external writes have failed safely.
Existing durable claims remain subject to reconciliation after restart.

Verification on Node 24.19.0/npm 11.17.0: root typecheck and four focused runtime
cases passed. The actual Node process was bootstrapped through synthetic proxy
headers; foreign Origin was denied, the cookie was Secure, and the same owner
session survived SIGTERM/restart while bootstrap replay remained denied.
No Fortnox or actual client request occurred. Full aggregate checks and image
acceptance are recorded with the later delivery parts.

## 2. Docker and Nginx (#72, #77, #78)

Multi-stage packaging, non-root UID, private named-volume state, file-mounted
secrets, bounded logs/resources and an Nginx example are implemented. Docker
builds accept an explicit source revision without including Git metadata.
The dedicated CI builds the image and verifies real synthetic HTTPS/proxy,
bootstrap, OAuth metadata, private MCP denial, SIGTERM and persistent recreation.

The local Docker client is installed, but the current OS identity cannot access
the daemon even outside the execution sandbox. No local Docker image/Compose run
is claimed. The initializer's private-file/non-overwrite behavior is tested
separately in Node. CI and actual operator-host evidence must be recorded.

The first supported platform target is Linux amd64. Systemd and APT remain
documentation only in the [Linux deployment guide](../deployment-linux.md).

## Acceptance tracking

Implementation and actual acceptance are separate. Do not close #42/#77/#78 or
broader parent gates from these runtime checks. Writes, review-host acceptance
and provider-file operations retain their existing gates. No image, release
or package has been published.

## 3. Protected owner setup (#72)

Hono composes existing Fetch/domain handlers; React/Vite assets are served from
this installation. Owner-only status and write-only credential configuration reuse
Better Auth and the vault. ENV values remain operator-managed. Company policies,
disconnect/reconnect and unknown-reference investigation reuse existing services.
The UI supports Swedish/English, bootstrap, login, reset, connection setup,
ChatGPT guidance and current capability status. All financial/provider-file gates
remain unchanged. Optional Worker assets preserve the portable route contract;
Docker/Node is the installation target.

Synthetic Node authorization/connection suite: 55 passed. Desktop and Pixel 7
Chromium: bootstrap, credential persistence without readback, disabled connection
without allowlist, language switching, logout/login and overflow checks passed.
Browser plugin was unavailable, so the existing Playwright installation was used.
Visual QA at 1487×1058 and mobile compares the generated reference with actual
screenshots: header/navigation copy, two-column layout, type scale, white/petrol/
gold palette, field/button spacing and stacked mobile layout. Functional copy
adds the required allowlist restriction, new-consent explanation and accessible
connection-type legend; callback text reflects the real installation origin.
The reference is a design aid, not a shipped image or a product support claim.

Workerd parity suite: 55 passed. Docker CI run
[42517870927](https://github.com/engshort/fortnox-mcp/actions/runs/42517870927)
passed the real image + Nginx HTTPS smoke test on 2026-11-08; the current local
Docker permission limitation does not prevent isolated CI verification.
