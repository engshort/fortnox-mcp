import {
  type AccountingActor,
  type BusinessReference,
  type BusinessWriteResult,
  BusinessWrites,
  businessReference,
  type Connections,
  DomainError,
  payrollFieldsHash,
  salaryTransactionFields,
} from "@fortnox-mcp/core";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import { DocumentHttp } from "./document-http.js";
import { ProviderError } from "./http.js";
import type { FortnoxPayrollWrites } from "./payroll-writes.js";

const retainedDeleteResponse = z
  .object({
    intent_id: z.string().uuid(),
    proposal_hash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal(200),
    receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

// Operator-only update/delete acceptance, never installed in an MCP catalog.
// The target comes exclusively from a retained successful synthetic intent.
// Candidate operations do not assert their own verified-action evidence.
export class FortnoxPayrollMaintenanceProbe {
  readonly writes: BusinessWrites;
  constructor(
    readonly connections: Connections,
    provider: FortnoxConnections,
    readonly reads: FortnoxPayrollWrites,
    readonly known: BusinessReference,
    readonly action: "update" | "delete",
    readonly active: () => boolean = () => false,
    readonly now = Date.now,
    deleteResponse?: z.infer<typeof retainedDeleteResponse>,
  ) {
    businessReference.parse(known);
    z.enum(["update", "delete"]).parse(action);
    const acknowledged =
      deleteResponse === undefined
        ? undefined
        : retainedDeleteResponse.parse(deleteResponse);
    const operation = `salary_transaction.${action}`;
    const http = new DocumentHttp(
      connections,
      provider,
      [operation],
      active,
      now,
    );
    const inspect = async (actor: AccountingActor, company: string) => {
      if (!active()) throw new DomainError("CAPABILITY_UNAVAILABLE");
      if (company !== known.company_id)
        throw new DomainError("COMPANY_FORBIDDEN");
      const connection = await connections.authorize(
        actor.ownerId,
        actor.clientId,
        company,
      );
      const original = connection.business?.executions.find(
        (e) => e.id === known.proposal_id && e.hash === known.proposal_hash,
      );
      if (
        !original ||
        original.client !== actor.clientId ||
        original.tenant !== connection.tenant ||
        original.state !== "succeeded" ||
        !original.reference ||
        !original.evidence ||
        original.operation !==
          (action === "update"
            ? "salary_transaction.create"
            : "salary_transaction.update")
      )
        throw new DomainError("PROPOSAL_STALE");
      const current = await reads.get(actor, company, original.reference);
      const fields = salaryTransactionFields.parse(current.fields);
      if (
        !/^SYNM7[A-Z0-9]{6,10}$/.test(fields.EmployeeId) ||
        fields.SalaryCode !== "11" ||
        fields.Date !== "2026-11-10" ||
        fields.TextRow !== "SYNTHETIC M7 MCP INPUT" ||
        (await payrollFieldsHash(fields)) !== original.evidence.digest
      )
        throw new DomainError("VALIDATION_FAILED");
      const refs = await reads.references(
        actor,
        company,
        fields.EmployeeId,
        fields.Date,
      );
      const employee = refs.employees[0];
      if (
        !refs.complete ||
        !refs.license_verified ||
        !employee?.active ||
        employee.id !== fields.EmployeeId ||
        employee.from > fields.Date ||
        (employee.to !== null && employee.to < fields.Date) ||
        refs.codes[0]?.unit_amount !== "0.01"
      )
        throw new DomainError("VALIDATION_FAILED");
      return { current, fields };
    };
    this.writes = new BusinessWrites(
      connections,
      {
        [operation]: {
          scope: "salary",
          enabled: true,
          evidence: async (p) => {
            const input = z
              .object({ id: z.string(), fields: salaryTransactionFields })
              .strict()
              .parse(p.input);
            return {
              target: input.id,
              fields: Object.keys(input.fields).sort(),
              digest: await payrollFieldsHash(input.fields),
            };
          },
          prepare: async (actor, company, input) => {
            z.object({}).strict().parse(input);
            const { current, fields } = await inspect(actor, company);
            const after =
              action === "delete"
                ? null
                : { ...fields, Number: "3", Amount: "0.01", Total: "0.03" };
            return {
              input: { id: current.id, fields: after ?? fields },
              baseline: current.version,
              preview: {
                effect: `synthetic_payroll_${action}_acceptance_probe`,
                before: fields,
                after,
                payslip_or_payout: false,
              },
            };
          },
          validate: async (actor, company, p) => {
            const { current } = await inspect(actor, company);
            if (current.version !== p.baseline)
              throw new DomainError("PROPOSAL_STALE");
          },
          dispatch: async (actor, company, p, before) => {
            const input = z
              .object({
                id: z.string().regex(/^[1-9]\d{0,9}$/),
                fields: salaryTransactionFields,
              })
              .strict()
              .parse(p.input);
            const { current } = await inspect(actor, company);
            if (current.id !== input.id || current.version !== p.baseline)
              throw new DomainError("PROPOSAL_STALE");
            const context = await http.context(
              actor,
              company,
              operation,
              "salary",
              true,
            );
            const raw = await http.submit(
              context,
              new URL(
                `https://api.fortnox.se/3/salarytransactions/${input.id}`,
              ),
              action === "update" ? "PUT" : "DELETE",
              action === "update"
                ? JSON.stringify({ SalaryTransaction: input.fields })
                : undefined,
              before,
            );
            if (action === "delete") {
              if (raw?.deletion_acknowledged) {
                try {
                  await reads.get(actor, company, input.id);
                } catch (error) {
                  if (
                    error instanceof ProviderError &&
                    error.reason === "record_not_found"
                  )
                    return { state: "succeeded", reference: input.id };
                }
              }
            } else if (
              z
                .object({
                  SalaryTransaction: z.object({
                    SalaryRow: z.literal(input.id),
                  }),
                })
                .safeParse(raw).success
            ) {
              try {
                const observed = await reads.get(actor, company, input.id);
                if (
                  (await payrollFieldsHash(observed.fields)) ===
                  (await payrollFieldsHash(input.fields))
                )
                  return { state: "succeeded", reference: input.id };
              } catch {}
            }
            return { state: "outcome_unknown", reference: input.id };
          },
          reconcile: async (
            actor,
            company,
            e,
          ): Promise<BusinessWriteResult> => {
            // Only an operator's captured response receipt can add this proof;
            // no model supplies a reference, status or success attestation.
            if (
              action === "delete" &&
              acknowledged?.intent_id === e.id &&
              acknowledged.proposal_hash === e.hash &&
              e.reference &&
              e.evidence?.target === e.reference
            ) {
              try {
                await reads.get(actor, company, e.reference);
              } catch (error) {
                if (
                  error instanceof ProviderError &&
                  error.reason === "record_not_found"
                )
                  return { state: "succeeded", reference: e.reference };
              }
            }
            if (action === "update" && e.reference && e.evidence) {
              try {
                const row = await reads.get(actor, company, e.reference);
                if ((await payrollFieldsHash(row.fields)) === e.evidence.digest)
                  return { state: "succeeded", reference: e.reference };
              } catch {}
            }
            return { state: "outcome_unknown", reference: e.reference };
          },
        },
      },
      now,
    );
  }
}
