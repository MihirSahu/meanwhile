import { SceneBuffer } from "../playback";
import {
  messageSchema,
  type SceneAction,
  type SceneMessage,
  type SceneFocus,
} from "../scene-schema";
import {
  formatHistoricalRange,
  type HistoricalRange,
} from "../historical-time";
import { validateDiscovery, type DiscoveryContext } from "../discovery";
import { sourcesForClaims } from "./evidence-gate";
import {
  checkSceneTimeline,
  chapterDateWindow,
  type DateWindow,
} from "./scene-timeline";
import type { StoryChecklist } from "./story-checklist";
import type { ResearchBundle } from "./scene-provider";
import type { EventDate, ResolvedEventPlan, StoryEvent } from "./event-plan";

const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const stamp = (p: EventDate["start"], end: boolean) =>
  p.year * 372 +
  ((p.month ?? (end ? 12 : 1)) - 1) * 31 +
  (p.day ??
    (end
      ? p.month
        ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][p.month - 1]
        : 31
      : 1));
export function eventWindow(date: EventDate) {
  for (const p of [date.start, date.end]) {
    const days = p.month
      ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][p.month - 1]
      : 31;
    if (!p.year || (p.day !== null && (p.month === null || p.day > days)))
      throw new Error("Event dates need valid months/days and no year zero.");
  }
  const start = stamp(date.start, false),
    end = stamp(date.end, true);
  if (start > end) throw new Error("Event date intervals must be ordered.");
  return { start, end };
}
function pointLabel(p: EventDate["start"]) {
  return `${p.day === null ? "" : `${p.day} `}${p.month === null ? "" : `${months[p.month - 1]} `}${p.year < 0 ? `${-p.year} BCE` : p.year < 100 ? `${p.year} CE` : p.year}`;
}
export function eventDateLabel(date: EventDate) {
  const start = pointLabel(date.start),
    end = `${pointLabel(date.end)}${date.start.year < 0 && date.end.year >= 100 ? " CE" : ""}`;
  return `${date.approximate ? "c. " : ""}${start}${start === end ? "" : `–${end}`}${date.zone ? ` (${date.zone})` : ""}`;
}
const assets = {
  place: "city",
  people: "officer",
  battle: "infantry",
  railway: "train",
  sailing: "sailship",
  earth_mission: "city",
  narration: "city",
} as const;
export type CompiledEvent = {
  index: number;
  kind: StoryEvent["kind"];
  chapter: number;
  claimIds: string[];
  sourceIds: string[];
  actionIds: string[];
  date: string;
  title: string;
  statement: string;
  location: StoryEvent["location"];
  participantLabels: string[];
  asset: string;
  relationText: string[];
  qualification: string | null;
};
export type CompiledStory = {
  focus: SceneFocus;
  messages: SceneMessage[];
  events: CompiledEvent[];
  structuralValidation: {
    method: "compiler-contract-v1";
    citations: "valid";
    protocol: "valid";
    dates: {
      index: number;
      chapter: number;
      heading: string;
      chapterWindow: { start: number; end: number };
      eventWindow: { start: number; end: number } | null;
      contained: true;
    }[];
  };
  requirements: {
    index: number;
    eventIndices: number[];
    actionIds: string[];
  }[];
};

export function compileEventPlan(
  plan: ResolvedEventPlan,
  checklist: StoryChecklist,
  research: ResearchBundle,
  discovery?: DiscoveryContext,
): CompiledStory {
  if (checklist.result.status !== "ready")
    throw new Error("Approve a sourced checklist before compiling events.");
  if (checklist.result.relations.length)
    throw new Error(
      "The event compiler requires event-level temporal relations.",
    );
  const records = plan.events.map((event, index) => {
    if (
      !event.claimIndices.length ||
      new Set(event.claimIndices).size !== event.claimIndices.length
    )
      throw new Error(
        `Event ${index} needs distinct supporting claim indices.`,
      );
    const claims = event.claimIndices.map((i) => checklist.claims[i]);
    if (claims.some((c) => !c))
      throw new Error(`Event ${index} selects an unknown frozen claim.`);
    if (event.template === "narration") {
      if (event.location.position !== null || event.participants.length)
        throw new Error(
          "Text-only non-Earth events must have no Earth coordinate or participant markers.",
        );
    } else if (!event.location.position)
      throw new Error("Mapped events need an Earth position.");
    if (claims.some((c) => c.certainty === "contested") && !event.qualification)
      throw new Error(
        "A contested claim needs a visible source qualification.",
      );
    if (!event.date && !["context", "caveat"].includes(event.kind))
      throw new Error(`Event ${index} needs a sourced date interval.`);
    const window = event.date ? eventWindow(event.date) : null;
    const ranges = claims
      .flatMap((c) => (c.yearRange ? [c.yearRange] : []))
      .sort((a, b) => a.startYear - b.startYear);
    if (event.date) {
      let coveredThrough =
        event.date.start.year === 1 ? -1 : event.date.start.year - 1;
      for (const range of ranges)
        if (range.startYear <= (coveredThrough === -1 ? 1 : coveredThrough + 1))
          coveredThrough = Math.max(coveredThrough, range.endYear);
      if (coveredThrough < event.date.end.year)
        throw new Error(
          `Event ${index} dates leave its selected claims' ranges or cross an unsupported gap.`,
        );
    }
    if (
      event.template === "railway" &&
      (event.date?.start.year ??
        (ranges.length
          ? Math.min(...ranges.map((r) => r.startYear))
          : -Infinity)) < 1800
    )
      throw new Error(
        "The railway template requires a sourced date from 1800 onward.",
      );
    const sourceIds = sourcesForClaims(
      claims.map((c) => c.id),
      checklist.claims,
      research,
    );
    return { event, index, claims, window, sourceIds };
  });
  const edges = records.map(() => new Set<number>()),
    indegree = records.map(() => 0),
    relationKeys = new Set<string>();
  for (const r of plan.relations) {
    const a = records[r.beforeIndex],
      b = records[r.afterIndex],
      key = `${Math.min(r.beforeIndex, r.afterIndex)}:${Math.max(r.beforeIndex, r.afterIndex)}`;
    if (!a || !b || a === b || relationKeys.has(key))
      throw new Error(
        "Event relations need distinct valid indices with one relation per pair.",
      );
    relationKeys.add(key);
    if (
      new Set(r.passageIds).size !== r.passageIds.length ||
      r.passageIds.some((id) => !research.passages?.some((p) => p.id === id))
    )
      throw new Error("Event relations must cite actual fetched passages.");
    const ownBasis = new Set(
      [...a.claims, ...b.claims].flatMap((c) => c.passageIds),
    );
    if (r.passageIds.some((id) => !ownBasis.has(id)))
      throw new Error(
        "Relation passages must belong to the related events' selected claims.",
      );
    if (r.kind === "before") {
      if (a.event.date && b.event.date) {
        // Month/year precision describes possible endpoint dates, not continuous
        // durations. Require at least one feasible end-before-start ordering.
        const earliestEnd = Math.max(
          stamp(a.event.date.start, false),
          stamp(a.event.date.end, false),
        );
        const latestStart = Math.min(
          stamp(b.event.date.start, true),
          stamp(b.event.date.end, true),
        );
        if (earliestEnd > latestStart)
          throw new Error(
            "A before relation contradicts the events' dates: the earlier event cannot end before the later one starts.",
          );
      }
      edges[a.index].add(b.index);
      indegree[b.index]++;
    }
    if (
      r.kind === "overlaps" &&
      (!a.window ||
        !b.window ||
        a.window.start > b.window.end ||
        b.window.start > a.window.end)
    )
      throw new Error(
        "Overlapping event relations need intersecting dated intervals.",
      );
  }
  // All unambiguous calendar order is server-owned; model relations can resolve coarse-date ties.
  for (const a of records)
    for (const b of records)
      if (
        a.window &&
        b.window &&
        a.window.end < b.window.start &&
        !edges[a.index].has(b.index)
      ) {
        edges[a.index].add(b.index);
        indegree[b.index]++;
      }
  // Bound propagation checks joint feasibility, not just individual pairs.
  // Each node is a possible start/end timestamp. x <= y raises y's lower
  // bound; an upper-bound violation proves that no schedule can satisfy it.
  const timing = records.flatMap(({ event }) =>
    event.date
      ? [
          {
            lower: stamp(event.date.start, false),
            upper: stamp(event.date.start, true),
          },
          {
            lower: stamp(event.date.end, false),
            upper: stamp(event.date.end, true),
          },
        ]
      : [
          { lower: -Infinity, upper: Infinity },
          { lower: -Infinity, upper: Infinity },
        ],
  );
  const timingEdges: [number, number][] = records.map((_, i) => [
    2 * i,
    2 * i + 1,
  ]);
  for (const rel of plan.relations) {
    if (rel.kind === "before")
      timingEdges.push([2 * rel.beforeIndex + 1, 2 * rel.afterIndex]);
    if (rel.kind === "overlaps")
      timingEdges.push(
        [2 * rel.beforeIndex, 2 * rel.afterIndex + 1],
        [2 * rel.afterIndex, 2 * rel.beforeIndex + 1],
      );
  }
  let timingChanged = true;
  while (timingChanged) {
    timingChanged = false;
    for (const [from, to] of timingEdges)
      if (timing[to].lower < timing[from].lower) {
        timing[to].lower = timing[from].lower;
        if (timing[to].lower > timing[to].upper)
          throw new Error(
            "Event relations have no jointly feasible historical timing.",
          );
        timingChanged = true;
      }
  }
  const rank = (r: (typeof records)[number]) =>
    r.window?.start ?? (r.event.kind === "context" ? -Infinity : Infinity);
  const pending = [...records],
    ordered: typeof records = [];
  while (pending.length) {
    const available = pending
      .filter((r) => !indegree[r.index])
      .sort((a, b) => rank(a) - rank(b) || a.index - b.index);
    const next = available[0];
    if (!next)
      throw new Error(
        "Event ordering contains a cycle or contradicts calendar order.",
      );
    pending.splice(pending.indexOf(next), 1);
    ordered.push(next);
    for (const target of edges[next.index]) indegree[target]--;
  }
  const dated = records.filter((r) => r.event.date);
  if (!dated.length)
    throw new Error(
      "A historical story needs at least one sourced dated event.",
    );
  const range: HistoricalRange = {
    startYear: Math.min(...dated.map((r) => r.event.date!.start.year)),
    endYear: Math.max(...dated.map((r) => r.event.date!.end.year)),
    approximate: dated.some((r) => r.event.date!.approximate),
  };
  const focused = records[plan.focusEventIndex];
  if (
    !focused?.event.location.position ||
    focused.event.template === "narration"
  )
    throw new Error(
      "Focus must select an actual Earth-mapped event for the requested main site.",
    );
  const focus: SceneFocus = {
    type: "focus",
    title: plan.title,
    location: focused.event.location.name,
    period: formatHistoricalRange(range),
    yearRange: range,
    center: focused.event.location.position,
    distance: 5.4,
    mode: "live",
    sources: research.sources.filter((s) =>
      research.passages?.some((p) => p.sourceId === s.id),
    ),
    evidence: {
      method: "passage-review-v1",
      passages: research.passages!,
      claims: checklist.claims,
    },
    ...(discovery
      ? {
          discoveryFrom: {
            title: discovery.originTitle,
            period: discovery.periodLabel,
          },
        }
      : {}),
  };
  if (discovery) validateDiscovery(discovery, { ...focus, yearRange: range });
  const overlaps = records.some(
    (a) =>
      a.window &&
      records.some(
        (b) =>
          a.index !== b.index &&
          b.window &&
          a.window!.start <= b.window.end &&
          b.window.start <= a.window!.end,
      ),
  );
  const messages: SceneMessage[] = [focus],
    events: CompiledEvent[] = [];
  const headingWindows = new Map<number, DateWindow>();
  const referenceWindows = new Map<string, DateWindow>();
  let time = 0;
  for (let chapter = 0; chapter < 3; chapter++) {
    const group = ordered.filter(
        (_, i) => Math.floor((i * 3) / ordered.length) === chapter,
      ),
      dates = group.filter((r) => r.event.date);
    const chapterRange: HistoricalRange = dates.length
      ? {
          startYear: Math.min(...dates.map((r) => r.event.date!.start.year)),
          endYear: Math.max(...dates.map((r) => r.event.date!.end.year)),
          approximate: dates.some((r) => r.event.date!.approximate),
        }
      : range;
    for (const record of group) {
      const knownRanges = record.claims.flatMap((c) =>
        c.yearRange ? [c.yearRange] : [],
      );
      if (
        !record.event.date &&
        knownRanges.length &&
        !knownRanges.some(
          (r) =>
            r.startYear <= chapterRange.endYear &&
            r.endYear >= chapterRange.startYear,
        )
      )
        throw new Error(
          "Undated context cites only claims outside the visible chapter period.",
        );
    }
    const date =
      dates.length === 1
        ? eventDateLabel(dates[0].event.date!)
        : formatHistoricalRange(chapterRange);
    const claimIds = [
        ...new Set(group.flatMap((r) => r.claims.map((c) => c.id))),
      ],
      sourceIds = sourcesForClaims(claimIds, checklist.claims, research);
    const caption = [
      "Schematic positions and scale.",
      group.some((r) => r.event.kind === "context")
        ? "Context markers are narrative anchors."
        : "",
      overlaps
        ? "Overlapping date intervals need not be consecutive events."
        : "",
      plan.presentation === "journey"
        ? "Selected stops; no exact course or complete itinerary."
        : "",
      plan.presentation === "comparison"
        ? "Places are compared; order does not imply a journey."
        : "",
      plan.presentation === "earth_mission" ||
      group.some((r) => r.event.template === "earth_mission")
        ? "Earth markers only; no spacecraft or lunar surface."
        : "",
      group.some(
        (r) => r.event.participants.length || r.event.template === "people",
      )
        ? "Uniformed figures are placeholders."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const actions: SceneAction[] = [
      {
        id: `b${chapter}_chapter`,
        type: "chapter",
        at: time,
        date,
        title: group[0].event.title,
        caption,
        sourceIds,
        claimIds,
        yearRange: chapterRange,
      },
    ];
    const start = time;
    for (const r of group) {
      const e = r.event,
        prefix = `b${chapter}_ev_${r.index}`,
        entity = `ev_${r.index}_marker`,
        ids = r.claims.map((c) => c.id);
      headingWindows.set(r.index, chapterDateWindow(date, chapterRange)!);
      const narration = `${e.date ? eventDateLabel(e.date) : "Context"}: ${e.statement}`;
      const participantLabels = e.participants.map(
        (p) => `${p.name}${p.role ? ` — ${p.role}` : ""}`,
      );
      const mainSlot = Math.max(
        4,
        Math.ceil(
          Math.max(
            e.template === "narration"
              ? `${e.location.name}. No Earth marker is shown. ${narration}`
                  .length
              : narration.length,
            ...participantLabels.map((l) => l.length + 20),
          ) / 14,
        ) + 1,
      );
      const relations = plan.relations
        .filter((rel) => {
          const ai = ordered.findIndex((o) => o.index === rel.beforeIndex),
            bi = ordered.findIndex((o) => o.index === rel.afterIndex);
          return ordered[Math.max(ai, bi)].index === r.index;
        })
        .map((rel) => {
          const other =
            records[
              rel.beforeIndex === r.index ? rel.afterIndex : rel.beforeIndex
            ];
          const text =
            rel.kind === "overlaps"
              ? `Concurrent with ${other.event.title}.`
              : rel.kind === "before"
                ? `After ${other.event.title}.`
                : `Presentation order does not assert relative timing with ${other.event.title}.`;
          const claimIds = [
            ...new Set([...r.claims, ...other.claims].map((c) => c.id)),
          ];
          return {
            text,
            referenceWindow: headingWindows.get(other.index)!,
            claimIds,
            sourceIds: sourcesForClaims(claimIds, checklist.claims, research),
          };
        });
      const supplements = [
        ...(e.qualification
          ? [{ text: e.qualification, claimIds: ids, sourceIds: r.sourceIds }]
          : []),
        ...relations,
      ];
      const slot =
        mainSlot +
        supplements.reduce(
          (sum, q) => sum + Math.ceil(q.text.length / 14) + 1,
          0,
        );
      const first = actions.length;
      actions.push({
        id: `${prefix}_heading`,
        type: "chapter",
        at: time + 0.01,
        date,
        title: e.title,
        caption:
          e.template === "narration"
            ? `${e.location.name}. No Earth marker is shown. ${narration}`
            : e.qualification
              ? `${e.qualification} ${caption}`
              : caption,
        sourceIds: r.sourceIds,
        claimIds: ids,
        yearRange: chapterRange,
      });
      if (e.template !== "narration") {
        actions.push({
          id: `${prefix}_marker`,
          type: "spawn",
          at: time + 0.05,
          entityId: entity,
          asset: assets[e.template],
          position: e.location.position!,
          palette: "clay",
          label: e.location.name,
          scale: 1,
          claimIds: ids,
        });
        e.participants.forEach((_, i) =>
          actions.push({
            id: `${prefix}_actor${i}`,
            type: "spawn",
            at: time + 0.05,
            entityId: `ev_${r.index}_actor${i}`,
            asset: "officer",
            position: e.location.position!,
            palette: "indigo",
            label: participantLabels[i],
            scale: 0.8,
            claimIds: ids,
          }),
        );
        actions.push({
          id: `${prefix}_speech`,
          type: "speech",
          at: time + 0.25,
          entityId: entity,
          text: narration,
          kind: "narration",
          duration: mainSlot - 0.75,
          sourceIds: r.sourceIds,
          claimIds: ids,
        });
      }
      let offset = mainSlot;
      supplements.forEach((q, i) => {
        if ("referenceWindow" in q)
          referenceWindows.set(`${prefix}_note${i}`, q.referenceWindow);
        const duration = Math.ceil(q.text.length / 14) + 1;
        if (e.template === "narration")
          actions.push({
            id: `${prefix}_note${i}`,
            type: "chapter",
            at: time + offset,
            date,
            title: e.title,
            caption: q.text,
            claimIds: q.claimIds,
            sourceIds: q.sourceIds,
            yearRange: chapterRange,
          });
        else
          actions.push({
            id: `${prefix}_note${i}`,
            type: "speech",
            at: time + offset,
            entityId: entity,
            text: q.text,
            kind: "narration",
            duration: duration - 0.25,
            claimIds: q.claimIds,
            sourceIds: q.sourceIds,
          });
        offset += duration;
      });
      for (const spawn of actions
        .slice(first)
        .filter((a) => a.type === "spawn"))
        if (spawn.type === "spawn")
          actions.push({
            id: `${spawn.id}_end`,
            type: "despawn",
            at: time + slot - 0.1,
            entityId: spawn.entityId,
            claimIds: ids,
          });
      events.push({
        index: r.index,
        kind: e.kind,
        chapter,
        claimIds: ids,
        sourceIds: r.sourceIds,
        actionIds: actions
          .slice(first)
          .filter((a) => a.type !== "despawn")
          .map((a) => a.id),
        date: e.date ? eventDateLabel(e.date) : "Undated context",
        title: e.location.name,
        statement: narration,
        location: e.location,
        participantLabels,
        asset: e.template === "narration" ? "none" : assets[e.template],
        relationText: relations.map((rel) => rel.text),
        qualification: e.qualification,
      });
      time += slot;
    }
    time = Math.max(time, start + 12);
    checkSceneTimeline(
      actions,
      [],
      checklist.claims,
      {
        date,
        yearRange: chapterRange,
      },
      { claimRangesChecked: true, referenceWindows },
    );
    messages.push({
      type: "batch",
      seq: chapter,
      readyThrough: time,
      actions,
      evidence: { method: "passage-review-v1", claims: [] },
    });
  }
  const requirements = checklist.result.requirements.map((r, index) => {
    const matching = events.filter((e) =>
      e.claimIds.some((id) => r.claimIds.includes(id)),
    );
    if (!matching.length)
      throw new Error(
        `Requirement ${index} has no rendered event from its frozen claims.`,
      );
    return {
      index,
      eventIndices: matching.map((e) => e.index),
      actionIds: matching.flatMap((e) => e.actionIds),
    };
  });
  messages.push({ type: "done", duration: time });
  const trial = new SceneBuffer();
  for (const m of messages) trial.ingest(messageSchema.parse(m));
  const dates = events.map((e) => {
    const batch = messages.find(
      (m) => m.type === "batch" && m.seq === e.chapter,
    );
    const heading =
      batch?.type === "batch"
        ? batch.actions.find(
            (a) => a.id === `b${e.chapter}_ev_${e.index}_heading`,
          )
        : undefined;
    if (heading?.type !== "chapter")
      throw new Error("Missing compiled chapter.");
    const chapterWindow = chapterDateWindow(heading.date, heading.yearRange)!;
    const window = records[e.index].window;
    if (
      window &&
      (window.start < chapterWindow.start || window.end > chapterWindow.end)
    )
      throw new Error("Typed event date leaves its compiled chapter heading.");
    return {
      index: e.index,
      chapter: e.chapter,
      heading: heading.date,
      chapterWindow,
      eventWindow: window,
      contained: true as const,
    };
  });
  return {
    focus,
    messages,
    events,
    requirements,
    structuralValidation: {
      method: "compiler-contract-v1",
      citations: "valid",
      protocol: "valid",
      dates,
    },
  };
}
