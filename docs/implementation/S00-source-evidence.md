# S00 source provenance and redistribution (G05)

**2026-11-05:** the official legal page and linked developer agreement were
reviewed again. The [owner evidence/request packet](S00-source-rights-request.md)
records missing acquisition evidence, unsent questions and the unchanged
distribution block. No specification was acquired or permission inferred.

Status on 2026-10-18: **precisely blocked for vendored/generated redistribution**.
The project may continue its independently written synthetic probes. No
Fortnox specification or generated provider implementation is redistributed.

The existing [source lock](../reference/source-lock.json) identifies the supplied
snapshot by SHA-256
`bee13230dab8fbc4e9e3339073299552a1cac5f253b05e705c928e4fa81bb4aa`,
size 1,576,933 bytes and OpenAPI 3.0.3, with no declared license. This is the
previously recorded local snapshot identity, not a new download or a proof of
acquisition rights. The exact acquisition URL/date and applicable permission
for that supplied copy are not recorded.

On 2026-10-18, the official [Legal & Change Policies page](https://www.fortnox.se/developer/guides-and-good-to-know/legal-and-change-policies)
linked a [Developer Agreement PDF](https://a.storyblok.com/f/134143/x/a98750f93c/developer.pdf)
dated 2021-06-10. Sections 3, 5.7 and 6 distinguish API integration use from
additional uses and ownership/publication/copying rights. The reviewed text does
not establish a permissive redistribution license for this OpenAPI snapshot or
its generated output. This is an unresolved permission question, not a claim
that every independently written integration is prohibited. No agreement was
accepted or support message sent during this read-only check.

The public [API reference](https://api.fortnox.se/apidocs) was also checked;
the research fetch exceeded its response-size limit. No new specification was
obtained, hashed, committed or used to generate code.

Before vendoring or generated-output distribution, record the exact authorized
source URL/date and hash, and obtain explicit applicable redistribution terms
or a reviewed written permission covering both the specification and generated
output. Keep provider material separately attributed; do not relabel it AGPL
because the surrounding project is AGPL. Resolve whether consumers instead
obtain the authorized source locally, and what generated material can ship.

The maintained-library strategy is separate: exact versions/integrity stay in
lockfiles and attribution in [third-party notices](../../THIRD_PARTY_NOTICES.md).
The G04 OAuth client and the dependency-free G02 view introduce no vendored
Fortnox schema. This record does not close G05 or authorize redistribution.
