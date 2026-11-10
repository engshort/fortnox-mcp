import { accountingDate } from "./accounting.js";
import { DomainError } from "./errors.js";
import { parseAmount, sumAmounts } from "./money.js";

// Independently implemented from SIE 4B (2008-09-30), sections 5, #RAR,
// #IB/#UB/#RES and #TRANS/#RTRANS/#BTRANS. Not a general SIE importer.
const cp437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
function invalid(): never {
  throw new DomainError("VALIDATION_FAILED");
}
function date(value: string | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return invalid();
  const formatted = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (!accountingDate.safeParse(formatted).success) return invalid();
  return formatted;
}
function account(value: string | undefined) {
  if (!value || !/^[1-9]\d{0,7}$/.test(value)) return invalid();
  return Number(value);
}
function money(value: string | undefined) {
  if (value === undefined) return invalid();
  return parseAmount(value, 2);
}
function tokens(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c && /[ \t]/.test(c)) {
      i++;
      continue;
    }
    if (c === "{" || c === "}") {
      out.push(c);
      i++;
      continue;
    }
    if (c === '"') {
      i++;
      let text = "",
        closed = false;
      while (i < line.length) {
        const v = line[i++];
        if (v === '"') {
          closed = true;
          break;
        }
        if (v === "\\") {
          const escaped = line[i++];
          if (escaped !== '"' && escaped !== "\\") return invalid();
          text += escaped;
        } else text += v;
      }
      if (!closed || (line[i] && !/[ \t{}]/.test(line[i] as string)))
        return invalid();
      out.push(text);
    } else {
      const start = i;
      while (i < line.length && !/[ \t{}"]/.test(line[i] as string)) i++;
      if (i === start) return invalid();
      out.push(line.slice(start, i));
    }
  }
  return out;
}
export interface SieYear {
  index: number;
  from: string;
  to: string;
}
export interface SieAccount {
  number: number;
  name: string;
  balances: Array<{
    year: number;
    opening: string | null;
    closing: string | null;
  }>;
}
export interface SieMovement {
  id: string;
  voucher: { series: string; number: string; date: string };
  account: number;
  date: string;
  amount: string;
  dimensions: Record<string, string>;
  source_line: number;
}
export interface SieExport {
  sha256: string;
  type: 4;
  encoding: "cp437" | "utf8";
  currency: string | null;
  years: SieYear[];
  accounts: SieAccount[];
  movements: SieMovement[];
  limitations: string[];
  complete: false;
}
// Parsing never asserts export coverage, missing-zero semantics, provider
// authorization, checksum validity or an atomic snapshot. Those require evidence
// at the authenticated adapter boundary and independent chart reconciliation.
export async function parseSie4(
  bytes: Uint8Array,
  encoding: "cp437" | "utf8",
): Promise<SieExport> {
  if (
    bytes.length === 0 ||
    bytes.length > 2 * 1024 * 1024 ||
    !["cp437", "utf8"].includes(encoding)
  )
    return invalid();
  let text: string;
  if (encoding === "cp437")
    text = Array.from(bytes, (b) =>
      b < 128 ? String.fromCharCode(b) : cp437[b - 128],
    ).join("");
  else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127)
      return invalid();
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 25000) return invalid();
  const years = new Map<number, SieYear>();
  const names = new Map<number, string>();
  const balances = new Map<
    string,
    {
      year: number;
      number: number;
      opening: string | null;
      closing: string | null;
    }
  >();
  const movements: SieMovement[] = [];
  const limitations = new Set<string>([
    "export_coverage_unverified",
    "missing_zero_balances_unverified",
  ]);
  const vouchers = new Set<string>();
  let type = false,
    format = false,
    flag = false,
    currency: string | null = null;
  let voucher: SieMovement["voucher"] | null = null,
    inVoucher = false;
  let voucherAmounts: string[] = [];
  let pendingAdded: string[] | null = null;
  const metadata = new Set([
    "#PROGRAM",
    "#GEN",
    "#FNAMN",
    "#ORGNR",
    "#FNR",
    "#ADRESS",
    "#FTYP",
    "#OMFATTN",
    "#KPTYP",
    "#KTYP",
    "#SRU",
    "#ENHET",
    "#DIM",
    "#UNDERDIM",
    "#OBJEKT",
    "#BKOD",
    "#TAXAR",
    "#PROSA",
  ]);
  for (const [lineIndex, line] of lines.entries()) {
    if (line.length > 8192) return invalid();
    const parts = tokens(line.trim());
    if (!parts.length) continue;
    const tag = parts[0];
    if (
      pendingAdded &&
      (tag !== "#TRANS" ||
        JSON.stringify(parts.slice(1)) !== JSON.stringify(pendingAdded))
    )
      return invalid();
    if (tag === "{") {
      if (!voucher || inVoucher || parts.length !== 1) return invalid();
      inVoucher = true;
      continue;
    }
    if (tag === "}") {
      if (!voucher || !inVoucher || parts.length !== 1 || pendingAdded)
        return invalid();
      if (sumAmounts(voucherAmounts, 2) !== "0.00")
        limitations.add("unbalanced_voucher");
      voucher = null;
      inVoucher = false;
      continue;
    }
    if (!tag?.startsWith("#")) return invalid();
    if (tag === "#VER") {
      if (voucher || parts.length < 4 || parts.length > 8) return invalid();
      const series = parts[1] as string,
        number = parts[2] as string;
      if (series.length > 32 || number.length > 32) return invalid();
      const key = JSON.stringify([series, number]);
      if (vouchers.has(key)) return invalid();
      vouchers.add(key);
      voucher = { series, number, date: date(parts[3]) };
      voucherAmounts = [];
      continue;
    }
    if (["#TRANS", "#RTRANS", "#BTRANS"].includes(tag)) {
      if (!voucher || !inVoucher || parts[2] !== "{") return invalid();
      const end = parts.indexOf("}", 3);
      if (
        end < 3 ||
        (end - 3) % 2 ||
        parts.length < end + 2 ||
        parts.length > end + 6
      )
        return invalid();
      const dimensions: Record<string, string> = {};
      for (let i = 3; i < end; i += 2) {
        const dimension = parts[i] as string,
          object = parts[i + 1] as string;
        if (
          !/^\d{1,6}$/.test(dimension) ||
          !object ||
          object.length > 128 ||
          Object.hasOwn(dimensions, dimension)
        )
          return invalid();
        dimensions[dimension] = object;
      }
      const number = account(parts[1]),
        amount = money(parts[end + 1]);
      const effectiveDate = parts[end + 2]
        ? date(parts[end + 2])
        : voucher.date;
      if (tag === "#RTRANS") {
        pendingAdded = parts.slice(1);
        continue;
      }
      if (tag === "#BTRANS") continue;
      pendingAdded = null;
      if (movements.length >= 10000) return invalid();
      movements.push({
        id: `sie:${lineIndex + 1}`,
        voucher: { ...voucher },
        account: number,
        amount,
        date: effectiveDate,
        dimensions,
        source_line: lineIndex + 1,
      });
      voucherAmounts.push(amount);
      continue;
    }
    if (voucher || inVoucher) return invalid();
    if (tag === "#SIETYP") {
      if (type || parts.length !== 2 || parts[1] !== "4") return invalid();
      type = true;
    } else if (tag === "#FLAGGA") {
      if (flag || parts.length !== 2 || parts[1] !== "0") return invalid();
      flag = true;
    } else if (tag === "#FORMAT") {
      if (format || parts.length !== 2 || parts[1] !== "PC8") return invalid();
      format = true;
      if (encoding !== "cp437") limitations.add("nonstandard_utf8_transport");
    } else if (tag === "#VALUTA") {
      if (
        currency !== null ||
        parts.length !== 2 ||
        !/^[A-Z]{3}$/.test(parts[1] ?? "")
      )
        return invalid();
      currency = parts[1] as string;
    } else if (tag === "#RAR") {
      if (!/^(?:0|-[1-9]\d?)$/.test(parts[1] ?? "") || parts.length !== 4)
        return invalid();
      const index = Number(parts[1]),
        from = date(parts[2]),
        to = date(parts[3]);
      if (years.has(index) || from > to) return invalid();
      years.set(index, { index, from, to });
    } else if (tag === "#KONTO") {
      const number = account(parts[1]),
        name = parts[2];
      if (
        parts.length !== 3 ||
        name === undefined ||
        name.length > 200 ||
        names.has(number) ||
        names.size >= 10000
      )
        return invalid();
      names.set(number, name);
    } else if (["#IB", "#UB", "#RES"].includes(tag)) {
      if (
        parts.length < 4 ||
        parts.length > 5 ||
        !/^(?:0|-[1-9]\d?)$/.test(parts[1] ?? "")
      )
        return invalid();
      const year = Number(parts[1]),
        number = account(parts[2]),
        amount = money(parts[3]);
      const key = `${year}:${number}`;
      const balance = balances.get(key) ?? {
        year,
        number,
        opening: null,
        closing: null,
      };
      const field = tag === "#IB" ? "opening" : "closing";
      if (balance[field] !== null) return invalid();
      balance[field] = amount;
      balances.set(key, balance);
    } else if (tag === "#KSUMMA") limitations.add("checksum_not_verified");
    else if (!metadata.has(tag))
      limitations.add(`unsupported_record:${tag.slice(0, 64)}`);
  }
  if (
    !type ||
    !flag ||
    !format ||
    !years.has(0) ||
    voucher ||
    inVoucher ||
    pendingAdded
  )
    return invalid();
  const current = years.get(0) as SieYear;
  for (const m of movements)
    if (
      !names.has(m.account) ||
      m.date < current.from ||
      m.date > current.to ||
      m.voucher.date < current.from ||
      m.voucher.date > current.to
    )
      return invalid();
  for (const b of balances.values())
    if (!names.has(b.number) || !years.has(b.year)) return invalid();
  if (!currency) limitations.add("currency_missing");
  const byAccount = new Map<number, SieAccount["balances"]>();
  for (const balance of balances.values()) {
    const list = byAccount.get(balance.number) ?? [];
    list.push({
      year: balance.year,
      opening: balance.opening,
      closing: balance.closing,
    });
    byAccount.set(balance.number, list);
  }
  const accounts = [...names]
    .sort(([a], [b]) => a - b)
    .map(([number, name]) => ({
      number,
      name,
      balances: byAccount.get(number) ?? [],
    }));
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const sha256 = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return {
    sha256,
    type: 4,
    encoding,
    currency,
    years: [...years.values()].sort((a, b) => b.index - a.index),
    accounts,
    movements,
    limitations: [...limitations].sort(),
    complete: false,
  };
}
