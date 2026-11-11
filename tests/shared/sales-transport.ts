import {
  type BusinessReference,
  SalesDocuments,
  type SalesResource,
  type StateStore,
  salesOperationIds,
} from "@fortnox-mcp/core";
import {
  FortnoxConnections,
  parseExactProviderJson,
} from "@fortnox-mcp/fortnox";
import { describe, expect, it } from "vitest";
import {
  FortnoxSalesDocuments,
  projectSalesDocument,
  salesProviderResources,
  serializeSalesDocument,
} from "../../packages/fortnox/src/sales-documents.js";
import { syntheticReferences } from "./accounting.js";
import { registerFixture } from "./registers.js";

const header = {
  CustomerNumber: "C1",
  Currency: "SEK" as const,
  VATIncluded: false as const,
  TermsOfPayment: "30",
  OfferDate: "2026-01-01",
  ExpireDate: "2026-01-31",
  NotCompleted: false,
};
const row = (RowId?: string) => ({
  ...(RowId ? { RowId } : {}),
  AccountNumber: 4000,
  Description: "Synthetic service",
  Price: "0.10",
  VAT: "25",
  Quantity: "1",
});
const ref = (p: BusinessReference): BusinessReference => ({
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
  f.seed("customer", "C1", { Name: "Synthetic customer", Active: true });
  f.seed("currency", "SEK", { Description: "Synthetic currency" });
  f.seed("terms_of_payment", "30", { Description: "Synthetic terms" });
  const data = new Map<string, Record<string, unknown>>();
  const calls: Array<{ method: string; path: string; body: string }> = [];
  let sequence = 1000;
  const flags = {
    active: true,
    lost: false,
    reject: false,
    disconnect: false,
    rowsChanged: false,
    noMeta: false,
    nullableEmptyCopies: false,
    failDetailReads: false,
  };
  const credentials = await f.connections.credentials(
    f.actor.ownerId,
    (await f.connections.list(f.actor.ownerId)).find(
      (c) => c.id === f.a.id,
    ) as typeof f.a,
  );
  const token = `Bearer ${credentials.accessToken}`;
  const provider = new FortnoxConnections({
    origin: "https://product.example.invalid",
    connections: f.connections,
    testTenants: ["100001", "100002"],
    fetch: async (input) => {
      const req = input as Request,
        url = new URL(req.url),
        parts = url.pathname.split("/");
      const resource = (
        Object.keys(salesProviderResources) as SalesResource[]
      ).find((r) => salesProviderResources[r].path === parts[2]);
      if (!resource) return f.provider.config.fetch(req);
      const spec = salesProviderResources[resource],
        id = parts[3],
        action = parts[4];
      const body = req.method === "GET" ? "" : await req.text();
      calls.push({ method: req.method, path: url.pathname, body });
      const key = (id: string) =>
        `${req.headers.get("authorization")}:${resource}:${id}`;
      if (req.method === "GET" && !action) {
        if (id) {
          if (flags.failDetailReads) return Response.json({}, { status: 500 });
          const value = data.get(key(id));
          return value
            ? Response.json({ [spec.single]: value })
            : Response.json({}, { status: 404 });
        }
        return Response.json({
          [spec.list]: [...data]
            .filter(([key]) =>
              key.startsWith(
                `${req.headers.get("authorization")}:${resource}:`,
              ),
            )
            .map(([, value]) => ({
              DocumentNumber: value.DocumentNumber,
              CustomerNumber: value.CustomerNumber,
              Cancelled: value.Cancelled,
            })),
          ...(flags.noMeta
            ? {}
            : { MetaInformation: { "@CurrentPage": 1, "@TotalPages": 1 } }),
        });
      }
      if (flags.reject)
        return Response.json(
          {
            ErrorInformation: {
              Code: 123,
              Message: "synthetic-private-message",
            },
          },
          { status: 400 },
        );
      if (action) {
        if (!id) throw new Error("synthetic effect requires identity");
        const value = data.get(key(id));
        if (!value) return Response.json({}, { status: 404 });
        if (action === "email") value.Sent = true;
        if (action === "cancel") value.Cancelled = true;
        if (action === "bookkeep") value.Booked = true;
        if (
          action === "createorder" ||
          action === "createinvoice" ||
          action === "credit"
        ) {
          const target: SalesResource =
              action === "createorder" ? "order" : "invoice",
            targetId = String(++sequence),
            targetSpec = salesProviderResources[target];
          value[
            action === "createorder"
              ? "OrderReference"
              : action === "credit"
                ? "CreditInvoiceReference"
                : "InvoiceReference"
          ] = targetId;
          data.set(
            `${req.headers.get("authorization")}:${target}:${targetId}`,
            {
              ...value,
              DocumentNumber: targetId,
              OrderReference: resource === "order" ? id : "",
              OfferReference: resource === "offer" ? id : "",
              Credit: action === "credit" ? "true" : "false",
              CreditInvoiceReference: "",
              [targetSpec.rows]: [row("999")],
            },
          );
        }
        if (flags.disconnect) {
          flags.disconnect = false;
          await f.connections.disconnect(f.actor.ownerId, f.a.id);
        }
        if (flags.lost) throw new Error("synthetic lost effect answer");
        return Response.json({ [spec.single]: value });
      }
      const parsed = JSON.parse(body)[spec.single] as Record<string, unknown>;
      const target = id ?? String(++sequence),
        previous = data.get(key(target));
      const rows = (parsed[spec.rows] as Array<Record<string, unknown>>).map(
        (r) => {
          const selected =
            Object.keys(r).length === 1
              ? (previous?.[spec.rows] as Array<Record<string, unknown>>)?.find(
                  (v) => String(v.RowId) === String(r.RowId),
                )
              : r;
          if (!selected) throw new Error("synthetic missing survivor");
          return { ...selected, RowId: ++sequence };
        },
      );
      const value = {
        ...previous,
        ...parsed,
        DocumentNumber: target,
        Cancelled: false,
        Sent: false,
        Booked: false,
        Credit: "false",
        [spec.rows]: rows,
      };
      data.set(key(target), value);
      if (flags.nullableEmptyCopies && value.EmailInformation) {
        const info = value.EmailInformation as Record<string, unknown>;
        for (const key of ["EmailAddressCC", "EmailAddressBCC"])
          if (info[key] === "") info[key] = null;
      }
      const changedRow = (
        value[spec.rows] as Array<Record<string, unknown>>
      )[0];
      if (flags.rowsChanged && changedRow) changedRow.Price = 9;
      if (flags.lost) throw new Error("synthetic lost document response");
      return Response.json(
        { [spec.single]: value },
        { status: req.method === "POST" ? 201 : 200 },
      );
    },
  });
  const adapter = new FortnoxSalesDocuments(
    f.connections,
    provider,
    salesOperationIds,
    () => flags.active,
  );
  const service = new SalesDocuments(
    f.connections,
    adapter,
    f.service,
    { references: async (_actor, company) => syntheticReferences(company) },
    salesOperationIds,
    ["approved@example.invalid"],
  );
  const seed = (id = "1", fields: Record<string, unknown> = {}) => {
    const value: Record<string, unknown> = {
      ...header,
      DocumentNumber: id,
      Cancelled: false,
      Sent: false,
      OfferRows: [row("11"), row("12")],
      ...fields,
    };
    data.set(`${token}:offer:${id}`, value);
    return value;
  };
  return { ...f, data, calls, flags, adapter, documents: service, seed };
}
export function salesTransportContract(fixture: () => Promise<StateStore>) {
  describe("fixed sales document transport", () => {
    const addressedHeader = {
      ...header,
      EmailInformation: {
        EmailAddressTo: "approved@example.invalid",
        EmailAddressCC: "",
        EmailAddressBCC: "",
        EmailSubject: "Synthetic test",
        EmailBody: "Synthetic test only",
      },
    };
    it("creates and updates addressed drafts when provider empty copies are null, without sending", async () => {
      const f = await setup(await fixture());
      f.flags.nullableEmptyCopies = true;
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.create",
        {
          financial_year: 7,
          fields: addressedHeader,
          rows: [row()],
          removed_row_ids: [],
        },
      );
      const result = await f.documents.writes.execute(
        f.actor,
        "offer.create",
        ref(p),
      );
      expect(result.state).toBe("succeeded");
      if (result.state !== "succeeded" || !result.reference)
        throw new Error("Synthetic addressed creation failed");
      const id = result.reference;
      const before = (await f.documents.get(f.actor, f.a.id, "offer", id))
        .record;
      expect(before.editable).toBe(true);
      expect(before.fields.EmailInformation).toEqual(
        addressedHeader.EmailInformation,
      );
      const update = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.update",
        {
          id,
          financial_year: 7,
          fields: { Comments: "Synthetic comment change" },
          rows: before.rows.map((r) => ({ RowId: r.RowId })),
          removed_row_ids: [],
        },
      );
      expect(
        await f.documents.writes.execute(f.actor, "offer.update", ref(update)),
      ).toMatchObject({ state: "succeeded", reference: id });
      const after = (await f.documents.get(f.actor, f.a.id, "offer", id))
        .record;
      expect(after.fields.Comments).toBe("Synthetic comment change");
      expect(after.fields.EmailInformation).toEqual(
        addressedHeader.EmailInformation,
      );
      expect(after.rows.map(({ RowId: _id, ...r }) => r)).toEqual(
        before.rows.map(({ RowId: _id, ...r }) => r),
      );
      expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(1);
      expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
      expect(f.calls.some((c) => c.path.endsWith("/email"))).toBe(false);
    });
    it("reconciles a retained known-reference intent with null empty copies without resending, and keeps other changes unknown", async () => {
      const f = await setup(await fixture());
      f.flags.nullableEmptyCopies = true;
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.create",
        {
          financial_year: 7,
          fields: addressedHeader,
          rows: [row()],
          removed_row_ids: [],
        },
      );
      f.flags.failDetailReads = true;
      const uncertain = await f.documents.writes.execute(
        f.actor,
        "offer.create",
        ref(p),
      );
      expect(uncertain).toMatchObject({
        state: "outcome_unknown",
        reference: expect.any(String),
      });
      if (uncertain.state !== "outcome_unknown" || !uncertain.reference)
        throw new Error("Missing synthetic uncertain reference");
      f.flags.failDetailReads = false;
      const raw = [...f.data.values()].find(
        (d) => d.DocumentNumber === uncertain.reference,
      );
      if (!raw) throw new Error("Missing synthetic created record");
      const info = raw.EmailInformation as Record<string, unknown>;
      expect(info.EmailAddressCC).toBeNull();
      expect(info.EmailAddressBCC).toBeNull();
      const sourceRow = (raw.OfferRows as Array<Record<string, unknown>>)[0];
      if (!sourceRow) throw new Error("Missing synthetic source row");
      const changes = [
        [raw, "CustomerNumber", "C2"],
        [info, "EmailAddressTo", "other@example.invalid"],
        [info, "EmailSubject", "Changed synthetic subject"],
        [sourceRow, "Price", "0.20"],
      ] as const;
      for (const [target, key, changed] of changes) {
        const original = target[key];
        target[key] = changed;
        expect(
          (await f.documents.writes.reconcile(f.actor, "offer.create", ref(p)))
            .state,
        ).toBe("outcome_unknown");
        target[key] = original;
      }
      expect(
        await f.documents.writes.reconcile(f.actor, "offer.create", ref(p)),
      ).toMatchObject({ state: "succeeded", reference: uncertain.reference });
      expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(1);
      expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    }, 30000);
    it("preserves missing and nonempty recipient fields and binds raw source changes despite empty-copy equivalence", async () => {
      const f = await setup(await fixture());
      const raw = f.seed("1", {
        EmailInformation: {
          ...addressedHeader.EmailInformation,
          EmailAddressCC: null,
          EmailAddressBCC: null,
        },
      });
      const before = await f.adapter.get(f.actor, f.a.id, "offer", "1");
      expect(before.editable).toBe(true);
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.update",
        {
          id: "1",
          financial_year: 7,
          fields: { Comments: "Synthetic comment" },
          rows: [{ RowId: "11" }, { RowId: "12" }],
          removed_row_ids: [],
        },
      );
      const info = raw.EmailInformation as Record<string, unknown>;
      info.EmailAddressCC = "";
      const changed = await f.adapter.get(f.actor, f.a.id, "offer", "1");
      expect(changed.fields).toEqual(before.fields);
      expect(changed.version).not.toBe(before.version);
      await expect(
        f.documents.writes.execute(f.actor, "offer.update", ref(p)),
      ).rejects.toThrow("PROPOSAL_STALE");
      expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
      for (const [key, value] of [
        ["EmailAddressTo", null],
        ["EmailAddressCC", "other@example.invalid"],
        ["EmailAddressBCC", "other@example.invalid"],
      ] as const) {
        const original = info[key];
        info[key] = value;
        const record = await f.adapter.get(f.actor, f.a.id, "offer", "1");
        expect(
          (record.fields.EmailInformation as Record<string, unknown>)[key],
        ).toBe(value);
        expect(record.editable).toBe(false);
        info[key] = original;
      }
      delete info.EmailAddressCC;
      const missing = await f.adapter.get(f.actor, f.a.id, "offer", "1");
      expect(missing.fields.EmailInformation).not.toHaveProperty(
        "EmailAddressCC",
      );
      expect(missing.editable).toBe(false);
    });
    it("blocks missing scopes, read-only writes and expired test leases before provider access", async () => {
      const f = await setup(await fixture());
      f.seed();
      f.flags.active = false;
      await expect(
        f.adapter.get(f.actor, f.a.id, "offer", "1"),
      ).rejects.toThrow("COMPANY_FORBIDDEN");
      f.flags.active = true;
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.readOnly = true;
      });
      let dispatched = false;
      await expect(
        f.adapter.write(
          f.actor,
          f.a.id,
          "offer",
          "create",
          { id: null, version: null, fields: header, rows: [row()] },
          async () => {
            dispatched = true;
          },
        ),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes = c.scopes.filter((scope) => scope !== "offer");
      });
      await expect(
        f.adapter.get(f.actor, f.a.id, "offer", "1"),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await f.connections.mutate(f.actor.ownerId, f.a.id, (c) => {
        c.scopes.push("offer");
        c.readOnly = false;
      });
      await f.connections.disableProgram(
        f.actor.ownerId,
        f.a.id,
        "order-offer",
        0,
      );
      await expect(
        f.documents.get(f.actor, f.a.id, "offer", "1"),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      await expect(
        f.adapter.get(f.actor, f.a.id, "offer", "1"),
      ).rejects.toThrow("CAPABILITY_UNAVAILABLE");
      expect(f.calls).toHaveLength(0);
      expect(dispatched).toBe(false);
    });
    it("uses each resource's quantity contract and separately verifies invoice booking and credit", async () => {
      const f = await setup(await fixture());
      const headers = {
        offer: header,
        order: {
          CustomerNumber: "C1",
          Currency: "SEK",
          VATIncluded: false,
          TermsOfPayment: "30",
          OrderDate: "2026-01-01",
          NotCompleted: false,
        },
        invoice: {
          CustomerNumber: "C1",
          Currency: "SEK",
          VATIncluded: false,
          TermsOfPayment: "30",
          InvoiceDate: "2026-01-01",
          DueDate: "2026-01-31",
          InvoiceType: "INVOICE",
        },
      };
      let invoiceId = "";
      for (const resource of ["offer", "order", "invoice"] as const) {
        const { Quantity: _quantity, ...common } = row();
        const quantities =
          resource === "offer"
            ? { Quantity: "1" }
            : resource === "order"
              ? { OrderedQuantity: "2", DeliveredQuantity: "1" }
              : { DeliveredQuantity: "1" };
        const rows = [
          { ...common, ...quantities },
          {
            ...common,
            ...quantities,
            Description: "Synthetic reduced VAT",
            Price: "0.20",
            VAT: "12",
          },
        ];
        const prepared = await f.documents.writes.prepare(
          f.actor,
          f.a.id,
          `${resource}.create`,
          {
            financial_year: 7,
            fields: headers[resource],
            rows,
            removed_row_ids: [],
          },
        );
        const result = await f.documents.writes.execute(
          f.actor,
          `${resource}.create`,
          ref(prepared),
        );
        expect(result.state).toBe("succeeded");
        if (result.state !== "succeeded")
          throw new Error("synthetic creation failed");
        const id = result.reference;
        expect(id).toBeTypeOf("string");
        if (resource === "invoice") invoiceId = id ?? "";
        const read = await f.documents.get(f.actor, f.a.id, resource, id ?? "");
        expect(read.record.rows).toHaveLength(2);
        expect(read.record.rows[0]).toMatchObject(quantities);
      }
      const booking = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "invoice.bookkeep",
        { id: invoiceId, financial_year: 7 },
      );
      expect(
        await f.documents.writes.execute(
          f.actor,
          "invoice.bookkeep",
          ref(booking),
        ),
      ).toMatchObject({ state: "succeeded", reference: invoiceId });
      await expect(
        f.documents.writes.prepare(f.actor, f.a.id, "invoice.cancel", {
          id: invoiceId,
          financial_year: 7,
        }),
      ).rejects.toThrow("VALIDATION_FAILED");
      const credit = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "invoice.credit",
        { id: invoiceId, financial_year: 7 },
      );
      const credited = await f.documents.writes.execute(
        f.actor,
        "invoice.credit",
        ref(credit),
      );
      expect(credited.state).toBe("succeeded");
      if (credited.state !== "succeeded")
        throw new Error("synthetic credit failed");
      expect(credited.reference).not.toBe(invoiceId);
    }, 30000);
    it("reads summaries as partial without inventing missing states and preserves decimal lexemes", async () => {
      const f = await setup(await fixture());
      f.seed();
      const page = await f.documents.list(f.actor, f.a.id, "offer");
      expect(page.complete).toBe(true);
      expect(page.records[0]).toMatchObject({
        complete: false,
        editable: false,
        observed: { sent: null },
      });
      expect(page.records[0]?.fields).not.toHaveProperty("Currency");
      const parsed = await projectSalesDocument(
        "offer",
        parseExactProviderJson(
          '{"DocumentNumber":"7","Cancelled":false,"Sent":false,"Total":99999999999999.123456,"Balance":null,"OfferRows":[{"RowId":1,"AccountNumber":4000,"Description":"Synthetic exact price","Price":99999999999999.123456,"VAT":25,"Quantity":"1"}]}',
        ),
      );
      expect(parsed.rows[0]?.Price).toBe("99999999999999.123456");
      expect(parsed.amounts).toEqual({
        total: "99999999999999.123456",
        balance: null,
      });
      f.flags.noMeta = true;
      expect((await f.documents.list(f.actor, f.a.id, "offer")).complete).toBe(
        false,
      );
    });
    it("keeps all surviving row IDs in updates and verifies regenerated IDs and complete intended content", async () => {
      const f = await setup(await fixture());
      f.seed();
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.update",
        {
          id: "1",
          financial_year: 7,
          fields: { Comments: "Synthetic update" },
          rows: [{ RowId: "11" }, { ...row("12"), Price: "0.20" }],
          removed_row_ids: [],
        },
      );
      const result = await f.documents.writes.execute(
        f.actor,
        "offer.update",
        ref(p),
      );
      expect(result).toMatchObject({ state: "succeeded", reference: "1" });
      const body = JSON.parse(
        f.calls.find((c) => c.method === "PUT")?.body ?? "{}",
      );
      expect(body.Offer.OfferRows[0]).toEqual({ RowId: 11 });
      const current = await f.documents.get(f.actor, f.a.id, "offer", "1");
      expect(current.record.rows[0]?.RowId).not.toBe("11");
      expect(current.record.rows[1]?.Price).toBe("0.2");
    });
    it("checks source version again at the adapter and marks unmodeled discount rows uneditable", async () => {
      const f = await setup(await fixture());
      const raw = f.seed();
      const before = await f.adapter.get(f.actor, f.a.id, "offer", "1");
      raw.Comments = "Concurrent source edit";
      await expect(
        f.adapter.write(
          f.actor,
          f.a.id,
          "offer",
          "update",
          {
            id: "1",
            version: before.version,
            fields: header,
            rows: [row("11"), row("12")],
          },
          async () => {},
        ),
      ).rejects.toThrow("PROPOSAL_STALE");
      expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
      f.seed("2", { OfferRows: [{ ...row("11"), Discount: 10 }] });
      expect(
        (await f.documents.get(f.actor, f.a.id, "offer", "2")).record.editable,
      ).toBe(false);
    });
    it("never retries effectful GET email or a rejected write and refuses late disconnect success", async () => {
      const f = await setup(await fixture());
      f.seed("1", {
        EmailInformation: {
          EmailAddressTo: "approved@example.invalid",
          EmailAddressCC: "",
          EmailAddressBCC: "",
          EmailSubject: "Synthetic test",
          EmailBody: "Synthetic test only",
        },
      });
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.email",
        { id: "1", financial_year: 7 },
      );
      f.flags.lost = true;
      expect(
        await f.documents.writes.execute(f.actor, "offer.email", ref(p)),
      ).toMatchObject({ state: "outcome_unknown" });
      expect(
        await f.documents.writes.execute(f.actor, "offer.email", ref(p)),
      ).toMatchObject({ state: "outcome_unknown" });
      expect(
        await f.documents.writes.reconcile(f.actor, "offer.email", ref(p)),
      ).toMatchObject({ state: "outcome_unknown" });
      expect(f.calls.filter((c) => c.path.endsWith("/email"))).toHaveLength(1);
      const g = await setup(await fixture());
      g.seed();
      const cancel = await g.documents.writes.prepare(
        g.actor,
        g.a.id,
        "offer.cancel",
        { id: "1", financial_year: 7 },
      );
      g.flags.disconnect = true;
      await expect(
        g.documents.writes.execute(g.actor, "offer.cancel", ref(cancel)),
      ).rejects.toThrow("CONNECTION_DISCONNECTED");
      const disconnected = (await g.connections.list(g.actor.ownerId)).find(
        (c) => c.id === g.a.id,
      );
      expect(
        disconnected?.business?.executions.find(
          (e) => e.id === cancel.proposal_id,
        )?.state,
      ).toBe("outcome_unknown");
    });
    it("reconciles exact update content after failed readback without resending and keeps denied effects unknown", async () => {
      const f = await setup(await fixture());
      f.seed();
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.update",
        {
          id: "1",
          financial_year: 7,
          fields: { Comments: "Synthetic recovered" },
          rows: [row("11"), row("12")],
          removed_row_ids: [],
        },
      );
      f.flags.lost = true;
      expect(
        await f.documents.writes.execute(f.actor, "offer.update", ref(p)),
      ).toMatchObject({ state: "outcome_unknown" });
      f.flags.lost = false;
      expect(
        await f.documents.writes.reconcile(f.actor, "offer.update", ref(p)),
      ).toMatchObject({ state: "succeeded", reference: "1" });
      expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
      const g = await setup(await fixture());
      g.seed();
      const p2 = await g.documents.writes.prepare(
        g.actor,
        g.a.id,
        "offer.cancel",
        { id: "1", financial_year: 7 },
      );
      g.flags.reject = true;
      expect(
        await g.documents.writes.execute(g.actor, "offer.cancel", ref(p2)),
      ).toMatchObject({ state: "outcome_unknown" });
      expect(g.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(1);
    });
    it("uses exact numeric wire tokens and reads conversion references in the target resource", async () => {
      const text = serializeSalesDocument("offer", header, [
        { ...row(), Price: "99999999999999.123456" },
      ]);
      expect(text).toContain('"Price":99999999999999.123456');
      expect(text).toContain('"Quantity":"1"');
      const f = await setup(await fixture());
      f.seed();
      const p = await f.documents.writes.prepare(
        f.actor,
        f.a.id,
        "offer.to_order",
        { id: "1", financial_year: 7 },
      );
      expect(
        await f.documents.writes.execute(f.actor, "offer.to_order", ref(p)),
      ).toMatchObject({ state: "succeeded" });
      expect(f.calls.some((c) => /^\/3\/orders\/\d+$/.test(c.path))).toBe(true);
    });
  });
}
