import { z } from "zod";
import {
  historicalRangeSchema,
  inferHistoricalRange,
  formatHistoricalRange,
  rangeContains,
  type HistoricalRange,
} from "./historical-time";
import {
  geoSchema,
  type Geo,
  type SceneAction,
  type SceneFocus,
} from "./scene-schema";
import { chapterAt } from "./playback";

export const discoveryContextSchema = z.object({
  originTitle: z.string().min(1).max(100),
  originCenter: geoSchema,
  periodLabel: z.string().min(1).max(100),
  yearRange: historicalRangeSchema,
  excludedTitles: z.array(z.string().min(1).max(100)).max(8),
});
export type DiscoveryContext = z.infer<typeof discoveryContextSchema>;
export const minimumDiscoveryDistance = 20;
export function angularDistance(a: Geo, b: Geo) {
  const rad = Math.PI / 180;
  return (
    Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          Math.sin(a.lat * rad) * Math.sin(b.lat * rad) +
            Math.cos(a.lat * rad) *
              Math.cos(b.lat * rad) *
              Math.cos((a.lon - b.lon) * rad),
        ),
      ),
    ) / rad
  );
}
export function currentHistoricalContext(
  focus: SceneFocus,
  actions: SceneAction[],
  time: number,
  excludedTitles: string[] = [],
): DiscoveryContext | null {
  const chapter = chapterAt(actions, time);
  const explicit = chapter ? inferHistoricalRange(chapter.date) : null;
  const yearRange =
    chapter?.yearRange ??
    explicit ??
    focus.yearRange ??
    inferHistoricalRange(focus.period);
  if (!yearRange) return null;
  return {
    originTitle: focus.title,
    originCenter: focus.center,
    // Discovery currently enforces years, so never imply month/day precision.
    periodLabel: formatHistoricalRange(yearRange),
    yearRange,
    excludedTitles: [...new Set([...excludedTitles, focus.title])].slice(-8),
  };
}
export function discoveryPrompt(context: DiscoveryContext) {
  return `Find one sourced historical event elsewhere in the world during ${context.periodLabel}, strictly within years ${context.yearRange.startYear} to ${context.yearRange.endYear} (negative years mean BCE). The current story is ${context.originTitle} near latitude ${context.originCenter.lat}, longitude ${context.originCenter.lon}. Choose an event at least ${minimumDiscoveryDistance} angular degrees away. This is an application selection rule: the server calculates separation from mapped coordinates; do not search for a source proving the angular distance. Find readable evidence for the selected event's date, context, principal actors, outcome and named geographic setting. Prefer a candidate with an explicitly supported city, country or region. If the sources cannot establish its geographic setting, choose another well-sourced event during the same period rather than repeatedly researching an unlocatable candidate. Do not repeat these stories: ${context.excludedTitles.join("; ")}. Show what was happening in that same period; do not change historical dates to make an event fit. If no supported event is found, ask for a broader historical period.`;
}
/** Historical extraction/review must not treat navigation arithmetic as a fact
 * that a historical source needs to establish. Research alone selects elsewhere. */
export function discoveryStoryPrompt(context: DiscoveryContext) {
  return `Prepare a concise sourced account of the one historical event selected by the research during ${context.periodLabel}, strictly within years ${context.yearRange.startYear} to ${context.yearRange.endYear} (negative years mean BCE). Explain its context, principal actors, main developments and concrete outcome. Include a supported geographic setting: a city, country or region is sufficient for an honest regional context anchor; do not invent a precise venue or imply the event occurred at that anchor. Do not repeat these stories: ${context.excludedTitles.join("; ")}. Do not change historical dates to fit the period.`;
}
export function validateDiscovery(
  context: DiscoveryContext,
  focus: { title: string; center: Geo; yearRange: HistoricalRange },
) {
  if (!rangeContains(context.yearRange, focus.yearRange))
    throw new Error(
      "The discovered event must stay within the requested historical period; never change historical dates to fit.",
    );
  const separation = angularDistance(context.originCenter, focus.center);
  if (separation < minimumDiscoveryDistance)
    throw new Error(
      "Choose an event elsewhere, at least 20 angular degrees from the original focus.",
    );
  if (
    context.excludedTitles.some(
      (title) => title.toLowerCase() === focus.title.toLowerCase(),
    )
  )
    throw new Error("Choose a different historical event.");
  return {
    periodCheck: "within_requested_range" as const,
    titleCheck: "not_excluded" as const,
    angularDistanceDegrees: separation,
    minimumAngularDistanceDegrees: minimumDiscoveryDistance,
  };
}
