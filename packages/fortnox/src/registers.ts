import {
  type AccountingActor,
  articleFields,
  assertScopeProgram,
  type Connections,
  customerFields,
  DomainError,
  parseAmount,
  priceSelection,
  type RegisterFields,
  type RegisterOperation,
  type RegisterPage,
  type RegisterProvider,
  type RegisterRecord,
  type RegisterResource,
  registerDecimal,
  registerId,
  registerScope,
  registerVersion,
  supplierFields,
  type WritableRegister,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import {
  boundedResponse,
  FortnoxHttp,
  type ProviderContext,
  ProviderError,
  parseExactProviderJson,
} from "./http.js";

const label = z.string().max(4096);
const reference = z.object({ Code: registerId, Description: label });
const optionalText = z.string().max(1024).optional();
const projectedParty = {
  Active: z.boolean().optional(),
  Name: label,
  Address1: optionalText,
  Address2: optionalText,
  City: optionalText,
  ZipCode: optionalText,
  CountryCode: optionalText,
  Email: optionalText,
  Phone1: optionalText,
  OrganisationNumber: optionalText,
  Currency: optionalText,
  TermsOfPayment: optionalText,
  CostCenter: optionalText,
  Project: optionalText,
  OurReference: optionalText,
  YourReference: optionalText,
};
// Input schemas are strict; source projections allow provider defaults and other
// article types on reads. Unknown source fields contribute to the version hash.
export const registerOutputFields = {
  customer: z.object({
    ...projectedParty,
    CustomerNumber: registerId,
    Type: optionalText,
    VATType: optionalText,
    PriceList: optionalText,
    TermsOfDelivery: optionalText,
    WayOfDelivery: optionalText,
  }),
  supplier: z.object({ ...projectedParty, SupplierNumber: registerId }),
  article: z.object({
    ArticleNumber: registerId,
    Description: label,
    Active: z.boolean().optional(),
    Type: optionalText,
    Unit: optionalText,
    SupplierNumber: optionalText,
    SalesPrice: registerDecimal.optional(),
    PurchasePrice: registerDecimal.optional(),
    VAT: registerDecimal.optional(),
  }),
  terms_of_payment: reference,
  terms_of_delivery: reference.extend({ DescriptionEnglish: optionalText }),
  way_of_delivery: reference.extend({ DescriptionEnglish: optionalText }),
  currency: reference.extend({
    BuyRate: registerDecimal.optional(),
    SellRate: registerDecimal.optional(),
    Unit: registerDecimal.optional(),
    Date: optionalText,
    IsAutomatic: z.boolean().optional(),
  }),
  unit: reference.extend({ CodeEnglish: optionalText }),
  cost_center: reference.extend({ Active: z.boolean() }),
  project: z.object({
    ProjectNumber: registerId,
    Description: label,
    Status: z.enum(["NOTSTARTED", "ONGOING", "COMPLETED"]),
  }),
  price_list: reference,
  price: z.object({
    ArticleNumber: registerId,
    PriceList: registerId,
    FromQuantity: registerDecimal,
    Price: registerDecimal,
    Percent: registerDecimal.optional(),
    Date: optionalText,
  }),
  mode_of_payment: reference.extend({
    AccountNumber: z.string().regex(/^\d{4}$/),
  }),
};
export const registerProviderResources = {
  customer: {
    path: "customers",
    single: "Customer",
    list: "Customers",
    identity: "CustomerNumber",
    paged: true,
  },
  supplier: {
    path: "suppliers",
    single: "Supplier",
    list: "Suppliers",
    identity: "SupplierNumber",
    paged: true,
  },
  article: {
    path: "articles",
    single: "Article",
    list: "Articles",
    identity: "ArticleNumber",
    paged: true,
  },
  terms_of_payment: {
    path: "termsofpayments",
    single: "TermsOfPayment",
    list: "TermsOfPayments",
    identity: "Code",
    paged: true,
  },
  terms_of_delivery: {
    path: "termsofdeliveries",
    single: "TermsOfDelivery",
    list: "TermsOfDeliveries",
    identity: "Code",
    paged: false,
  },
  way_of_delivery: {
    path: "wayofdeliveries",
    single: "WayOfDelivery",
    list: "WayOfDeliveries",
    identity: "Code",
    paged: false,
  },
  currency: {
    path: "currencies",
    single: "Currency",
    list: "Currencies",
    identity: "Code",
    paged: false,
  },
  unit: {
    path: "units",
    single: "Unit",
    list: "Units",
    identity: "Code",
    paged: false,
  },
  cost_center: {
    path: "costcenters",
    single: "CostCenter",
    list: "CostCenters",
    identity: "Code",
    paged: false,
  },
  project: {
    path: "projects",
    single: "Project",
    list: "Projects",
    identity: "ProjectNumber",
    paged: true,
  },
  price_list: {
    path: "pricelists",
    single: "PriceList",
    list: "PriceLists",
    identity: "Code",
    paged: false,
  },
  price: {
    path: "prices",
    single: "Price",
    list: "Prices",
    identity: "ArticleNumber",
    paged: true,
  },
  mode_of_payment: {
    path: "modesofpayments",
    single: "ModeOfPayment",
    list: "ModesOfPayments",
    identity: "Code",
    paged: false,
  },
} as const;
const integer = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number);
const metaSchema = z.object({
  "@CurrentPage": integer,
  "@TotalPages": integer,
  "@TotalResources": integer.optional(),
});
const exactFields = new Set(["SalesPrice", "PurchasePrice", "VAT"]);
function bodyFor(
  resource: WritableRegister,
  id: string | null,
  fields: RegisterFields,
) {
  const schema = {
    customer: customerFields,
    supplier: supplierFields,
    article: articleFields,
  }[resource];
  const parsed = schema.partial().parse(fields) as RegisterFields;
  const entries = Object.entries(parsed).map(
    ([k, v]) =>
      `${JSON.stringify(k)}:${exactFields.has(k) ? parseAmount(v, 6) : JSON.stringify(v)}`,
  );
  if (id !== null)
    entries.push(
      `${JSON.stringify(registerProviderResources[resource].identity)}:${JSON.stringify(registerId.parse(id))}`,
    );
  return `{${JSON.stringify(registerProviderResources[resource].single)}:{${entries.join(",")}}}`;
}

export class FortnoxRegisters implements RegisterProvider {
  readonly http: FortnoxHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly enabled: readonly RegisterOperation[] = [],
    readonly now = Date.now,
    readonly active: () => boolean = () => false,
  ) {
    this.http = new FortnoxHttp({
      fetch: provider.config.fetch,
      state: connections.state,
      now,
    });
  }
  private async context(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    action: "list" | "get" | "create" | "update",
  ): Promise<ProviderContext> {
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    const assert = async () => {
      const current = await this.connections.authorize(
        actor.ownerId,
        actor.clientId,
        company,
      );
      assertScopeProgram(current, registerScope(resource));
      if (
        !this.active() ||
        current.generation !== c.generation ||
        !this.provider.config.testTenants.includes(current.tenant)
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      if (
        !this.enabled.includes(`${resource}.${action}` as RegisterOperation) ||
        !actor.scopes.includes("mcp:read") ||
        !current.scopes.includes(registerScope(resource))
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      if (action === "create" || action === "update") {
        if (current.readOnly || !actor.scopes.includes("mcp:write"))
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        await this.connections.assertWritesAllowed();
      }
    };
    await assert();
    return {
      owner: actor.ownerId,
      company,
      tenant: c.tenant,
      generation: c.generation,
      clientId: (await this.connections.credentials(actor.ownerId, c)).clientId,
      assertActive: assert,
      token: (force) => this.provider.token(actor.ownerId, c, force),
    };
  }
  private url(
    resource: RegisterResource,
    id: string | null,
    query: Record<string, string>,
    page?: number,
  ) {
    const spec = registerProviderResources[resource];
    let path = `/3/${spec.path}`;
    if (resource === "price") {
      const selection = priceSelection.parse(query);
      path += `${id === null ? "/sublist" : ""}/${encodeURIComponent(selection.price_list)}/${encodeURIComponent(selection.article_number)}`;
    } else if (id !== null)
      path += `/${encodeURIComponent(registerId.parse(id))}`;
    const url = new URL(path, "https://api.fortnox.se");
    if (resource !== "price")
      for (const [key, value] of Object.entries(query))
        url.searchParams.set(key, value);
    if (resource === "price" && id !== null)
      url.searchParams.set("fromquantity", "0");
    if (page !== undefined && spec.paged) {
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", "100");
    }
    return url;
  }
  private async read(context: ProviderContext, url: URL, until = Infinity) {
    const deadline = Math.min(this.now() + 15000, until);
    let renew = false;
    let renewed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.http.permit(context, deadline);
      const token = await context.token(renew);
      renew = false;
      await context.assertActive();
      let response: Response;
      try {
        response = await this.provider.config.fetch(
          new Request(url, {
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/json",
            },
            redirect: "manual",
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(5000, deadline - this.now())),
            ),
          }),
        );
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "network");
      }
      if (
        (response.status === 401 && !renewed) ||
        ((response.status === 429 || response.status >= 500) && attempt < 2)
      ) {
        await response.body?.cancel();
        if (response.status === 401) {
          renew = true;
          renewed = true;
        }
        // Shared durable pacing bounds retries; do not retry writes.
        if (response.status !== 401) {
          const retry = response.headers.get("retry-after");
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
          const wait = seconds ? seconds * 1000 : 250 * 2 ** attempt;
          if (this.now() + wait >= deadline)
            throw new ProviderError("RATE_LIMITED", "read_budget");
          await new Promise((r) => setTimeout(r, wait));
        }
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404)
          throw new ProviderError("UPSTREAM_UNAVAILABLE", "record_not_found");
        throw new ProviderError(
          response.status === 403
            ? "CAPABILITY_UNAVAILABLE"
            : response.status === 401
              ? "RECONNECT_REQUIRED"
              : "UPSTREAM_UNAVAILABLE",
          response.status === 403
            ? "permission_scope_or_license_unknown"
            : "provider_error",
        );
      }
      let raw: unknown;
      try {
        raw = parseExactProviderJson(await boundedResponse(response, 262144));
      } catch {
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_response");
      }
      await context.assertActive();
      return z.record(z.string(), z.unknown()).parse(raw);
    }
    throw new ProviderError("UPSTREAM_UNAVAILABLE", "read_budget");
  }
  private async record(
    resource: RegisterResource,
    raw: unknown,
  ): Promise<RegisterRecord> {
    const parsed = registerOutputFields[resource].safeParse(raw);
    if (!parsed.success)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "invalid_register_response",
      );
    const fields = parsed.data as RegisterFields;
    const id = registerId.parse(
      fields[registerProviderResources[resource].identity],
    );
    const source = z.record(z.string(), z.unknown()).parse(raw);
    const { "@url": _url, ...versioned } = source;
    return { id, fields, version: await registerVersion(versioned) };
  }
  async page(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    query: Record<string, string>,
    page: number,
    until?: number,
  ): Promise<RegisterPage> {
    const context = await this.context(actor, company, resource, "list");
    const spec = registerProviderResources[resource];
    const raw = await this.read(
      context,
      this.url(resource, null, query, page),
      until,
    );
    const rows = z.array(z.unknown()).max(500).parse(raw[spec.list]);
    const records: RegisterRecord[] = [];
    for (const row of rows) {
      const record = await this.record(resource, row);
      if (
        resource === "price" &&
        (record.fields.PriceList !== query.price_list ||
          record.id !== query.article_number)
      )
        throw new ProviderError("UPSTREAM_UNAVAILABLE", "reference_mismatch");
      records.push(record);
    }
    if (!spec.paged) return { records, next_page: null, complete: true };
    const meta = metaSchema.safeParse(raw.MetaInformation);
    if (!meta.success) return { records, next_page: null, complete: false };
    const current = meta.data["@CurrentPage"],
      total = meta.data["@TotalPages"];
    if (
      current !== page ||
      (total < current && !(total === 0 && page === 1 && !records.length))
    )
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
    return {
      records,
      next_page: current < total ? current + 1 : null,
      complete: current >= total,
    };
  }
  async get(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    id: string,
    selection?: z.infer<typeof priceSelection>,
  ): Promise<RegisterRecord> {
    const context = await this.context(actor, company, resource, "get");
    const spec = registerProviderResources[resource];
    const raw = await this.read(
      context,
      this.url(resource, id, selection ?? {}),
    );
    const record = await this.record(resource, raw[spec.single]);
    if (
      record.id !== id ||
      (resource === "price" &&
        record.fields.PriceList !== selection?.price_list)
    )
      throw new ProviderError("UPSTREAM_UNAVAILABLE", "reference_mismatch");
    return record;
  }
  async write(
    actor: AccountingActor,
    company: string,
    resource: WritableRegister,
    action: "create" | "update",
    id: string | null,
    fields: RegisterFields,
    beforeDispatch: () => Promise<void>,
  ) {
    const context = await this.context(actor, company, resource, action);
    const body = bodyFor(resource, action === "create" ? id : null, fields);
    const url = this.url(resource, action === "update" ? id : null, {});
    await this.http.permit(context, this.now() + 15000);
    const token = await context.token(false);
    await context.assertActive();
    await beforeDispatch();
    let reference: string | undefined;
    try {
      const response = await this.provider.config.fetch(
        new Request(url, {
          method: action === "create" ? "POST" : "PUT",
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body,
        }),
      );
      if (!response.ok) {
        await response.body?.cancel();
        return { state: "outcome_unknown" as const };
      }
      const raw = z
        .record(z.string(), z.unknown())
        .parse(parseExactProviderJson(await boundedResponse(response)));
      const record = await this.record(
        resource,
        raw[registerProviderResources[resource].single],
      );
      if (id !== null && record.id !== id)
        return { state: "outcome_unknown" as const };
      reference = record.id;
      const readback = await this.get(actor, company, resource, reference);
      const matches = Object.entries(fields).every(([key, value]) =>
        exactFields.has(key)
          ? parseAmount(readback.fields[key], 6) === parseAmount(value, 6)
          : readback.fields[key] === value,
      );
      return {
        state: matches ? ("succeeded" as const) : ("outcome_unknown" as const),
        reference,
      };
    } catch {
      return {
        state: "outcome_unknown" as const,
        ...(reference ? { reference } : {}),
      };
    }
  }
}
