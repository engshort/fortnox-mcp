import { Decimal } from "decimal.js";
import { DomainError } from "./errors.js";

const Exact = Decimal.clone({ precision: 128 });
export class BridgeNumber {
  constructor(readonly text: string) {}
}
export function parseBridgeJson(raw: string): unknown {
  // A fresh marker distinguishes JSON numbers from caller-supplied strings or
  // objects. Never serialize the validation tree back into the provider body.
  const marker = crypto.randomUUID();
  try {
    const objects: Set<string>[] = [];
    let tokens = 0;
    for (const match of raw.matchAll(/"(?:\\.|[^"\\])*"|[{}]/g)) {
      if (++tokens > 50000) throw new Error();
      if (match[0] === "{") objects.push(new Set());
      else if (match[0] === "}") objects.pop();
      else if (/^\s*:/.test(raw.slice((match.index ?? 0) + match[0].length))) {
        const key = JSON.parse(match[0]) as string;
        const keys = objects.at(-1);
        if (keys?.has(key)) throw new Error();
        keys?.add(key);
      }
    }
    return JSON.parse(
      raw.replace(
        /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
        (token) => {
          if (
            ++tokens > 100000 ||
            (!token.startsWith('"') && token.length > 128)
          )
            throw new Error();
          return token.startsWith('"')
            ? token
            : `{"${marker}":${JSON.stringify(token)}}`;
        },
      ),
      (_key, value: unknown) => {
        if (
          value &&
          typeof value === "object" &&
          Object.hasOwn(value, marker)
        ) {
          const number = new Exact(
            (value as Record<string, string>)[marker] ?? "",
          );
          if (
            !number.isFinite() ||
            number.abs().gte("1e48") ||
            number.decimalPlaces() > 18
          )
            throw new Error();
          return new BridgeNumber(number.toFixed());
        }
        return value;
      },
    );
  } catch {
    throw new DomainError("VALIDATION_FAILED");
  }
}
export type BridgeSchema = Record<string, unknown> | boolean;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError("VALIDATION_FAILED");
  return value as Record<string, unknown>;
}
export const bridgeObject = record;
export function bridgePlain(value: unknown): unknown {
  if (value instanceof BridgeNumber) return value.text;
  if (Array.isArray(value)) return value.map(bridgePlain);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, bridgePlain(v)]),
    );
  return value;
}
const annotations = new Set([
  "description",
  "title",
  "example",
  "examples",
  "default",
  "deprecated",
  "xml",
  "externalDocs",
  "discriminator",
  "writeOnly",
  "$schema",
  "$id",
]);
const supported = new Set([
  "$ref",
  "type",
  "format",
  "nullable",
  "properties",
  "required",
  "items",
  "additionalProperties",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "readOnly",
]);
export function bridgeSchemaCheck(
  root: Record<string, unknown>,
  schema: unknown,
  input: unknown,
): void {
  let remaining = 100_000;
  const resolve = (ref: string) => {
    if (!ref.startsWith("#/")) throw new DomainError("CAPABILITY_UNAVAILABLE");
    let result: unknown = root;
    for (const key of ref
      .slice(2)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      const obj = record(result);
      if (!Object.hasOwn(obj, key))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
      result = obj[key];
    }
    return result;
  };
  const propertyNames = (raw: unknown, depth = 0): Set<string> => {
    if (depth > 32) throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (typeof raw === "boolean") return new Set();
    const s = record(raw);
    if (typeof s.$ref === "string")
      return propertyNames(resolve(s.$ref), depth + 1);
    const names = new Set(
      Object.keys(s.properties ? record(s.properties) : {}),
    );
    for (const key of ["allOf", "oneOf", "anyOf"])
      if (Array.isArray(s[key]))
        for (const part of s[key])
          for (const name of propertyNames(part, depth + 1)) names.add(name);
    return names;
  };
  const check = (
    raw: unknown,
    value: unknown,
    depth: number,
    composed = false,
  ): void => {
    if (--remaining < 0 || depth > 64)
      throw new DomainError("VALIDATION_FAILED");
    if (raw === true) return;
    if (raw === false) throw new DomainError("VALIDATION_FAILED");
    const s = record(raw);
    for (const key of Object.keys(s))
      if (!supported.has(key) && !annotations.has(key) && !key.startsWith("x-"))
        throw new DomainError("CAPABILITY_UNAVAILABLE");
    if (typeof s.$ref === "string") {
      check(resolve(s.$ref), value, depth + 1);
      return;
    }
    if (value === null && (s.nullable === true || s.type === "null")) return;
    if (s.readOnly === true) throw new DomainError("VALIDATION_FAILED");
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      if (!Array.isArray(s[key])) continue;
      let matches = 0;
      for (const sub of s[key]) {
        try {
          check(sub, value, depth + 1, true);
          matches++;
        } catch (error) {
          if (
            !(error instanceof DomainError) ||
            error.code !== "VALIDATION_FAILED"
          )
            throw error;
        }
      }
      if (
        (key === "allOf" && matches !== s[key].length) ||
        (key === "anyOf" && !matches) ||
        (key === "oneOf" && matches !== 1)
      )
        throw new DomainError("VALIDATION_FAILED");
    }
    if (s.not !== undefined) {
      let matches = true;
      try {
        check(s.not, value, depth + 1);
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          error.code !== "VALIDATION_FAILED"
        )
          throw error;
        matches = false;
      }
      if (matches) throw new DomainError("VALIDATION_FAILED");
    }
    const numeric = value instanceof BridgeNumber;
    const actual =
      value === null
        ? "null"
        : numeric
          ? "number"
          : Array.isArray(value)
            ? "array"
            : typeof value;
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (
        !types.includes(actual) &&
        !(
          numeric &&
          types.includes("integer") &&
          new Exact(value.text).isInteger()
        )
      )
        throw new DomainError("VALIDATION_FAILED");
    }
    const equal = (candidate: unknown) =>
      numeric && typeof candidate === "number"
        ? new Exact(value.text).eq(String(candidate))
        : JSON.stringify(bridgePlain(value)) === JSON.stringify(candidate);
    if (
      (Array.isArray(s.enum) && !s.enum.some(equal)) ||
      (s.const !== undefined && !equal(s.const))
    )
      throw new DomainError("VALIDATION_FAILED");
    if (numeric) {
      const n = new Exact(value.text);
      if (!n.isFinite() || n.abs().gte("1e48") || n.decimalPlaces() > 18)
        throw new DomainError("VALIDATION_FAILED");
      if (
        (typeof s.minimum === "number" &&
          (s.exclusiveMinimum === true ? n.lte(s.minimum) : n.lt(s.minimum))) ||
        (typeof s.maximum === "number" &&
          (s.exclusiveMaximum === true ? n.gte(s.maximum) : n.gt(s.maximum))) ||
        (typeof s.exclusiveMinimum === "number" && n.lte(s.exclusiveMinimum)) ||
        (typeof s.exclusiveMaximum === "number" && n.gte(s.exclusiveMaximum)) ||
        (typeof s.multipleOf === "number" &&
          (s.multipleOf <= 0 || !n.mod(String(s.multipleOf)).isZero()))
      )
        throw new DomainError("VALIDATION_FAILED");
    }
    if (typeof value === "string") {
      if (
        (typeof s.minLength === "number" && [...value].length < s.minLength) ||
        (typeof s.maxLength === "number" && [...value].length > s.maxLength) ||
        (typeof s.pattern === "string" &&
          !new RegExp(s.pattern, "u").test(value))
      )
        throw new DomainError("VALIDATION_FAILED");
      if (
        s.format === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new DomainError("VALIDATION_FAILED");
      if (
        s.format === "date-time" &&
        (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
          !Number.isFinite(Date.parse(value)))
      )
        throw new DomainError("VALIDATION_FAILED");
    }
    if (Array.isArray(value)) {
      if (
        (typeof s.minItems === "number" && value.length < s.minItems) ||
        (typeof s.maxItems === "number" && value.length > s.maxItems) ||
        (s.uniqueItems === true &&
          new Set(value.map((v) => JSON.stringify(bridgePlain(v)))).size !==
            value.length)
      )
        throw new DomainError("VALIDATION_FAILED");
      for (const item of value) check(s.items ?? true, item, depth + 1);
    } else if (actual === "object") {
      const obj = record(value),
        keys = Object.keys(obj);
      const props = s.properties === undefined ? {} : record(s.properties);
      if (!composed && s.additionalProperties === undefined) {
        const known = propertyNames(s);
        if (keys.some((key) => !known.has(key)))
          throw new DomainError("VALIDATION_FAILED");
      }
      if (
        (typeof s.minProperties === "number" &&
          keys.length < s.minProperties) ||
        (typeof s.maxProperties === "number" &&
          keys.length > s.maxProperties) ||
        (Array.isArray(s.required) &&
          s.required.some(
            (k) => typeof k !== "string" || !Object.hasOwn(obj, k),
          ))
      )
        throw new DomainError("VALIDATION_FAILED");
      for (const key of keys) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw new DomainError("VALIDATION_FAILED");
        check(
          Object.hasOwn(props, key)
            ? props[key]
            : (s.additionalProperties ?? true),
          obj[key],
          depth + 1,
        );
      }
    }
  };
  check(schema, input, 0);
}
