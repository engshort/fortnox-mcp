import { z } from "zod";
import { accountingHash } from "./accounting.js";
import { type Actor, requirePermission } from "./actor.js";
import type { FortnoxBridge } from "./bridge.js";
import type { Ciphertext } from "./connections.js";
import { DomainError } from "./errors.js";

export const syncLimits = {
  retentionMs: 7 * 86400000,
  companyEvents: 1000,
  installationEvents: 20000,
} as const;
// Independently authored read profiles. They describe routing, never provider
// payload validation or verified live support. Unknown deltas stay unavailable.
export const syncResources = [
  {
    id: "financial_years",
    path: "/3/financialyears",
    envelope: "FinancialYears",
    detail: "FinancialYear",
    keys: ["Id"],
    scope: "bookkeeping",
    topic: "financial-years",
    yearly: false,
  },
  {
    id: "accounts",
    path: "/3/accounts",
    envelope: "Accounts",
    detail: "Account",
    keys: ["Number"],
    scope: "bookkeeping",
    topic: "financial-years",
    yearly: true,
  },
  {
    id: "voucher_series",
    path: "/3/voucherseries",
    envelope: "VoucherSeriesCollection",
    detail: "VoucherSeries",
    keys: ["Code"],
    scope: "bookkeeping",
    topic: null,
    yearly: true,
  },
  {
    id: "vouchers",
    path: "/3/vouchers",
    envelope: "Vouchers",
    detail: "Voucher",
    keys: ["VoucherSeries", "VoucherNumber"],
    scope: "bookkeeping",
    topic: "vouchers",
    yearly: true,
  },
  {
    id: "customer_invoices",
    path: "/3/invoices",
    envelope: "Invoices",
    detail: "Invoice",
    keys: ["DocumentNumber"],
    scope: "invoice",
    topic: "invoices",
    yearly: false,
  },
  {
    id: "supplier_invoices",
    path: "/3/supplierinvoices",
    envelope: "SupplierInvoices",
    detail: "SupplierInvoice",
    keys: ["GivenNumber"],
    scope: "supplierinvoice",
    topic: "supplier-invoices",
    yearly: false,
  },
  {
    id: "customer_invoice_payments",
    path: "/3/invoicepayments",
    envelope: "InvoicePayments",
    detail: "InvoicePayment",
    keys: ["Number"],
    scope: "invoice",
    topic: "invoices",
    yearly: false,
  },
  {
    id: "supplier_invoice_payments",
    path: "/3/supplierinvoicepayments",
    envelope: "SupplierInvoicePayments",
    detail: "SupplierInvoicePayment",
    keys: ["Number"],
    scope: "supplierinvoice",
    topic: null,
    yearly: false,
  },
  {
    id: "customers",
    path: "/3/customers",
    envelope: "Customers",
    detail: "Customer",
    keys: ["CustomerNumber"],
    scope: "customer",
    topic: "customers",
    yearly: false,
  },
  {
    id: "suppliers",
    path: "/3/suppliers",
    envelope: "Suppliers",
    detail: "Supplier",
    keys: ["SupplierNumber"],
    scope: "supplier",
    topic: "suppliers",
    yearly: false,
  },
  {
    id: "projects",
    path: "/3/projects",
    envelope: "Projects",
    detail: "Project",
    keys: ["ProjectNumber"],
    scope: "project",
    topic: "projects",
    yearly: false,
  },
  {
    id: "cost_centers",
    path: "/3/costcenters",
    envelope: "CostCenters",
    detail: "CostCenter",
    keys: ["Code"],
    scope: "costcenter",
    topic: "cost-centers",
    yearly: false,
  },
] as const;
export type SyncResource = (typeof syncResources)[number]["id"];
export interface SyncEvent {
  event_id: string;
  company_id: string;
  resource: SyncResource;
  action: "upsert" | "delete" | "rescan";
  identity: Record<string, string> | null;
  occurred_at: string;
  related_invoice?: string;
}
export interface SyncHead {
  epoch: string;
  tail: number;
  floor: number;
}
export interface SyncPage extends SyncHead {
  events: Array<{ sequence: number; event: SyncEvent }>;
}
export interface SyncJournal {
  read(
    owner: string,
    company: string,
    generation: number,
    after: number,
    limit: number,
    now: number,
  ): Promise<SyncPage>;
  append(
    owner: string,
    company: string,
    generation: number,
    integration: string,
    topic: string,
    offset: string,
    events: SyncEvent[],
    now: number,
  ): Promise<void>;
  offsets(
    integration: string,
  ): Promise<Array<{ topic: string; offset: string; received: number }>>;
  reset(owner: string, company: string, generation: number): Promise<void>;
  cleanup(now: number): Promise<void>;
}
export type RealtimeStatus =
  | "unavailable"
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected";
const cursorSchema = z
  .object({
    generation: z.number(),
    access: z.number(),
    manifest: z.string(),
    epoch: z.string(),
    sequence: z.number().int().nonnegative(),
    expires: z.number(),
  })
  .strict();
const querySchema = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    wait_seconds: z.coerce.number().int().min(0).max(20).default(0),
  })
  .strict();
export class CompanySync {
  constructor(
    readonly bridge: FortnoxBridge,
    readonly journal: SyncJournal,
    readonly realtime: (company: string) => RealtimeStatus,
    readonly now = Date.now,
  ) {}
  async manifest(actor: Actor, company: string) {
    requirePermission(actor, "finance_read");
    const connection = await this.bridge.authorize(actor, company);
    const catalog = await this.bridge.catalog();
    const operations = (await this.bridge.operations(actor, company))
      .operations;
    const resources = syncResources.map((r) => {
      const list = catalog?.operations.find(
        (o) => o.method === "GET" && o.effect === "read" && o.path === r.path,
      );
      const detail = catalog?.operations.find(
        (o) =>
          o.method === "GET" &&
          o.effect === "read" &&
          o.path.startsWith(`${r.path}/`) &&
          o.path
            .slice(r.path.length + 1)
            .split("/")
            .every((s) => /^\{[^}]+\}$/.test(s)) &&
          (o.path.match(/\{/g)?.length ?? 0) === r.keys.length,
      );
      const allowed =
        connection.scopes.includes(r.scope) &&
        [list, detail].every(
          (o) =>
            o && operations.some((v) => v.operation_id === o.id && v.available),
        );
      return {
        resource: r.id,
        available: allowed,
        reason: allowed
          ? null
          : !catalog
            ? "catalog_missing"
            : (operations.find(
                (o) => o.operation_id === list?.id && !o.available,
              )?.reason ?? "reviewed_read_profile_required"),
        required_scopes: [r.scope],
        support_status: "implemented_unverified",
        list_path: `/api/v1/companies/${company}/fortnox${r.path}`,
        path_parameters: Object.fromEntries(
          (detail?.path.match(/\{[^}]+\}/g) ?? []).map((p, i) => [
            p.slice(1, -1),
            r.keys[i],
          ]),
        ),
        detail_path: detail
          ? `/api/v1/companies/${company}/fortnox${detail.path}`
          : null,
        collection_envelope: r.envelope,
        detail_envelope: r.detail,
        identity_fields: [...(r.yearly ? ["financialyear"] : []), ...r.keys],
        year_required: r.yearly,
        pagination: {
          page: "page",
          limit: "limit",
          default_limit: 100,
          metadata: "MetaInformation",
          total_pages: "@TotalPages",
          current_page: "@CurrentPage",
        },
        lastmodified: false,
        event_topic: r.topic,
        event_support: r.topic !== null,
        provider_access_verified: false,
      };
    });
    const revision = await accountingHash({
      profile: "company-sync-v1.1",
      catalog: catalog?.revision ?? null,
      generation: connection.generation,
      access: connection.accessRevision ?? 0,
      resources,
    });
    const current = await this.bridge.authorize(actor, company);
    if (
      current.generation !== connection.generation ||
      current.accessRevision !== connection.accessRevision ||
      (await this.bridge.catalog())?.revision !== catalog?.revision
    )
      throw new DomainError("CONNECTION_CONFLICT");
    return {
      version: "company-sync-v1" as const,
      company_id: company,
      generation: connection.generation,
      access_revision: connection.accessRevision ?? 0,
      catalog_revision: catalog?.revision ?? null,
      manifest_revision: revision,
      resources,
      realtime: {
        status: this.realtime(company),
        retention_seconds: syncLimits.retentionMs / 1000,
        max_events: syncLimits.companyEvents,
      },
    };
  }
  async changes(
    actor: Actor,
    company: string,
    input: unknown,
    authenticate: () => Promise<unknown>,
    signal?: AbortSignal,
  ) {
    const query = querySchema.parse(input);
    const manifest = await this.manifest(actor, company);
    const binding = JSON.stringify([
      "company-sync-v1",
      actor.ownerId,
      actor.subjectId ?? actor.ownerId,
      actor.oauthClientId ?? actor.clientId,
      company,
    ]);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(
          await this.bridge.connections.vault.openData(
            JSON.parse(
              atob(query.cursor.replace(/-/g, "+").replace(/_/g, "/")),
            ) as Ciphertext,
            binding,
          ),
        );
      } catch {
        throw new DomainError("VALIDATION_FAILED");
      }
    }
    const deadline = this.now() + query.wait_seconds * 1000;
    let page: SyncPage;
    let reason: string | null;
    do {
      if (signal?.aborted) throw new DomainError("CONNECTION_CONFLICT");
      page = await this.journal.read(
        actor.ownerId,
        company,
        manifest.generation,
        cursor?.sequence ?? 0,
        query.limit,
        this.now(),
      );
      reason = !cursor
        ? "initial_baseline"
        : cursor.expires <= this.now()
          ? "cursor_expired"
          : cursor.generation !== manifest.generation ||
              cursor.access !== manifest.access_revision ||
              cursor.manifest !== manifest.manifest_revision
            ? "source_changed"
            : cursor.epoch !== page.epoch
              ? "journal_reset"
              : cursor.sequence < page.floor || cursor.sequence > page.tail
                ? "retention_gap"
                : null;
      if (
        reason ||
        page.events.length ||
        this.now() >= deadline ||
        ["unavailable", "disabled"].includes(this.realtime(company))
      )
        break;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(
          done,
          Math.min(250, Math.max(0, deadline - this.now())),
        );
        signal?.addEventListener("abort", done, { once: true });
      });
      await authenticate();
    } while (this.now() <= deadline);
    const current = await this.manifest(actor, company);
    await authenticate();
    if (
      signal?.aborted ||
      current.manifest_revision !== manifest.manifest_revision
    )
      throw new DomainError("CONNECTION_CONFLICT");
    const events = reason ? [] : page.events;
    const sequence = reason
      ? page.tail
      : (events.at(-1)?.sequence ?? cursor?.sequence ?? page.tail);
    const sealed = await this.bridge.connections.vault.sealData(
      {
        generation: manifest.generation,
        access: manifest.access_revision,
        manifest: manifest.manifest_revision,
        epoch: page.epoch,
        sequence,
        expires: this.now() + syncLimits.retentionMs,
      },
      binding,
    );
    return {
      version: manifest.version,
      company_id: company,
      generation: manifest.generation,
      access_revision: manifest.access_revision,
      catalog_revision: manifest.catalog_revision,
      manifest_revision: manifest.manifest_revision,
      events: events
        .map((e) => e.event)
        .filter((e) =>
          manifest.resources.some(
            (r) => r.resource === e.resource && r.available,
          ),
        ),
      next_cursor: btoa(JSON.stringify(sealed))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
      has_more: sequence < page.tail,
      resync_required: reason !== null,
      resync_reason: reason,
      realtime_status: this.realtime(company),
    };
  }
}
