import {
  type Actor,
  accountingHash,
  type Bookkeeping,
  type BridgeCall,
  type BridgeCatalog,
  type BridgeExecution,
  BridgeNumber,
  type BridgeProvider,
  type BridgeRecovery,
  type BridgeResult,
  type BridgeShape,
  bridgeLimits,
  bridgeObject,
  bridgePathMatch,
  bridgePlain,
  bridgeSchemaCheck,
  type Connections,
  DomainError,
  parseBridgeJson,
} from "@fortnox-mcp/core";
import { fileValidator } from "@fortnox-mcp/files";
import type { FortnoxConnections } from "./connections.js";
import { boundedBytes, FortnoxHttp, type ProviderContext } from "./http.js";

export class FortnoxBridgeProvider implements BridgeProvider {
  readonly http: FortnoxHttp;
  constructor(
    readonly connections: Connections,
    readonly provider: FortnoxConnections,
    readonly catalog: () => Promise<BridgeCatalog | null>,
    readonly bookkeeping: Bookkeeping,
  ) {
    this.http = new FortnoxHttp({
      fetch: provider.config.fetch,
      state: connections.state,
    });
  }
  async validate(actor: Actor, company: string, call: BridgeCall) {
    const catalog = await this.catalog();
    if (!catalog) throw new DomainError("CAPABILITY_UNAVAILABLE");
    const path = bridgePathMatch(call.operation.path, call.path);
    if (!path) throw new DomainError("VALIDATION_FAILED");
    if (
      /^\/3\/(?:accounts|vouchers|sie)(?:\/|$)/.test(call.path) &&
      !/^[1-9]\d{0,9}$/.test(call.query.get("financialyear") ?? "")
    )
      throw new DomainError("VALIDATION_FAILED");
    for (const key of call.query.keys())
      if (
        !call.operation.parameters.some(
          (p) => p.in === "query" && p.name === key,
        )
      )
        throw new DomainError("VALIDATION_FAILED");
    const resolve = (schema: unknown, depth = 0): Record<string, unknown> => {
      if (depth > 32) throw new DomainError("CAPABILITY_UNAVAILABLE");
      const s = bridgeObject(schema);
      if (typeof s.$ref !== "string") return s;
      if (!s.$ref.startsWith("#/"))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      let target: unknown = catalog.root;
      for (const key of s.$ref.slice(2).split("/"))
        target =
          bridgeObject(target)[key.replace(/~1/g, "/").replace(/~0/g, "~")];
      return resolve(target, depth + 1);
    };
    const coerce = (value: string, schema: unknown): unknown => {
      const s = resolve(schema);
      if (s.type === "integer" || s.type === "number") {
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))
          throw new DomainError("VALIDATION_FAILED");
        return new BridgeNumber(value);
      }
      if (s.type === "boolean") {
        if (!["true", "false"].includes(value))
          throw new DomainError("VALIDATION_FAILED");
        return value === "true";
      }
      if (s.type === "array")
        return value.split(",").map((v) => coerce(v, s.items));
      return value;
    };
    for (const p of call.operation.parameters) {
      const values =
        p.in === "path"
          ? path[p.name] === undefined
            ? []
            : [path[p.name] as string]
          : p.in === "query"
            ? call.query.getAll(p.name)
            : call.headers.has(p.name)
              ? [call.headers.get(p.name) as string]
              : [];
      if (!values.length) {
        if (p.required) throw new DomainError("VALIDATION_FAILED");
        continue;
      }
      const schema = resolve(p.schema);
      if (p.style && !["form", "simple"].includes(p.style))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const repeatedArray =
        p.in === "query" && schema.type === "array" && p.explode !== false;
      if (values.length !== 1 && !repeatedArray)
        throw new DomainError("VALIDATION_FAILED");
      bridgeSchemaCheck(
        catalog.root,
        p.schema,
        repeatedArray
          ? values.map((v) => coerce(v, schema.items))
          : coerce(values[0] ?? "", p.schema),
      );
    }
    if (!call.bytes.length) {
      if (call.operation.bodyRequired)
        throw new DomainError("VALIDATION_FAILED");
      if (
        (call.operation.method === "POST" && call.path === "/3/vouchers") ||
        (["PUT", "PATCH"].includes(call.operation.method) &&
          /^\/3\/(?:invoices|offers|orders)(?:-v2)?\/[^/]+$/.test(call.path))
      )
        throw new DomainError("VALIDATION_FAILED");
      return;
    }
    const type = call.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
    const schema = call.operation.request[type];
    if (schema === undefined) throw new DomainError("CAPABILITY_UNAVAILABLE");
    let body: unknown;
    if (type === "application/json" || type.endsWith("+json")) {
      body = parseBridgeJson(
        new TextDecoder("utf-8", { fatal: true }).decode(call.bytes),
      );
    } else if (type === "multipart/form-data") {
      if (!call.operation.files)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const form = await new Request("https://bridge.invalid", {
        method: "POST",
        headers: { "content-type": call.contentType ?? "" },
        body: new Uint8Array(call.bytes),
      }).formData();
      const result: Record<string, unknown> = {};
      for (const [key, value] of form) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new DomainError("VALIDATION_FAILED");
        if (Object.hasOwn(result, key))
          throw new DomainError("VALIDATION_FAILED");
        if (typeof value === "string") result[key] = value;
        else {
          const file = new Uint8Array(await value.arrayBuffer());
          if (!file.length || file.length > bridgeLimits.requestBytes)
            throw new DomainError("VALIDATION_FAILED");
          try {
            await fileValidator.validate(file);
          } catch {
            throw new DomainError("VALIDATION_FAILED");
          }
          const properties = resolve(schema).properties;
          const partSchema = properties
            ? resolve(bridgeObject(properties)[key])
            : {};
          result[key] = partSchema.type === "string" ? value.name : {}; // Bytes are validated independently.
        }
      }
      body = result;
    } else {
      if (!call.operation.files)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      try {
        await fileValidator.validate(call.bytes);
      } catch {
        throw new DomainError("VALIDATION_FAILED");
      }
      return;
    }
    bridgeSchemaCheck(catalog.root, schema, body);
    if (call.operation.effect !== "write") return;
    if (call.operation.reconciliation === "exact_existing_target") {
      const read = catalog.operations.find(
        (op) =>
          op.method === "GET" &&
          op.effect === "read" &&
          !op.unavailable &&
          bridgePathMatch(op.path, call.path),
      );
      if (
        !read ||
        read.scopes.some((scope) => !call.operation.scopes.includes(scope))
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const current = await this.dispatch(
        actor,
        company,
        {
          ...call,
          operation: read,
          bytes: new Uint8Array(),
          contentType: null,
        },
        async () => {},
      );
      if (current.status !== 200)
        throw new DomainError(
          current.status === 404
            ? "RESOURCE_NOT_FOUND"
            : "CAPABILITY_UNAVAILABLE",
        );
    }
    if (call.path === "/3/vouchers") {
      const v = bridgeObject(bridgeObject(bridgePlain(body)).Voucher);
      if (call.headers.get("x-fortnox-currency") !== "SEK")
        throw new DomainError("VALIDATION_FAILED");
      if (
        Object.keys(v).some(
          (k) =>
            ![
              "Description",
              "TransactionDate",
              "VoucherSeries",
              "VoucherRows",
            ].includes(k),
        ) ||
        !Array.isArray(v.VoucherRows)
      )
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      await this.bookkeeping.validate(actor, {
        company_id: company,
        financial_year: Number(call.query.get("financialyear")),
        date: v.TransactionDate,
        series: v.VoucherSeries,
        description: v.Description,
        currency: "SEK",
        attachments: [],
        rows: v.VoucherRows.map((raw) => {
          const row = bridgeObject(raw);
          if (
            Object.keys(row).some(
              (k) =>
                ![
                  "Account",
                  "Debit",
                  "Credit",
                  "CostCenter",
                  "Project",
                  "TransactionInformation",
                ].includes(k),
            )
          )
            throw new DomainError("CAPABILITY_UNAVAILABLE");
          return {
            account: Number(row.Account),
            debit: row.Debit,
            credit: row.Credit,
            ...(row.CostCenter === undefined
              ? {}
              : { cost_center: row.CostCenter }),
            ...(row.Project === undefined ? {} : { project: row.Project }),
            ...(row.TransactionInformation === undefined
              ? {}
              : { information: row.TransactionInformation }),
          };
        }),
      });
    }
    if (
      ["PUT", "PATCH"].includes(call.operation.method) &&
      /^\/3\/(?:invoices|offers|orders)(?:-v2)?\/[^/]+$/.test(call.path)
    ) {
      const expected = call.headers.get("if-match");
      if (!expected) throw new DomainError("PRECONDITION_REQUIRED");
      const read = catalog.operations.find(
        (op) =>
          op.method === "GET" &&
          op.effect === "read" &&
          bridgePathMatch(op.path, call.path),
      );
      if (!read || read.unavailable)
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      const previous = await this.dispatch(
        actor,
        company,
        {
          ...call,
          operation: read,
          bytes: new Uint8Array(),
          contentType: null,
        },
        async () => {},
      );
      if (previous.status !== 200 || previous.headers.get("etag") !== expected)
        throw new DomainError("CONNECTION_CONFLICT");
      const prior = bridgeObject(
        parseBridgeJson(new TextDecoder().decode(previous.bytes)),
      );
      const next = bridgeObject(body);
      const family = /\/invoices/.test(call.path)
        ? "Invoice"
        : /\/offers/.test(call.path)
          ? "Offer"
          : "Order";
      const oldDoc = bridgeObject(prior[family]),
        newDoc = bridgeObject(next[family]);
      const oldRows = oldDoc[`${family}Rows`],
        newRows = newDoc[`${family}Rows`];
      if (!Array.isArray(oldRows) || !Array.isArray(newRows))
        throw new DomainError("VALIDATION_FAILED");
      const oldIds = oldRows.map((r) =>
        String(bridgePlain(bridgeObject(r).RowId)),
      );
      const newIds = newRows
        .filter((r) => bridgeObject(r).RowId !== undefined)
        .map((r) => String(bridgePlain(bridgeObject(r).RowId)));
      const removed = (call.headers.get("x-fortnox-removed-row-ids") ?? "")
        .split(",")
        .filter(Boolean);
      if (
        new Set([...newIds, ...removed]).size !==
          newIds.length + removed.length ||
        oldIds.some((id) => !newIds.includes(id) && !removed.includes(id)) ||
        [...newIds, ...removed].some((id) => !oldIds.includes(id))
      )
        throw new DomainError("VALIDATION_FAILED");
    }
  }
  private shape(value: unknown, depth = 0): BridgeShape {
    if (depth > 16) throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (Array.isArray(value)) return value.map((v) => this.shape(v, depth + 1));
    if (value && typeof value === "object" && !(value instanceof BridgeNumber))
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => {
            if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
              throw new DomainError("CAPABILITY_UNAVAILABLE");
            return [key, this.shape(bridgeObject(value)[key], depth + 1)];
          }),
      );
    return null;
  }
  private project(value: unknown, shape: BridgeShape): unknown {
    if (shape === null)
      return value instanceof BridgeNumber ? value.text : value;
    if (Array.isArray(shape)) {
      if (!Array.isArray(value) || value.length !== shape.length)
        throw new DomainError("OUTCOME_UNKNOWN");
      return shape.map((s, n) => this.project(value[n], s));
    }
    const object = bridgeObject(value);
    return Object.fromEntries(
      Object.keys(shape)
        .sort()
        .map((key) => {
          if (!Object.hasOwn(object, key))
            throw new DomainError("OUTCOME_UNKNOWN");
          return [key, this.project(object[key], shape[key] ?? null)];
        }),
    );
  }
  async recovery(call: BridgeCall): Promise<BridgeRecovery | undefined> {
    // Only an existing, explicit target can be reconciled generically. Creation,
    // delivery and deletion never guess identity or treat absence as proof.
    if (
      call.operation.reconciliation !== "exact_existing_target" ||
      call.operation.method !== "PUT" ||
      call.query.size ||
      !/^\/3\/[^/]+\/[^/]+$/.test(call.path) ||
      !call.contentType?.startsWith("application/json") ||
      call.operation.files
    )
      return;
    const body = parseBridgeJson(new TextDecoder().decode(call.bytes));
    let shape: BridgeShape;
    try {
      shape = this.shape(body);
    } catch {
      return;
    }
    if (JSON.stringify(shape).length > 4096) return;
    const catalog = await this.catalog();
    if (
      !catalog?.operations.some(
        (op) =>
          op.method === "GET" &&
          op.effect === "read" &&
          !op.unavailable &&
          bridgePathMatch(op.path, call.path),
      )
    )
      return;
    return {
      path: call.path,
      shape,
      digest: await accountingHash(this.project(body, shape)),
    };
  }
  async reconcile(
    actor: Actor,
    company: string,
    execution: BridgeExecution,
  ): Promise<"succeeded" | "outcome_unknown"> {
    const recovery = execution.recovery,
      catalog = await this.catalog();
    if (!recovery || !catalog) return "outcome_unknown";
    const operation = catalog.operations.find(
      (op) =>
        op.method === "GET" &&
        op.effect === "read" &&
        !op.unavailable &&
        bridgePathMatch(op.path, recovery.path),
    );
    if (!operation) return "outcome_unknown";
    const c = await this.connections.authorizeActor(actor, company);
    if (!operation.scopes.every((scope) => c.scopes.includes(scope)))
      return "outcome_unknown";
    try {
      const result = await this.dispatch(
        actor,
        company,
        {
          operation,
          path: recovery.path,
          query: new URLSearchParams(),
          bytes: new Uint8Array(),
          contentType: null,
          headers: new Headers(),
        },
        async () => {},
      );
      if (result.status !== 200) return "outcome_unknown";
      const body = parseBridgeJson(new TextDecoder().decode(result.bytes));
      return (await accountingHash(this.project(body, recovery.shape))) ===
        recovery.digest
        ? "succeeded"
        : "outcome_unknown";
    } catch {
      return "outcome_unknown";
    }
  }
  async dispatch(
    actor: Actor,
    company: string,
    call: BridgeCall,
    beforeDispatch: () => Promise<void>,
  ): Promise<BridgeResult> {
    const c = await this.connections.authorizeActor(actor, company);
    const assertActive = async () => {
      const current = await this.connections.authorizeActor(actor, company);
      if (
        current.generation !== c.generation ||
        !this.provider.allowsTenant(c.tenant)
      )
        throw new DomainError("COMPANY_FORBIDDEN");
    };
    const context: ProviderContext = {
      owner: actor.ownerId,
      company,
      tenant: c.tenant,
      generation: c.generation,
      clientId: (await this.connections.credentials(actor.ownerId, c)).clientId,
      assertActive,
      token: (force) => this.provider.token(actor.ownerId, c, force),
    };
    const deadline = Date.now() + bridgeLimits.timeoutMs;
    await this.http.permit(context, deadline);
    const token = await context.token(false);
    await assertActive();
    await beforeDispatch();
    const headers = new Headers({
      authorization: `Bearer ${token}`,
      accept: call.headers.get("accept") ?? "application/json",
    });
    if (call.contentType) headers.set("content-type", call.contentType);
    for (const p of call.operation.parameters)
      if (p.in === "header" && call.headers.has(p.name))
        headers.set(p.name, call.headers.get(p.name) ?? "");
    const url = new URL(`https://api.fortnox.se${call.path}`);
    url.search = call.query.toString();
    const send = (accessToken: string) =>
      this.provider.config.fetch(
        new Request(url, {
          method: call.operation.method,
          headers: new Headers(
            [...headers].map(([key, value]) => [
              key,
              key === "authorization" ? `Bearer ${accessToken}` : value,
            ]),
          ),
          ...(call.bytes.length ? { body: new Uint8Array(call.bytes) } : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
      );
    let response = await send(token);
    if (response.status === 401 && call.operation.effect === "read") {
      await response.body?.cancel();
      const replacement = await context.token(true);
      await this.http.permit(context, deadline);
      await assertActive();
      await beforeDispatch();
      response = await send(replacement);
    }
    const bytes = await boundedBytes(response, bridgeLimits.responseBytes);
    const output = new Headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    if (!response.ok) output.set("x-fortnox-mcp-error-source", "provider");
    for (const key of ["content-type", "content-disposition", "retry-after"])
      if (response.headers.has(key))
        output.set(key, response.headers.get(key) ?? "");
    const type = response.headers.get("content-type") ?? "";
    if (bytes.length && (type.includes("json") || type === ""))
      parseBridgeJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    await assertActive();
    if (call.operation.effect === "read")
      output.set("etag", `"${await accountingHash([...bytes])}"`);
    const state =
      response.ok && response.status !== 202 ? "succeeded" : "outcome_unknown";
    return {
      status: response.status,
      headers: output,
      bytes,
      ...(call.operation.effect === "write" ? { state } : {}),
    };
  }
}
