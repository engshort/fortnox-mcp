# Contributing

We welcome code, tests, documentation, translations and practical feedback from business owners and accounting firms. The project is independent and community-oriented.

Questions, issues and development discussions are welcome in **Swedish or English**. Code, API identifiers and technical reference documentation use English. The default [README](README.md) is the Swedish user introduction; the [English developer README](README.en.md) is the contributor entry point. Use [GitHub Discussions](https://github.com/alex-engvall/fortnox-mcp/discussions) for questions and ideas, and issues for actionable tasks and defects.

## Current state

This repository starts with an approved specification. There is not yet an installable server. Start with [the scope queue](docs/implementation/README.md); S00 and S01 establish feasibility and the executable development setup.

## Contribution flow

1. Find or open an issue with a concrete use case and expected result. Check the [decisions](docs/decisions.md) and coverage matrix first.
2. Work on a branch and keep the scope small enough to review. Discuss product changes before implementing them.
3. Add behavior tests appropriate to the change and update affected English and Swedish documentation.
4. Open a PR describing the problem, resulting behavior, evidence and remaining limitations. Include the scope ID.
5. A maintainer reviews correctness, authorization, data handling and compatibility before merging.

AI-assisted contributions are welcome. The submitter remains responsible for understanding and verifying the change. Include which tests ran and disclose unresolved assumptions; fabricated test results or source claims are unacceptable.

Coding agents start with the [agent guide](docs/AGENT-GUIDE.md).
The optional [Labstride issue-to-review workflow](docs/development.md#optional-labstride-issue-to-review-workflow)
and [Swedish owner guide](docs/users/labstride.sv.md) describe the separate issue
start authorization, same-chat plan approval and coordinator-managed draft PR/CI
handoff. Labstride is not required for contributions.

## Development conventions

- TypeScript with strict checking; explicit runtime schemas at external boundaries.
- Exact decimal money values, explicit company and fiscal-year context, UTC instants and Swedish business-date handling as specified in contracts.
- Prefer a small number of runtime dependencies and the official MCP SDK. Select and lock tested versions during S01, following S00 compatibility evidence.
- No production data in examples. Use synthetic data that cannot be mistaken for real customers.
- No direct provider requests from tool handlers that bypass the domain layer.

Runnable root commands and current limitations are documented in [development setup](docs/development.md). The local foundation uses synthetic data; integrations and hosted-client acceptance remain separate gates.

## Licensing and contributor agreement

Public project code and documentation continue to be distributed under [AGPL-3.0-only](LICENSE). By submitting a contribution, you agree to license your original contribution under AGPL-3.0-only and confirm that you have the right to submit it. **Contributors retain copyright in their original work.** A signed [Contributor License Agreement (CLA)](CLA.md) grants **Easy Today AB** additional, non-exclusive rights to use the contributions covered by that agreement in open-source and separately licensed commercial products. It is not a copyright assignment, and it does not make the public Project proprietary.

Once the CLA signing process has been activated, external contributors must sign the current agreement before their code, documentation or other copyrightable work can be merged. A maintainer or automated check will request signing in the pull request. The agreement only covers intentionally submitted work under the accepted version; it does not retroactively license earlier work. **The CLA automation is not active until its [maintainer setup](docs/maintainers/cla-setup.md) has been completed and verified.**

If you contribute on behalf of an employer, customer or another legal entity, check who owns the work and arrange appropriate authority to grant the rights. A personal GitHub signature does not automatically establish a company's approval. Identify co-authors and any third-party material; an automated CLA check cannot determine ownership or rights to external code.

See [CLA.md](CLA.md) for the exact terms and [GOVERNANCE.md](GOVERNANCE.md) for how the community project and any separately licensed products coexist.

Do not copy upstream documentation, specifications or code merely because it is publicly accessible. Record provenance and permissions; see [third-party notices](THIRD_PARTY_NOTICES.md).

Read the [code of conduct](CODE_OF_CONDUCT.md) and use the [security reporting process](SECURITY.md) for vulnerabilities.
