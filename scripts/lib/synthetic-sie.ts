// Independently authored, synthetic-only workloads. No provider data or names.
export function syntheticSieWorkload(
  movements: number,
  textLength = 16,
): Uint8Array {
  if (!Number.isInteger(movements) || movements < 2 || movements % 2)
    throw new Error("Use an even movement count");
  const lines = [
    "#FLAGGA 0",
    "#SIETYP 4",
    "#FORMAT PC8",
    "#VALUTA SEK",
    "#RAR 0 20250101 20251231",
    '#KONTO 1930 "Synthetic cash"',
    '#KONTO 4000 "Synthetic offset"',
    "#IB 0 1930 0",
    "#IB 0 4000 0",
    `#UB 0 1930 ${(movements / 200).toFixed(2)}`,
    `#UB 0 4000 ${(-movements / 200).toFixed(2)}`,
  ];
  for (let i = 0; i < movements; i += 1000) {
    lines.push(`#VER A ${i / 1000 + 1} 20250615 "Synthetic voucher"`, "{");
    for (let j = i; j < Math.min(movements, i + 1000); j += 2) {
      lines.push(
        `#TRANS 1930 {} 0.01 20250615 "${"x".repeat(textLength)}"`,
        '#TRANS 4000 {} -0.01 20250615 "Synthetic offset"',
      );
    }
    lines.push("}");
  }
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}
