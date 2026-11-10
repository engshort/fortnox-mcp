# Nova continuous deployment

S11/M05 automation deploys the Node/Docker application to
`https://fortnox.mcp.engshort.se` on push/merge to `main`. It does not publish
a release or enable Fortnox operations. No Cloudflare Tunnel or Worker is used.

## Installation and network

Public DNS points directly to ISS. ISS forwards TCP 80/443 to Nova's existing
80/443 listeners; ISS does not need Nginx or ISPConfig. Nova's Nginx terminates
HTTPS using a renewed certificate for the exact hostname, redirects HTTP and
proxies this hostname to `172.30.77.10:13001`. Apply the reviewed settings through
persistent ISPConfig site configuration, preserving other websites. See
`deploy/nova/public-nginx.conf`. Both proxies clear forwarded authority headers,
preserve browser Origin, and disable buffering, caching, request logs and retries.
Public SSH needs a dedicated forwarded TCP port to Nova's SSH server.

The installation root is
`/var/www/clients/client17/web1194/private/fortnox-mcp` (ISPConfig client17/web1194).
An ISPConfig panel login is distinct from a Linux deployment identity. The
operator uses the authorized `kollino-alex-dev` ACLs, preserving website ownership
and the earlier separate test installation. This path is outside the document root.

Copy `deploy/nova/compose.yaml`, `nginx.conf` and built `dist/nova-deploy.mjs`
into the installation root. Initialize an empty `.private` directory using the
existing image initializer and the public HTTPS origin. Retain its secrets and
the named `fortnox-mcp-nova-data` volume across releases. No application port is
published. The private proxy permits only the documented ISS/WireGuard addresses.
Retrieve the one-time bootstrap code privately; never send it to CI.

The initializer explicitly sets mounted secret files to 0444 after creation:
restrictive operator umasks and ISPConfig default ACLs must not prevent UID 10001
from reading the individual read-only mounts. Their host parent remains 0700.
Likewise ensure the dedicated SSH private key is exactly 0600 after creation.

Install a dedicated Ed25519 deploy key with this authorized_keys restriction,
substituting absolute root and Node paths:

```text
restrict,command="/usr/bin/flock -n /absolute/root/.deploy.lock /absolute/node /absolute/root/nova-deploy.mjs /absolute/root" ssh-ed25519 PUBLIC_KEY
```

It permits only `deploy <40-hex revision> <64-hex archive digest>` and
`status <40-hex revision>`. Shell, SFTP, PTY and forwarding are unavailable.
Rotate/revoke this authorized_keys entry and its GitHub secret together.

## GitHub environment and workflow

Environment `nova-production` permits only `main`, with no manual review gate.
Secrets: `NOVA_DEPLOY_KEY`, `NOVA_KNOWN_HOSTS` (independently read on Nova; no blind
ssh-keyscan). Variables: `NOVA_DEPLOY_HOST`, `NOVA_DEPLOY_PORT`, `NOVA_DEPLOY_USER`.
Runtime requires no PAT, deploy App or registry credential; `GITHUB_TOKEN` is
read-only. PRs and other branches cannot deploy.

`Deploy Nova` runs on main pushes and manual main dispatches. It serializes
deployments without cancelling active upgrades, runs root checks and synthetic
Docker/HTTPS acceptance, builds the exact commit, and sends a hashed compressed
image via pinned-host SSH. Superseded main revisions are refused before deploy.

The receiver checks checksum, 1 GiB limit and OCI revision before stopping the
application. It retains the previous image, stops/drains requests, and uses the
existing offline `upgrade` command with encrypted pre-migration backup. After
readiness it updates the public revision header and minimal deployment metadata.
Public smoke checks health/revision, setup, OAuth issuer, HTTP redirect and
unauthenticated admin/MCP denial. It makes no Fortnox calls. Failure keeps CI red.

## Recovery and evidence

An interrupted deployment leaves `.private/pending.json` and blocks a new deploy.
Inspect image, database, keys and encrypted backup privately. Never start old
code against a migrated database automatically. Follow
[offline recovery](deployment-linux.md#backup-restore-keys-and-upgrade) with
matching code/keys and restore reconciliation safeguards as needed. Remove pending
metadata only after verified operator recovery. Do not resend uncertain writes.

Retain previous images and encrypted backups until acceptance; manage retention
privately and monitor the existing 64 MiB snapshot limit. Cleanup targets only
this installation, without global prune or volume deletion. Receiver/proxy updates
are explicit operator actions from reviewed source.

Record workflow URL, exact commit and public smoke result. Deploy acceptance does
not establish Fortnox or actual ChatGPT business acceptance.
