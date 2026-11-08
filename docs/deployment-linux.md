# Linux deployment: Docker first

The owner [accepted the delivered MVP and authorized a bounded prerelease](implementation/M05-release-authorization-2026-11-09.md)
on 2026-11-09. Release source is version-tagged; build the Docker image locally
using the commands below. Remaining actual test cases and operation gates are
documented separately from owner acceptance.

Milestone 5 delivers a single Node application behind the operator's existing
Nginx. There is no second Docker-specific MCP implementation. The image starts
`dist/product-node.js`, uses SQLite and carries the reviewed SQL migrations.
Actual Docker/client/provider acceptance is tracked in [M05 evidence](implementation/M05-delivery.md).

## Installation

Prerequisites: Linux amd64, Docker Engine/Compose, Git, a public HTTPS domain,
and an existing Nginx/certificate managed by the operator. No model API key.
Start from a reviewed clean Git revision. From the repository root:

```sh
export SOURCE_COMMIT=$(git rev-parse HEAD)
docker build -f deploy/docker/Dockerfile --build-arg SOURCE_COMMIT="$SOURCE_COMMIT" -t fortnox-mcp:local .
mkdir -m 700 deploy/docker/.private
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/deploy/docker/.private:/output" fortnox-mcp:local node /app/initialize.mjs /output https://your-domain.example
docker compose -f deploy/docker/compose.yaml up -d --no-build
```

The initializer requires an empty private directory and never replaces existing
secrets. Its files are readable through read-only Compose secret mounts by the
dedicated application UID 10001. The host parent directory must remain 0700;
never copy its contents into the build context, support bundles or Git.

Replace the domain/certificate paths in `deploy/nginx/fortnox-mcp.conf`, validate
with `nginx -t`, then apply it using the existing host's administration procedure.
The application port is published only on 127.0.0.1:3000. Do not expose it through
another port binding or reuse proxy mode on an untrusted direct endpoint.
The template disables request-bearing access/error logs and retries; application
diagnostics are separate. Docker logs use bounded size rotation, not a guaranteed
time-based retention period.

Open `/setup`. Retrieve the one-time bootstrap code privately using Compose cp
from `/data/bootstrap-code.txt`; remove the local copy after redemption. Never
paste it into ChatGPT, a public issue or a shell command argument. The code
expires after ten minutes; the existing owner cannot be replaced by restart.

The default installation enables owner setup only. Provider operations require
their separately verified test-company configuration and acceptance gates.

## Process and data contracts

`HOST`, `PORT` and `DATA_DIR` configure the process; `PRODUCT_DATABASE` can
override the default database. Compose uses `/data/product.sqlite`. The named
volume survives container recreation. Do not run `down --volumes` on real state.
Keep independent protected copies of the encryption/backup keys.

The application runs as non-root with read-only root filesystem, bounded temporary
space and a 35-second container stop grace. The Node process drains requests
before closing SQLite, with a 30-second hard deadline. Forced interruption leaves
durable submission claims for reconciliation; it never makes a write safe to retry.

The image healthcheck calls `/health` with the configured public authority.
It does not access Fortnox. Missing configuration/migrations keep readiness failed.

## Verification

`node scripts/docker-smoke.mjs` builds a unique test image, initializes synthetic
configuration and runs the actual Compose/Nginx/HTTPS chain. It verifies bootstrap,
foreign-Origin rejection, Secure cookies, OAuth metadata, private MCP denial,
SIGTERM and recreation with the same volume. Cleanup targets only its randomly
named test project, volume, Nginx container and image. No Fortnox is contacted.
The M05 Docker CI runs this command without project secrets. Read its exact-head
result before claiming image acceptance.

## Future step 3: Node with systemd (not implemented)

Use the same `dist/product-node.js`, migrations, admin assets, configuration and
Nginx boundary. Future delivery must install a compatible Node runtime, dedicated
system user, private state/key directories, an EnvironmentFile, service lifecycle
and upgrades. Test the same MCP/OAuth/file/recovery behavior. No service file,
installer or systemd support claim is delivered in milestone 5.

## Future step 4: APT (not implemented)

Future work includes Debian metadata and dependency policy, package/service
installation and removal semantics, migration-safe upgrades, signing-key custody
and rotation, signed repository publication and reproducible package evidence.
Systemd support alone is not a .deb package. No .deb, maintainer scripts or APT
repository is created or published here.

## Protected owner setup

Open `/setup` with the privately issued bootstrap code, create the single owner,
and subsequently use `/sign-in`. Never send bootstrap/reset codes or passwords
to ChatGPT. The Fortnox tab accepts your own write-only Client ID/Secret; encrypted
saved values are never returned. ENV credentials are operator-managed. Register
the displayed callback in your integration. Connecting requires exactly two
operator-allowlisted authorized test tenants, then explicit Fortnox consent.
The Companies tab manages read-only/review policy, disconnect and reconnect.
Policy changes never activate a capability or approve a voucher. New companies
require fresh client consent. ChatGPT and Status tabs show installation guidance
and current gates. Switch Swedish/English in the header. No model API key is needed.

## Backup, restore, keys and upgrade

Use maintenance downtime for all commands. Stop `fortnox-mcp` with Compose; each
command also takes the same Linux flock as the runtime, so a running app causes
refusal. Commands run as the same non-root image user and mount the same state
and secrets. Example (from the repository root):

```sh
docker compose -f deploy/docker/compose.yaml stop fortnox-mcp
docker compose -f deploy/docker/compose.yaml run --rm --no-deps -e MAINTENANCE_MODE=true fortnox-mcp node /app/dist/product-ops.js backup /data/operator-backup.enc
docker compose -f deploy/docker/compose.yaml cp fortnox-mcp:/data/operator-backup.enc ./private-backups/operator-backup.enc
```

Create the host backup directory privately (0700); keep exported backup files
0600 and store backup/encryption keys independently. Remove the volume copy after
verifying the protected exported copy. Backup snapshots are bounded to 64 MiB;
monitor state size before reaching this limit. Backups are not plaintext SQLite.
Do not pass keys in CLI arguments. `BACKUP_KEY_FILE` supplies the encryption key.

Restore: stop the app, copy an encrypted backup into the mounted `/data` directory
using the stopped service's Compose cp, then run the same operator invocation with
`restore /data/operator-backup.enc`. Preserve an encrypted backup of current state
first. The candidate is authenticated/migrated before replacement. Restart with
`up -d --no-build`. All old sessions/grants/review capabilities are invalidated;
log in again, reconnect the test companies and obtain fresh client consent.
Unknown results remain unknown and are never automatically resent.

`restore-status` reports only an opaque restore ID, the blocked UTC-millisecond
interval and reconciliation status. Review the entire missing interval against
Fortnox and independently retained execution evidence. Supply a private JSON file
with exactly `restore_id`, `from`, `to` and `evidence_sha256` (SHA-256 of your private
reconciliation record) to `reconcile-restore /data/reconciliation.json` while
stopped. Do not attest until all potentially omitted writes in that interval have
been accounted for. This clears the interval block only; unresolved operations
and acceptance gates remain independently enforced. No model tool can attest.

For credential rotation, stop the service, back up, privately add a fresh 32-byte
base64 key to `credential-keys.json`, retain the old key and set
`CREDENTIAL_ACTIVE_KEY` to the new ID. Run `rotate-keys`. Connections, proposals,
owner credentials and encrypted receipt chunks are migrated transactionally.
Validate using only the new active key before removing old keys from this
installation. Keep old keys offline for retained backups. Rotate `AUTH_SECRET`
through the private secret file during downtime; previously issued browser cookies
become invalid. Restore always revokes persisted MCP grants separately.
Rotate `BACKUP_KEY` by generating a new private 32-byte key and making a fresh
backup; retain the old key separately for old backups.

For upgrade, retain the current image revision, stop the service and select the
reviewed new image via `FORTNOX_MCP_IMAGE`. Run `upgrade /data/pre-upgrade.enc` in
that image: it makes a protected backup before applying versioned migrations.
Start and check health, owner login, connection status and pending/unknown
operations. Do not downgrade a migrated DB by starting an old image; recover via
the backed-up version with its matching code/keys and the same restore safeguards.
`cleanup` removes expired temporary files/proposals/flows and bounded resolved
history; pending or unknown financial execution history remains protected.

If bootstrap expired before claiming the owner, use `bootstrap-code
/data/new-bootstrap-code.txt` during downtime and privately retrieve that new
file. An active/claiming owner cannot be replaced. For a lost owner password,
`reset-owner /data/new-reset-code.txt` issues the maintained auth library's private
ten-minute reset code for that same owner. Redeem via `/reset-password`, then
remove the private code copy. Neither command prints the code or owner identity.

Removal: stop the service and remove only its Compose containers. Export/verify
required private backups first. Remove its named data volume only when deliberately
erasing that installation, then remove its Nginx site, private secrets and backup
copies according to your retention decision. Do not use global Docker prune.

## Prepare a reviewable prerelease candidate

From a clean reviewed commit, install locked dependencies and run the documented
checks/build. Run `node scripts/prepare-release.mjs 0.1.0-mvp.5.0
/tmp/fortnox-m5-candidate` with a new output directory. It creates source, runtime
SBOM, original dependency licenses, guides, pending acceptance, manifest, notes and
checksums. Verify with `sha256sum --check SHA256SUMS` inside that directory.
Set `M05_RELEASE_IMAGE` only to an already tested local image built with matching
`SOURCE_COMMIT` and `VERSION` arguments. The preparer verifies source/version and
exact application/admin bytes, then saves the image plus OS inventory/notices.
It never contacts a registry or publishes a release. Without Docker access the
local packet explicitly has no image. A packet is a draft, with distribution
approval false and actual acceptance pending, even when all checksums pass.

The Docker CI prepares and checks a complete local draft in its temporary runner
without uploading/publishing it. Its health-only measurements describe that
runner and the configured container limits, not Fortnox/ChatGPT capacity. Full
image licensing/source-rights review and the actual acceptance matrix remain
release requirements. Systemd/APT remain future documented work.
