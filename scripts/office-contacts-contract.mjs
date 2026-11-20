import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const uuid = z.string().uuid();
export const officeContractConfig = z
  .object({
    origin: z.url(),
    access_token: z.string().min(1),
    bureau_company_id: uuid,
    customer_company_id: uuid,
    organisation_number: z.string().regex(/^\d{10}$/),
    allow_integration_users_unavailable: z.boolean().default(true),
  })
  .strict();
const output = z
  .object({
    status: z.literal("ok"),
    company_id: uuid,
    data: z
      .object({
        records: z.array(
          z
            .object({
              id: z.string().min(1),
              name: z.string().trim().min(1),
              email: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    evidence: z.object({ complete: z.boolean() }).strict(),
    continuation: uuid.nullable(),
  })
  .strict();

// Consumer-side check usable by both repositories. No contacts, identifiers,
// credentials, provider bodies or request URLs are written to the result.
export async function runOfficeContactsContract(input, send = fetch) {
  const config = officeContractConfig.parse(input);
  const origin = new URL(config.origin);
  if (origin.origin !== config.origin || origin.protocol !== "https:")
    throw new Error("invalid_contract_configuration");
  const headers = {
    authorization: `Bearer ${config.access_token}`,
    accept: "application/json",
  };
  const result = [];
  for (const [source, company] of [
    ["customer-register", config.bureau_company_id],
    ["payroll", config.customer_company_id],
    ["integration-users", config.customer_company_id],
  ]) {
    let continuation = null,
      pages = 0,
      records = 0;
    const seen = new Set();
    for (;;) {
      const url = new URL(
        `${origin.origin}/api/v1/companies/${company}/office-contacts/${source}`,
      );
      if (source === "customer-register")
        url.searchParams.set("organisation_number", config.organisation_number);
      else if (continuation) url.searchParams.set("continuation", continuation);
      const response = await send(
        new Request(url, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        }),
      );
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error("contact_contract_failed");
      }
      const body = await response.json();
      if (
        source === "integration-users" &&
        pages === 0 &&
        config.allow_integration_users_unavailable &&
        response.status === 403 &&
        body?.status === "error" &&
        body?.error?.code === "OFFICE_CONTACTS_SOURCE_UNAVAILABLE"
      ) {
        result.push({
          source,
          outcome: "source_unavailable",
          pages: 0,
          records: 0,
        });
        break;
      }
      if (
        response.status !== 200 ||
        response.headers.get("cache-control") !== "no-store"
      )
        throw new Error("contact_contract_failed");
      const value = output.parse(body);
      if (
        value.company_id !== company ||
        value.evidence.complete !== (value.continuation === null) ||
        (source === "customer-register" &&
          (value.continuation !== null || value.data.records.length > 1))
      )
        throw new Error("contact_contract_failed");
      records += value.data.records.length;
      pages++;
      if (value.continuation === null) {
        result.push({ source, outcome: "complete", pages, records });
        break;
      }
      if (seen.has(value.continuation) || pages >= 10000)
        throw new Error("contact_contract_failed");
      seen.add(value.continuation);
      continuation = value.continuation;
    }
  }
  return { version: "office-contacts-v1", checks: result };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const file = process.env.OFFICE_CONTACTS_CONTRACT_CONFIG;
    if (!file) throw new Error();
    const info = await stat(file);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65536)
      throw new Error();
    const config = JSON.parse(await readFile(file, "utf8"));
    console.log(JSON.stringify(await runOfficeContactsContract(config)));
  } catch {
    console.error(
      "Office contacts contract incomplete. Check private configuration, consent, source availability and server evidence; no private values were emitted.",
    );
    process.exitCode = 1;
  }
}
