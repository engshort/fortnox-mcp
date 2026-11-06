# Source register

Reviewed on **2026-10-18**. Sources describe upstream behavior; project choices are in [decisions](../decisions.md). Online docs can change. Recheck affected sources and actual client/provider behavior during implementation.

F07 was rechecked on 2026-10-20 for the original documentation guide; F06 was
rechecked on 2026-10-20 for the small S10 operation-supplement pack. These checks
do not establish live company permissions or resolve the supplied snapshot's
missing acquisition/distribution evidence.

## Fortnox

| ID | Primary source | Used for |
| --- | --- | --- |
| F01 | [Developer portal](https://www.fortnox.se/developer/developer-portal) | Integration ownership, client credentials, scopes, publishing prerequisites |
| F02 | [Authorization](https://www.fortnox.se/developer/authorization) | Authorization-code flow, token lifetime and rotation |
| F03 | [Get authorization code](https://www.fortnox.se/developer/authorization/get-authorization-code) | State, service accounts, offline access and PKCE |
| F04 | [Client credentials](https://www.fortnox.se/developer/authorization/get-access-token-using-client-credentials) | Service consent, TenantId and token acquisition |
| F05 | [Rate limits](https://www.fortnox.se/developer/guides-and-good-to-know/rate-limits-for-fortnox-api) | 25 requests/5 seconds and client/tenant budget |
| F06 | [Scopes](https://www.fortnox.se/developer/guides-and-good-to-know/scopes) | Resource scopes, read/write scope limitation and licenses |
| F07 | [Parameters](https://www.fortnox.se/developer/guides-and-good-to-know/parameters) | Global filters, fiscal years and pagination |
| F08 | [Errors](https://www.fortnox.se/developer/guides-and-good-to-know/errors) | Provider error representation |
| F09 | [Voucher best practice](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers) | Year/account/series checks and attachment workflow |
| F10 | [Fortnox API reference](https://api.fortnox.se/apidocs) | Current reference and OpenAPI download; compare against supplied snapshot |
| F11 | [Exportera SIE-fil](https://support.fortnox.se/produkthjalp/bokforing/exportera-sie-fil) | SIE1–4 data contents and one-year export boundary; UI guidance, not proof of every API parameter |
| F12 | [Websockets](https://www.fortnox.se/developer/guides-and-good-to-know/websockets) | Future event expansion, minimal events and replay; not a v1 dependency |
| F13 | [Legal and change policies](https://www.fortnox.se/developer/guides-and-good-to-know/legal-and-change-policies) | Upstream change handling and terms links |
| F14 | [Integration checklist](https://www.fortnox.se/developer/checklist) | Developer access and test databases |
| F15 | [Delete values](https://www.fortnox.se/developer/guides-and-good-to-know/delete-values) | Field clearing differs from omission; verify per endpoint |
| F16 | [Salary endpoint rights](https://www.fortnox.se/developer/blog/security-fixes-to-several-salary-endpoints) | Historical explanation of corresponding salary rights; verify current behavior |

## MCP and clients

| ID | Primary source | Used for |
| --- | --- | --- |
| M01 | [MCP SDKs](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/sdk.mdx) | Official SDK choices and support tiers |
| M02 | [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | Protocol-era changes; compatibility must be tested |
| M03 | [Tool annotations](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/) | Hints versus enforceable authorization |
| M04 | [MCP Apps patterns](https://apps.extensions.modelcontextprotocol.io/api/documents/patterns.html) | App-only tools and UI interactions |
| M05 | [Elicitation specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/client/elicitation.mdx) | User interaction, URL/form distinctions and server verification |
| O01 | [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server) | Tool/server authentication and annotations |
| O02 | [OpenAI plugin reference](https://developers.openai.com/plugins/reference) | UI visibility, tool results, file inputs and compatibility fields |
| O03 | [OpenAI MCP UI guide](https://developers.openai.com/plugins/build/chatgpt-ui) | Embedded views and host bridge |

Actual ChatGPT/Claude plan, workspace and UI availability are not established solely by protocol docs. Record exact client evidence in S00/S12; do not infer universal support from examples.

## Hosting and licensing

| ID | Primary source | Used for |
| --- | --- | --- |
| H01 | [Cloudflare remote MCP](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/) | Worker deployment direction |
| H02 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Resource budgets to benchmark |
| H03 | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Free/paid constraints; recheck before estimating costs |
| H04 | [Project Alexandria](https://www.cloudflare.com/en-gb/lp/project-alexandria/) | Potential OSS sponsorship; no acceptance assumed |
| L01 | [OSI AGPL-3.0](https://opensource.org/license/agpl-3.0) | Approved open-source license and license text |
| L02 | [GNU license FAQ](https://www.gnu.org/licenses/gpl-faq.en.html) | Private modifications, distribution and network-source obligations |
| L03 | [Open Source Definition](https://opensource.org/osd) | Commercial redistribution and open-source terminology |

## Supplied specification

Additional local input reviewed on **2026-11-06**: a user-supplied OpenAPI 3.0.3
snapshot with SHA-256
`10600267abe8addf88b240337317d666fedc7d469a419e18443d3cf63c4d10e7`
(1,701,157 bytes, 285 paths, 451 operations). It is kept only as ignored private
documentation input. Acquisition URL/date and redistribution permission are not
established; no license is declared. This does not replace the older source lock,
approve G05/#35, or establish live behavior. Its account-list contract makes
transaction-information settings optional; named account requirements use
`MANDATORY`. These facts inform independently written parsing and synthetic
tests, with unknown numeric semantics still blocked. Its separate account-detail
contract identifies `AccountController_doShow` (`GET /3/accounts/{Number}`,
`Account` envelope), with named transaction-information settings. This supports
an independently implemented selected-account read, not inferred numeric rules. No source copy or generated
implementation is distributed.

See [source-lock.json](source-lock.json). It was analyzed locally; no live Fortnox requests were made. The source file is not redistributed here because no license field establishes redistribution terms. Resource counts and original classifications are recorded in [resource-inventory.json](resource-inventory.json).

The snapshot contains mixed API families, missing security declarations for most operations, example/demo auth schemes and inconsistent parameter/schema details. Absence of `security` does not mean anonymous access. Never use an embedded demo authorization URL as an endpoint for this integration.
