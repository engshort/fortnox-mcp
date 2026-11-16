import {
  type BusinessReference,
  registerVersion,
  type SalesDocumentProvider,
  type SalesDocumentRecord,
  SalesDocuments,
  type SalesHeader,
  type SalesResource,
  type StateStore,
  salesOperationIds,
} from "@fortnox-mcp/core";
import { describe, expect, it } from "vitest";
import { syntheticReferences } from "./accounting.js";
import { registerFixture } from "./registers.js";

const header = (): SalesHeader => ({
  CustomerNumber: "C1",
  Currency: "SEK",
  VATIncluded: false,
  TermsOfPayment: "30",
  OfferDate: "2026-01-01",
  ExpireDate: "2026-01-31",
  NotCompleted: false,
});
const row = (RowId?: string) => ({
  ...(RowId ? { RowId } : {}),
  AccountNumber: 4000,
  Description: "Synthetic service",
  Quantity: "1",
  Price: "0.10",
  VAT: "25",
});
const input = () => ({
  financial_year: 7,
  fields: header(),
  rows: [row()],
  removed_row_ids: [],
});
const reference = (p: BusinessReference): BusinessReference => ({
  company_id: p.company_id,
  proposal_id: p.proposal_id,
  proposal_hash: p.proposal_hash,
});

async function setup(state: StateStore) {
  const f = await registerFixture(state);
  for (const c of [f.a, f.b])
    await f.connections.mutate(f.actor.ownerId, c.id, (current) => {
      current.scopes.push("offer", "order", "invoice");
    });
  f.seed("customer", "C1", { Name: "Synthetic", Active: true });
  f.seed("currency", "SEK", { Description: "Synthetic currency" });
  f.seed("terms_of_payment", "30", { Description: "Synthetic terms" });
  const records = new Map<string, SalesDocumentRecord>();
  let calls = 0,
    sequence = 100;
  const flags = { lost: false, verified: true, pages: 1 };
  const provider: SalesDocumentProvider = {
    get: async (_actor, company, resource, id) => {
      const value = records.get(`${company}:${resource}:${id}`);
      if (!value) throw new Error("synthetic document absent");
      return structuredClone(value);
    },
    page: async (_actor, company, resource, _query, page) => ({
      records: [...records]
        .filter(([key]) => key.startsWith(`${company}:${resource}:`))
        .map(([, v]) => structuredClone(v)),
      complete: page === flags.pages,
      next_page: page < flags.pages ? page + 1 : null,
    }),
    write: async (_actor, company, resource, action, value, before) => {
      await before();
      calls++;
      const id = value.id ?? String(++sequence);
      const previous = records.get(`${company}:${resource}:${id}`);
      if (action === "create" || action === "update") {
        const rows =
          value.rows?.map((raw) => {
            const r = raw as ReturnType<typeof row>;
            const next =
              Object.keys(r).length === 1
                ? previous?.rows.find((v) => v.RowId === r.RowId)
                : r;
            if (!next) throw new Error("synthetic missing retained row");
            return { ...next, RowId: String(++sequence) };
          }) ?? [];
        const result: SalesDocumentRecord = {
          id,
          fields: value.fields as SalesHeader,
          rows,
          version: await registerVersion({ fields: value.fields, rows }),
          editable: true,
          complete: true,
          observed: {
            cancelled: false,
            booked: false,
            sent: false,
            credit: false,
            order_reference: null,
            invoice_reference: null,
            credit_reference: null,
          },
        };
        records.set(`${company}:${resource}:${id}`, result);
      }
      if (flags.lost) throw new Error("synthetic lost response");
      return { state: "succeeded", reference: id };
    },
  };
  const accounting = {
    references: async (_actor: unknown, company: string) => ({
      ...syntheticReferences(company),
      validation_verified: flags.verified,
    }),
  };
  const service = new SalesDocuments(
    f.connections,
    provider,
    f.service,
    accounting,
    salesOperationIds,
    ["approved@example.invalid"],
  );
  const seed = async (
    resource: SalesResource = "offer",
    id = "1",
    overrides: Partial<SalesDocumentRecord> = {},
  ) => {
    const result: SalesDocumentRecord = {
      id,
      fields: header(),
      rows: [row("11"), row("12")],
      version: await registerVersion({ resource, id, overrides }),
      editable: true,
      complete: true,
      observed: {
        cancelled: false,
        booked: false,
        sent: false,
        credit: false,
        order_reference: null,
        invoice_reference: null,
        credit_reference: null,
      },
      ...overrides,
    };
    records.set(`${f.a.id}:${resource}:${id}`, result);
    return result;
  };
  return {
    ...f,
    records,
    flags,
    documents: service,
    documentProvider: provider,
    accounting,
    seed,
    calls: () => calls,
  };
}

export function salesDocumentsContract(fixture: () => Promise<StateStore>) {
  describe("gated sales document domain", () => {
    it("keeps writes disabled by default and requires the document read operation", async () => {
      const f = await setup(await fixture());
      const off = new SalesDocuments(
        f.connections,
        f.documentProvider,
        f.service,
        f.accounting,
      );
      await expect(off.get(f.actor, f.a.id, "offer", "1")).rejects.toThrow(
        "CAPABILITY_UNAVAILABLE",
      );
      await expect(
        off.writes.prepare(f.actor, f.a.id, "offer.create", input()),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(
        () =>
          new SalesDocuments(
            f.connections,
            f.documentProvider,
            f.service,
            f.accounting,
            ["offer.create"],
          ),
      ).toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls()).toBe(0);
    });
    it("prepares the complete intended rows, then dispatches one immutable update under concurrency", async () => {
      const f = await setup(await fixture());
      const source = await f.seed();
      const proposal = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.update",
        {
          ...input(),
          id: source.id,
          fields: { Comments: "Synthetic update" },
          rows: [{ RowId: "11" }, { ...row("12"), Price: "0.20" }, row()],
        },
      );
      expect(proposal.preview).toMatchObject({
        intended_rows: [row("11"), { ...row("12"), Price: "0.20" }, row()],
        removed_row_ids: [],
      });
      await Promise.allSettled([
        f.documents.writes.execute(
          f.actor,
          "offer.update",
          reference(proposal),
        ),
        f.documents.writes.execute(
          f.actor,
          "offer.update",
          reference(proposal),
        ),
      ]);
      expect(f.calls()).toBe(1);
      expect(
        (await f.documents.writes.status(f.actor, reference(proposal))).state,
      ).toBe("succeeded");
      const current = (
        await f.documents.get(f.actor, f.a.id, "offer", source.id)
      ).record;
      expect(
        current.rows.every((r) => r.RowId !== "11" && r.RowId !== "12"),
      ).toBe(true);
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "offer.update", {
          ...input(),
          id: source.id,
          fields: {},
          rows: [{ RowId: "11" }],
        }),
      ).rejects.toThrow();
    });
    it("rejects source changes after preparation and never treats omission as row deletion", async () => {
      const f = await setup(await fixture());
      const source = await f.seed();
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "offer.update", {
          ...input(),
          id: source.id,
          rows: [{ RowId: "11" }],
        }),
      ).rejects.toThrow();
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.update",
        {
          ...input(),
          id: source.id,
          rows: [{ RowId: "11" }],
          removed_row_ids: ["12"],
        },
      );
      f.records.set(`${f.a.id}:offer:1`, {
        ...source,
        version: "a".repeat(64),
      });
      await expect(
        f.documents.writes.execute(f.actor, "offer.update", reference(p)),
      ).rejects.toThrow("PROPOSAL_STALE");
      expect(f.calls()).toBe(0);
    });
    it("preserves uncertain email outcomes across service recreation and never resends", async () => {
      const f = await setup(await fixture());
      await f.seed("offer", "1", {
        fields: {
          ...header(),
          EmailInformation: {
            EmailAddressTo: "approved@example.invalid",
            EmailAddressCC: "" as const,
            EmailAddressBCC: "" as const,
            EmailSubject: "Synthetic acceptance",
            EmailBody: "Synthetic content",
          },
        },
      });
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.email",
        { id: "1", financial_year: 7 },
      );
      f.flags.lost = true;
      await expect(
        f.documents.writes.execute(f.actor, "offer.email", reference(p)),
      ).resolves.toMatchObject({ state: "outcome_unknown" });
      const restored = new SalesDocuments(
        f.connections,
        f.documentProvider,
        f.service,
        f.accounting,
        salesOperationIds,
        ["approved@example.invalid"],
      );
      await expect(
        restored.writes.execute(f.actor, "offer.email", reference(p)),
      ).resolves.toMatchObject({ state: "outcome_unknown" });
      await expect(
        restored.writes.reconcile(f.actor, "offer.email", reference(p)),
      ).resolves.toMatchObject({ state: "outcome_unknown" });
      expect(f.calls()).toBe(1);
    });
    it("requires current target scope, verified references and valid document states", async () => {
      const f = await setup(await fixture());
      const source = await f.seed();
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes = c.scopes.filter((s) => s !== "invoice");
      });
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "offer.to_invoice", {
          id: "1",
          financial_year: 7,
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      f.flags.verified = false;
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "offer.create", input()),
      ).resolves.toMatchObject({ company_id: f.a.id });
      f.flags.verified = true;
      for (const changes of [
        { complete: false },
        { editable: false },
        { observed: { ...source.observed, cancelled: true } },
      ]) {
        await f.seed("offer", "1", changes);
        await expect(
          f.documents.writes.prepare(f.actor, f.a.id, "offer.update", {
            ...input(),
            id: "1",
            rows: [{ RowId: "11" }, { RowId: "12" }],
          }),
        ).rejects.toThrow();
      }
      expect(f.calls()).toBe(0);
    });
    it("does not email unapproved recipients, CC/BCC or an already sent document", async () => {
      const f = await setup(await fixture());
      const fields = {
        ...header(),
        EmailInformation: {
          EmailAddressTo: "other@example.invalid",
          EmailAddressCC: "" as const,
          EmailAddressBCC: "" as const,
          EmailSubject: "Synthetic",
          EmailBody: "Synthetic",
        },
      };
      await f.seed("offer", "1", { fields });
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "offer.email", {
          id: "1",
          financial_year: 7,
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await f.seed("offer", "1", {
        fields: {
          ...fields,
          EmailInformation: {
            ...fields.EmailInformation,
            EmailAddressTo: "approved@example.invalid",
          },
        },
        observed: {
          cancelled: false,
          booked: false,
          sent: true,
          credit: false,
          order_reference: null,
          invoice_reference: null,
          credit_reference: null,
        },
      });
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "offer.email", {
          id: "1",
          financial_year: 7,
        }),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls()).toBe(0);
    });
  });
}
