# Approved decision register

Approved baseline: 2026-10-18. Product owner: alex-engvall. Details below consolidate the conversation, including superseded approval proposals. No separate external approval page is mandated for daily bookkeeping.

| ID | Decision | Consequence |
| --- | --- | --- |
| D01 | Independent, community-oriented Fortnox MCP project | No Kollino dependencies, branding or tenant assumptions; Easy Today AB is the named recipient of signed CLA licenses without changing public project independence. |
| D02 | Public repository, own distribution free, AGPL v3; CLA for new contributions | Keep SPDX AGPL-3.0-only for the public Project. External contributors retain copyright and grant Easy Today AB additional non-exclusive rights, including separate commercial/proprietary licensing, through a signed CLA. No assignment or resale-permission scheme. |
| D03 | Self-hosting first; no central project service at launch | Each Community installation has its own Fortnox Client ID/Secret. Never distribute a shared secret. Separately licensed hosted/premium services may be considered later but are not included in the launch plan. |
| D04 | TypeScript; portable core | Cloudflare evaluated first for simple deployment; Node.js/Docker alternative. |
| D05 | Setup wizard plus developer configuration | Browser setup for owner identity, companies, status and client instructions. |
| D06 | One owner, multiple companies in v1 | Company isolation from the first executable slice; future team roles must not require rewriting domain isolation. |
| D07 | Broad read/write use, not just search | Common Fortnox workflows form the stable-release baseline. Restricted APIs are classified separately. |
| D08 | Analysis in the AI client | Server retrieves data and performs deterministic calculations with evidence; no required model API key. |
| D09 | Full financial data basis | All available accounts/balances, assets, liabilities, equity, income, expenses and transactions; liquidity and cross-period/company comparisons. |
| D10 | Standard client approvals for normal tools | Accurate MCP annotations; server still enforces ownership, scope and validation. Optional read-only mode is server-enforced. |
| D11 | Manual vouchers default to embedded review | Per-company `review_required` or `client_managed`; owner can change it outside model tools. All manual-voucher paths obey the same policy. |
| D12 | Keep daily work in the AI client | Prefer MCP Apps review UI; compatibility and trusted approval verification are S00 gates. Unsupported review mode blocks execution rather than downgrading. |
| D13 | Accounting validation is mandatory | Exact decimals, balanced vouchers, resource checks, safe retry handling and meaningful automated tests. Approval never bypasses validation. |
| D14 | Multiple receipts in one workflow | Per-item proposals, review, evidence, status, partial failure and reconciliation. |
| D15 | Fortnox is the system of record | Minimal bounded operational state, temporary files and no full local financial replica. |
| D16 | Payroll input first | Expand later; no initial full payroll run, payslip-generation or payout promise. |
| D17 | Developer assistance included | Documentation search, operation discovery and redacted diagnostics. No local simulator initially. |
| D18 | ChatGPT first; Claude next | General MCP core with capability-specific adapters and a tested client matrix. |
| D19 | Swedish default README; English developer material | The public website (`index.html`) and default `README.md` introduce the project in Swedish for business owners across industries. Both link to `README.en.md` for developers. The website uses static GitHub Pages hosting; the MCP server uses its own runtime. Swedish and English discussions are welcome; code and technical reference docs use English. Swedish setup guidance and examples remain available. |
| D20 | Public prereleases before stable 1.0 | Stable release requires useful breadth plus quality and compatibility evidence. |
| D21 | Fortnox test environment available through owner | Owner has developer access and can create a test company; no credentials have been supplied or live tests run for this baseline. |
| D22 | Protected web application: Hono for HTTP routing, React + Vite for owner-facing UI | Reuse the existing portable TypeScript domain/MCP services across Cloudflare Workers and Node.js. Serve built admin assets from the same installation; keep embedded MCP Apps separate and subject to client/CSP/review gates. The public GitHub Pages site remains static. |

## Owner-directed ordinary activation (2026-11-11)

The owner explicitly requested removal of test/activation restrictions and a
pull request followed by squash merge after green CI. The implemented finite
capabilities in S02–S09/S11 are available in the ordinary product without test
tenant lists, separate acceptance builds or operation leases. Historical
verification gates remain evidence requirements and no longer gate ordinary
runtime activation. This refines D07/D12/D20; it does not promote acceptance,
change D10/D11/D13/D15 or approve a stable release. The existing conforming-host
MCP Apps trust boundary is documented, including its limits. See the
[scope, migration and acceptance record](implementation/product-activation-2026-11-11.md).

## CLA and commercial-rights decision (2026-10-20)

The owner approved a **Contributor License Agreement with Easy Today AB as the legal rights recipient**. The public code and documentation remain AGPL-3.0-only; the company's additional license is non-exclusive, contributors retain copyright, and separately licensed commercial products may be built only from material for which the company has the necessary rights. The change does not alter the open-source release scope, licensing of historic third-party material, or the D03 self-hosting-first launch decision.

The earlier D02 choice **not** to require a CLA is superseded. Scope: **new intentional contributions accepted under a signed version of [CLA.md](../CLA.md)**, not retroactive rights for already committed code. Implementation requires legal review and verified signing/required checks before enforcement; see [maintainer CLA runbook](maintainers/cla-setup.md). No CLA signatures, third-party GitHub App installation, private premium repository or deployed hosted service are implied by this documentation change.

Rationale: preserve a genuine, unrestricted AGPL Community project while enabling the rights holder to develop sustainable premium products. Alternatives considered were AGPL-only commercial hosting (no proprietary derivative right for third-party code), copyright assignment (more intrusive than necessary) and a fully separate commercial control plane (still a possible architecture, not required by this decision). Migration: none for existing AGPL grants or software; pending external pull requests must be assessed individually when the signing check goes live. Until then, do not merge external contributions on an assumption that future CLA acceptance will retroactively cover them.


## D22 — Web application framework (proposed 2026-11-06)

**Owner request and approval:** The product owner requested this framework proposal as a product decision on 2026-11-06. Review and merge of the proposing pull request constitutes approval of D22; opening the PR alone does not. **Effective scope:** subsequent S11/M18 protected setup/admin UI work after approval. This decision does not approve implementation, a release or any unverified host capability.

**Decision**

- **HTTP routing:** Adopt **Hono** incrementally for the product's HTTP routes (owner administration, setup, OAuth callbacks where appropriate, and static assets). Compose the existing Fetch `Request`/`Response` handlers without moving company authorization, accounting rules or MCP protocol responsibilities into routes. Use the same routing composition in Cloudflare Workers and Node.js via the existing `@hono/node-server` adapter. Using the adapter today does **not** mean Hono routing is already in place.
- **Protected web UI:** Use **React** for interactive owner-only setup and administration, bundled with **Vite** into versioned static assets. Serve those assets from the installation's own origin in both runtimes; do not require a separate frontend server, Node-only SSR, or a centrally hosted control plane. Keep one owner with multiple explicitly authorized companies as the v1 product model.
- **Embedded MCP Apps:** Treat receipt/voucher review as separate, independently built entry points. React may be reused only if the actual client host accepts the output, its restrictive CSP and the verified approval boundary. Until then, retain the existing self-contained review UI; no React migration may weaken `review_required`, expose a commit capability to the model, or reclassify an unsupported client as supported.
- **Public website:** Keep `index.html`, `installera/` and `site/` dependency-free static GitHub Pages content under D19. This decision applies to the authenticated web application, not marketing/documentation pages.

**Why this stack**

The project already has a portable TypeScript core, Cloudflare and Node runtime adapters, an HTTP fetch boundary and modest owner-facing web workflows that will become more interactive as company connections, policy settings and review status are added. Hono fits the existing Fetch boundary. React gives those workflows reusable view components, while Vite supplies a static production build without introducing a second application server. This is a targeted UI/routing decision, not a backend rewrite.

**Alternatives considered:** Continue with hand-authored HTML and vanilla TypeScript (smaller now, but more UI state and templating work as the setup/administration flow grows); adopt Next.js or SvelteKit (would introduce a full-stack rendering/server model and duplicate routing responsibilities for no accepted SSR requirement). Do not introduce a React SPA for simple static status pages solely for consistency.

**Required boundaries and acceptance before migration**

- Reuse existing authentication, owner/company authorization, read-only and per-company voucher policies, immutable proposals, one-time approval and unknown-write handling. The browser never becomes the authority for these checks. Admin and secret/policy operations remain unavailable to model-callable MCP tools; no arbitrary Fortnox proxy is added.
- Keep credentials, refresh tokens and privileged review capabilities out of bundled assets, browser storage, browser logs and model-visible responses. Preserve same-origin protections, secure session cookies, CSRF defenses where relevant, content security policy and strict server-side input validation.
- Prove equivalent route behavior and authorization across Worker/D1 and Node/SQLite. Check static-asset delivery, OAuth redirects, deploy/package size, Worker resource limits, accessibility, Swedish/English UI and failure/recovery behavior. Independently verify MCP Apps CSP, remount/replay and trusted-review behavior under G02 before replacing the embedded view.
- Integrate gradually with `packages/ui` and the existing `apps/shared` product application; migrate only after tests preserve behavior. Do not couple the portable domain core to Hono, React, Vite or platform-specific storage.

**Migration impact:** No immediate code or database migration, no change to the published static website, existing MCP tools or production support claims. Today the UI is server-generated HTML/JavaScript; a Hono router and React/Vite application are not implemented by this decision. Future UI PRs must carry the relevant tests, dependency/license checks and S11 documentation.

**Decision interaction:** D22 refines the implementation of D04 (portable TypeScript), D05 (setup wizard), D12 (in-client work and verified review) and D19 (static public website); it does not supersede or relax those decisions.

## Implementation choices versus unresolved evidence

D19 was refined and clarified by the owner on 2026-10-18: make Swedish the default README, address business owners across industries and link to an English developer README in the introduction. The owner corrected the earlier sector-specific wording; the presentation follows the project's broad audience and D01 independence. `README.sv.md` remains as a compatibility link. Effective immediately for documentation; no runtime or data migration is required.

D19 was extended by the owner on 2026-10-18 to include a dedicated Swedish open-source project website on GitHub Pages, with a shorter repository README. The owner requested more colour and style inspiration from Almega, Svenskt Näringsliv and Företagarna. This is a presentation and static-hosting choice; it does not change MCP hosting or the implementation scope.

D19 presentation refinement, approved by the owner on 2026-10-18: replace the illustrative hero with a direct, typography-led introduction to the planned ChatGPT–Fortnox connection, emphasize free software and open source, and align the header background with the hero. Remove the Claude logo and public-page presentation because no required brand approval is recorded. This does not change D18's future client roadmap, the development status or external provider/hosting costs.

Retention defaults, package boundaries and tool names in the contracts are initial engineering choices that may be refined with documented rationale. They must preserve these decisions. Unknown provider/client behavior is not resolved by optimistic wording: see [verification gates](reference/verification-gates.md).

## Superseded proposals

- Mandatory external browser approval for every manual voucher: replaced by embedded client review and an owner-configurable policy.
- A bespoke broad preapproval/automation-permission engine: not part of v1; normal actions use the client's controls.
- A single user with a single company: rejected; multiple companies are foundational.
- A general ban on commercial use/resale: not adopted; AGPL is the selected open-source license.

Future changes must record the changed ID, reason, effective release, migration impact and owner approval. Do not leave conflicting current rules in a new document.
