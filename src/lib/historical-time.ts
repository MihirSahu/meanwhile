import { z } from "zod";

const year = z
  .number()
  .int()
  .min(-10000)
  .max(2100)
  .refine((value) => value !== 0, "Historical dates do not use year zero.");
export const historicalRangeSchema = z
  .object({ startYear: year, endYear: year, approximate: z.boolean() })
  .refine(
    (range) => range.startYear <= range.endYear,
    "The historical range must be ordered.",
  );
export type HistoricalRange = z.infer<typeof historicalRangeSchema>;

export function rangesOverlap(a: HistoricalRange, b: HistoricalRange) {
  return a.startYear <= b.endYear && b.startYear <= a.endYear;
}
export function rangeContains(outer: HistoricalRange, inner: HistoricalRange) {
  return outer.startYear <= inner.startYear && outer.endYear >= inner.endYear;
}
export function formatHistoricalRange(range: HistoricalRange) {
  const year = (value: number) =>
    value < 0 ? `${Math.abs(value)} BCE` : String(value);
  return `${range.approximate ? "c. " : ""}${year(range.startYear)}${range.startYear === range.endYear ? "" : `–${year(range.endYear)}${range.startYear < 0 && range.endYear > 0 ? " CE" : ""}`}`;
}

/** A conservative fallback for existing demos/upstream display strings. */
export function inferHistoricalRange(label: string): HistoricalRange | null {
  if (
    /centur|millenni/i.test(label) ||
    /\d{3,4}\s*[–-]\s*\d{1,2}\b/.test(label) ||
    (/\b(?:BCE|BC)\b/i.test(label) && /\b(?:CE|AD)\b/i.test(label))
  )
    return null;
  const years = [...label.matchAll(/\b(\d{3,4})\b/g)].map((match) =>
    Number(match[1]),
  );
  if (!years.length || years.length > 2 || years.some((value) => value > 2100))
    return null;
  const sign = /\b(?:BCE|BC)\b/i.test(label) ? -1 : 1;
  const values = years.map((value) => value * sign);
  const approximate = /\bc\.|circa|around|about|approximately/i.test(label);
  const range = {
    startYear:
      Math.min(...values) - (approximate && values.length === 1 ? 25 : 0),
    endYear:
      Math.max(...values) + (approximate && values.length === 1 ? 25 : 0),
    approximate,
  };
  return historicalRangeSchema.safeParse(range).success ? range : null;
}
