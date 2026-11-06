# Fortnox MCP — MVP delivery plan

Planning baseline: **2026-10-20**, source commit
`4abf75b05971437e9ba14dc0ceb2c4ce8216fd18`.
Execution tracker: [MVP #54](https://github.com/alex-engvall/fortnox-mcp/issues/54).
The [full roadmap #16](https://github.com/alex-engvall/fortnox-mcp/issues/16),
[approved decisions](../decisions.md), contracts and
[release policy](../releases.md) retain their authority.

This plan implements the owner's requested MVP project proposal. It is a delivery
subset for an installable prerelease, not evidence of implemented capabilities,
a stable 1.0 scope change or permission to publish a release.

## Demonstrable outcome

From a clean installation, one authenticated owner connects two authorized test
companies, explicitly selects a company in ChatGPT, provides at least two receipt
files, reviews individual immutable proposals and receives verified Fortnox
voucher and attachment references. Interrupted or partially successful work can
be investigated and resumed without blindly resending successful or unknown
financial writes.

Keep multi-company isolation, exact money, embedded review by default, bounded
temporary storage and explicit unknown outcomes. File interpretation remains in
the AI client; no model/OCR API key is introduced.

The first release supports ChatGPT and **one actually verified deployment path**.
Evaluate hosted Cloudflare Workers first under D04; select and document the path
using measured evidence. Keep portable logic and Node/workerd regression checks.
An alpha does not advertise untested hosted Node/Docker support. Stable 1.0's
broader deployment requirements remain unchanged.

## Five delivery parts

| Part | Existing parent scopes | Required subset |
| --- | --- | --- |
| Foundation | S00 #17, S01 #18 | Real client connection, review and file acceptance; reuse the executable foundation |
| Connections | S02 #19, S03 #20, necessary S04 #21 reads | Owner/bootstrap, separate service/user token lifecycles, encrypted durable storage, company isolation and first end-to-end read |
| Accounting | S06 #23 | Required reference reads, exact validation, immutable review and safe voucher execution |
| Receipts | S07 #24 | Multiple real files, individual proposals/results, upload/link/retrieval and step-level recovery |
| Release | Relevant S10 #27, S11 #28, S12 #29 slices | Protected setup, redacted diagnostics, lifecycle, verified packaging and acceptance evidence |

Protected setup and durable storage develop alongside connections. These are
delivery groupings rather than five strictly sequential phases.

Outside this project: full sales/purchase workflows (#22), broad financial
analysis/SIE (#25), payroll (#26), specialist modules (#30, #43–#52), additional
client and deployment claims. Their existing scope and milestones remain intact.
Local documentation search/read/describe already implemented in PRs #13/#14 is
reused, not re-created.

## One bounded delivery per planned PR

Each issue contains scope, exclusions, start dependencies, activation/release
conditions, acceptance and required evidence. The issue descriptions are in
Swedish for the owner; implementation and technical documentation remain English.
No delivery dates or assignees have been invented.

| Issue | Planned delivery | Part | Parent | Start dependencies |
| --- | --- | --- | --- | --- |
| [M01 / #55](https://github.com/alex-engvall/fortnox-mcp/issues/55) | Skyddad ägarbootstrap och adminsession | Anslutning | #19 | Existing foundation |
| [M02 / #56](https://github.com/alex-engvall/fortnox-mcp/issues/56) | Autentiserad MCP OAuth i produktservern | Anslutning | #19 | #55 |
| [M03 / #57](https://github.com/alex-engvall/fortnox-mcp/issues/57) | Krypterade anslutningar och företagsisolering | Anslutning | #19 | #55 |
| [M04 / #58](https://github.com/alex-engvall/fortnox-mcp/issues/58) | Fortnox serviceconsent och tokenlivscykel | Anslutning | #19 | #57 |
| [M05 / #59](https://github.com/alex-engvall/fortnox-mcp/issues/59) | Fortnox användaranslutning med refreshrotation | Anslutning | #19 | #57 |
| [M06 / #60](https://github.com/alex-engvall/fortnox-mcp/issues/60) | Koppla från och återanslut företag säkert | Anslutning | #19 | #58, #59 |
| [M07 / #61](https://github.com/alex-engvall/fortnox-mcp/issues/61) | Säker Fortnox HTTP-adapter med läsbudgeter | Anslutning | #20 | #57 |
| [M08 / #62](https://github.com/alex-engvall/fortnox-mcp/issues/62) | Lista anslutna företag och läs företagsprofil | Anslutning | #19 | #56, #58, #59, #61 |
| [M09 / #63](https://github.com/alex-engvall/fortnox-mcp/issues/63) | Läs bokföringens konton, år, serier och referenser | Bokföring | #21 | #62 |
| [M10 / #64](https://github.com/alex-engvall/fortnox-mcp/issues/64) | Validera manuella verifikationer med exakta belopp | Bokföring | #23 | #63 |
| [M11 / #65](https://github.com/alex-engvall/fortnox-mcp/issues/65) | Beständiga skrivintentioner och osäkra verifikationsutfall | Bokföring | #20 | #57, #61 |
| [M12 / #66](https://github.com/alex-engvall/fortnox-mcp/issues/66) | Oföränderliga verifikationsförslag och granskningsvy | Bokföring | #23 | #56, #57, #64 |
| [M13 / #67](https://github.com/alex-engvall/fortnox-mcp/issues/67) | Bokför endast det granskade verifikationsförslaget | Bokföring | #23 | #65, #66 |
| [M14 / #68](https://github.com/alex-engvall/fortnox-mcp/issues/68) | Säker tvåfilers input och output för kvitton | Kvitton | #24 | #56, #57 |
| [M15 / #69](https://github.com/alex-engvall/fortnox-mcp/issues/69) | Förbered kvittobatch med granskning per underlag | Kvitton | #24 | #64, #66, #68 |
| [M16 / #70](https://github.com/alex-engvall/fortnox-mcp/issues/70) | Ladda upp, länka och hämta Fortnox-underlag | Kvitton | #24 | #61, #65, #68 |
| [M17 / #71](https://github.com/alex-engvall/fortnox-mcp/issues/71) | Återuppta delvis lyckad kvittobatch utan omsändning | Kvitton | #24 | #67, #69, #70 |
| [M18 / #72](https://github.com/alex-engvall/fortnox-mcp/issues/72) | Skyddad setup för ägare, företag och ChatGPT | Release | #28 | #55, #56, #60, #62 |
| [M19 / #73](https://github.com/alex-engvall/fortnox-mcp/issues/73) | Redigerad anslutningsdiagnostik för MVP-flödet | Release | #27 | #61, #62 |
| [M20 / #74](https://github.com/alex-engvall/fortnox-mcp/issues/74) | Verifiera uppgradering, backup, återställning och rensning | Release | #28 | #57, #60, #65, #68 |
| [M21 / #75](https://github.com/alex-engvall/fortnox-mcp/issues/75) | G06-delacceptans för anslutning och företagsläsning | Anslutning | #36 | #61 |
| [M22 / #76](https://github.com/alex-engvall/fortnox-mcp/issues/76) | G07-delacceptans för manuell kvittobokföring | Bokföring | #37 | #63, #64 |
| [M23 / #77](https://github.com/alex-engvall/fortnox-mcp/issues/77) | G09-delacceptans för vald MVP-drift och två kvitton | Grund | #39 | Existing foundation |
| [M24 / #78](https://github.com/alex-engvall/fortnox-mcp/issues/78) | Verifiera och paketera första installerbara prereleasen | Release | #29 | #60, #62, #67, #71, #72, #73, #74, #75, #76, #77 |

The issue titles above are Swedish as published on GitHub; part values also match
the proposed project fields. Existing verification tasks #31, #32, #33, #35, #38
and #42 are reused. Together with the 24 new deliveries these form the **30**
issues labeled `release:mvp`. The umbrella #54 is a navigation tracker rather
than an executable project item.

Only documented clickable parent/dependency links were added for these new
issues. **Native sub-issue and blocked-by relationships have not been created.**
Existing native relationships and milestones were preserved.

## Start conditions versus activation and release

Start #31 (G01) and #32 (G02) first, then #33 (G03) and the early runtime probe
#77. Drive #35 (G05) in parallel. Independent bootstrap, storage and synthetic
adapter work can proceed while host acceptance is outstanding.

A prerequisite contract for implementing a slice is different from proof needed
to enable it. For example, voucher execution can be built disabled against an
adapter after the intent and review services exist; it must not be advertised or
enabled until the relevant host, provider, validation and recovery evidence
passes. Do not require closing a whole parent scope merely to start a child, and
do not mistake a synthetic adapter test for live acceptance.

| Gate | MVP treatment |
| --- | --- |
| G01 #31 | Actual ChatGPT protocol/auth, saved-answer reload and administrative reload acceptance; do not infer success from an MCP 200 |
| G02 #32 | Actual restrictive-CSP review, remount/replay and server-bound single execution; no silent client-managed fallback |
| G03 #33 | Two real client files and output retrieval, format/size/expiry and ownership checks |
| G04 #34 | Remains closed for its existing isolated probe; production durability, token concurrency and lifecycle need new evidence |
| G05 #35 | Parallel source-provenance/distribution blocker; independently written work continues, restricted source/derived distribution does not |
| G06 #36 | Connection/read acceptance in #75; later reference, voucher and file acceptance in #92/#93/#94; full gate remains open |
| G07 #37 | Manual-voucher rule/provider acceptance in #76; full analysis/SIE acceptance remains open |
| G08 #38 | Lost responses, concurrent submits, restart and partial-link recovery for all enabled financial/file steps |
| G09 #39 | Measured selected-runtime/two-file acceptance in #77, repeated on the release candidate; broader Node/Worker/SIE gate remains open |
| G10 #40 | Payroll is outside this prerelease |
| G11 #41 | Broad common-workflow acceptance remains a stable 1.0 condition |
| G12 #42 | Installable prerelease requires secure product bootstrap/lifecycle and tested confidential reporting delivery |

A partial gate acceptance must name the exact operation, client/runtime versions,
workload, evidence and unsupported cases. Do not close the broader gate/parent
because the MVP subset passed. Disable an affected capability when its evidence
fails rather than weakening its contract.

## GitHub Project configuration

**Current state:** the issues and labels exist; the Projects board, fields, views
and auto-add workflow have **not** been created or verified. The connected GitHub
toolset exposes issue operations without Projects mutations. Direct
`gh api graphql` access returned `Forbidden`; `gh project list` could not
resolve the owner. No project URL, ID or successful setup is assumed.

When an authorized Projects session is available, check for an existing
**Fortnox MCP — MVP** project under `alex-engvall` before creating a duplicate.
Link it to `alex-engvall/fortnox-mcp`, use #54's goal/acceptance as the description,
and configure:

| Field | Single-select values |
| --- | --- |
| Status | Backlog, Ready, In progress, Verification, Blocked, Done |
| Leveransdel | Grund, Anslutning, Bokföring, Kvitton, Release |
| Prioritet | P0 – blockerar nästa steg; P1 – krävs för leverans |

GitHub's built-in Status is edited to these values; the other two are project
single-select fields. Initial P0 items are #31, #32, #33 and #77; all other
delivery items are P1. Use the Swedish part values from each issue. Assign the
reused gates as follows: #31/#32/#33 → Grund, #35 → Anslutning,
#38 → Kvitton (also covers accounting writes), #42 → Release.

Do not infer `Done` from merged code or an auto-close event. The item's
acceptance and evidence must be satisfied. Unverified merged work goes to
`Verification`. Initial delivery tasks are `Backlog`; #35 is `Blocked`.
Review start dependencies before moving an item to `Ready`. #31/#32 already
contain partial evidence but remain open; assigning them `Verification` must
not imply that pending host tests have run.

| Saved view | Layout |
| --- | --- |
| Arbete | Board grouped by Status |
| Leveransplan | Table grouped by Leveransdel, showing priority and dependency information |
| Verifiering | Table filtered to `label:verification-gate`, showing acceptance tasks and the source-rights blocker |

Use the issue body as the source for documented dependencies until native
relationships are available. Preserve existing milestones. Add the existing
matching issues first, then configure repository auto-add using
`is:issue label:"release:mvp"`; auto-add does not backfill existing matches.
Check the manual/imported count is 30 before recording the actual project URL
in #54 and this document.

See GitHub's [single-select fields](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields),
[saved views](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project)
and [auto-add behavior](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/adding-items-automatically).

## Release demonstration and handoff

The final acceptance issue #78 collects the following evidence rather than
replacing the operation-specific records:

1. A clean installation and protected setup in the selected, measured runtime.
2. Two test companies, explicit selection, token lifecycle and negative isolation
   cases.
3. Two actual ChatGPT files, separate immutable proposals and policy-bound review.
4. Verified voucher and attachment references for each successful receipt.
5. Lost response, restart, revoked access and partial-link recovery without blind
   resubmission; unresolved outcomes stay explicit.
6. Applicable gate/subset evidence, actual confidential-report delivery,
   lifecycle/cleanup/backup/restore and Swedish/English usage guides.
7. Exact release commit, compatibility/limits, SBOM/licenses, AGPL source,
   checksums and an authorized source/derivative distribution strategy.

Prepare reviewable release artifacts and notes; **publishing remains a separate
maintainer-authorized action**. Recommend test accounts until explicit
production-readiness evidence exists. No real financial data, raw provider
payloads, credentials or private signatures belong in public evidence.


## Milestone 2 provider acceptance refinement — 2026-11-06

The owner approved limiting M21/#75 to connection/auth and company reads so milestone 2 can close on its own actual acceptance. Original later MVP provider requirements are preserved in [reference acceptance #92](https://github.com/engshort/fortnox-mcp/issues/92), [voucher acceptance #93](https://github.com/engshort/fortnox-mcp/issues/93) and [file acceptance #94](https://github.com/engshort/fortnox-mcp/issues/94), in their implementation milestones. M24/#78 also requires these applicable acceptances. Full G06/#36 and source-rights #35 keep their separate criteria. This changes delivery tracking, not product decisions or permission to activate unverified operations.
