# M05 owner acceptance and release authorization — 2026-11-09

The owner explicitly approved MVP acceptance and authorized merge/publication
after green CI. The owner then requested a single consolidated PR. These are
maintainer decisions, recorded separately from observed test results.

## Integration

PR #108 was already squash-merged after its three checks passed. The repository
allows squash merges only. Remaining delivery parts #109–#114 are consolidated
in #114 against the resulting main. Superseded PRs #109–#113 are closed with a
pointer to #114, rather than represented as separately merged. The consolidated
source tree matches the previously tested delivery before this authorization
record and artifact workflow are added.

All existing S00, OAuth, S01 and Docker checks, plus the new source-packet check,
must pass on the consolidated PR. After squash merge, check the resulting main
commit again before creating the immutable prerelease tag. No rule or required
check is bypassed.

After #114 merged, all five verification workflows passed on main. A separate
Dependabot security-update job failed because Miniflare pinned vulnerable Undici
7.29.1 and its computed fix would downgrade the Worker toolchain. The release
follow-up overrides that development dependency to 7.30.1 in the root and
S00 OAuth lockfiles, and the root Cloudflare test plugin's development-only Zod
4.6.5 copy to the existing runtime version 4.6.7. Repeat full CI and audit before tagging the corrected main;
the failed updater remains historical evidence, not a passing check.

## Publication scope

Publish **`v0.1.0-mvp.5.0` as a GitHub prerelease**, with project source, Docker
build/installation instructions, runtime SBOM, original dependency notices,
checksums and accurate release notes. CI builds a candidate packet from the
tagged commit. The artifact workflow has read-only repository permissions and
does not publish; the authorized maintainer verifies the packet before release.
The preparer's draft manifest remains a preparation record until that review.
Record the exact tag/commit, CI runs and final asset hashes in publication evidence.

This source distribution consists of independently authored AGPL project source
and separately attributed material recorded in THIRD_PARTY_NOTICES. The source
guard excludes private inputs and Fortnox specifications; no generated provider
implementation is shipped. Runtime dependency notices and lockfile integrity
remain required. Source-rights #35 stays blocked for its separate upstream
specification/generated-material scope; it is not treated as cleared.

Docker installation builds the reviewed image locally from the tagged source.
The saved Docker/OS-image candidate remains local pending its full distribution
review. It is not included in this source-only publication. No registry, npm,
APT package or systemd installer is part of this release.

## Accepted delivery and observed limits

Owner acceptance covers the delivered installable test build and authorizes this
bounded prerelease. It does not manufacture evidence for unperformed scenarios.
The [actual session record](M05-actual-acceptance.md), [delivery evidence](M05-delivery.md)
and [issue review](M05-issue-review-2026-11-09.md) retain their measured scope.

The release supports the documented Linux amd64 / Node 24 / Docker Compose /
existing-Nginx installation, protected bilingual owner setup, two authorized test
connections, bounded company reads/diagnosis and offline maintenance. Actual
service/user renewal and local Chrome read lifecycle have dated evidence.
Financial writes, provider files and trusted review execution retain their
default-off activation gates. No production-readiness or stable-release claim
is introduced.

Actual two-receipt original-file transfer, separate trusted human reviews,
voucher/attachment readback, provider fault recovery and confidential report
delivery remain unperformed or incomplete. Their issue checklists and technical
gates are not marked passed by this owner decision. Systemd and APT remain
documented future work. Record remaining limitations in both release languages.
