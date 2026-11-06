import assert from "node:assert/strict";
import test from "node:test";
import {
  chapterDateWindow,
  checkSceneTimeline,
} from "../src/lib/server/scene-timeline";
import {
  checkStoryCoverage,
  checkStoryRequirements,
  renderedFocusFacts,
  type StoryRequirement,
  type CoverageCheck,
} from "../src/lib/server/story-coverage";
import {
  fixtureClaim,
  batchOutput,
  fixtureRequirements,
} from "./fixtures/live-scene";
import type { SceneAction } from "../src/lib/scene-schema";
const years = (start: number, end = start) => ({
  startYear: start,
  endYear: end,
  approximate: false,
});
const requirements = fixtureRequirements as StoryRequirement[];
const first = batchOutput(0).actions as SceneAction[];
const coverage: CoverageCheck[] = [
  {
    id: "r1",
    status: "covered",
    actionIds: ["b0_chapter"],
    reason: "Explained.",
  },
  {
    id: "r2",
    status: "covered",
    actionIds: ["b0_merchant"],
    reason: "Introduced.",
  },
  {
    id: "r3",
    status: "pending",
    actionIds: [],
    reason: "The ending is due later.",
  },
];
test("story plans require sourced context, actors and an outcome", () => {
  assert.doesNotThrow(() =>
    checkStoryRequirements(requirements, [fixtureClaim]),
  );
  assert.doesNotThrow(() =>
    checkStoryRequirements(
      [
        ...requirements,
        {
          id: "r4",
          kind: "actors",
          description: "Later treaty signatories",
          claimIds: ["c1"],
          chapter: 2,
        },
        {
          id: "r5",
          kind: "context",
          description: "Later battle details",
          claimIds: ["c1"],
          chapter: 1,
        },
      ],
      [fixtureClaim],
    ),
  );
  assert.throws(
    () =>
      checkStoryRequirements(
        requirements.filter((r) => r.kind !== "actors"),
        [fixtureClaim],
      ),
    /actors/,
  );
  assert.throws(
    () =>
      checkStoryRequirements(
        requirements.map((r) =>
          r.kind === "context" ? { ...r, chapter: 2 } : r,
        ),
        [fixtureClaim],
      ),
    /chapter zero/,
  );
  assert.throws(
    () =>
      checkStoryRequirements(
        requirements.map((r) => ({ ...r, claimIds: ["c99"] })),
        [fixtureClaim],
      ),
    /known claims/,
  );
});
test("intermediate review leaves future requirements pending, final review requires rendered coverage", () => {
  const context = {
    requirements,
    covered: [],
    chapter: 0,
    final: false,
    committedActions: [],
  };
  assert.doesNotThrow(() => checkStoryCoverage(coverage, first, context));
  assert.throws(
    () =>
      checkStoryCoverage(coverage, first, {
        ...context,
        chapter: 2,
        final: true,
      }),
    /missing from rendered/,
  );
  assert.throws(
    () =>
      checkStoryCoverage(
        coverage.map((c) =>
          c.id === "r1" ? { ...c, actionIds: ["outline-only"] } : c,
        ),
        first,
        context,
      ),
    /plans do not count/,
  );
  assert.throws(
    () => checkStoryCoverage(coverage.slice(1), first, context),
    /every story requirement/,
  );
});
test("committed coverage cannot disappear in a later chapter", () => {
  assert.throws(
    () =>
      checkStoryCoverage(
        coverage.map((c) =>
          c.id === "r1" ? { ...c, status: "pending", actionIds: [] } : c,
        ),
        [],
        {
          requirements,
          covered: coverage,
          chapter: 1,
          final: false,
          committedActions: first,
        },
      ),
    /Preserve committed/,
  );
});
test("date labels parse exact days, month spans, compact ranges and BCE years", () => {
  const one = chapterDateWindow("July 16, 1969", years(1969))!,
    other = chapterDateWindow("24 July 1969", years(1969))!;
  assert.ok(one.end < other.start);
  assert.deepEqual(
    chapterDateWindow("16–24 July 1969", years(1969)),
    chapterDateWindow("July 16–24, 1969", years(1969)),
  );
  const march = chapterDateWindow("March–17 April 1895", years(1895))!,
    april = chapterDateWindow("17 April 1895", years(1895))!;
  assert.ok(march.start < april.start);
  assert.equal(march.end, april.end);
  assert.deepEqual(
    chapterDateWindow("1200–1150 BCE", years(-1200, -1150)),
    chapterDateWindow("Context", years(-1200, -1150)),
  );
});
test("Apollo return narration cannot be placed under the launch date heading", () => {
  const chapter = {
    ...first[0],
    date: "July 16, 1969",
    yearRange: years(1969),
    claimIds: ["c1"],
  } as SceneAction;
  const speech = {
    ...first.at(-1),
    at: 5,
    text: "On July 24, Apollo 11 returned to the Pacific.",
    claimIds: ["c1"],
  } as SceneAction;
  const claim = { ...fixtureClaim, yearRange: years(1969) };
  assert.throws(
    () =>
      checkSceneTimeline([chapter, speech], [], [claim], {
        date: "July 16, 1969",
        yearRange: years(1969),
      }),
    /outside the visible heading/,
  );
  assert.doesNotThrow(() =>
    checkSceneTimeline(
      [{ ...chapter, date: "July 16–24, 1969" } as SceneAction, speech],
      [],
      [claim],
      { date: "July 16–24, 1969", yearRange: years(1969) },
    ),
  );
});
test("a supported 1836 claim still cannot appear in Beagle's 1834–1835 chapter", () => {
  const chapter = {
    ...first[0],
    date: "1834–1835",
    yearRange: years(1834, 1835),
  } as SceneAction;
  const speech = {
    ...first.at(-1),
    at: 15,
    text: "The expedition reached Australia.",
    claimIds: ["c5"],
  } as SceneAction;
  const claim = { ...fixtureClaim, id: "c5", yearRange: years(1836) };
  assert.throws(
    () =>
      checkSceneTimeline([chapter, speech], [], [claim], {
        date: "1834–1835",
        yearRange: years(1834, 1835),
      }),
    /matching chapter/,
  );
});
test("measurements are not mistaken for years", () => {
  const chapter = {
    ...first[0],
    date: "18 June 1815",
    yearRange: years(1815),
  } as SceneAction;
  const speech = {
    ...first.at(-1),
    at: 5,
    text: "The force numbered 1800 soldiers and traveled 650 miles.",
    claimIds: ["c1"],
  } as SceneAction;
  assert.doesNotThrow(() =>
    checkSceneTimeline(
      [chapter, speech],
      [],
      [{ ...fixtureClaim, yearRange: years(1815) }],
      { date: "18 June 1815", yearRange: years(1815) },
    ),
  );
});

test("dated chapter captions obey the heading just like narration", () => {
  const chapter = {
    ...first[0],
    date: "July 16, 1969",
    caption: "The mission returned on July 24.",
    yearRange: years(1969),
  } as SceneAction;
  assert.throws(
    () =>
      checkSceneTimeline(
        [chapter],
        [],
        [{ ...fixtureClaim, yearRange: years(1969) }],
        { date: "July 16, 1969", yearRange: years(1969) },
      ),
    /outside the visible heading/,
  );
});
test("ISO dates work without treating matching dates or quantities as different periods", () => {
  assert.deepEqual(
    chapterDateWindow("1969-07-16", years(1969)),
    chapterDateWindow("16 July 1969", years(1969)),
  );
  const chapter = {
    ...first[0],
    date: "July 16, 1969",
    yearRange: years(1969),
  } as SceneAction;
  const speech = {
    ...first.at(-1),
    at: 5,
    text: "On July 16 there were 650 people.",
    claimIds: ["c1"],
  } as SceneAction;
  assert.doesNotThrow(() =>
    checkSceneTimeline(
      [chapter, speech],
      [],
      [{ ...fixtureClaim, yearRange: years(1969) }],
      { date: "July 16, 1969", yearRange: years(1969) },
    ),
  );
});
test("a movement alone cannot stand in for an explicit outcome", () => {
  const final = coverage.map((c) =>
    c.id === "r3"
      ? { ...c, status: "covered" as const, actionIds: ["b0_move"] }
      : c,
  );
  assert.throws(
    () =>
      checkStoryCoverage(final, first, {
        requirements,
        covered: [],
        chapter: 2,
        final: true,
        committedActions: [],
      }),
    /explicit rendered text/,
  );
});

test("visible focus header fields count as rendered evidence, while hidden metadata cannot", () => {
  const renderedFocus = renderedFocusFacts(
    {
      title: "Waterloo",
      period: "18 June 1815",
      location: "Waterloo, Belgium",
    } as any,
    ["c1"],
  );
  const requirement = {
    id: "r1",
    kind: "request" as const,
    description: "Show Waterloo in Belgium on 18 June 1815.",
    claimIds: ["c1"],
    chapter: 0,
  };
  const checks: CoverageCheck[] = [
    {
      id: "r1",
      status: "covered",
      actionIds: ["@focus:title", "@focus:period", "@focus:location"],
      reason: "The visible story header supplies these fields.",
    },
  ];
  const context = {
    requirements: [requirement],
    covered: [],
    chapter: 0,
    final: false,
    committedActions: [],
    renderedFocus,
  };
  assert.doesNotThrow(() => checkStoryCoverage(checks, [], context));
  assert.throws(
    () => checkStoryCoverage(checks, [], { ...context, renderedFocus: [] }),
    /claim-linked/,
  );
  assert.throws(
    () =>
      checkStoryCoverage(checks, [], {
        ...context,
        renderedFocus: renderedFocus.map((f) => ({ ...f, claimIds: ["c2"] })),
      }),
    /claim-linked/,
  );
  assert.throws(
    () =>
      checkStoryCoverage(
        [{ ...checks[0], actionIds: ["@focus:outline"] }],
        [],
        {
          ...context,
          renderedFocus: [
            ...renderedFocus,
            { id: "@focus:outline", text: "A hidden plan", claimIds: ["c1"] },
          ],
        },
      ),
    /claim-linked/,
  );
});
