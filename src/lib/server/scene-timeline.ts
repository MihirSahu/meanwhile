import type { HistoricalRange } from "../historical-time";
import { inferHistoricalRange, rangesOverlap } from "../historical-time";
import type { EvidenceClaim } from "../evidence-schema";
import type { SceneAction } from "../scene-schema";
export type DateWindow = { start: number; end: number };
const names =
  "January February March April May June July August September October November December".split(
    " ",
  );
const monthPattern =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const yearPattern = "(?:\\d{1,5}(?=\\s*(?:BCE|BC|CE|AD)\\b)|\\d{3,4})(?!\\d)";
const sharedYearPattern = `(?:,?\\s+(${yearPattern})(\\s*(?:BCE|BC|CE|AD)\\b)?)?`;
const rangeSeparator = "(?:-|to|through|until)";
const quantityUnitPattern =
  "(?:(?:people|men|troops|soldiers|casualties|prisoners|miles|kilomet(?:er|re)s?|km|feet|meters|metres|tons|years|hours|minutes|million|percent|ships)\\b|%)";
const quantityAfter = new RegExp(`^\\s*${quantityUnitPattern}`, "i");
const month = (text: string) =>
  names.findIndex((name) =>
    name
      .toLowerCase()
      .startsWith(text.replace(/\./g, "").slice(0, 3).toLowerCase()),
  ) + 1;
const stamp = (year: number, month: number, day: number) =>
  year * 372 + (month - 1) * 31 + day;
const yearWindow = (start: number, end = start): DateWindow => ({
  start: stamp(start, 1, 1),
  end: stamp(end, 12, 31),
});
const contains = (outer: DateWindow, inner: DateWindow) =>
  outer.start <= inner.start && outer.end >= inner.end;
// A coarse mention such as "in 1300" is compatible with a specific day in
// that year. Explicit range endpoints are checked separately by the parser.
const compatible = (a: DateWindow, b: DateWindow) =>
  a.start <= b.end && b.start <= a.end;
function dated(
  year: number,
  month: number,
  day: number | null,
): DateWindow | null {
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !year ||
    year > 2100 ||
    year < -10000 ||
    month < 1 ||
    month > 12 ||
    (day !== null && (day < 1 || day > days[month - 1]))
  )
    return null;
  return {
    start: stamp(year, month, day ?? 1),
    end: stamp(year, month, day ?? days[month - 1]),
  };
}
function calendarMentions(
  text: string,
  fallback: HistoricalRange | undefined,
  label: boolean,
  options: { allowOfYear?: boolean } = {},
) {
  let normalized = text
    .replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1")
    .replace(/[–—]/g, "-");
  // Expand compact ranges to complete dates before extracting their endpoints.
  normalized = normalized.replace(
    new RegExp(
      `\\b(\\d{1,2})\\s*${rangeSeparator}\\s*(\\d{1,2})\\s+(${monthPattern})${sharedYearPattern}`,
      "gi",
    ),
    (
      _match,
      first: string,
      last: string,
      month: string,
      year?: string,
      era?: string,
    ) => {
      const suffix = year ? ` ${year}${era ?? ""}` : "";
      return `${first} ${month}${suffix} - ${last} ${month}${suffix}`;
    },
  );
  normalized = normalized.replace(
    new RegExp(
      `(${monthPattern})\\s+(\\d{1,2})\\s*${rangeSeparator}\\s*(\\d{1,2})(?!\\d)${sharedYearPattern}`,
      "gi",
    ),
    (
      _match,
      month: string,
      first: string,
      last: string,
      year?: string,
      era?: string,
    ) => {
      const suffix = year ? ` ${year}${era ?? ""}` : "";
      return `${month} ${first}${suffix} - ${month} ${last}${suffix}`;
    },
  );
  const years = [...normalized.matchAll(/\b\d{3,4}\b/g)].map((m) =>
    Number(m[0]),
  );
  const negativeEra = /\b(?:BCE|BC)\b/i.test(normalized);
  const positiveEra = /\b(?:CE|AD)\b/i.test(normalized);
  const sign = negativeEra && !positiveEra ? -1 : 1;
  const signedYear = (year: number, start: number, end: number) => {
    const suffix = normalized.slice(end).match(/^\s*(BCE|BC|CE|AD)\b/i)?.[1];
    const prefix = normalized
      .slice(0, start)
      .match(/\b(BCE|BC|CE|AD)\s*$/i)?.[1];
    const era = suffix ?? prefix;
    return year * (era ? (/^(BCE|BC)$/i.test(era) ? -1 : 1) : sign);
  };
  const unique = [...new Set(years)];
  const defaultYear =
    !label && fallback && fallback.startYear === fallback.endYear
      ? fallback.startYear
      : unique.length === 1 && !(negativeEra && positiveEra)
        ? unique[0] * sign
        : fallback && fallback.startYear === fallback.endYear
          ? fallback.startYear
          : null;
  const windows: { window: DateWindow; start: number; end: number }[] = [];
  for (const match of normalized.matchAll(/\b(\d{3,4})-(\d{2})-(\d{2})\b/g)) {
    const window = dated(
      signedYear(
        Number(match[1]),
        match.index!,
        match.index! + match[0].length,
      ),
      Number(match[2]),
      Number(match[3]),
    );
    if (!window) throw new Error(`Invalid calendar date: ${match[0]}.`);
    windows.push({
      window,
      start: match.index!,
      end: match.index! + match[0].length,
    });
  }
  // An era makes a short year unambiguous ("July 50 BCE"). Try month/year
  // before month/day so that these labels retain their typed precision.
  const pattern = new RegExp(
    `(?:(\\d{1,2})\\s+(${monthPattern})(?:,?\\s+(${yearPattern}))?|(${monthPattern})\\s+(?:(${yearPattern})|(\\d{1,2})(?!\\d)(?:,?\\s+(${yearPattern}))?))`,
    "gi",
  );
  for (const match of normalized.matchAll(pattern)) {
    const y = match[3] ?? match[5] ?? match[7],
      day = match[1] ?? match[6];
    const year = y
      ? signedYear(Number(y), match.index!, match.index! + match[0].length)
      : defaultYear;
    if (year === null) continue;
    const window = dated(
      year,
      month(match[2] ?? match[4]),
      day ? Number(day) : null,
    );
    if (!window) throw new Error(`Invalid calendar date: ${match[0]}.`);
    windows.push({
      window,
      start: match.index!,
      end: match.index! + match[0].length,
    });
  }
  // A month range can share the other endpoint's year, or the active year
  // when both omit it. Standalone month words in prose remain ambiguous.
  const monthRange = new RegExp(
    `(${monthPattern})${sharedYearPattern}\\s*${rangeSeparator}\\s*(${monthPattern})${sharedYearPattern}`,
    "gi",
  );
  for (const match of normalized.matchAll(monthRange)) {
    const start = match.index!,
      end = start + match[0].length;
    const firstStart = match[2] ? start + match[0].indexOf(match[2]) : start;
    const lastStart = match[5] ? start + match[0].lastIndexOf(match[5]) : start;
    const firstYear = match[2]
      ? signedYear(Number(match[2]), firstStart, firstStart + match[2].length)
      : null;
    const lastYear = match[5]
      ? signedYear(Number(match[5]), lastStart, lastStart + match[5].length)
      : null;
    for (const [name, year] of [
      [match[1], firstYear ?? lastYear ?? defaultYear],
      [match[4], lastYear ?? firstYear ?? defaultYear],
    ] as const) {
      if (year === null) continue;
      const window = dated(year, month(name), null);
      if (!window) throw new Error(`Invalid calendar date: ${match[0]}.`);
      windows.push({ window, start, end });
    }
  }
  if (label && defaultYear !== null)
    for (const match of normalized.matchAll(
      new RegExp(`\\b${monthPattern}`, "gi"),
    )) {
      if (windows.some((w) => match.index! >= w.start && match.index! < w.end))
        continue;
      const window = dated(defaultYear, month(match[0]), null);
      if (window)
        windows.push({
          window,
          start: match.index!,
          end: match.index! + match[0].length,
        });
    }
  // Bare year ranges are date expressions even without "in" or "from".
  // Keep calendar-date spans and explicit quantity ranges out of this pass.
  const ignoredRanges: { start: number; end: number }[] = [];
  const rangePattern =
    /(?:\b(BCE|BC|CE|AD)\s+)?\b(\d{1,5})(?:\s*(BCE|BC|CE|AD)\b)?\s*(?:-|to|through|until)\s*(?:(BCE|BC|CE|AD)\s+)?(\d{1,5})(?:\s*(BCE|BC|CE|AD)\b)?\b/gi;
  for (const match of normalized.matchAll(rangePattern)) {
    const start = match.index!,
      end = start + match[0].length;
    if (windows.some((w) => start < w.end && w.start < end)) continue;
    const explicitEra = Boolean(match[1] || match[3] || match[4] || match[6]);
    if (!explicitEra && quantityAfter.test(normalized.slice(end))) {
      ignoredRanges.push({ start, end });
      continue;
    }
    if (
      !explicitEra &&
      (match[2].length < 3 ||
        match[2].length > 4 ||
        match[5].length < 3 ||
        match[5].length > 4)
    )
      continue;
    const firstStart = start + match[0].search(/\d/);
    const firstEnd = firstStart + match[2].length;
    // The separator cannot contain digits, so the next digit run after the
    // first endpoint/era identifies the second endpoint without value matching.
    const tail = normalized.slice(firstEnd, end);
    const secondStart = firstEnd + tail.search(/\d/);
    const secondEnd = secondStart + match[5].length;
    const a = signedYear(Number(match[2]), firstStart, firstEnd),
      b = signedYear(Number(match[5]), secondStart, secondEnd);
    if (!a || !b) throw new Error("Historical dates do not use year zero.");
    windows.push(
      { window: yearWindow(a), start, end: firstEnd },
      { window: yearWindow(b), start: secondStart, end: secondEnd },
    );
  }
  for (const match of normalized.matchAll(/\b(\d{1,5})\b/g)) {
    const start = match.index!,
      end = start + match[0].length;
    if (
      windows.some((w) => start >= w.start && end <= w.end) ||
      ignoredRanges.some((r) => start >= r.start && end <= r.end)
    )
      continue;
    const before = normalized.slice(Math.max(0, start - 22), start),
      after = normalized.slice(end);
    const explicitEra =
      /\b(?:BCE|BC|CE|AD)\s*$/i.test(before) ||
      /^\s*(?:BCE|BC|CE|AD)\b/i.test(after);
    if (!explicitEra && (match[1].length < 3 || match[1].length > 4)) continue;
    const followsDatedRange = windows.some(
      (w) =>
        w.end <= start &&
        /^\s*(?:(?:BCE|BC|CE|AD)\s*)?(?:-|to|through|until|and)\s*$/i.test(
          normalized.slice(w.end, start),
        ),
    );
    if (
      !label &&
      !followsDatedRange &&
      !explicitEra &&
      !(options.allowOfYear === false
        ? /(?:\b(?:in|during|by|since|from|until|around|circa|year)|c\.)\s*$/i
        : /(?:\b(?:in|during|by|since|from|until|around|circa|year|of)|c\.)\s*$/i
      ).test(before)
    )
      continue;
    if (
      !explicitEra &&
      (quantityAfter.test(after) ||
        new RegExp(
          `^\\s*(?:-|to|through)\\s*\\d{3,4}\\s*${quantityUnitPattern}`,
          "i",
        ).test(after))
    )
      continue;
    const value = signedYear(Number(match[1]), start, end);
    if (!value) throw new Error("Historical dates do not use year zero.");
    const approximate = /(?:around|circa|c\.)\s*$/i.test(before);
    windows.push({
      window: yearWindow(
        value - (approximate ? 25 : 0),
        value + (approximate ? 25 : 0),
      ),
      start,
      end,
    });
  }
  return windows.map((w) => w.window);
}
/** Conservative English display-date parsing; ambiguous labels fall back to typed years. */
/** Bare "of 1848" can be a quantity; only unambiguous date cues block freezing. */
export function hasExplicitHistoricalDate(text: string) {
  return calendarMentions(text, undefined, false, { allowOfYear: false }).length > 0;
}

export function chapterDateWindow(
  label: string,
  fallback?: HistoricalRange,
): DateWindow | null {
  if (/\b(?:early|late|mid|centur|millenni)/i.test(label))
    return fallback ? yearWindow(fallback.startYear, fallback.endYear) : null;
  if (/\bc\.|circa|around|about/i.test(label)) {
    const range = inferHistoricalRange(label) ?? fallback;
    return range ? yearWindow(range.startYear, range.endYear) : null;
  }
  const windows = calendarMentions(label, fallback, true);
  if (windows.length)
    return {
      start: Math.min(...windows.map((w) => w.start)),
      end: Math.max(...windows.map((w) => w.end)),
    };
  return fallback ? yearWindow(fallback.startYear, fallback.endYear) : null;
}
export function checkSceneTimeline(
  actions: SceneAction[],
  committed: SceneAction[],
  claims: EvidenceClaim[],
  plan: { date: string; yearRange: HistoricalRange },
  options: {
    claimRangesChecked?: boolean;
    // Server-generated relation notes may name a previously validated heading.
    referenceWindows?: ReadonlyMap<string, DateWindow>;
  } = {},
) {
  const planned = chapterDateWindow(plan.date, plan.yearRange);
  const ordered = [...committed, ...actions].sort((a, b) => a.at - b.at);
  const chapterTimes = actions
    .filter((a) => a.type === "chapter")
    .map((a) => a.at);
  if (new Set(chapterTimes).size !== chapterTimes.length)
    throw new Error("Two chapter headings cannot share a playback timestamp.");
  for (const action of actions) {
    const chapter = ordered
      .filter((a) => a.type === "chapter" && a.at <= action.at)
      .at(-1);
    if (chapter?.type !== "chapter") continue;
    const active = chapterDateWindow(
      chapter.date,
      chapter.yearRange ?? plan.yearRange,
    );
    if (
      action.type === "chapter" &&
      active &&
      planned &&
      !contains(planned, active)
    )
      throw new Error(
        `Chapter ${action.id} changes its approved historical window. Keep future events in their planned chapter.`,
      );
    if (action.type === "despawn") continue;
    for (const claim of (options.claimRangesChecked ? [] : claims).filter((c) =>
      action.claimIds?.includes(c.id),
    ))
      if (
        claim.yearRange &&
        chapter.yearRange &&
        !rangesOverlap(claim.yearRange, chapter.yearRange)
      )
        throw new Error(
          `Action ${action.id} cites a ${claim.yearRange.startYear}–${claim.yearRange.endYear} claim under ${chapter.date}. Move it to the matching chapter.`,
        );
    const text =
      action.type === "chapter"
        ? `${action.title}. ${action.caption}`
        : action.type === "speech"
          ? action.text
          : action.type === "spawn"
            ? action.label
            : "";
    if (active)
      for (const mention of calendarMentions(
        text,
        chapter.yearRange ?? plan.yearRange,
        false,
      ))
        if (
          !compatible(active, mention) &&
          !(
            options.referenceWindows?.get(action.id) &&
            compatible(options.referenceWindows.get(action.id)!, mention)
          )
        )
          throw new Error(
            `Action ${action.id} mentions a date outside the visible heading "${chapter.date}". Update the heading within the approved window or defer the action to its planned chapter.`,
          );
  }
}
