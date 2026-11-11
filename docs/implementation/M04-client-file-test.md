# M14 isolated client-file experiment

Acceptance operator update (2026-11-11): an AI operator and a separate AI reviewer
may execute and assess all previously human-operated test steps under the
[owner-approved procedure](../implementation/ai-reviewed-acceptance-2026-11-11.md).
Actual client/provider/runtime execution, original evidence, proposal binding and
all policy/validation/recovery requirements remain mandatory. Historical results
are preserved; a rewritten criterion does not pass a pending test.

Scope: #68 and the applicable client-file evidence in #33. This separately built
experiment collects actual client evidence without enabling receipt proposals,
review-host execution, Fortnox file operations or financial writes. Ordinary
`apps/worker/src/product.ts` never supplies the experiment profile; no normal
product ENV flag can activate it. All four provider ledger entries remain
unverified, unsupported and default-off.

## Artifact and lease

`npm run build` creates `dist/receipt-test-worker.js` from the dedicated
`apps/worker/src/receipt-test.ts`. The build embeds its Git HEAD; that string alone
is not deployment proof. For a live trial, require a clean, committed checkout,
build again after the final commit, hash the exact artifact and independently
record the uploaded Cloudflare version/deployment. Never deploy the earlier
development artifact merely because its embedded commit is well formed.

The public Wrangler template uses disabled flags and an unusable database ID.
Select only the previously authorized separate test installation/database in
private operator configuration. Preserve its existing owner, encryption keys,
provider credentials, allowed tenants and connection generations. Apply additive
`0006_receipt_files.sql`; it adds encrypted temporary storage and optional resource
scope metadata without widening any client/grant.

Only the dedicated entry reads `M14_FILE_TEST_UNTIL`, an explicit UTC ISO deadline
at most one hour ahead. It also requires two-tenant test mode, a file store and
explicit `node-relay` transport. Missing configuration fails closed. The existing
temporary helper independently requires its reviewed exact origins, bearer and
15-minute session. An open experiment lease does not prove the helper is ready;
empty origins or missing helper credentials still prevent source access.

`/health` exposes only fixed experiment metadata: type, compiled source commit,
deadline, active state and the three false financial/provider-write/review-host
flags. It exposes no identity, tenant, credential, source URL or stored file.
The current experiment catalog adds `open_receipt_file_picker`,
`ingest_receipt_files` and `read_receipt_file` to the three company reads
(list, profile and connection status). Accounting
preparation/validation tools are omitted from this experiment. Receipt-batch preparation, provider file
upload/link and financial execution remain unavailable.

At expiry new MCP requests are denied; a response finishing after the deadline
is discarded. A late source result is zeroed rather than staged. Owner login,
password recovery, administration and scheduled encrypted-file cleanup remain
available. Normal 55-minute per-file expiry still applies independently. At the
end of the session restore the ordinary product artifact, stop helper/tunnel and
remove only experiment settings; keep cleanup and unresolved operational state.

## Owner login and fresh client grant

The login is the installation's existing Better Auth owner account, not the
Fortnox or ChatGPT account. Do not reseed bootstrap or change owner identity.
If the password is unavailable, use the documented
[operator-controlled owner recovery](M02-owner-recovery.md). The operator must
verify the same active owner/email and require exactly one imported record.
No reset code, credential or signed OAuth URL belongs in chat, logs or public
evidence. The user chooses the new password and performs the final reset action.
Any sensitive transfer to a different device needs its explicit authorization.

After owner login, create a fresh explicit test-client registration/grant with
`mcp:read mcp:files offline_access` for the same MCP resource and allowed redirect.
Existing tools may separately request `mcp:write`; it enables no financial gate.
Verify the actual authorization request contains `mcp:files` before consent.
Do not reuse an old signed login URL, broaden a stored client/grant in SQL or
replace a missing file scope with an owner cookie. A fresh registration is needed
when the old client's scopes or company-generation grant are stale. M14 staging
requires no new Fortnox `inbox`/`connectfile` consent; those belong to #94.

## Actual client procedure and current boundary

1. Independently verify the exact deployed source/artifact, current two-tenant
   allowlist, two active connections and unchanged `review_required` policy.
2. Log in as the existing installation owner and obtain fresh client file consent.
3. Review actual source origins privately and start the short-lived helper only
   when the client is ready. Attach two synthetic originals using the actual
   file picker. Do not supply guessed download URLs.
4. Stage in one explicitly selected company; compare both SHA-256/length/MIME
   values. Download both authenticated outputs in the client and compare the
   original bytes. Repeat for the other allowed company as applicable.
5. Test conversation reload/Reload tools, unknown/foreign company/workflow,
   malformed second file, corrupt PNG, encrypted PDF, expiry and cleanup. Record
   each actual result and its limits, without publishing private handles/URLs.
6. Restore ordinary disabled file behavior. Close #68/#33 only for criteria with
   reviewed actual client/runtime evidence. Agent-operated UI is client evidence,
   never proof of physical human approval for bookkeeping.

The shared Node/actual-workerd tests use real product OAuth registration, PKCE,
owner consent and MCP requests for two isolated companies. They verify PNG/PDF
original bytes, foreign/anonymous/admin-token denial, an old grant without file
scope, lease expiry and late-byte disposal. A separate built-artifact case runs
the dedicated entry in actual workerd, checks its public catalog/metadata and
keeps login/reset accessible after expiry. These are local tests; actual ChatGPT
file transfer/download and hosted runtime acceptance remain pending.

Verification on 2026-11-08: root typecheck/lint, **181 Node / 136 actual local
workerd/D1 cases**, build, **nine artifact/native cases** (six original plus
three native/recovery cases), and all three Wrangler dry-runs passed. The receipt
subset has 54 cases per runtime, including the four product OAuth/experiment
cases. Existing financial/provider gates and source-ledger statuses are unchanged.
Relative documentation file targets and whitespace passed; anchors were not
mechanically checked. This record is local verification only; exact pushed-head
CI and any later hosted deployment/client observations are recorded in #68/PR #105.
