# Milestone 2 implementation and acceptance

This record separates executable product integration from actual hosted/client/provider acceptance. All fixtures are synthetic. No financial write is enabled. G01 #31 remains closed within its owner-accepted scope; product acceptance is separate. G05 #35 and full G06 #36 remain separate.

## M01 — owner bootstrap (#55)

The product admin handler claims an expiring operator-provisioned bootstrap using a durable CAS. Only the winning request invokes Better Auth signup; restart never reopens bootstrap. Public signup is not forwarded. A failure after claiming requires operator investigation of the existing account before recovery, never deletion/reseeding of the owner.

Better Auth 1.7.10 manages password hashing, cookies, sessions and ten-minute single-use password resets. Installation-wide durable login budgets supplement its database-backed rate limiter. Admin sessions expire after 24 hours, are not cookie-cached and are revoked by password reset. MCP bearer tokens cannot authenticate admin requests.

Run root `npm run typecheck`, `npm run lint`, `npm test`. The shared owner contract runs in Node/SQLite and local workerd/D1: concurrent bootstrap, replay, expiry, origins, password login, recreated handler, logout and operator reset. Hosted deployment, browser accessibility and actual owner lifecycle are not established by these tests.

The operator command reads an ignored private JSON file, never credential arguments. Migrations must be applied first. `bootstrap` provisions only an empty installation; `reset` verifies the existing owner's email and writes the library-issued token privately. The command operates on local SQLite; D1 provisioning uses a reviewed, private conditional insert as described in the user guide. Never copy the probe's owner/grants into the product installation.

Observed M01 checks (2026-11-06): root typecheck passed; three shared owner cases passed on Node/SQLite and three on local workerd/D1. Miniflare required loopback access outside the filesystem/network sandbox. Hosted acceptance was not run.
