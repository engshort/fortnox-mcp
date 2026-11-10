import { z } from "zod";
import { accountingHash } from "./accounting.js";
import type { AccountingActor } from "./bookkeeping.js";
import {
  type BusinessOperation,
  BusinessWrites,
  type PreparedBusinessWrite,
} from "./business-writes.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import { parseAmount } from "./money.js";
import { assertScopeProgram } from "./programs.js";

// Independently modeled bounded register profile. Provider URLs, account defaults,
// stock adjustments, bank instructions and delivery-channel defaults are excluded.
export const registerId = z.string().regex(/^[A-Za-z0-9ÅÄÖåäö_. -]{1,50}$/);
const text = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => v !== "API_BLANK");
const code = registerId;
const currency = z.string().regex(/^[A-Z]{3}$/);
export const registerDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/);
const common = {
  Name: text,
  Active: z.boolean().optional(),
  Address1: text.optional(),
  Address2: text.optional(),
  City: text.optional(),
  ZipCode: z.string().min(1).max(10).optional(),
  CountryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  Email: z.email().max(254).optional(),
  Phone1: text.optional(),
  OrganisationNumber: z.string().min(1).max(30).optional(),
  Currency: currency.optional(),
  TermsOfPayment: code.optional(),
  CostCenter: code.optional(),
  Project: code.optional(),
  OurReference: z.string().min(1).max(50).optional(),
  YourReference: z.string().min(1).max(50).optional(),
};
export const customerFields = z
  .object({
    ...common,
    Type: z.enum(["PRIVATE", "COMPANY"]).optional(),
    VATType: z
      .enum(["SEVAT", "SEREVERSEDVAT", "EUREVERSEDVAT", "EUVAT", "EXPORT"])
      .optional(),
    PriceList: code.optional(),
    TermsOfDelivery: code.optional(),
    WayOfDelivery: code.optional(),
  })
  .strict();
export const supplierFields = z.object({ ...common }).strict();
export const articleFields = z
  .object({
    Description: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => v !== "API_BLANK"),
    Active: z.boolean().optional(),
    Type: z.literal("SERVICE"),
    Unit: code.optional(),
    SupplierNumber: registerId.optional(),
    SalesPrice: registerDecimal.optional(),
    PurchasePrice: registerDecimal.optional(),
    VAT: registerDecimal.refine((v) => Number(v) <= 100).optional(),
  })
  .strict();
export const writableRegisters = {
  customer: {
    scope: "customer",
    identity: "CustomerNumber",
    schema: customerFields,
  },
  supplier: {
    scope: "supplier",
    identity: "SupplierNumber",
    schema: supplierFields,
  },
  article: {
    scope: "article",
    identity: "ArticleNumber",
    schema: articleFields,
  },
} as const;
export type WritableRegister = keyof typeof writableRegisters;
export const referenceScopes = {
  terms_of_payment: "settings",
  terms_of_delivery: "settings",
  way_of_delivery: "settings",
  currency: "currency",
  unit: "settings",
  cost_center: "costcenter",
  project: "project",
  price_list: "price",
  price: "price",
  mode_of_payment: "settings",
} as const;
export type ReferenceRegister = keyof typeof referenceScopes;
export type RegisterResource = WritableRegister | ReferenceRegister;
export type RegisterFields = Record<string, string | boolean>;
export interface RegisterRecord {
  id: string;
  fields: RegisterFields;
  version: string;
}
export interface RegisterPage {
  records: RegisterRecord[];
  next_page: number | null;
  complete: boolean;
}
export const registerQueries = {
  customer: z
    .object({
      name: text.optional(),
      customernumber: registerId.optional(),
      filter: z.enum(["active", "inactive"]).optional(),
    })
    .strict(),
  supplier: z
    .object({ name: text.optional(), suppliernumber: registerId.optional() })
    .strict(),
  article: z
    .object({
      description: text.optional(),
      articlenumber: registerId.optional(),
      filter: z.enum(["active", "inactive"]).optional(),
    })
    .strict(),
};
export const priceSelection = z
  .object({ price_list: code, article_number: registerId })
  .strict();
export interface RegisterProvider {
  page(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    query: Record<string, string>,
    page: number,
    until?: number,
  ): Promise<RegisterPage>;
  get(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    id: string,
    selection?: z.infer<typeof priceSelection>,
  ): Promise<RegisterRecord>;
  write(
    actor: AccountingActor,
    company: string,
    resource: WritableRegister,
    action: "create" | "update",
    id: string | null,
    fields: RegisterFields,
    beforeDispatch: () => Promise<void>,
  ): Promise<{
    state: "succeeded" | "failed" | "outcome_unknown";
    reference?: string;
  }>;
}
export type RegisterOperation =
  | `${RegisterResource}.list`
  | `${RegisterResource}.get`
  | `${WritableRegister}.create`
  | `${WritableRegister}.update`;
export const registerOperationIds: readonly RegisterOperation[] = [
  ...Object.keys(writableRegisters).flatMap((r) =>
    ["list", "get", "create", "update"].map(
      (a) => `${r}.${a}` as RegisterOperation,
    ),
  ),
  ...Object.keys(referenceScopes).flatMap((r) =>
    ["list", "get"].map((a) => `${r}.${a}` as RegisterOperation),
  ),
];
export function registerScope(resource: RegisterResource) {
  return Object.hasOwn(writableRegisters, resource)
    ? writableRegisters[resource as WritableRegister].scope
    : referenceScopes[resource as ReferenceRegister];
}
const pendingRegister = z
  .object({
    id: registerId.nullable(),
    fields: z.record(z.string(), z.union([z.string(), z.boolean()])),
  })
  .strict();
export class Registers {
  readonly writes: BusinessWrites;
  constructor(
    readonly connections: Connections,
    readonly provider: RegisterProvider,
    readonly enabled: readonly RegisterOperation[] = [],
  ) {
    if (enabled.some((id) => !registerOperationIds.includes(id)))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    for (const resource of Object.keys(writableRegisters) as WritableRegister[])
      if (
        (enabled.includes(`${resource}.create`) ||
          enabled.includes(`${resource}.update`)) &&
        !enabled.includes(`${resource}.get`)
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    const operations: Record<string, BusinessOperation> = {};
    for (const resource of Object.keys(writableRegisters) as WritableRegister[])
      for (const action of ["create", "update"] as const) {
        const operation = `${resource}.${action}` as const;
        operations[operation] = {
          scope: writableRegisters[resource].scope,
          enabled: enabled.includes(operation),
          evidence: async (p) => {
            const input = pendingRegister.parse(p.input);
            return {
              target: input.id,
              fields: Object.keys(input.fields).sort(),
              digest: await registerFieldsHash(input.fields),
            };
          },
          reconcile: async (actor, company, e) => {
            const id = e.reference ?? e.evidence?.target;
            if (!id || !e.evidence) return { state: "outcome_unknown" };
            try {
              const record = (await this.get(actor, company, resource, id))
                .record;
              const selected = Object.fromEntries(
                e.evidence.fields.map((key) => [key, record.fields[key]]),
              );
              if (Object.values(selected).some((v) => v === undefined))
                return { state: "outcome_unknown" };
              return {
                state:
                  (await registerFieldsHash(selected as RegisterFields)) ===
                  e.evidence.digest
                    ? "succeeded"
                    : "outcome_unknown",
                reference: id,
              };
            } catch {
              return { state: "outcome_unknown" };
            }
          },
          prepare: (actor, company, input) =>
            this.prepareBody(actor, company, resource, action, input),
          validate: (actor, company, p) =>
            this.validateBody(actor, company, resource, p),
          dispatch: async (actor, company, p, beforeDispatch) => {
            const input = pendingRegister.parse(p.input);
            return provider.write(
              actor,
              company,
              resource,
              action,
              input.id,
              input.fields,
              beforeDispatch,
            );
          },
        };
      }
    this.writes = new BusinessWrites(connections, operations);
  }
  private async authorize(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    action: "list" | "get" | "create" | "update",
  ) {
    z.string().uuid().parse(company);
    if (!actor.scopes.includes("mcp:read"))
      throw new DomainError("AUTH_REQUIRED");
    if (!this.enabled.includes(`${resource}.${action}` as RegisterOperation))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(c, registerScope(resource));
    if (!c.scopes.includes(registerScope(resource)))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return c;
  }
  async list(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    input: unknown = {},
    start = 1,
  ) {
    await this.authorize(actor, company, resource, "list");
    z.number().int().min(1).max(10000).parse(start);
    const query = Object.hasOwn(registerQueries, resource)
      ? registerQueries[resource as WritableRegister].parse(input)
      : resource === "price"
        ? priceSelection.parse(input)
        : z.object({}).strict().parse(input);
    const records: RegisterRecord[] = [];
    const seen = new Set<string>();
    const until = Date.now() + 15000;
    let page = start,
      complete = false,
      next: number | null = start;
    for (let i = 0; i < 5 && Date.now() < until; i++) {
      const result = await this.provider.page(
        actor,
        company,
        resource,
        query as Record<string, string>,
        page,
        until,
      );
      if (
        records.length + result.records.length > 500 ||
        JSON.stringify([...records, ...result.records]).length > 262144
      )
        break;
      for (const record of result.records) {
        const key =
          resource === "price"
            ? `${record.id}:${record.fields.FromQuantity}`
            : record.id;
        if (seen.has(key)) throw new DomainError("UPSTREAM_UNAVAILABLE");
        seen.add(key);
        records.push(record);
      }
      complete = result.complete;
      next = result.next_page;
      if (complete || next === null) break;
      if (next !== page + 1) throw new DomainError("UPSTREAM_UNAVAILABLE");
      page = next;
    }
    await this.authorize(actor, company, resource, "list");
    return {
      company_id: company,
      records,
      complete,
      next_page: complete ? null : next,
    };
  }
  async get(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    id: string,
    selection?: z.infer<typeof priceSelection>,
  ) {
    registerId.parse(id);
    if (
      resource === "price"
        ? priceSelection.parse(selection).article_number !== id
        : selection !== undefined
    )
      throw new DomainError("VALIDATION_FAILED");
    await this.authorize(actor, company, resource, "get");
    const result = await this.provider.get(
      actor,
      company,
      resource,
      id,
      selection,
    );
    if (result.id !== id) throw new DomainError("UPSTREAM_UNAVAILABLE");
    await this.authorize(actor, company, resource, "get");
    return { company_id: company, record: result, complete: true as const };
  }
  async resolve(
    actor: AccountingActor,
    company: string,
    resource: RegisterResource,
    id: string,
  ) {
    const { record } = await this.get(actor, company, resource, id);
    if (
      (resource === "customer" ||
        resource === "supplier" ||
        resource === "article" ||
        resource === "cost_center") &&
      record.fields.Active !== true
    )
      throw new DomainError("VALIDATION_FAILED");
    if (resource === "project" && record.fields.Status !== "ONGOING")
      throw new DomainError("VALIDATION_FAILED");
    return record;
  }
  private async references(
    actor: AccountingActor,
    company: string,
    fields: RegisterFields,
  ) {
    const refs = {
      Currency: "currency",
      TermsOfPayment: "terms_of_payment",
      TermsOfDelivery: "terms_of_delivery",
      WayOfDelivery: "way_of_delivery",
      Unit: "unit",
      CostCenter: "cost_center",
      Project: "project",
      PriceList: "price_list",
      SupplierNumber: "supplier",
    } as const;
    for (const [field, resource] of Object.entries(refs)) {
      const value = fields[field];
      if (typeof value === "string")
        await this.resolve(actor, company, resource, value);
    }
  }
  private async prepareBody(
    actor: AccountingActor,
    company: string,
    resource: WritableRegister,
    action: "create" | "update",
    raw: unknown,
  ): Promise<PreparedBusinessWrite> {
    const def = writableRegisters[resource];
    const input = z
      .object({ id: registerId.optional(), fields: z.unknown() })
      .strict()
      .parse(raw);
    const fields = (
      action === "create" ? def.schema : def.schema.partial()
    ).parse(input.fields) as RegisterFields;
    if (!Object.keys(fields).length || (action === "update" && !input.id))
      throw new DomainError("VALIDATION_FAILED");
    await this.references(actor, company, fields);
    const before =
      action === "update"
        ? (await this.get(actor, company, resource, input.id as string)).record
        : null;
    const after = { ...before?.fields, ...fields };
    return {
      input: { id: input.id ?? null, fields },
      baseline: before?.version ?? null,
      preview: {
        resource,
        action,
        id: input.id ?? null,
        before: before?.fields ?? null,
        after,
        diff: Object.keys(fields)
          .filter((k) => before?.fields[k] !== fields[k])
          .map((field) => ({
            field,
            before: before?.fields[field] ?? null,
            after: fields[field],
          })),
      },
    };
  }
  private async validateBody(
    actor: AccountingActor,
    company: string,
    resource: WritableRegister,
    p: PreparedBusinessWrite,
  ) {
    const input = pendingRegister.parse(p.input);
    await this.references(actor, company, input.fields);
    if (p.baseline !== null) {
      if (!input.id) throw new DomainError("PROPOSAL_STALE");
      if (
        (await this.get(actor, company, resource, input.id)).record.version !==
        p.baseline
      )
        throw new DomainError("PROPOSAL_STALE");
    }
  }
}
// Hash all returned source content, including unmodeled fields, without storing it.
export function registerVersion(value: unknown): Promise<string> {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
  return accountingHash(stable(value));
}
export async function registerFieldsHash(fields: RegisterFields) {
  const exact = new Set(["SalesPrice", "PurchasePrice", "VAT"]);
  return registerVersion(
    Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [
        k,
        exact.has(k) ? parseAmount(v, 6) : v,
      ]),
    ),
  );
}
