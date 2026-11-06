import { historicalChecklistFixture } from "./fixtures/checklist-regressions";
import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import {
  eventPlanSchema,
  type ResolvedEventPlan,
} from "../src/lib/server/event-plan";
import {
  compileEventPlan,
  eventWindow,
  eventDateLabel,
} from "../src/lib/server/event-compiler";
import {
  checkEventReview,
  reviewCompiledEvents,
  eventReviewSchema,
  type EventReviewRecord,
} from "../src/lib/server/event-review";
import { generateScene } from "../src/lib/server/scene-harness";
import { SceneBuffer, entityVisible } from "../src/lib/playback";
import { ResearchCache } from "../src/lib/server/research-cache";
import { storyChecklistSchema } from "../src/lib/server/story-checklist";
import type {
  GenerationRequest,
  SceneProvider,
} from "../src/lib/server/scene-provider";
import {
  fixtureEventPlan,
  essentialFixture,
  fixtureEventReview,
  fixtureChecklist,
  fixturePassage,
} from "./fixtures/live-scene";
const checklist = () =>
  storyChecklistSchema.parse(structuredClone(fixtureChecklist));
const plan = () =>
  eventPlanSchema.parse(structuredClone(fixtureEventPlan))
    .result as ResolvedEventPlan;
const research = {
  text: "Fixture evidence",
  passages: [fixturePassage],
  sources: [
    {
      id: "s1",
      title: "Evidence",
      url: "https://example.org/history/silk-roads",
    },
  ],
};
const compile = (p = plan()) => compileEventPlan(p, checklist(), research);
function date(
  year: number,
  month: number | null = null,
  day: number | null = null,
) {
  return {
    start: { year, month, day },
    end: { year, month, day },
    approximate: false,
    zone: null,
  };
}

test("compiler produces a complete seekable scene with deterministic IDs, citations and narration time", () => {
  const first = compile(),
    second = compile();
  assert.deepEqual(first, second);
  const buffer = new SceneBuffer();
  first.messages.forEach((m) => buffer.ingest(m));
  assert.ok(buffer.complete);
  assert.equal(buffer.readyThrough, 36);
  assert.equal(
    new Set(buffer.actions.map((a) => a.id)).size,
    buffer.actions.length,
  );
  for (const e of first.events) {
    const speech = buffer.actions.find(
      (a) =>
        a.type === "speech" && a.id === `b${e.chapter}_ev_${e.index}_speech`,
    );
    assert.ok(speech?.type === "speech");
    assert.deepEqual(speech.claimIds, ["c1"]);
    assert.deepEqual(speech.sourceIds, ["s1"]);
    assert.ok(speech.duration >= speech.text.length / 14);
    assert.equal(
      buffer.actions.filter(
        (a) =>
          a.type === "spawn" &&
          entityVisible(buffer.actions, a, speech.at + 0.1),
      ).length,
      1,
    );
  }
  assert.equal(
    buffer.actions.filter(
      (a) =>
        a.type === "spawn" &&
        entityVisible(buffer.actions, a, buffer.readyThrough),
    ).length,
    0,
  );
  assert.equal(first.requirements.length, 3);
  assert.ok(
    first.requirements.every((r) =>
      r.actionIds.every((id) => buffer.actions.some((a) => a.id === id)),
    ),
  );
});

test("server sorts distinct occurrences of a composite claim into chronological chapters", () => {
  const p = plan();
  p.events[0].date = date(1320);
  p.events[0].statement = "The later exchange.";
  p.events[1].date = date(1280);
  p.events[2].date = date(1300);
  const c = compile(p);
  assert.deepEqual(
    c.events.map((e) => e.index),
    [1, 2, 0],
  );
  assert.deepEqual(
    c.events.map((e) => e.chapter),
    [0, 1, 2],
  );
  assert.equal(c.focus.period, "1280–1320");
  const contradictory = structuredClone(p);
  contradictory.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
  ];
  assert.throws(() => compile(contradictory), /contradicts/);
});

test("overlap relations preserve independent event intervals without ordering whole composite claims", () => {
  const p = plan();
  p.events[0].statement = "Regional trading networks linked markets.";
  p.events[0].date = { ...date(1290), end: date(1310).end };
  p.events[1].date = date(1300);
  p.events[2].date = date(1320);
  p.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "overlaps", passageIds: ["p1"] },
  ];
  assert.equal(compile(p).events.length, 3);
  p.events[1].date = date(1320);
  assert.throws(() => compile(p), /intersecting/);
});

test("date validation rejects impossible dates, missing precision and future dates outside frozen claims", () => {
  for (const d of [
    date(0),
    date(1300, null, 2),
    date(1300, 2, 30),
    { ...date(1310), end: date(1290).end },
  ])
    assert.throws(() => eventWindow(d));
  assert.equal(
    eventDateLabel({ ...date(-44, 3, 15), zone: "Julian" }),
    "15 Mar 44 BCE (Julian)",
  );
  const p = plan();
  p.events[0].date = date(1400);
  assert.throws(() => compile(p), /claims' ranges/);
  p.events[0].date = null;
  assert.throws(() => compile(p), /needs a sourced date/);
  p.events[0].kind = "context";
  assert.equal(compile(p).events[0].date, "Undated context");
  p.events[1].statement = "In 1400 another event occurred.";
  assert.throws(() => compile(p), /outside the visible heading/);
});

test("event ordering rejects cycles, missing receipts and invented pairs", () => {
  const p = plan();
  p.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
    { beforeIndex: 1, afterIndex: 0, kind: "before", passageIds: ["p1"] },
  ];
  assert.throws(() => compile(p), /one relation per pair/);
  p.relations.push({
    beforeIndex: 1,
    afterIndex: 2,
    kind: "before",
    passageIds: ["p1"],
  });
  p.relations[1] = {
    beforeIndex: 2,
    afterIndex: 0,
    kind: "before",
    passageIds: ["p1"],
  };
  assert.throws(() => compile(p), /cycle/);
  p.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p99"] },
  ];
  assert.throws(() => compile(p), /fetched passages/);
  p.relations[0].beforeIndex = 8;
  assert.throws(() => compile(p), /valid indices/);
});

test("server owns template bounds, asset era and requirement-to-event candidates", () => {
  const p = plan();
  p.events[0].template = "railway";
  assert.throws(() => compile(p), /1800/);
  p.events[0].template = "earth_mission";
  p.presentation = "earth_mission";
  const result = compile(p);
  assert.ok(
    result.messages.some(
      (m) =>
        m.type === "batch" &&
        m.actions.some(
          (a) =>
            a.type === "chapter" &&
            a.caption.includes("no spacecraft or lunar surface"),
        ),
    ),
  );
  const c = checklist();
  if (c.result.status !== "ready") throw new Error();
  c.claims.push({ ...c.claims[0], id: "c2" });
  c.result.requirements[2].claimIds = ["c2"];
  assert.throws(() => compileEventPlan(p, c, research), /no rendered event/);
  p.events[0].claimIndices = [7];
  assert.throws(() => compile(p), /unknown frozen claim/);
});

test("independent event review requires every index, real receipt basis and full requirement support", () => {
  const p = plan(),
    c = checklist(),
    review = eventReviewSchema.parse(fixtureEventReview(p));
  checkEventReview(review, p, c);
  const duplicate = structuredClone(review);
  duplicate.events[1].index = 0;
  assert.throws(() => checkEventReview(duplicate, p, c), /exactly once/);
  const wrong = structuredClone(review);
  wrong.events[0].passageIds = ["p99"];
  assert.throws(() => checkEventReview(wrong, p, c), /own passages/);
  const missing = structuredClone(review);
  missing.requirements[2] = {
    index: 2,
    verdict: "revise",
    reason: "Goods were mentioned but ideas were omitted.",
  };
  assert.throws(() => checkEventReview(missing, p, c), /ideas were omitted/);
});

function provider(
  adjust?: (request: GenerationRequest<unknown>, value: any) => any,
) {
  const stages: string[] = [];
  const p: SceneProvider = {
    cacheIdentity: "events-test",
    async research() {
      stages.push("research");
      return research;
    },
    async generate<T>(request: GenerationRequest<T>) {
      stages.push(request.stage);
      const input = JSON.parse(request.input);
      let value: unknown;
      if (request.stage === "checklist") value = essentialFixture();
      else if (request.stage === "checklist_review")
        value = {
          missingEvidence: [],
          claims: [
            {
              id: "c1",
              verdict: "supported",
              reason: "Fixture",
              passageIds: ["p1"],
            },
          ],
          requirements: fixtureChecklist.result.requirements.map((r) => ({
            id: r.id,
            verdict: "supported",
            reason: "Fixture",
          })),
          relations: [],
          scope: { verdict: "supported", reason: "Fixture" },
        };
      else if (request.stage === "event_review")
        value = fixtureEventReview(input.plan, input.checklist);
      else value = fixtureEventPlan;
      return request.schema.parse(
        adjust ? adjust(request, structuredClone(value)) : value,
      );
    },
  };
  return { p, stages };
}

test("default harness uses event compiler with five calls and publishes only after complete review", async () => {
  const { p, stages } = provider(),
    reviews: EventReviewRecord[] = [];
  const iterator = generateScene("Silk Road", p, new AbortController().signal, {
    cache: new ResearchCache(),
    onEventReview: (r) => reviews.push(r),
  });
  const first = await iterator.next();
  assert.equal(first.value?.type, "focus");
  assert.deepEqual(stages, [
    "research",
    "checklist",
    "checklist_review",
    "event_plan",
    "event_review",
  ]);
  assert.equal(reviews.length, 1);
  assert.ok(reviews[0].accepted);
  const buffer = new SceneBuffer();
  buffer.ingest(first.value);
  for await (const m of iterator) buffer.ingest(m);
  assert.ok(buffer.complete);
});

test("failed whole-scene review repairs uncommitted events once and never leaks a partial focus", async () => {
  const { p, stages } = provider((r, v) => {
    if (r.stage === "event_review")
      v.requirements[2] = {
        index: 2,
        verdict: "revise",
        reason: "Missing essential outcome",
      };
    return v;
  });
  const messages: unknown[] = [],
    reviews: EventReviewRecord[] = [];
  await assert.rejects(async () => {
    for await (const m of generateScene(
      "Silk Road",
      p,
      new AbortController().signal,
      { cache: new ResearchCache(), onEventReview: (r) => reviews.push(r) },
    ))
      messages.push(m);
  }, /did not pass/);
  assert.equal(messages.length, 0);
  assert.deepEqual(stages.slice(-4), [
    "event_plan",
    "event_review",
    "repair",
    "event_review",
  ]);
  assert.equal(reviews.length, 2);
  assert.ok(reviews.every((r) => !r.accepted));
});

test("event planner repairs a wrong claim index before review and cancellation stops publication", async () => {
  const { p, stages } = provider((r, v) => {
    if (r.stage === "event_plan") v.result.events[0].claimIndices = [7];
    return v;
  });
  const controller = new AbortController(),
    iterator = generateScene("Silk Road", p, controller.signal, {
      cache: new ResearchCache(),
    });
  assert.equal((await iterator.next()).value?.type, "focus");
  assert.equal(stages.filter((s) => s === "repair").length, 1);
  assert.equal(stages.filter((s) => s === "event_review").length, 1);
  controller.abort();
  await assert.rejects(() => iterator.next(), /abort/i);
});

test("event schemas serialize to strict SDK structured outputs without low-level action bookkeeping", () => {
  for (const schema of [eventPlanSchema, eventReviewSchema]) {
    const format = zodTextFormat(schema, "events");
    assert.equal(format.strict, true);
    assert.equal(format.schema.additionalProperties, false);
  }
  const json = JSON.stringify(zodTextFormat(eventPlanSchema, "events").schema);
  assert.ok(!json.includes('"actionIds"'));
  assert.ok(!json.includes('"sourceIds"'));
  assert.ok(!json.includes('"chapter"'));
});

test("fifteen fully populated events stay within protocol, duration and entity limits", () => {
  const p = plan();
  p.events = Array.from({ length: 15 }, (_, index) => ({
    ...structuredClone(p.events[index % 3]),
    title: "An event",
    statement: "A".repeat(175),
    location: { name: "L".repeat(80), position: { lat: 0, lon: 0 } },
    participants: Array.from({ length: 3 }, () => ({
      name: "N".repeat(40),
      role: "R".repeat(35),
    })),
    date: { ...date(1300, 12, 31), zone: "Z".repeat(20) },
  }));
  const parsed = eventPlanSchema.parse({ result: p }).result;
  if (parsed.status !== "resolved") throw new Error();
  const compiled = compile(parsed),
    buffer = new SceneBuffer();
  compiled.messages.forEach((m) => buffer.ingest(m));
  assert.ok(buffer.complete);
  assert.ok(buffer.readyThrough <= 600);
  assert.equal(buffer.actions.filter((a) => a.type === "spawn").length, 60);
  assert.ok(
    compiled.messages.every(
      (m) => m.type !== "batch" || m.actions.length <= 100,
    ),
  );
  assert.ok(
    buffer.actions
      .filter((a) => a.type === "speech")
      .every((a) => a.type === "speech" && a.text.length <= 240),
  );
  assert.ok(
    buffer.actions
      .filter((a) => a.type === "chapter")
      .every(
        (a) =>
          a.type === "chapter" &&
          a.caption.includes("Overlapping date intervals"),
      ),
  );
});

test("review input keeps original event indices beside their own claims after chronological sorting", async () => {
  const p = plan(),
    c = checklist();
  c.claims.push({ ...c.claims[0], id: "c2", passageIds: ["p2"] });
  p.events[0].claimIndices = [1];
  p.events.forEach((event, index) => {
    event.date = date([1320, 1280, 1300][index]);
    event.statement = "Trading networks linked regional markets.";
  });
  const evidence = {
    ...research,
    passages: [fixturePassage, { ...fixturePassage, id: "p2" }],
  };
  const compiled = compileEventPlan(p, c, evidence);
  let received: any;
  const { p: reviewer } = provider((request, value) => {
    if (request.stage === "event_review") received = JSON.parse(request.input);
    return value;
  });
  await reviewCompiledEvents(reviewer, new AbortController().signal, {
    prompt: "Silk Road",
    plan: p,
    checklist: c,
    research: evidence,
    compiled,
  });
  assert.deepEqual(received.rendered.playbackOrder, [1, 2, 0]);
  assert.deepEqual(
    received.rendered.events.map((e: any) => e.index),
    [0, 1, 2],
  );
  assert.equal(received.rendered.events[0].sourceClaims[0].id, "c2");
  assert.deepEqual(received.rendered.events[0].sourceClaims[0].passageIds, [
    "p2",
  ]);
  assert.equal(received.rendered.events[0].chapter, 2);
  assert.ok(!JSON.stringify(received.rendered).includes('"actionIds"'));
});

test("an undated railway context may use its own frozen claim's sourced era without inventing a date", () => {
  const fixture = historicalChecklistFixture("railway");
  const c = storyChecklistSchema.parse({
    ...fixture.checklist,
    result: { ...fixture.checklist.result, relations: [] },
  });
  const p = plan();
  p.events.forEach((e, index) => {
    e.claimIndices = [index];
    e.statement = c.claims[index].text;
    e.date = index === 0 ? null : date(1830, 9, 15);
    e.kind = index === 0 ? "context" : "event";
    e.location.name = [
      "Liverpool and Manchester Railway",
      "Manchester",
      "Eccles",
    ][index];
    e.location.position = { lat: 53.48, lon: -2.34 };
  });
  p.events[0].template = "railway";
  const evidence = {
    ...research,
    passages: [
      {
        ...fixturePassage,
        text: fixture.document.text,
        documentHash: fixture.document.documentHash,
        end: fixture.document.text.length,
      },
    ],
  };
  const compiled = compileEventPlan(p, c, evidence);
  assert.equal(compiled.events[0].asset, "train");
  assert.equal(compiled.events[0].date, "Undated context");
  assert.ok(compiled.events[0].statement.startsWith("Context:"));
  c.claims[0].yearRange = null;
  assert.throws(() => compileEventPlan(p, c, evidence), /1800/);
  c.claims[0].yearRange = { startYear: 1799, endYear: 1830, approximate: true };
  assert.throws(() => compileEventPlan(p, c, evidence), /1800/);
});

test("undated context cannot hide a claim from a future historical period", () => {
  const p = plan(),
    c = checklist();
  c.claims.push({
    ...c.claims[0],
    id: "c2",
    yearRange: { startYear: 1400, endYear: 1400, approximate: false },
  });
  p.events[0].claimIndices = [1];
  p.events[0].kind = "context";
  p.events[0].date = null;
  assert.throws(
    () => compileEventPlan(p, c, research),
    /Undated context.*outside/,
  );
});

test("month-precision date containment uses actual month bounds", () => {
  const p = plan();
  p.events.forEach((e) => {
    e.date = date(1300, 2);
    e.statement = "Merchants exchanged goods.";
  });
  const story = compile(p);
  assert.ok(story.structuralValidation.dates.every((d) => d.contained));
  const p2 = plan();
  p2.events.forEach((e) => {
    e.date = date(1300, 4);
    e.statement = "Merchants exchanged goods.";
  });
  assert.ok(compile(p2).structuralValidation.dates.every((d) => d.contained));
});
