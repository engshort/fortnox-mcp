# Documentation map

Company access: [same-registration approval renewal, safe local read additions
and owner receipt recovery](implementation/access-renewal-2026-11-13.md).
Unknown writes remain retained; activation and actual acceptance stay separate.

S08 follow-up: [dated balances, cross-year transactions and historical
reskontra](implementation/S08-dated-reads.md). Available in the ordinary product;
unverified source semantics still produce unknown values and incomplete results.

S10/#27: [documentation and diagnosis acceptance](implementation/S10-acceptance-2026-11-12.md)
maps the existing criteria to local Node/workerd, actual CLI and separately
verified product-diagnosis evidence. External-source redistribution #35 remains
open; this adds no provider or hosted-client capability.

Issue #134: [bounded positive upload recovery](implementation/receipt-upload-recovery-2026-11-12.md)
is under verification; original provider-outcome recovery remains pending.

Current actual acceptance: [the 2026-11-11 implemented-function audit](implementation/acceptance-audit-2026-11-11.md)
records independently AI-reviewed provider/client results and their limits;
[remaining Swedish test steps](users/acceptansprov.sv.md) identify concrete prerequisites.

Acceptance operator: the owner permits [AI execution with independent AI review](implementation/ai-reviewed-acceptance-2026-11-11.md)
for all sandbox tests formerly requiring a human operator. Actual execution and
evidence requirements remain; historical records are not promoted.

Current activation: the owner removed ordinary product test/verification
activation restrictions on 2026-11-11. See [the activation decision and runtime
boundaries](implementation/product-activation-2026-11-11.md). Dated milestone
records below retain their original evidence; activation does not promote it.

Operations: [Nova merge-to-main deployment and recovery](deployment-nova.md).

Milestone 7: [financial analysis/payroll delivery and remaining evidence](implementation/M07-analysis-payroll.md) and [Swedish user guidance](users/analys-och-loneunderlag.sv.md). Implementation in progress; no new operation activated.

S11/#117: [company/program administration, consent evidence and S04/S05 handoff](implementation/S11-company-programs.md).
Implementation and local verification are complete; the owner excluded actual
Fortnox acceptance from this delivery, without changing operation activation gates.

S04/S05: [business write foundation](implementation/S04-S05-business-writes.md)
and [Swedish register/document status](users/register-och-fakturor.sv.md).
No new provider capability is enabled by the foundation.
The [register implementation/evidence](implementation/S04-register-evidence.md)
and [operation matrix](reference/s04-register-operations.json) describe the
separate bounded test profile; actual acceptance remains pending.

Milestone 5: [Docker delivery/evidence](implementation/M05-delivery.md),
[English Linux guide](deployment-linux.md), [Swedish guide](users/docker.sv.md)
and [pending actual acceptance](implementation/M05-actual-acceptance.md).
The [owner's 2026-11-09 acceptance and publication authorization](implementation/M05-release-authorization-2026-11-09.md)
covers the bounded prerelease; individual test observations retain their scope.
The [dated local Chrome lifecycle report](implementation/M05-client-lifecycle-2026-11-08.md)
separates observed reads/reconnection and persisted OAuth rotation from remaining
old-token, UI/file and recovery acceptance.
The [provider-renewal and isolated old-token follow-up](implementation/M05-token-renewal-2026-11-08.md)
distinguishes actual provider exchanges from synthetic OAuth rejection tests.
The [2026-11-09 issue review](implementation/M05-issue-review-2026-11-09.md)
records all 51 related issues, six bounded implementation closures and the
remaining acceptance requirements.

Milestone 4: [receipt implementation/evidence](implementation/M04-receipts-evidence.md) and [Swedish receipt guide](users/kvitton.sv.md). In progress; file and financial activation gates remain closed.

Actual M14 client preparation uses a [separate bounded file-test build](implementation/M04-client-file-test.md), with original-byte staging/readback only and no provider or financial writes.

The [actual file-input attempt and explicit host-picker follow-up](implementation/M04-file-picker-followup.md)
record the client's pre-call refusal, restored disabled installation and pending
acceptance of the optional picker.

G08 preparation: [recovery scenario matrix, read-only status check and pending actual test session](implementation/M04-G08-recovery.md).

File-specific G06: [exact operations, fresh test consent, original-byte readback check and pending provider cases](implementation/M04-G06-files.md).

Milestone 3: [reviewed accounting implementation/evidence](implementation/M03-accounting-evidence.md), [Swedish accounting guide](users/manuell-bokforing.sv.md) and [operation matrix](reference/mvp-accounting-operations.json). Provider booking and trusted-host execution remain disabled pending dated acceptance.

Milestone 2: [product implementation and acceptance](implementation/M02-connections-evidence.md), [Swedish ENV guide](users/env.sv.md) and [company connection guide](users/foretagsanslutningar.sv.md). Product/provider live acceptance is pending; operations remain disabled outside an explicit allowlisted test run.

Start with the [milestone 1 handoff](implementation/S00-milestone-1-handoff.md)
for current acceptance, runtime limits and the [G05 evidence packet](implementation/S00-source-rights-request.md).

Current S00 follow-up: [G03 transport correction and Chrome results](implementation/S00-G03-transport-2026-11-06.md),
[maintenance deployment](implementation/S00-hosted-maintenance-2026-11-05.md),
[review recheck](implementation/S00-review-acceptance-2026-11-05.md),
[owner review/remount recheck](implementation/S00-review-acceptance-2026-11-07.md),
[default-off file probe](implementation/S00-files-evidence.md) and
[Swedish synthetic-client instructions](users/klientprov.sv.md).

Baseline approved by the project owner on **2026-10-18**. This is an implementation specification, not a record of implemented features.

## Reading paths

| Audience/task | Reading order |
| --- | --- |
| Product/review | [Product](product.md) → [decisions](decisions.md) → [release gates](releases.md) |
| First usable prerelease | [MVP delivery plan](implementation/MVP.md) → [MVP tracker #54](https://github.com/alex-engvall/fortnox-mcp/issues/54) |
| First contributor | [English developer README](../README.en.md) → [CONTRIBUTING](../CONTRIBUTING.md) → [CLA](../CLA.md) → [development](development.md) → [architecture](architecture.md) → [implementation queue](implementation/README.md) |
| Coding agent / optional Labstride | [Agent guide](AGENT-GUIDE.md) → [English workflow](development.md#optional-labstride-issue-to-review-workflow) → [Swedish owner guide](users/labstride.sv.md) |
| API integration | [Sources](reference/sources.md) → [coverage](reference/coverage.md) → [authentication](contracts/authentication.md) → [tools](contracts/tools.md) |
| Local documentation tools | [Developer setup](developer-tools.md) → [Swedish usage](users/dokumentation.sv.md) → [S10 evidence](implementation/S10-docs-evidence.md) |
| Financial correctness | [Validation](contracts/validation.md) → [analytics](contracts/analytics.md) → [tests](testing.md) |
| User workflows | [Approval](contracts/approval.md) → [receipts](contracts/receipts.md) → [client compatibility](contracts/clients.md) |
| Project website | [Website source](../index.html) → [Installera source](../installera/index.html) → [development and publishing](website.md) |
| Operations | [Security](security.md) → [storage](contracts/storage.md) → [deployment](deployment.md) |
| CLA maintainer setup | [Contributor agreement](../CLA.md) → [CLA setup and enforcement](maintainers/cla-setup.md) |
| Swedish user | [Project introduction](../README.md) → [Kom igång](users/kom-igang.sv.md) → [examples](users/exempel.sv.md) |

## Authority and maintenance

Approved decisions take precedence over illustrative examples. Contracts define required behavior. Implementation scopes identify dependencies and acceptance criteria; they do not weaken the contracts. Source facts are distinguished from project choices and unverified assumptions in [verification gates](reference/verification-gates.md).

Coverage means verified behavior, not merely a generated tool definition.
Fortnox business modules are still planned; the foundation and isolated probes
below have scoped implementation evidence. Update affected documents together
when a decision changes. Keep one current decision register rather than
accumulating contradictory planning documents.

The [S00/S01 verification handoff](implementation/S00-S01-handoff.md) summarizes
completed checks, open and blocked work, exit criteria and the next steps.

The isolated [S00 spike](../spikes/s00-mcp/README.md) now contains a pinned SDK, lockfile, executable synthetic server, offline tests and a [CI workflow](testing.md#continuous-integration). It is not a production module or Fortnox implementation, and that transport-only spike is not deployed. See the [spike evidence and unresolved gates](implementation/S00-spike-evidence.md) and the separate [CI evidence](implementation/S00-ci-evidence.md).

The [S01 root workspace](development.md) adds a locally verified TypeScript foundation, Node/Worker entries and SQLite/D1 adapter tests in actual local workerd. [S01 evidence](implementation/S01-evidence.md) distinguishes this foundation from pending remote authentication, hosted-client acceptance and Fortnox features.

The separate [S00 OAuth probe](../spikes/s00-oauth/README.md) tests a maintained
auth component and owner-bound synthetic MCP requests on Node and local workerd/D1.
[OAuth evidence](implementation/S00-oauth-evidence.md) now also records live
ChatGPT login/consent, a synthetic tool call and refresh rotation. Broader client
acceptance remains open; this does not enable the root product's remote MCP endpoint.

The separate local [Fortnox G04 operator probe](implementation/S00-fortnox-evidence.md)
adds offline-checked service/user connection tests. The owner completed private
consent in a dedicated sandbox; service/client-credentials and user refresh paths,
tenant checks and `/me` semantics passed live for two identity scopes. G04 is
verified within that scope; the root provider module remains disabled.

The optional [G02 synthetic review experiment](implementation/S00-review-evidence.md)
adds server-bound proposals, a standard MCP Apps view and atomic one-time test
approval. Local SQLite/D1/OAuth checks and one actual ChatGPT view/click pass;
restrictive-CSP and remount/replay checks remain open. It is off by default and
enables no financial operation.

The [first S11 slice](implementation/S11-cloudflare-first-installation.md) adds an active Cloudflare test-installation button and public Worker/D1 status page. It adds no provider coverage or remote MCP access. [Evidence](implementation/S11-cloudflare-evidence.md) separates local verification from one successful hosted installation in an existing account and the remaining fresh-account/lifecycle checks. [Deployment troubleshooting](deployment.md#github-connection-fails-before-the-build) covers the observed Cloudflare identity/role and incomplete GitHub connection failure.
