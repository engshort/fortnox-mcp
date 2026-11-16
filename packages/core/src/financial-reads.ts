import {
  type Actor,
  actorResource,
  hasPermission,
  requirePermission,
} from "./actor.js";
import type { Connections } from "./connections.js";
import { DomainError } from "./errors.js";
import {
  type FinancialReadQuery,
  financialReadQuery,
  type ReadDefinition,
  type ReadModule,
  type ReadOperation,
  readDefinitions,
  readOutput,
} from "./read-contracts.js";

export interface FinancialReadProvider {
  read(
    actor: Actor,
    operation: ReadOperation,
    input: FinancialReadQuery,
    page: number,
  ): Promise<{ data: unknown; next: number | null; source: string }>;
}
interface Cursor {
  owner: string;
  client: string;
  resource: string;
  company: string;
  generation: number;
  operation: ReadOperation;
  query: string;
  nextPage: number;
  expiresAt: number;
}
export class FinancialReads {
  constructor(
    readonly connections: Connections,
    readonly provider: FinancialReadProvider,
    readonly modules: readonly ReadModule[],
    readonly now = Date.now,
  ) {}
  available(actor: Actor, operation: ReadOperation): boolean {
    const definition: ReadDefinition = readDefinitions[operation];
    return Boolean(
      definition.module &&
        this.modules.includes(definition.module) &&
        hasPermission(actor, "read") &&
        hasPermission(actor, "finance_read"),
    );
  }
  async read(actor: Actor, operation: ReadOperation, input: unknown) {
    requirePermission(actor, "read");
    if (!this.available(actor, operation))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const definition: ReadDefinition = readDefinitions[operation];
    const parsed = financialReadQuery.parse(definition.input.parse(input));
    const before = await this.connections.authorizeActor(
      actor,
      parsed.company_id,
    );
    if (!before.scopes.includes(definition.scope ?? ""))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const started = this.now();
    const limit = parsed.limit ?? 100;
    const query = JSON.stringify([
      parsed.financial_year ?? null,
      parsed.number ?? null,
      parsed.series ?? null,
      limit,
    ]);
    const binding = {
      owner: actor.ownerId,
      client: actor.clientId,
      resource: actorResource(actor),
      company: before.id,
      generation: before.generation,
      operation,
      query,
    };
    let page = 1;
    if (parsed.continuation) {
      const record = (
        await this.connections.state.get<Record<string, Cursor>>(
          "read-continuations-v1",
          actor.ownerId,
        )
      )?.value[parsed.continuation];
      if (
        !record ||
        record.expiresAt <= started ||
        Object.entries(binding).some(
          ([key, value]) => record[key as keyof Cursor] !== value,
        )
      )
        throw new DomainError("COMPANY_FORBIDDEN");
      page = record.nextPage;
    }
    const result = await this.provider.read(
      actor,
      operation,
      { ...parsed, limit },
      page,
    );
    const after = await this.connections.authorizeActor(
      actor,
      parsed.company_id,
    );
    if (before.generation !== after.generation)
      throw new DomainError("COMPANY_FORBIDDEN");
    let continuation: string | null = null;
    if (result.next !== null) {
      if (
        !Number.isSafeInteger(result.next) ||
        result.next <= page ||
        result.next > 10000
      )
        throw new DomainError("UPSTREAM_UNAVAILABLE");
      for (let attempt = 0; attempt < 8; attempt++) {
        const row = await this.connections.state.get<Record<string, Cursor>>(
          "read-continuations-v1",
          actor.ownerId,
        );
        const live = Object.fromEntries(
          Object.entries(row?.value ?? {}).filter(
            ([, value]) => value.expiresAt > this.now(),
          ),
        );
        if (Object.keys(live).length >= 32)
          throw new DomainError("CAPABILITY_UNAVAILABLE");
        const id = crypto.randomUUID();
        live[id] = {
          ...binding,
          nextPage: result.next,
          expiresAt: this.now() + 600000,
        };
        if (
          await this.connections.state.put(
            "read-continuations-v1",
            actor.ownerId,
            live,
            row?.version ?? null,
          )
        ) {
          continuation = id;
          break;
        }
      }
      if (!continuation) throw new DomainError("RATE_LIMITED");
    }
    const output = readOutput(definition.data).safeParse({
      status: "ok",
      company_id: before.id,
      data: result.data,
      evidence: {
        retrieved_at: new Date(this.now()).toISOString(),
        retrieval_started_at: new Date(started).toISOString(),
        complete: result.next === null,
        sources: [result.source],
        warnings: [
          "Provider observations are not an atomic snapshot.",
          ...(definition.module === "accounts"
            ? [
                "Provider-supplied annual balances; not balances as of an arbitrary date.",
              ]
            : []),
        ],
        ...(parsed.financial_year !== undefined
          ? { financial_year: parsed.financial_year }
          : {}),
      },
      continuation,
    });
    if (!output.success) throw new DomainError("UPSTREAM_UNAVAILABLE");
    await this.connections.authorizeActor(actor, before.id);
    return output.data;
  }
}
