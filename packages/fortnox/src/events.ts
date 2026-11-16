import {
  accountingHash,
  type Connection,
  type SyncEvent,
  type SyncResource,
  syncResources,
} from "@fortnox-mcp/core";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const fortnoxEvent = z.object({
  topic: z.string().min(1).max(64),
  offset: z.string().min(1).max(256),
  type: z.string().min(1).max(128),
  tenantId: z.string().regex(/^[1-9]\d{0,19}$/),
  entityId: id.optional(),
  timestamp: z.iso.datetime({ offset: true }),
  year: id.optional(),
  series: id.optional(),
  id: id.optional(),
  invoiceId: id.optional(),
});
const known: Record<string, RegExp> = {
  "financial-years":
    /^(?:financial-year|account)-(?:created|updated|deleted)-v1$/,
  vouchers: /^voucher-(?:created|updated|deleted)-v1$/,
  invoices:
    /^(?:invoice-(?:created|updated|cancelled|bookkeep)-v1|invoicepayment-(?:bookkeep|deleted)-v1|reminder-sent-v1)$/,
  "supplier-invoices":
    /^supplier-invoice-(?:created|updated|cancelled|bookkeep)-v1$/,
  customers: /^customer-(?:(?:created|deleted)-v1|updated-v2)$/,
  suppliers: /^supplier-(?:created|updated|deleted)-v1$/,
  projects: /^project-(?:created|updated|deleted)-v1$/,
  "cost-centers": /^cost-center-(?:created|updated|deleted)-v1$/,
};
export async function normalizeFortnoxEvent(
  input: unknown,
  integration: string,
  connection: Pick<Connection, "id" | "tenant">,
): Promise<{ topic: string; offset: string; events: SyncEvent[] }> {
  const e = fortnoxEvent.parse(input);
  if (e.tenantId !== connection.tenant)
    throw new Error("Event company mismatch");
  const knownType = known[e.topic]?.test(e.type) === true;
  const resources: SyncResource[] = !knownType
    ? syncResources.filter((r) => r.topic === e.topic).map((r) => r.id)
    : e.topic === "financial-years"
      ? [e.type.startsWith("account-") ? "accounts" : "financial_years"]
      : e.type.startsWith("invoicepayment-")
        ? ["customer_invoice_payments", "customer_invoices"]
        : syncResources
            .filter(
              (r) =>
                r.topic === e.topic && r.id !== "customer_invoice_payments",
            )
            .map((r) => r.id);
  // Unknown topics conservatively invalidate all readable resources.
  if (!resources.length) resources.push(...syncResources.map((r) => r.id));
  const events: SyncEvent[] = [];
  for (const resource of resources) {
    let identity: Record<string, string> | null = null;
    const profile = syncResources.find((r) => r.id === resource);
    if (knownType && profile) {
      // The documented event `year` is not verified as a REST fiscal-year ID.
      // Annual resources require a scan until that mapping has live evidence.
      if (
        resource === "customer_invoices" &&
        e.type.startsWith("invoicepayment-")
      )
        identity = e.invoiceId ? { DocumentNumber: e.invoiceId } : null;
      else if (!profile.yearly && e.entityId)
        identity = { [profile.keys[0]]: e.entityId };
    }
    events.push({
      company_id: connection.id,
      event_id: await accountingHash([
        integration,
        e.topic,
        e.offset,
        resource,
      ]),
      resource,
      action: !identity
        ? "rescan"
        : e.type.includes("-deleted-") &&
            !(
              resource === "customer_invoices" &&
              e.type.startsWith("invoicepayment-")
            )
          ? "delete"
          : "upsert",
      identity,
      occurred_at: e.timestamp,
      ...(e.invoiceId && resource === "customer_invoice_payments"
        ? { related_invoice: e.invoiceId }
        : {}),
    });
  }
  return { topic: e.topic, offset: e.offset, events };
}
