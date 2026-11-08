# Deployment and owner setup

The owner selected [Node/Docker behind an existing Nginx](deployment-linux.md) for milestone 5.
The [delivery record](implementation/M05-delivery.md) distinguishes implemented
runtime work from pending Docker, client, provider and release acceptance.
The Cloudflare infrastructure test below retains its original limited scope.

Status: first Cloudflare infrastructure installation verified on 2026-10-18 in one existing account, with new resources and default names. Fresh-account onboarding and lifecycle acceptance remain pending. The protected wizard, Fortnox connection and remote MCP remain unavailable. No Docker image, published npm package or hosted project service exists.

## First Cloudflare test installation

Start at the Swedish [Installera page](https://alex-engvall.github.io/fortnox-mcp/installera/) ([source](../installera/index.html)). The active button uses the whole public repository, not `apps/worker` alone. Publish it with the root configuration on the default branch. Follow the button to sign into Cloudflare/GitHub, choose your repository/Worker/D1 names, retain the detected build/deploy commands and wait for deployment. The Worker URL opens a Swedish/English status page. No Fortnox credentials or model key are needed.

Check the signed-in Cloudflare identity in the user menu as well as the selected account. The successful installation used the account owner's **Super Administrator - All Privileges** role across the entire account. A member with only **Domain Administrator** has read-only access to account-wide Workers resources, according to [Cloudflare's role reference](https://developers.cloudflare.com/fundamentals/manage-members/roles/#domain-scoped-roles); selecting the owner's account does not elevate that member's permissions. The minimum sufficient deployment role has not been established by this test.

When installing **Cloudflare Workers and Pages** on GitHub, select **Only select repositories** and the intended project. The verified flow also added its newly created repository copy to that selection automatically. Check the final repository list; access to all repositories is not required by the observed installation.

Root `wrangler.jsonc` declares the test entry and `DB`. Cloudflare's documented button flow provisions D1 and replaces the placeholder ID. `npm run deploy` first runs `wrangler d1 migrations apply DB --remote --config wrangler.jsonc`, then deploys. Running this manually requires your provisioned database ID and Cloudflare authorization; the zero ID is not a shared database.

`GET /`, `/setup` and `/health` check the schema without reading stored rows. A missing database/schema returns `503`. `/mcp` stays blocked on this public entry. It does not reuse the local MCP entry in `apps/worker/wrangler.jsonc`. See [local preview](development.md#cloudflare-installation-preview), [plan](implementation/S11-cloudflare-first-installation.md) and [verification limits](implementation/S11-cloudflare-evidence.md).

**Updates:** the copied repository does not automatically track upstream. Review changes and migration notes, merge chosen changes into your copy while preserving generated resource IDs, then let Workers Builds run build/deploy again. Never replace provisioned IDs with example zeros. Wrangler tracks applied migrations. Future private-data features require tested backup/restore and upgrade procedures before use.

**End the test:** delete the Worker and D1 separately in your Cloudflare dashboard; check any Workers Builds integration you no longer need. Deleting a Worker alone does not delete its database. This version cannot create Fortnox records.

### GitHub connection fails before the build

The observed failure was **Error connecting to git account** on return from GitHub, even though the GitHub App was installed. No application build had started. The recovery used the correct Cloudflare owner sign-in and then replacement of the incomplete GitHub connection; reinstalling alone was not established as a fix.

1. In Cloudflare, check the user-menu email, selected account and your role under **Manage account → Members**. Use the intended account's owner or have an administrator review the required account permissions. Do not change build commands or D1 configuration for a failure before the build.
2. Check whether Cloudflare actually lists the GitHub account as a connected account. **Installed** on GitHub does not by itself prove that Cloudflare registered the connection.
3. If the permissions are corrected but Cloudflare still has no connection and GitHub only opens the existing app's configuration page, review that installation's selected repositories and dependent builds before removing it. Uninstalling the app revokes its access and stops new builds for every connected Workers/Pages project using that installation; existing deployments remain hosted. See [Cloudflare's integration guidance](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/#remove-access).
4. If that interruption is acceptable, uninstall **Cloudflare Workers and Pages** from the intended GitHub account, restart the installation button while signed into Cloudflare as the owner, and authorize only the intended repository. Do not remove unrelated GitHub Apps or repeatedly reinstall without correcting the account context.
5. Confirm that Cloudflare lists the GitHub account, then continue with `npm run build` and `npm run deploy`. A successful build must include the D1 migration and the hosted status page must confirm both Worker and database readiness.

The [hosted evidence](implementation/S11-cloudflare-evidence.md#hosted-installation-verification--2026-10-18) records the successful run and its limits. A Swedish walkthrough is in [Kom igång](users/kom-igang.sv.md#om-github-anslutningen-misslyckas).

## Supported target modes

| Mode | Initial direction | Gate |
| --- | --- | --- |
| Cloudflare | Worker HTTP server, supported transactional storage, secrets, private temporary file storage as needed | Measure CPU, schemas, auth, decimal/SIE work, file sizes and cleanup; free tier is not guaranteed |
| Node.js | HTTP server, SQLite/supported durable adapter, local/private temporary storage; Docker packaging | Demonstrate persistence, restart recovery and equivalent policies |
| Local stdio | Optional for supporting clients | Explicit owner/company configuration; not a substitute for remote ChatGPT connectivity |

The core stays independent of Cloudflare-specific APIs. A paid plan may be necessary as resource needs grow. Record dated requirements and measured limits in release documentation; do not hard-code old provider prices as a permanent promise.

## Setup wizard responsibilities

1. Establish the installation owner through a secure bootstrap and admin login.
2. Explain prerequisites and the integration's independent status.
3. Store the owner's Fortnox Client ID/Secret securely and show the exact registered callback URL.
4. Select modules/scopes, initiate provider consent and verify company identity.
5. Add additional companies and show each connection's capability/status.
6. Set read-only/manual-review policy per company; default to manual review.
7. Provide client connection instructions based on tested compatibility.
8. Run redacted connection diagnostics and explain missing scope/license/permission separately.

Do not collect Fortnox passwords in the wizard. The user signs in at Fortnox. Never print secrets in the final setup instructions or require pasting them into the AI conversation.

## Configuration categories

The implementation must document actual variable names in `.env.example`: public base URL, runtime/storage settings, secret-encryption/bootstrap inputs, Fortnox client credentials, OAuth metadata, enabled modules, budgets and retention. Per-company grants and policy live in durable operational state. Examples contain placeholders only.

For owners, describe backup/restore, disconnection, credential rotation, failed approval cleanup, version upgrades and unknown-write recovery. Never recommend retries until a financial operation's status is understood.

## Packaging

Publish versioned artifacts only after tests. Prefer an OCI image and documented Worker configuration/template. The first-test button uses independently owned resources without embedded project secrets; provisioning, migration and readiness have one verified hosted run, while fresh-account and lifecycle checks remain open. A button must not imply that Fortnox developer registration or consent can be skipped.

Future shared hosting requires a new multi-user threat model and identity/tenant design. The single-owner deployment must not be advertised as ready for unrelated public users.
