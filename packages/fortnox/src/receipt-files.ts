import {
  type AccountingActor,
  type AccountingProvider,
  type AttachmentReference,
  assertScopeProgram,
  attachmentReference,
  type Connections,
  DomainError,
  fileDigest,
  providerFileId,
  type ReceiptFileRecord,
  type ReceiptProvider,
  type ReceiptWriteResult,
  receiptFileLimits,
} from "@fortnox-mcp/core";
import { fileValidator } from "@fortnox-mcp/files";
import { z } from "zod";
import type { FortnoxConnections } from "./connections.js";
import {
  boundedResponse,
  FortnoxHttp,
  type ProviderContext,
  ProviderError,
} from "./http.js";
export interface ReceiptProviderGates {
  upload: boolean;
  link: boolean;
  connectionRead: boolean;
  inboxRead: boolean;
  formats: readonly string[];
  // Only dated operation evidence may classify a dispatched rejection as not applied.
  rejectedWithoutEffect: {
    inbox_upload: readonly number[];
    voucher_file_link: readonly number[];
  };
}
export const receiptProviderOperations = Object.freeze({
  inbox_upload: {
    method: "POST",
    path: "/3/inbox",
    scope: "inbox",
    effect: "file_write",
  },
  voucher_file_link: {
    method: "POST",
    path: "/3/voucherfileconnections",
    scope: "connectfile",
    effect: "attachment_write",
  },
  voucher_file_read: {
    method: "GET",
    path: "/3/voucherfileconnections/{FileId}",
    scope: "connectfile",
    effect: "read",
  },
  inbox_read: {
    method: "GET",
    path: "/3/inbox/{Id}",
    scope: "inbox",
    effect: "read",
  },
});
const integer = z.union([
  z.number().int().positive().safe(),
  z
    .string()
    .regex(/^[1-9]\d{0,14}$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe()),
]);
const connection = z.object({
  VoucherFileConnection: z.object({
    FileId: providerFileId,
    VoucherNumber: integer,
    VoucherSeries: z.string(),
    VoucherYear: integer,
  }),
});
export class FortnoxReceiptFiles implements ReceiptProvider {
  readonly http: FortnoxHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly accounting: AccountingProvider,
    readonly gates: ReceiptProviderGates,
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
    scope: string,
    write = false,
  ): Promise<ProviderContext> {
    if (
      !actor.scopes.includes("mcp:read") ||
      !actor.scopes.includes("mcp:files") ||
      (write && !actor.scopes.includes("mcp:write"))
    )
      throw new DomainError("AUTH_REQUIRED");
    const c = await this.connections.authorize(
      actor.ownerId,
      actor.clientId,
      company,
    );
    assertScopeProgram(c, scope);
    if (write && c.readOnly) throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (!this.provider.allowsTenant(c.tenant))
      throw new DomainError("COMPANY_FORBIDDEN");
    if (!c.scopes.includes(scope))
      throw new ProviderError("CAPABILITY_UNAVAILABLE", "missing_scope");
    return {
      owner: actor.ownerId,
      company,
      generation: c.generation,
      tenant: c.tenant,
      clientId: (await this.connections.credentials(actor.ownerId, c)).clientId,
      token: (force) => this.provider.token(actor.ownerId, c, force),
      assertActive: async () => {
        const current = await this.connections.authorize(
          actor.ownerId,
          actor.clientId,
          company,
        );
        assertScopeProgram(current, scope);
        if (
          current.generation !== c.generation ||
          current.policyVersion !== c.policyVersion ||
          (write && current.readOnly)
        )
          throw new DomainError("COMPANY_FORBIDDEN");
      },
    };
  }
  private async write(
    actor: AccountingActor,
    company: string,
    operation: "inbox_upload" | "voucher_file_link",
    url: URL,
    body: BodyInit,
    before: () => Promise<void>,
    parse: (raw: unknown) => string,
    contentType?: string,
  ): Promise<ReceiptWriteResult> {
    const ctx = await this.context(
        actor,
        company,
        receiptProviderOperations[operation].scope,
        true,
      ),
      deadline = this.now() + 15000;
    await this.http.permit(ctx, deadline);
    const token = await ctx.token(false);
    await ctx.assertActive();
    if (this.now() >= deadline)
      throw new ProviderError("RATE_LIMITED", "file_write_budget");
    await before();
    let trustedReference: string | undefined;
    const controller = new AbortController();
    let response: Response | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          void response?.body?.cancel().catch(() => {});
          reject(new Error("bounded file write"));
        },
        Math.max(1, deadline - this.now()),
      );
    });
    const work = async (): Promise<ReceiptWriteResult> => {
      response = await this.provider.config.fetch(
        new Request(url, {
          method: "POST",
          body,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(contentType ? { "content-type": contentType } : {}),
          },
          redirect: "manual",
          signal: controller.signal,
        }),
      );
      if (controller.signal.aborted) {
        await response.body?.cancel();
        throw new Error("bounded file write");
      }
      if (!response.ok) {
        await response.body?.cancel();
        return this.gates.rejectedWithoutEffect[operation].includes(
          response.status,
        )
          ? { state: "failed", code: `HTTP_${response.status}` }
          : { state: "outcome_unknown" };
      }
      const reference = providerFileId.parse(
        parse(JSON.parse(await boundedResponse(response))),
      );
      trustedReference = reference;
      await ctx.assertActive();
      return { state: "succeeded", reference };
    };
    try {
      return await Promise.race([work(), timeout]);
    } catch {
      return {
        state: "outcome_unknown",
        ...(trustedReference ? { reference: trustedReference } : {}),
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  private async owningVoucher(
    actor: AccountingActor,
    ref: AttachmentReference,
  ) {
    const voucher = await this.accounting.read(
      actor,
      ref.company_id,
      ref.voucher,
    );
    if (
      voucher.company_id !== ref.company_id ||
      voucher.financial_year !== ref.voucher.financial_year ||
      voucher.series !== ref.voucher.series
    )
      throw new DomainError("COMPANY_FORBIDDEN");
  }

  async upload(
    actor: AccountingActor,
    company: string,
    file: { record: ReceiptFileRecord; bytes: Uint8Array },
    beforeDispatch: () => Promise<void>,
  ) {
    if (!this.gates.upload) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const actual = await fileValidator.validate(file.bytes);
    if (
      file.record.company !== company ||
      file.record.owner !== actor.ownerId ||
      file.record.client !== actor.clientId ||
      file.record.expires <= this.now() ||
      file.record.bytes !== file.bytes.length ||
      (await fileDigest(file.bytes)) !== file.record.hash
    )
      throw new DomainError("COMPANY_FORBIDDEN");
    if (
      actual.mime !== file.record.mime ||
      !this.gates.formats.includes(actual.mime)
    )
      throw new ProviderError(
        "CAPABILITY_UNAVAILABLE",
        "file_format_unverified",
      );
    const form = new FormData();
    const extension =
      { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" }[
        actual.mime
      ] ?? "bin";
    form.set(
      "file",
      new Blob([new Uint8Array(file.bytes)], { type: actual.mime }),
      `receipt-${file.record.id}.${extension}`,
    );
    return this.write(
      actor,
      company,
      "inbox_upload",
      new URL("https://api.fortnox.se/3/inbox?path=Inbox_v"),
      form,
      async () => {
        const current = await this.connections.authorize(
          actor.ownerId,
          actor.clientId,
          company,
        );
        if (
          current.generation !== file.record.generation ||
          current.policyVersion !== file.record.policy
        )
          throw new DomainError("COMPANY_FORBIDDEN");
        await beforeDispatch();
      },
      (raw) =>
        z.object({ File: z.object({ Id: providerFileId }) }).parse(raw).File.Id,
    );
  }
  async link(
    actor: AccountingActor,
    input: AttachmentReference,
    beforeDispatch: () => Promise<void>,
  ) {
    const ref = attachmentReference.parse(input);
    if (!this.gates.link) throw new DomainError("CAPABILITY_UNAVAILABLE");
    // Verify the owning accounting record before creating its file relationship.
    await this.owningVoucher(actor, ref);
    return this.write(
      actor,
      ref.company_id,
      "voucher_file_link",
      new URL(
        `https://api.fortnox.se/3/voucherfileconnections?financialyear=${ref.voucher.financial_year}`,
      ),
      JSON.stringify({
        VoucherFileConnection: {
          FileId: ref.file_id,
          VoucherSeries: ref.voucher.series,
          VoucherNumber: String(ref.voucher.number),
          VoucherYear: ref.voucher.financial_year,
        },
      }),
      beforeDispatch,
      (raw) => {
        const c = connection.parse(raw).VoucherFileConnection;
        if (
          c.FileId !== ref.file_id ||
          c.VoucherYear !== ref.voucher.financial_year ||
          c.VoucherSeries !== ref.voucher.series ||
          c.VoucherNumber !== ref.voucher.number
        )
          throw new DomainError("COMPANY_FORBIDDEN");
        return c.FileId;
      },
      "application/json",
    );
  }
  async connection(actor: AccountingActor, input: AttachmentReference) {
    const ref = attachmentReference.parse(input);
    if (!this.gates.connectionRead)
      throw new DomainError("CAPABILITY_UNAVAILABLE");
    const ctx = await this.context(actor, ref.company_id, "connectfile");
    const raw = await this.http.read(ctx, "voucher_file_connection", {
      fileId: ref.file_id,
      financialYear: ref.voucher.financial_year,
    });
    const c = connection.parse(raw).VoucherFileConnection;
    return (
      c.FileId === ref.file_id &&
      c.VoucherYear === ref.voucher.financial_year &&
      c.VoucherSeries === ref.voucher.series &&
      c.VoucherNumber === ref.voucher.number
    );
  }
  async retrieve(actor: AccountingActor, input: AttachmentReference) {
    const ref = attachmentReference.parse(input);
    if (!this.gates.inboxRead) throw new DomainError("CAPABILITY_UNAVAILABLE");
    await this.owningVoucher(actor, ref);
    if (!(await this.connection(actor, ref)))
      throw new DomainError("COMPANY_FORBIDDEN");
    const ctx = await this.context(actor, ref.company_id, "inbox"),
      deadline = this.now() + 15000;
    let force = false,
      renewed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let renewal = false;
      await this.http.permit(ctx, deadline);
      const token = await ctx.token(force);
      force = false;
      await ctx.assertActive();
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            void reader?.cancel().catch(() => {});
            reject(
              new ProviderError("UPSTREAM_UNAVAILABLE", "file_read_timeout"),
            );
          },
          Math.max(1, deadline - this.now()),
        );
      });
      const work = async () => {
        const response = await this.provider.config.fetch(
          new Request(`https://api.fortnox.se/3/inbox/${ref.file_id}`, {
            headers: {
              authorization: `Bearer ${token}`,
              accept: "image/jpeg,image/png,application/pdf",
            },
            redirect: "manual",
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) {
          await response.body?.cancel();
          throw new ProviderError("UPSTREAM_UNAVAILABLE", "file_read_timeout");
        }
        if (response.status === 401 && !renewed) {
          await response.body?.cancel();
          renewed = true;
          renewal = true;
          return null;
        }
        if (response.status === 401) {
          await response.body?.cancel();
          throw new ProviderError(
            "RECONNECT_REQUIRED",
            "provider_authentication",
          );
        }
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          await response.body?.cancel();
          const hint = response.headers.get("retry-after");
          const delay =
            hint && /^\d+$/.test(hint)
              ? Number(hint) * 1000
              : 250 * 2 ** attempt;
          if (this.now() + delay >= deadline)
            throw new ProviderError("RATE_LIMITED", "file_read_budget");
          await new Promise((resolve) => setTimeout(resolve, delay));
          return null;
        }
        if (response.status !== 200 || response.redirected) {
          await response.body?.cancel();
          throw new ProviderError(
            response.status === 403
              ? "CAPABILITY_UNAVAILABLE"
              : response.status === 429
                ? "RATE_LIMITED"
                : "UPSTREAM_UNAVAILABLE",
            response.status === 403
              ? "permission_scope_or_license_unknown"
              : "file_read_failed",
          );
        }
        const length = response.headers.get("content-length");
        if (
          length &&
          (!/^\d+$/.test(length) || Number(length) > receiptFileLimits.bytes)
        ) {
          await response.body?.cancel();
          throw new ProviderError(
            "UPSTREAM_UNAVAILABLE",
            "file_response_limit",
          );
        }
        reader = response.body?.getReader();
        if (!reader)
          throw new ProviderError(
            "UPSTREAM_UNAVAILABLE",
            "invalid_file_response",
          );
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > receiptFileLimits.bytes)
            throw new ProviderError(
              "UPSTREAM_UNAVAILABLE",
              "file_response_limit",
            );
          parts.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        try {
          const actual = await fileValidator.validate(bytes);
          const declared = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase();
          if (
            declared &&
            declared !== "application/octet-stream" &&
            declared !== actual.mime
          )
            throw new ProviderError(
              "UPSTREAM_UNAVAILABLE",
              "file_content_mismatch",
            );
          await ctx.assertActive();
          if (!(await this.connection(actor, ref)))
            throw new DomainError("COMPANY_FORBIDDEN");
          return { bytes, mime: actual.mime };
        } catch (cause) {
          bytes.fill(0);
          throw cause;
        }
      };
      try {
        const result = await Promise.race([work(), timeout]);
        if (result) return result;
        force = renewal;
      } finally {
        clearTimeout(timer);
        controller.abort();
        void reader?.cancel().catch(() => {});
      }
    }
    throw new ProviderError("RECONNECT_REQUIRED", "provider_authentication");
  }
}
