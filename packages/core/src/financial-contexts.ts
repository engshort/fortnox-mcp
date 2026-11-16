import { z } from "zod";
import { accountingDate, accountingHash } from "./accounting.js";
import { hasPermission } from "./actor.js";
import {
  type AnalysisRecord,
  type AnalysisStore,
  analysisLimits,
} from "./analysis-storage.js";
import {
  calculateFinancialReport,
  type FinancialBasis,
  type FinancialContextReader,
  type FinancialQuery,
  financialBasis,
  type MovementRead,
} from "./analytics.js";
import type { AccountingActor } from "./bookkeeping.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import {
  type FinancialYearIndex,
  type FinancialYearProvider,
  financialYearIndex,
} from "./financial-dates.js";
import { sumAmounts } from "./money.js";
import { assertFeature, assertScopeProgram } from "./programs.js";

export const prepareFinancialAnalysisQuery = z
  .object({
    company_id: z.string().uuid(),
    from: accountingDate,
    to: accountingDate,
    analysis_context_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((q) => q.from <= q.to);
export class AnalysisContextError extends DomainError {
  constructor(readonly reason: string) {
    super("CAPABILITY_UNAVAILABLE");
  }
}
export interface AnalysisSource extends FinancialYearProvider {
  beginAnalysisYear(
    actor: AccountingActor,
    query: FinancialQuery,
    until: number,
  ): Promise<{ source: unknown; cursor: unknown }>;
  advanceAnalysisYear(
    actor: AccountingActor,
    cursor: unknown,
    source: () => Promise<unknown>,
    until: number,
  ): Promise<{ cursor?: unknown; basis?: FinancialBasis }>;
  financialYear(
    actor: AccountingActor,
    company: string,
    year: number,
    until?: number,
  ): Promise<{ id: number; from: string; to: string }>;
  profileVersion(company: string, year: number): Promise<string>;
}
type Movement = FinancialBasis["movements"][number];
type PackedMovement = [
  string,
  number,
  string,
  string,
  boolean | null,
  string,
  Movement["voucher_ref"],
  Record<string, string>,
  string | null | undefined,
];
function pack(row: Movement): PackedMovement {
  return [
    row.id,
    row.account,
    row.date,
    row.amount,
    row.effective,
    row.source_ref,
    row.voucher_ref,
    row.dimensions,
    row.description,
  ];
}
function unpack(row: PackedMovement): Movement {
  return {
    id: row[0],
    account: row[1],
    date: row[2],
    amount: row[3],
    effective: row[4],
    source_ref: row[5],
    ...(row[6] ? { voucher_ref: row[6] } : {}),
    dimensions: row[7],
    ...(row[8] != null ? { description: row[8] } : {}),
  };
}
type PackedBasis = Omit<FinancialBasis, "movements"> & {
  movements: PackedMovement[];
};
interface Manifest {
  binding: string;
  from: string;
  to: string;
  index: FinancialYearIndex;
  profiles: string[];
  year: number;
  phase: "start" | "source" | "publish";
  page: number;
}
interface MovementPointer {
  id: string;
  account: number;
  date: string;
  part: string;
  effective: boolean | null;
}
interface RowPage {
  name: string;
  low: number;
  high: number;
  from: string;
  to: string;
}
export interface AnalysisContextMetric {
  operation: "context.prepare" | "context.read";
  outcome: "building" | "ready" | "hit" | "error";
  duration_ms: number;
}
export class FinancialContexts implements FinancialContextReader {
  constructor(
    readonly connections: Connections,
    readonly source: AnalysisSource,
    readonly store: AnalysisStore,
    readonly enabled = false,
    readonly now = Date.now,
    readonly observe?: (metric: AnalysisContextMetric) => void,
  ) {}
  private metric(
    operation: AnalysisContextMetric["operation"],
    outcome: AnalysisContextMetric["outcome"],
    started: number,
  ) {
    try {
      this.observe?.({ operation, outcome, duration_ms: this.now() - started });
    } catch {
      /* optional metadata sink */
    }
  }
  private async binding(actor: AccountingActor, company: string) {
    if (!this.enabled)
      throw new AnalysisContextError("analysis_contexts_disabled");
    if (!hasPermission(actor, "read")) throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(c, "bookkeeping");
    // Isolated source fixtures can use the legacy all-program selection.
    if (c.programs) assertFeature(c, "financial-analysis");
    if (!c.scopes.includes("bookkeeping"))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    return accountingHash({
      version: "analysis-context/1",
      owner: actor.ownerId,
      client: actor.clientId,
      company,
      tenant: c.tenant,
      generation: c.generation,
      access: c.accessRevision ?? 0,
      revision: c.financialRevision ?? 0,
      programs: c.programs ?? null,
      key: this.connections.vault.active,
      scopes: c.scopes,
    });
  }
  private partBinding(r: AnalysisRecord, name: string, ordinal: number) {
    return JSON.stringify([
      "analysis-part/1",
      r.id,
      r.namespace,
      r.owner,
      r.company,
      name,
      ordinal,
    ]);
  }
  private async write(
    r: AnalysisRecord,
    lease: string,
    name: string,
    value: unknown,
  ) {
    const json = JSON.stringify(value),
      chunks = [];
    for (
      let offset = 0;
      offset < json.length;
      offset += analysisLimits.chunkCharacters
    )
      chunks.push(
        await this.connections.vault.sealData(
          json.slice(offset, offset + analysisLimits.chunkCharacters),
          this.partBinding(r, name, chunks.length),
        ),
      );
    if (!(await this.store.write(r.id, lease, name, chunks, this.now())))
      throw new AnalysisContextError(
        "analysis_capacity_or_lease_exceeded_retry_preparation",
      );
  }
  private async read<T>(r: AnalysisRecord, name: string): Promise<T> {
    const chunks = await this.store.read(r.id, name);
    if (!chunks.length)
      throw new AnalysisContextError("analysis_incomplete_prepare_again");
    let text = "";
    for (const [ordinal, chunk] of chunks.entries()) {
      const value = await this.connections.vault.openData(
        chunk,
        this.partBinding(r, name, ordinal),
      );
      if (typeof value !== "string") throw new DomainError("VALIDATION_FAILED");
      text += value;
    }
    return JSON.parse(text) as T;
  }
  private async manifest(r: AnalysisRecord) {
    return (await this.connections.vault.openData(
      r.manifest,
      this.partBinding(r, "manifest", 0),
    )) as Manifest;
  }
  private async checked(actor: AccountingActor, company: string, id: string) {
    const binding = await this.binding(actor, company),
      r = await this.store.get(id);
    if (!r)
      throw new AnalysisContextError(
        "analysis_unavailable_or_expired_prepare_again",
      );
    if (r.owner !== actor.ownerId || r.company !== company)
      throw new DomainError("COMPANY_FORBIDDEN");
    if (r.expires <= this.now()) {
      await this.store.remove(id);
      throw new AnalysisContextError("analysis_expired_prepare_again");
    }
    const m = await this.manifest(r);
    if (m.binding !== binding)
      throw new AnalysisContextError(
        "analysis_access_or_source_changed_prepare_again",
      );
    for (const [i, y] of m.index.years.entries())
      if ((await this.source.profileVersion(company, y.id)) !== m.profiles[i])
        throw new AnalysisContextError(
          "analysis_profile_changed_prepare_again",
        );
    return { r, m };
  }
  private async checkpoint(
    r: AnalysisRecord,
    m: Manifest,
    lease: string,
    ready: boolean,
  ) {
    const manifest = await this.connections.vault.sealData(
      m,
      this.partBinding(r, "manifest", 0),
    );
    const expires = ready ? this.now() + analysisLimits.readyMs : r.expires;
    if (
      !(await this.store.finish(
        r.id,
        lease,
        manifest,
        expires,
        ready,
        this.now(),
      ))
    )
      throw new AnalysisContextError("analysis_lease_lost_retry_preparation");
    return { ...r, expires, ready };
  }
  private status(r: AnalysisRecord, m: Manifest) {
    return {
      analysis_context_id: r.id,
      state: r.ready ? ("ready" as const) : ("building" as const),
      expires_at: r.expires,
      years_completed: m.year,
      years_total: m.index.years.length,
      next_action: r.ready
        ? ("query_with_analysis_context_id" as const)
        : ("repeat_prepare_with_analysis_context_id" as const),
    };
  }
  async prepare(actor: AccountingActor, input: unknown) {
    const started = this.now(),
      q = prepareFinancialAnalysisQuery.parse(input),
      until = started + 45000;
    const binding = await this.binding(actor, q.company_id);
    if (!q.analysis_context_id) await this.store.cleanup(started);
    let id = q.analysis_context_id;
    if (!id) {
      const namespace = await accountingHash([binding, q.from, q.to]);
      let r = await this.store.find(namespace);
      if (r?.ready) {
        await this.store.remove(r.id);
        r = null;
      }
      if (!r) {
        const index = financialYearIndex.parse(
          await this.source.years(actor, q.company_id, until),
        );
        if (index.company_id !== q.company_id || !index.complete)
          throw new AnalysisContextError("financial_year_index_incomplete");
        index.years.sort((a, b) => a.from.localeCompare(b.from));
        if (
          new Set(index.years.map((y) => y.id)).size !== index.years.length ||
          index.years.some(
            (y, i) =>
              y.from > y.to ||
              (i > 0 && (index.years[i - 1]?.to ?? "") >= y.from),
          )
        )
          throw new AnalysisContextError("financial_year_index_ambiguous");
        index.years = index.years.filter(
          (y) => y.from <= q.to && y.to >= q.from,
        );
        if (!index.years.length || index.years.length > analysisLimits.years)
          throw new AnalysisContextError(
            "analysis_year_limit_5_select_smaller_interval",
          );
        const m: Manifest = {
          binding,
          from: q.from,
          to: q.to,
          index,
          profiles: await Promise.all(
            index.years.map((y) =>
              this.source.profileVersion(q.company_id, y.id),
            ),
          ),
          year: 0,
          phase: "start",
          page: 0,
        };
        r = {
          id: crypto.randomUUID(),
          namespace,
          owner: actor.ownerId,
          company: q.company_id,
          expires: started + analysisLimits.buildingMs,
          ready: false,
          manifest: { key: "", iv: "", data: "" },
        };
        r.manifest = await this.connections.vault.sealData(
          m,
          this.partBinding(r, "manifest", 0),
        );
        if ((await this.binding(actor, q.company_id)) !== binding)
          throw new DomainError("CONNECTION_CONFLICT");
        if (!(await this.store.reserve(r, this.now()))) {
          r = await this.store.find(namespace);
          if (!r)
            throw new AnalysisContextError(
              "analysis_capacity_exceeded_wait_for_expiry_or_reduce_input",
            );
        }
      }
      id = r.id;
    }
    let { r, m } = await this.checked(actor, q.company_id, id);
    if (m.from !== q.from || m.to !== q.to)
      throw new DomainError("CONNECTION_CONFLICT");
    if (r.ready) return this.status(r, m);
    const lease = await this.store.claim(id, this.now());
    if (!lease) return this.status(r, m);
    // Reload after acquiring the lease: another request may just have checkpointed.
    ({ r, m } = await this.checked(actor, q.company_id, id));
    try {
      const y = m.index.years[m.year];
      if (!y) throw new DomainError("VALIDATION_FAILED");
      if (m.phase === "start") {
        const build = await this.source.beginAnalysisYear(
          actor,
          {
            company_id: q.company_id,
            financial_year: y.id,
            from: y.from,
            to: y.to,
          },
          until,
        );
        await this.write(r, lease, "source", build.source);
        await this.write(r, lease, "build", build.cursor);
        m.phase = "source";
      } else if (m.phase === "source") {
        const result = await this.source.advanceAnalysisYear(
          actor,
          await this.read(r, "build"),
          () => this.read(r, "source"),
          until,
        );
        if (result.basis) {
          const basis = financialBasis.parse(result.basis);
          if (
            basis.year.id !== y.id ||
            basis.year.from !== y.from ||
            basis.year.to !== y.to
          )
            throw new AnalysisContextError(
              "analysis_year_changed_prepare_again",
            );
          if (basis.movements.some((row) => row.effective === null))
            basis.limitations = [
              ...new Set([
                ...basis.limitations,
                "unknown_effective_row_semantics",
              ]),
            ];
          calculateFinancialReport(
            {
              company_id: q.company_id,
              financial_year: y.id,
              from: y.from,
              to: y.to,
            },
            basis,
          );
          if (basis.consistency === "changed")
            throw new AnalysisContextError(
              "source_changed_during_retrieval_prepare_again",
            );
          await this.write(r, lease, "publish", {
            ...basis,
            movements: basis.movements.map(pack),
          });
          await this.store.write(r.id, lease, "build", [], this.now());
          await this.store.write(r.id, lease, "source", [], this.now());
          m.phase = "publish";
          m.page = 0;
        } else await this.write(r, lease, "build", result.cursor);
      } else {
        const packed = await this.read<PackedBasis>(r, "publish");
        const basis: FinancialBasis = {
          ...packed,
          movements: packed.movements.map(unpack),
        };
        const rows = [...basis.movements].sort(
          (a, b) =>
            a.account - b.account ||
            a.date.localeCompare(b.date) ||
            a.id.localeCompare(b.id),
        );
        const pages: RowPage[] = [];
        for (let offset = 0; offset < rows.length; offset += 256) {
          const page = rows.slice(offset, offset + 256);
          pages.push({
            name: `rows:${y.id}:${pages.length}`,
            low: page[0]?.account ?? 0,
            high: page.at(-1)?.account ?? 0,
            from: page.reduce((d, v) => (v.date < d ? v.date : d), y.to),
            to: page.reduce((d, v) => (v.date > d ? v.date : d), y.from),
          });
        }
        const end = Math.min(pages.length, m.page + 32);
        for (; m.page < end && this.now() < until; m.page++) {
          const p = pages[m.page];
          if (p)
            await this.write(
              r,
              lease,
              p.name,
              rows.slice(m.page * 256, (m.page + 1) * 256).map(pack),
            );
        }
        if (m.page === pages.length) {
          const indexed = indexBasis(basis);
          await this.write(r, lease, `header:${y.id}`, {
            ...basis,
            movements: [],
          });
          await this.write(r, lease, `summary:${y.id}`, indexed);
          await this.write(r, lease, `pages:${y.id}`, pages);
          await this.write(
            r,
            lease,
            `selection:${y.id}`,
            rows.map((row, i) => ({
              id: row.id,
              account: row.account,
              date: row.date,
              effective: row.effective,
              part: `rows:${y.id}:${Math.floor(i / 256)}`,
            })),
          );
          await this.store.write(r.id, lease, "publish", [], this.now());
          m.year++;
          m.phase = "start";
          m.page = 0;
        }
      }
      await this.checked(actor, q.company_id, id);
      r = await this.checkpoint(r, m, lease, m.year === m.index.years.length);
      this.metric("context.prepare", r.ready ? "ready" : "building", started);
      return this.status(r, m);
    } catch (error) {
      await this.store.remove(id, lease);
      this.metric("context.prepare", "error", started);
      throw error;
    }
  }
  async years(actor: AccountingActor, company: string, context: string) {
    const { r, m } = await this.checked(actor, company, context);
    if (!r.ready)
      throw new AnalysisContextError("analysis_building_continue_preparation");
    return m.index;
  }
  async readBasis(
    actor: AccountingActor,
    query: FinancialQuery,
    rawMovements: boolean | MovementRead = false,
  ): Promise<FinancialBasis> {
    const started = this.now();
    if (!query.analysis_context_id) throw new DomainError("VALIDATION_FAILED");
    const { r, m } = await this.checked(
      actor,
      query.company_id,
      query.analysis_context_id,
    );
    if (!r.ready)
      throw new AnalysisContextError("analysis_building_continue_preparation");
    const y = m.index.years.find((y) => y.id === query.financial_year);
    if (!y || query.from < y.from || query.to > y.to)
      throw new AnalysisContextError(
        "analysis_year_not_captured_prepare_new_context",
      );
    // Permission probe is independent of the historical source observation.
    const current = await this.source
      .financialYear(actor, r.company, y.id, started + 45000)
      .catch(async (error) => {
        await this.store.remove(r.id);
        throw error;
      });
    if (current.from !== y.from || current.to !== y.to)
      throw new AnalysisContextError("analysis_year_changed_prepare_again");
    const basis = await this.read<FinancialBasis>(
      r,
      `${rawMovements ? "header" : "summary"}:${y.id}`,
    );
    if (rawMovements) {
      const selection = (
        await this.read<MovementPointer[]>(r, `selection:${y.id}`)
      )
        .filter(
          (v) =>
            (!(
              typeof rawMovements === "object" && rawMovements.effective_only
            ) ||
              v.effective === true) &&
            v.date >= query.from &&
            v.date <= query.to &&
            (!query.account_numbers ||
              query.account_numbers.includes(v.account)),
        )
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
        );
      const after =
        typeof rawMovements === "object"
          ? rawMovements.after_movement
          : undefined;
      const position = after ? selection.findIndex((v) => v.id === after) : 0;
      if (position < 0) throw new DomainError("CONNECTION_CONFLICT");
      // Include the anchor and one look-ahead row for the existing cursor rules.
      const selected =
        typeof rawMovements === "object"
          ? selection.slice(
              position,
              position + rawMovements.page_size + (after ? 2 : 1),
            )
          : selection;
      const ids = new Set(selected.map((v) => v.id));
      for (const part of new Set(selected.map((v) => v.part))) {
        const rows = (await this.read<PackedMovement[]>(r, part)).map(unpack);
        basis.movements.push(...rows.filter((v) => ids.has(v.id)));
      }
      basis.movement_selection = { total: selection.length };
    }
    if (this.now() >= started + 45000)
      throw new AnalysisContextError(
        "analysis_read_budget_select_fewer_accounts",
      );
    await this.checked(actor, r.company, r.id);
    basis.analysis_context = {
      id: r.id,
      mode: "pinned_basis",
      expires_at: r.expires,
      provider_access_checked_at: this.now(),
    };
    this.metric("context.read", "hit", started);
    return basis;
  }
}
// Daily amounts omit descriptions/dimensions; actual rows stay separately encrypted.
// Original sample positions preserve the existing source-order movement IDs.
function indexBasis(basis: FinancialBasis): FinancialBasis {
  const grouped = new Map<
    string,
    {
      row: FinancialBasis["movements"][number];
      count: number;
      samples: { id: string; position: number }[];
    }
  >();
  for (const [position, row] of basis.movements.entries()) {
    const key = `${row.account}:${row.date}:${row.effective}`;
    const prior = grouped.get(key);
    if (prior) {
      prior.row.amount = sumAmounts([prior.row.amount, row.amount], 2);
      prior.count++;
      if (prior.samples.length < 20)
        prior.samples.push({ id: row.id, position });
    } else
      grouped.set(key, {
        row: {
          id: `daily:${grouped.size}`,
          account: row.account,
          date: row.date,
          amount: row.amount,
          effective: row.effective,
          source_ref: "daily_aggregate",
          dimensions: {},
        },
        count: 1,
        samples: [{ id: row.id, position }],
      });
  }
  return {
    ...basis,
    movements: [...grouped.values()].map((v) => v.row),
    movement_summaries: Object.fromEntries(
      [...grouped.values()].map((v) => [
        v.row.id,
        { count: v.count, samples: v.samples },
      ]),
    ),
  };
}
