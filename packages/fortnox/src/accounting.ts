import {
  type AccountingActor,
  type AccountingGates,
  type AccountingProvider,
  type AccountingReferences,
  type AccountingYears,
  accountingDate,
  type Connections,
  DomainError,
  parseAmount,
  type SubmitResult,
  type VoucherInput,
  type VoucherReference,
  voucherInput,
  voucherReference,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import {
  boundedResponse,
  FortnoxHttp,
  type ProviderContext,
  ProviderError,
  type ProviderOperation,
  readPages,
} from "./http.js";

const providerBool = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((v) => v === true || v === "true");
const integer = z.union([
  z.number().int().safe(),
  z
    .string()
    .regex(/^\d{1,12}$/)
    .transform(Number),
]);
const rule = z.enum(["REQUIRED", "ALLOWED", "NOTALLOWED"]);
// List and single-account documentation disagree on this field's representation.
// A numeric value is observable reference data, never an inferred booking rule.
const informationRule = z.union([
  rule,
  z
    .number()
    .int()
    .safe()
    .transform(() => "UNKNOWN" as const),
]);
const dimension = z.object({
  Code: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  Active: providerBool,
});
const project = z.object({
  ProjectNumber: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  Status: z.enum(["NOTSTARTED", "ONGOING", "COMPLETED"]),
});
const year = z
  .object({
    Id: integer.refine((id) => id > 0),
    FromDate: accountingDate,
    ToDate: accountingDate,
  })
  .refine((y) => y.FromDate <= y.ToDate);
const account = z.object({
  Number: integer,
  Active: providerBool,
  Year: integer,
  CostCenterSettings: rule,
  ProjectSettings: rule,
  TransactionInformationSettings: informationRule,
});
const series = z.object({
  Code: z.string(),
  Manual: providerBool,
  Year: integer,
});
const meta = z
  .object({
    "@CurrentPage": integer,
    "@TotalPages": integer,
    "@TotalResources": integer.optional(),
  })
  .optional();

const responseFieldNames = new Set([
  "MetaInformation",
  "@CurrentPage",
  "@TotalPages",
  "@TotalResources",
  "Number",
  "Active",
  "Year",
  "CostCenterSettings",
  "ProjectSettings",
  "TransactionInformationSettings",
  "Code",
  "Manual",
  "ProjectNumber",
  "Status",
  "Id",
  "FromDate",
  "ToDate",
  "LockedPeriod",
  "EndDate",
]);
function parseReferenceResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  operation: ProviderOperation,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const paths = new Set(
    parsed.error.issues
      .slice(0, 8)
      .map((issue) =>
        [
          operation,
          ...issue.path
            .slice(0, 6)
            .map((part) =>
              typeof part === "number"
                ? "*"
                : responseFieldNames.has(String(part))
                  ? String(part)
                  : "field",
            ),
        ].join("."),
      ),
  );
  throw new ProviderError(
    "UPSTREAM_UNAVAILABLE",
    `invalid_${operation}_response`,
    null,
    [...paths].map((path) => ({ path, rule: "provider_contract" })),
  );
}

export class FortnoxAccounting implements AccountingProvider {
  readonly http: FortnoxHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly gates: AccountingGates,
    readonly now = Date.now,
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
    operation: ProviderOperation,
  ): Promise<ProviderContext> {
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    const required = {
      financial_years: "bookkeeping",
      accounts: "bookkeeping",
      voucher_series: "bookkeeping",
      locked_period: "settings",
      cost_centers: "costcenter",
      projects: "project",
      voucher: "bookkeeping",
      company_information: "companyinformation",
      identity: "profile",
    }[operation];
    if (!this.gates.references || !actor.scopes.includes("mcp:read"))
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (!c.scopes.includes(required))
      throw new ProviderError("CAPABILITY_UNAVAILABLE", "missing_scope");
    const generation = c.generation;
    return {
      owner: actor.ownerId,
      company: c.id,
      tenant: c.tenant,
      generation,
      clientId: (await this.connections.credentials(actor.ownerId, c)).clientId,
      assertActive: async () => {
        const current = await this.connections.authorize(
          actor.ownerId,
          actor.clientId,
          company,
        );
        if (current.generation !== generation)
          throw new DomainError("COMPANY_FORBIDDEN");
      },
      token: (force) => this.provider.token(actor.ownerId, c, force),
    };
  }
  private async list<T>(
    actor: AccountingActor,
    company: string,
    financialYear: number | undefined,
    operation: ProviderOperation,
    envelope: string,
    schema: z.ZodType<T>,
  ) {
    const ctx = await this.context(actor, company, operation);
    const until = this.now() + 15000;
    return readPages(
      async (page) => {
        const raw = parseReferenceResponse(
          z.object({ MetaInformation: meta }).catchall(z.unknown()),
          await this.http.read(
            ctx,
            operation,
            {
              ...(financialYear === undefined ? {} : { financialYear }),
              page,
            },
            until,
          ),
          operation,
        );
        const items = parseReferenceResponse(
          z.array(schema).max(100),
          raw[envelope],
          operation,
        );
        const m = raw.MetaInformation;
        // Missing pagination metadata cannot establish complete reference data.
        const empty =
          m &&
          page === 1 &&
          items.length === 0 &&
          m["@TotalResources"] === 0 &&
          m["@TotalPages"] === 0 &&
          [0, 1].includes(m["@CurrentPage"]);
        if (
          !m ||
          (!empty && (m["@CurrentPage"] !== page || m["@TotalPages"] < page))
        )
          throw new ProviderError("UPSTREAM_UNAVAILABLE", "invalid_pagination");
        return { items, next: page < m["@TotalPages"] ? page + 1 : null };
      },
      { pages: 5, items: 500, bytes: 262144, until },
      1,
      this.now,
    );
  }
  async years(
    actor: AccountingActor,
    company: string,
  ): Promise<AccountingYears> {
    const retrievedAt = this.now();
    const result = await this.list(
      actor,
      company,
      undefined,
      "financial_years",
      "FinancialYears",
      year,
    );
    if (new Set(result.items.map((y) => y.Id)).size !== result.items.length)
      throw new ProviderError(
        "UPSTREAM_UNAVAILABLE",
        "ambiguous_financial_years",
      );
    return {
      company_id: company,
      retrieved_at: retrievedAt,
      complete: result.complete,
      years: result.items.map((y) => ({
        id: y.Id,
        from: y.FromDate,
        to: y.ToDate,
      })),
    };
  }
  async references(
    actor: AccountingActor,
    company: string,
    financialYear: number,
  ): Promise<AccountingReferences> {
    z.number().int().positive().safe().parse(financialYear);
    const retrievedAt = this.now();
    const years = await this.years(actor, company);
    const selected = years.years.filter((y) => y.id === financialYear);
    if (selected.length !== 1)
      throw new ProviderError(
        "CAPABILITY_UNAVAILABLE",
        "financial_year_missing_or_ambiguous",
      );
    const accounts = await this.list(
      actor,
      company,
      financialYear,
      "accounts",
      "Accounts",
      account,
    );
    const seriesList = await this.list(
      actor,
      company,
      financialYear,
      "voucher_series",
      "VoucherSeriesCollection",
      series,
    );
    const costCenters = await this.list(
      actor,
      company,
      financialYear,
      "cost_centers",
      "CostCenters",
      dimension,
    );
    const projects = await this.list(
      actor,
      company,
      financialYear,
      "projects",
      "Projects",
      project,
    );
    const lock = parseReferenceResponse(
      z.object({
        LockedPeriod: z.object({
          EndDate: accountingDate.or(z.literal("")).nullable().optional(),
        }),
      }),
      await this.http.read(
        await this.context(actor, company, "locked_period"),
        "locked_period",
        { financialYear },
      ),
      "locked_period",
    );
    if (
      accounts.items.some((a) => a.Year !== financialYear) ||
      seriesList.items.some((s) => s.Year !== financialYear)
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    const y = selected[0];
    if (!y) throw new DomainError("CAPABILITY_UNAVAILABLE");
    return {
      company_id: company,
      financial_year: financialYear,
      retrieved_at: retrievedAt,
      complete: [years, accounts, seriesList, costCenters, projects].every(
        (r) => r.complete,
      ),
      year: { id: y.id, from: y.from, to: y.to },
      locked_through: lock.LockedPeriod.EndDate || null,
      // Actual lock/precision/row rules require the dated G06/G07 evidence packet.
      validation_verified: false,
      accounts: accounts.items.map((a) => ({
        number: a.Number,
        active: a.Active,
        cost_center: a.CostCenterSettings,
        project: a.ProjectSettings,
        information: a.TransactionInformationSettings,
      })),
      series: seriesList.items.map((s) => ({ code: s.Code, manual: s.Manual })),
      cost_centers: costCenters.items.map((d) => ({
        code: d.Code,
        active: d.Active,
      })),
      projects: projects.items.map((d) => ({
        code: d.ProjectNumber,
        active: d.Status === "ONGOING",
      })),
    };
  }
  async submit(
    actor: AccountingActor,
    input: VoucherInput,
    beforeDispatch: () => Promise<void>,
  ): Promise<SubmitResult> {
    const voucher = voucherInput.parse(input);
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      voucher.company_id,
    );
    if (!this.gates.writes || !actor.scopes.includes("mcp:write") || c.readOnly)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const context = await this.context(actor, c.id, "voucher");
    // Pace and acquire credentials before marking the intent dispatched. No automatic POST retry.
    await this.http.permit(context, this.now() + 15000);
    const token = await context.token(false);
    await context.assertActive();
    await beforeDispatch();
    try {
      const response = await this.provider.config.fetch(
        new Request(
          `https://api.fortnox.se/3/vouchers?financialyear=${voucher.financial_year}`,
          {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.timeout(15000),
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              Voucher: {
                Description: voucher.description,
                TransactionDate: voucher.date,
                VoucherSeries: voucher.series,
                VoucherRows: voucher.rows.map((r) => ({
                  Account: r.account,
                  Debit: r.debit,
                  Credit: r.credit,
                  ...(r.cost_center ? { CostCenter: r.cost_center } : {}),
                  ...(r.project ? { Project: r.project } : {}),
                  ...(r.information
                    ? { TransactionInformation: r.information }
                    : {}),
                })),
              },
            }),
          },
        ),
      );
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      ) {
        await response.body?.cancel();
        return { state: "failed", code: `HTTP_${response.status}` };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { state: "outcome_unknown" };
      }
      const result = z
        .object({
          Voucher: z.object({
            Year: integer,
            VoucherSeries: z.string(),
            VoucherNumber: integer,
          }),
        })
        .parse(JSON.parse(await boundedResponse(response)));
      const reference = voucherReference.parse({
        financial_year: result.Voucher.Year,
        series: result.Voucher.VoucherSeries,
        number: result.Voucher.VoucherNumber,
      });
      if (
        reference.financial_year !== voucher.financial_year ||
        reference.series !== voucher.series
      )
        return { state: "outcome_unknown" };
      return { state: "succeeded", reference };
    } catch {
      return { state: "outcome_unknown" };
    }
  }
  async read(
    actor: AccountingActor,
    company: string,
    input: VoucherReference,
  ): Promise<VoucherInput> {
    const reference = voucherReference.parse(input);
    const raw = await this.http.read(
      await this.context(actor, company, "voucher"),
      "voucher",
      {
        financialYear: reference.financial_year,
        voucher: { series: reference.series, number: reference.number },
      },
    );
    const v = z
      .object({
        Voucher: z.object({
          Year: integer,
          VoucherNumber: integer,
          VoucherSeries: z.string(),
          TransactionDate: z.string(),
          Description: z.string(),
          VoucherRows: z.array(
            z.object({
              Account: integer,
              Debit: z.string(),
              Credit: z.string(),
              Removed: providerBool,
              CostCenter: z.string().optional(),
              Project: z.string().optional(),
              TransactionInformation: z.string().optional(),
            }),
          ),
        }),
      })
      .parse(raw).Voucher;
    if (
      v.Year !== reference.financial_year ||
      v.VoucherNumber !== reference.number ||
      v.VoucherSeries !== reference.series ||
      v.VoucherRows.some((r) => r.Removed)
    )
      throw new DomainError("OUTCOME_UNKNOWN");
    return voucherInput.parse({
      company_id: company,
      financial_year: v.Year,
      series: v.VoucherSeries,
      date: v.TransactionDate,
      description: v.Description,
      currency: "SEK",
      attachments: [],
      rows: v.VoucherRows.map((r) => ({
        account: r.Account,
        debit: parseAmount(r.Debit, 2),
        credit: parseAmount(r.Credit, 2),
        ...(r.CostCenter ? { cost_center: r.CostCenter } : {}),
        ...(r.Project ? { project: r.Project } : {}),
        ...(r.TransactionInformation
          ? { information: r.TransactionInformation }
          : {}),
      })),
    });
  }
}
