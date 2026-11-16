import {
  DomainError,
  type SyncEvent,
  type SyncJournal,
  syncLimits,
} from "@fortnox-mcp/core";
import type { ReceiptSql, ReceiptStatement } from "./receipt-sql.js";

export function sqlSyncJournal(db: ReceiptSql): SyncJournal {
  const ensure = (
    owner: string,
    company: string,
    generation: number,
  ): ReceiptStatement => ({
    sql: `INSERT INTO sync_heads(owner,company,generation,epoch) VALUES(?,?,?,?)
      ON CONFLICT(owner,company) DO UPDATE SET generation=excluded.generation,epoch=excluded.epoch,floor=sync_heads.tail WHERE sync_heads.generation<excluded.generation`,
    values: [owner, company, generation, crypto.randomUUID()],
  });
  const cleanup = (now: number): ReceiptStatement[] => [
    {
      sql: `UPDATE sync_heads SET floor=MAX(floor,tail-${syncLimits.companyEvents},COALESCE((SELECT MAX(sequence) FROM sync_events e WHERE e.owner=sync_heads.owner AND e.company=sync_heads.company AND e.received<=?),0))`,
      values: [now - syncLimits.retentionMs],
    },
    {
      sql: `UPDATE sync_heads SET floor=MAX(floor,COALESCE((SELECT MAX(sequence) FROM sync_events e WHERE e.owner=sync_heads.owner AND e.company=sync_heads.company AND e.rowid IN (SELECT rowid FROM sync_events ORDER BY rowid DESC LIMIT -1 OFFSET ${syncLimits.installationEvents})),0))`,
      values: [],
    },
    {
      sql: "DELETE FROM sync_events WHERE sequence<=(SELECT floor FROM sync_heads h WHERE h.owner=sync_events.owner AND h.company=sync_events.company)",
      values: [],
    },
    {
      sql: "DELETE FROM sync_offsets WHERE received<=?",
      values: [now - 14 * 86400000],
    },
  ];
  return {
    async read(owner, company, generation, after, limit, now) {
      await db.batch([ensure(owner, company, generation), ...cleanup(now)]);
      const h = (
        await db.all("SELECT * FROM sync_heads WHERE owner=? AND company=?", [
          owner,
          company,
        ])
      )[0];
      if (!h || Number(h.generation) !== generation)
        throw new DomainError("CONNECTION_CONFLICT");
      const tail = Number(h.tail),
        floor = Number(h.floor);
      const rows = await db.all(
        "SELECT sequence,event FROM sync_events WHERE owner=? AND company=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?",
        [owner, company, Math.max(after, floor), tail, limit],
      );
      return {
        epoch: String(h.epoch),
        tail,
        floor,
        events: rows.map((r) => ({
          sequence: Number(r.sequence),
          event: JSON.parse(String(r.event)) as SyncEvent,
        })),
      };
    },
    async append(
      owner,
      company,
      generation,
      integration,
      topic,
      offset,
      events,
      now,
    ) {
      if (
        events.length > 12 ||
        offset.length > 256 ||
        topic.length > 64 ||
        integration.length > 256
      )
        throw new DomainError("VALIDATION_FAILED");
      const statements: ReceiptStatement[] = [
        ensure(owner, company, generation),
      ];
      for (const event of events) {
        const payload = JSON.stringify(event);
        if (
          new TextEncoder().encode(payload).length > 2048 ||
          event.company_id !== company
        )
          throw new DomainError("VALIDATION_FAILED");
        statements.push(
          {
            sql: "INSERT INTO sync_events(owner,company,sequence,event_id,received,event) SELECT ?,?,tail+1,?,?,? FROM sync_heads WHERE owner=? AND company=? AND generation=? AND NOT EXISTS(SELECT 1 FROM sync_events WHERE owner=? AND company=? AND event_id=?)",
            values: [
              owner,
              company,
              event.event_id,
              now,
              payload,
              owner,
              company,
              generation,
              owner,
              company,
              event.event_id,
            ],
          },
          {
            sql: "UPDATE sync_heads SET tail=MAX(tail,COALESCE((SELECT MAX(sequence) FROM sync_events e WHERE e.owner=sync_heads.owner AND e.company=sync_heads.company),0)) WHERE owner=? AND company=? AND generation=?",
            values: [owner, company, generation],
          },
        );
      }
      statements.push(
        {
          sql: "INSERT INTO sync_offsets(integration,topic,offset,received) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM sync_heads WHERE owner=? AND company=? AND generation=?) ON CONFLICT(integration,topic) DO UPDATE SET offset=excluded.offset,received=excluded.received",
          values: [integration, topic, offset, now, owner, company, generation],
        },
        ...cleanup(now),
      );
      await db.batch(statements);
    },
    async offsets(integration) {
      return (
        await db.all(
          "SELECT topic,offset,received FROM sync_offsets WHERE integration=?",
          [integration],
        )
      ).map((r) => ({
        topic: String(r.topic),
        offset: String(r.offset),
        received: Number(r.received),
      }));
    },
    async reset(owner, company, generation) {
      await db.batch([
        ensure(owner, company, generation),
        {
          sql: "UPDATE sync_heads SET epoch=?,floor=tail WHERE owner=? AND company=? AND generation=?",
          values: [crypto.randomUUID(), owner, company, generation],
        },
        {
          sql: "DELETE FROM sync_events WHERE owner=? AND company=? AND sequence<=(SELECT floor FROM sync_heads WHERE owner=? AND company=?)",
          values: [owner, company, owner, company],
        },
      ]);
    },
    async cleanup(now) {
      await db.batch(cleanup(now));
    },
  };
}
