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
  return `Find one sourced historical event elsewhere in the world during ${context.periodLabel}, strictly within years ${context.yearRange.startYear} to ${context.yearRange.endYear} (negative years mean BCE). The current story is ${context.originTitle} near latitude ${context.originCenter.lat}, longitude ${context.originCenter.lon}. Choose an event at least 20 angular degrees away. Do not repeat these stories: ${context.excludedTitles.join("; ")}. Show what was happening in that same period; do not change historical dates to make an event fit. If no supported event is found, ask for a broader historical period.`;
}
export function validateDiscovery(
  context: DiscoveryContext,
  focus: { title: string; center: Geo; yearRange: HistoricalRange },
) {
  if (!rangeContains(context.yearRange, focus.yearRange))
    throw new Error(
      "The discovered event must stay within the requested historical period; never change historical dates to fit.",
    );
  if (angularDistance(context.originCenter, focus.center) < 20)
    throw new Error(
      "Choose an event elsewhere, at least 20 angular degrees from the original focus.",
    );
  if (
    context.excludedTitles.some(
      (title) => title.toLowerCase() === focus.title.toLowerCase(),
    )
  )
    throw new Error("Choose a different historical event.");
}
