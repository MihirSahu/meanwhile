import { historicalChecklistFixture } from "./fixtures/checklist-regressions";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import {
  eventPlanSchema,
  maxStoryEvents,
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
import { angularDistance, discoveryPrompt, type DiscoveryContext } from "../src/lib/discovery";
import { eventRepairSchema } from "../src/lib/server/event-repair";
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

test("complete role phrases survive compilation without clipping map labels or losing visible role coverage", () => {
  const p = plan();
  const actor = {
    name: "Representatives of the Central Asian trading communities",
    role: "A principal representative of the regional trading communities",
  };
  p.events[0].participants = [actor];
  assert.ok(eventPlanSchema.safeParse({ result: p }).success);
  const compiled = compile(p);
  assert.deepEqual(compiled.events[0].participantLabels, [actor.name]);
  assert.deepEqual(compiled.events[0].participantNotes, [`${actor.name} — ${actor.role}`]);
  const buffer = new SceneBuffer(); compiled.messages.forEach((m) => buffer.ingest(m));
  const note = buffer.actions.find((a) => a.type === "speech" && a.text.includes(actor.role));
  assert.ok(note?.type === "speech");
  assert.equal(note.text, `${actor.name} — ${actor.role}`);
  assert.deepEqual(note.claimIds, ["c1"]);
  assert.deepEqual(note.sourceIds, ["s1"]);
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

test("a broad story's location labels its scope while the center remains a real mapped camera anchor", () => {
  const p = plan();
  p.location = "Worldwide";
  const result = compile(p);
  assert.equal(result.focus.location, "Worldwide");
  assert.deepEqual(result.focus.center, p.events[p.focusEventIndex].location.position);
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

test("coarse dates preserve the planned narrative instead of jumping ahead of a precise protest date", () => {
  const p = plan();
  p.events[0].date = date(1300, 10, 23);
  p.events[1].date = date(1300);
  p.events[2].date = date(1300, 11, 1);
  assert.deepEqual(compile(p).events.map((e) => e.index), [0, 1, 2]);
  // A sourced edge still overrides an ambiguous proposed sequence.
  p.relations = [{ beforeIndex: 2, afterIndex: 1, kind: "before", passageIds: ["p1"] }];
  assert.deepEqual(compile(p).events.map((e) => e.index), [0, 2, 1]);
});

test("undated context preserves its proposed placement rather than automatically becoming the opening", () => {
  const p = plan();
  p.events[2].date = null;
  p.events[2].kind = "context";
  assert.deepEqual(compile(p).events.map((e) => e.index), [0, 1, 2]);
});

test("genuinely undated aftermath stays an outcome after its sourced anchor with visible timing limits", () => {
  const p = plan();
  p.events[2].date = null;
  p.events[2].kind = "outcome";
  p.events[2].statement = "Restrictions continued for decades afterward.";
  p.relations = [{ beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] }];
  const result = compile(p);
  assert.deepEqual(result.events.map((e) => e.index), [0, 1, 2]);
  assert.equal(result.events[2].kind, "outcome");
  assert.equal(result.events[2].date, "Undated aftermath");
  assert.match(result.events[2].statement, /^Undated aftermath:/);
  assert.match(result.events[2].relationText.join(" "), /^After /);
  const last = result.messages.filter((m) => m.type === "batch")[2];
  assert.ok(last.type === "batch");
  const heading = last.actions.find((a) => a.type === "chapter");
  assert.ok(heading?.type === "chapter");
  assert.match(heading.caption!, /Aftermath is undated/);

  p.relations = [];
  assert.throws(() => compile(p), /sourced after relation/);
  p.relations = [{ beforeIndex: 1, afterIndex: 2, kind: "unordered", passageIds: ["p1"] }];
  assert.throws(() => compile(p), /sourced after relation/);
  p.relations[0].kind = "before";
  p.relations[0].passageIds = ["p99"];
  assert.throws(() => compile(p), /actual fetched passages/);
});

test("relative aftermath can follow a sourced chain but an undated cycle cannot substitute for a dated anchor", () => {
  const p = plan();
  for (const e of p.events.slice(1)) { e.date = null; e.kind = "outcome"; }
  p.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
    { beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] },
  ];
  assert.deepEqual(compile(p).events.map((e) => e.index), [0, 1, 2]);
  p.relations = [
    { beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] },
    { beforeIndex: 2, afterIndex: 0, kind: "before", passageIds: ["p1"] },
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
  ];
  p.events[0].date = null;
  p.events[0].kind = "outcome";
  assert.throws(() => compile(p), /sourced after relation/);
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
      let adjusted: any = adjust ? adjust(request, structuredClone(value)) : value;
      if (request.schema === (eventRepairSchema as unknown) && adjusted.result.status === "resolved") {
        const full = adjusted.result;
        adjusted = { result: { status: "corrected",
          edits: full.events.map(({ kind: _kind, ...replacement }: any, index: number) => ({ index, replacement: { ...replacement, kind: null } })),
          additions: [], removals: [], order: full.events.map((_: any, i: number) => i), relations: full.relations,
          metadata: { title: full.title, location: full.location, focusEventIndex: full.focusEventIndex, presentation: full.presentation },
        } };
      }
      return request.schema.parse(adjusted);
    },
  };
  return { p, stages };
}

const discoveryContext: DiscoveryContext = {
  originTitle: "An earlier synthetic story", originCenter: { lat: 10, lon: -70 },
  periodLabel: "c. 1300", yearRange: { startYear: 1275, endYear: 1325, approximate: true },
  excludedTitles: ["An earlier synthetic story"],
};

test("discovery does not turn angular-distance selection into a historical evidence loop", async () => {
  const { p, stages } = provider((request, value) => {
    const input = JSON.parse(request.input);
    if (request.stage === "checklist" || request.stage === "checklist_review") {
      assert.doesNotMatch(request.input, /angular degrees|originCenter|at least 20|latitude|longitude/);
      const task = request.stage === "checklist" ? input.request : input;
      assert.match(task.prompt, /strictly within years 1275 to 1325/);
      assert.equal(task.discovery, undefined);
    }
    if (request.stage === "event_plan") {
      assert.deepEqual(input.request.discovery, discoveryContext);
      assert.doesNotMatch(input.request.prompt, /angular|latitude|longitude/);
    }
    if (request.stage === "event_review") {
      assert.doesNotMatch(input.prompt, /angular|latitude|longitude/);
      assert.equal(input.structuralValidation.discovery.minimumAngularDistanceDegrees, 20);
      assert.equal(input.structuralValidation.discovery.angularDistanceDegrees,
        angularDistance(discoveryContext.originCenter, input.rendered.focus.center));
      assert.equal(input.structuralValidation.discovery.periodCheck, "within_requested_range");
    }
    return value;
  });
  let researchRequests = 0;
  p.research = async (prompt) => {
    researchRequests++;
    stages.push("research");
    assert.equal(prompt, discoveryPrompt(discoveryContext));
    assert.match(prompt, /at least 20 angular degrees/);
    return research;
  };
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Ignored discovery override", p, new AbortController().signal, {
    discovery: discoveryContext, cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(researchRequests, 1);
  assert.deepEqual(stages, ["research", "checklist", "checklist_review", "event_plan", "event_review"]);
});

test("discovery still recovers genuinely missing historical location evidence", async () => {
  let reviews = 0, rereads = 0;
  const { p } = provider((request, value) => {
    if (request.stage === "checklist_review" && ++reviews === 1) {
      value.missingEvidence = ["Find evidence of the event's geographic setting."];
      value.scope = { verdict: "revise", reason: "The historical setting needs a supporting passage." };
    }
    return value;
  });
  p.rereadEvidence = async (topics) => {
    rereads++;
    assert.deepEqual(topics, ["Find evidence of the event's geographic setting."]);
    const text = fixturePassage.text + " The synthetic setting was Central Asia.";
    return { ...research, passages: [{ ...fixturePassage, text, end: text.length,
      documentHash: createHash("sha256").update(text).digest("hex") }] };
  };
  const buffer = new SceneBuffer();
  for await (const message of generateScene(discoveryPrompt(discoveryContext), p, new AbortController().signal, {
    discovery: discoveryContext, cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(rereads, 1);
  assert.equal(reviews, 2);
});

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

test("the event planner is told which frozen claims can supply dates and which are undated", async () => {
  let inspected = false;
  const { p } = provider((request, value) => {
    if (request.stage === "checklist")
      value.claims.push({ ...value.claims[0], id: "c2", text: "This journey is schematic.", yearRange: null });
    if (request.stage === "checklist_review")
      value.claims.push({ ...value.claims[0], id: "c2" });
    if (request.stage === "event_plan") {
      const input = JSON.parse(request.input).request;
      assert.deepEqual(input.datedClaimIndices, [0]);
      assert.deepEqual(input.undatedClaimIndices, [1]);
      assert.equal(input.checklist.claims[1].yearRange, null);
      inspected = true;
    }
    return value;
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic temporal capabilities", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(inspected);
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
    if (r.stage === "repair") {
      const feedback = JSON.parse(r.input).repair;
      assert.equal(feedback.eventReview.requirements[2].verdict, "revise");
      assert.match(r.instructions, /ONE occurrence/);
    }
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

test("successive checklist source findings receive structured, cumulative repairs before freezing", async () => {
  const feedback: any[] = [];
  let reviews = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist")
      feedback.push(JSON.parse(request.input).repair);
    if (request.stage === "checklist_review") {
      reviews++;
      if (reviews === 1) {
        value.claims[0].verdict = "revise";
        value.claims[0].reason = "The passage does not establish membership in the demands.";
        value.requirements[2].verdict = "revise";
        value.requirements[2].reason = "Remove unsupported ordering from the outcome.";
      } else if (reviews === 2) {
        value.scope = {
          verdict: "revise",
          reason: "Include the essential context already present in the fetched passages.",
        };
      }
    }
    return value;
  });
  const iterator = generateScene("Synthetic checklist repair", p, new AbortController().signal, {
    cache: new ResearchCache(),
  });
  const first = await iterator.next();
  assert.equal(reviews, 3);
  assert.equal(first.value?.type, "focus");
  const buffer = new SceneBuffer();
  buffer.ingest(first.value);
  for await (const message of iterator) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(feedback[0], null);
  assert.equal(feedback[1].sourceReview.claims[0].verdict, "revise");
  assert.deepEqual(feedback[1].reviewedRequirements, fixtureChecklist.result.requirements);
  assert.match(feedback[1].instruction, /has NOT frozen/);
  assert.deepEqual(feedback[1].earlierIssues, []);
  assert.match(feedback[2].earlierIssues[0], /membership in the demands/);
  assert.match(feedback[2].sourceReview.scope.reason, /essential context/);
  assert.equal(stages.length, 9);
  assert.deepEqual(stages.slice(-2), ["event_plan", "event_review"]);
});

test("a source reviewer receives its earlier candidates and verdict reversals instead of reviewing repairs in isolation", async () => {
  const histories: any[][] = [];
  const reasons = [
    "Attribute the date: the passage creates a chronological conflict.",
    "Remove the contested framing: the passages do not establish a conflict.",
  ];
  const { p } = provider((request, value) => {
    if (request.stage === "checklist_review") {
      const input = JSON.parse(request.input);
      histories.push(input.previousReviews);
      const reason = reasons[histories.length - 1];
      if (reason) {
        value.claims[0].verdict = "revise";
        value.claims[0].reason = reason;
      }
    }
    return value;
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic verdict reversal", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.deepEqual(histories.map((history) => history.length), [0, 1, 2]);
  assert.deepEqual(histories[2].map((record) => record.review.claims[0].reason), reasons);
  assert.ok(histories[2].every((record) => record.accepted === false));
  assert.deepEqual(histories[2][0].candidate.claims, fixtureChecklist.claims);
  assert.deepEqual(histories[2][0].candidate.result.requirements, fixtureChecklist.result.requirements);
});

test("targeted evidence recovery clears review history before receipt IDs are rebuilt", async () => {
  const histories: any[][] = [];
  let researchCalls = 0;
  const { p } = provider((request, value) => {
    if (request.stage === "checklist" && researchCalls === 2)
      assert.deepEqual(JSON.parse(request.input).request.coverageQuestions, ["Find the essential source context."]);
    if (request.stage === "checklist_review") {
      if (researchCalls === 2)
        assert.deepEqual(JSON.parse(request.input).coverageQuestions, ["Find the essential source context."]);
      histories.push(JSON.parse(request.input).previousReviews);
      if (histories.length === 1)
        value.scope = { verdict: "revise", reason: "Correct the existing wording." };
      if (histories.length === 2)
        value.missingEvidence = ["Find the essential source context."];
    }
    return value;
  });
  p.research = async () => {
    if (++researchCalls === 1) return research;
    const text = fixturePassage.text + " Supplemental synthetic source context.";
    return {
      ...research,
      passages: [{
        ...fixturePassage,
        text,
        end: text.length,
        documentHash: createHash("sha256").update(text).digest("hex"),
      }],
    };
  };
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic source recovery", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(researchCalls, 2);
  assert.deepEqual(histories.map((history) => history.length), [0, 1, 0]);
});

test("a late planner evidence gap gets the unused lookup and a freshly reviewed checklist before publication", async () => {
  let plans = 0, researchCalls = 0, checklistCalls = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist") {
      checklistCalls++;
      if (researchCalls === 2)
        assert.deepEqual(JSON.parse(request.input).request.coverageQuestions, ["Find a sourced date for the outcome."]);
    }
    if (request.stage === "event_plan" && plans++ === 0)
      return { result: { status: "clarification", question: "Find a sourced date for the outcome." } };
    return value;
  });
  p.research = async (_prompt, _signal, options) => {
    researchCalls++;
    if (researchCalls === 1) return research;
    assert.deepEqual(options?.recoveryTopics, ["Find a sourced date for the outcome."]);
    const text = fixturePassage.text + " Additional source date evidence.";
    return { ...research, passages: [{ ...fixturePassage, text, end: text.length,
      documentHash: createHash("sha256").update(text).digest("hex") }] };
  };
  const iterator = generateScene("Synthetic late evidence gap", p, new AbortController().signal, { cache: new ResearchCache() });
  const first = await iterator.next();
  assert.equal(first.value?.type, "focus");
  assert.equal(researchCalls, 2);
  assert.equal(checklistCalls, 2);
  assert.equal(plans, 2);
  assert.deepEqual(stages.slice(-2), ["event_plan", "event_review"]);
  const buffer = new SceneBuffer(); buffer.ingest(first.value);
  for await (const message of iterator) buffer.ingest(message);
  assert.ok(buffer.complete);
});

test("a planner capacity problem is replanned without researching or discarding the reviewed checklist", async () => {
  let plans = 0, checklists = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist") checklists++;
    if (request.stage === "event_plan" && plans++ === 0)
      return { result: { status: "clarification", reason: "capacity",
        question: "May the 15-record limit be increased to 16?" } };
    return value;
  });
  p.rereadEvidence = async () => { assert.fail("Capacity cannot trigger an evidence reread."); };
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic planning-capacity correction", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(checklists, 1);
  assert.equal(stages.filter((s) => s === "research").length, 1);
  assert.deepEqual(stages.slice(-3), ["event_plan", "repair", "event_review"]);
});

test("a capacity response preserves semantic feedback and does not consume the remaining factual repair", async () => {
  let reviews = 0, capacityReturned = false, historyKept = false;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "event_review" && ++reviews <= 2)
      value.events[reviews - 1] = { ...value.events[reviews - 1], verdict: "revise",
        reason: `Factual correction ${reviews}.` };
    if (request.stage === "repair" && request.schema === (eventRepairSchema as unknown) && !capacityReturned) {
      capacityReturned = true;
      return { result: { status: "clarification", reason: "capacity", question: "May I use sixteen records?" } };
    }
    if (request.stage === "repair" && request.schema !== (eventRepairSchema as unknown)) {
      const input = JSON.parse(request.input);
      assert.equal(input.repair.eventReview.events[0].verdict, "revise");
      assert.equal(input.repair.reviewedPlan.result.status, "resolved");
      historyKept = true;
    }
    if (request.stage === "repair" && request.schema === (eventRepairSchema as unknown) && reviews === 2) {
      const input = JSON.parse(request.input);
      assert.ok(input.repair.earlierIssues.some((issue: string) => issue.includes("Factual correction 1")));
      assert.match(input.repair.issues, /Factual correction 2/);
    }
    return value;
  });
  p.rereadEvidence = async () => { assert.fail("A capacity correction cannot trigger research."); };
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic capacity feedback retention", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete && historyKept);
  assert.equal(reviews, 3);
  assert.equal(stages.filter((s) => s === "repair").length, 3);
});

test("late planning recovery shares the one-lookup cap and cannot loop or publish when evidence remains missing", async () => {
  let researchCalls = 0;
  const { p } = provider((request, value) => request.stage === "event_plan"
    ? { result: { status: "clarification", question: "The outcome date is still unsupported." } }
    : value);
  p.research = async () => {
    researchCalls++;
    if (researchCalls === 1) return research;
    const text = fixturePassage.text + " Supplemental context, without the missing date.";
    return { ...research, passages: [{ ...fixturePassage, text, end: text.length,
      documentHash: createHash("sha256").update(text).digest("hex") }] };
  };
  await assert.rejects(async () => {
    for await (const _message of generateScene("Synthetic unresolved late gap", p, new AbortController().signal, {
      cache: new ResearchCache(),
    })) assert.fail("An unresolved evidence gap must not publish.");
  }, (error: any) => error.code === "evidence" && /outcome date is still unsupported/.test(error.details?.reason ?? ""));
  assert.equal(researchCalls, 2);
});

test("evidence preparation bounds local rereads as well as search and leaves no incomplete cache entry", async () => {
  let searches = 0, rereads = 0;
  const { p } = provider((request, value) => request.stage === "checklist" ? {
    claims: [], result: { status: "clarification", reason: "missing_evidence",
      missingEvidence: ["Find the principal leadership."], question: "Leadership evidence is still missing." },
  } : value);
  const additional = (label: string) => {
    const text = fixturePassage.text + label;
    return { ...research, passages: [{ ...fixturePassage, text, end: text.length,
      documentHash: createHash("sha256").update(text).digest("hex") }] };
  };
  p.research = async () => ++searches === 1 ? research : additional(" A new search receipt.");
  p.rereadEvidence = async () => additional(` A new local receipt ${++rereads}.`);
  const cache = new ResearchCache();
  await assert.rejects(async () => {
    for await (const _message of generateScene("Synthetic bounded source recovery", p, new AbortController().signal, { cache }))
      assert.fail("Incomplete preparation cannot publish.");
  }, (error: any) => error.code === "evidence" && /Leadership evidence is still missing/.test(error.details?.reason ?? ""));
  assert.equal(searches, 2);
  assert.equal(rereads, 2);
  assert.equal(cache.get(`${p.cacheIdentity}:Synthetic bounded source recovery`), null);
});

test("two distinct essential gaps may be searched, but a third one cannot keep restarting research", async () => {
  let searches = 0;
  const { p } = provider((request, value) => request.stage === "checklist" ? {
    claims: [], result: { status: "clarification", reason: "missing_evidence",
      question: `Missing essential topic ${searches}.`, missingEvidence: [`Essential topic ${searches}`] },
  } : value);
  p.research = async () => {
    const text = fixturePassage.text + ` Supplemental source version ${++searches}.`;
    return { ...research, passages: [{ ...fixturePassage, text, end: text.length,
      documentHash: createHash("sha256").update(text).digest("hex") }] };
  };
  await assert.rejects(async () => {
    for await (const _message of generateScene("Synthetic distinct source gaps", p, new AbortController().signal, {
      cache: new ResearchCache(),
    })) assert.fail("Missing essential evidence cannot publish.");
  }, (error: any) => error.code === "evidence");
  assert.equal(searches, 3, "one initial search and at most two targeted lookups");
});

test("two checklist repairs cannot starve two distinct scene corrections before the final review", async () => {
  let checklistReviews = 0, eventReviews = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist_review" && ++checklistReviews <= 2)
      value.scope = { verdict: "revise", reason: `Checklist correction ${checklistReviews}.` };
    if (request.stage === "event_review" && ++eventReviews <= 2)
      value.events[eventReviews - 1] = { ...value.events[eventReviews - 1], verdict: "revise",
        reason: `Scene correction ${eventReviews}.` };
    return value;
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic phase repair budgets", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(checklistReviews, 3);
  assert.equal(eventReviews, 3);
  assert.equal(stages.filter((s) => s === "repair").length, 2);
  assert.equal(stages.filter((s) => s === "checklist").length, 3);
});

test("distinct semantic findings may use the remaining shared repair without granting an unbounded retry", async () => {
  let reviews = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "event_review" && ++reviews <= 2)
      value.events[reviews - 1] = { ...value.events[reviews - 1], verdict: "revise", reason: `Correct distinct issue ${reviews}.` };
    return value;
  });
  const iterator = generateScene("Synthetic distinct semantic findings", p, new AbortController().signal, { cache: new ResearchCache() });
  const first = await iterator.next();
  assert.equal(first.value?.type, "focus");
  assert.equal(reviews, 3);
  assert.equal(stages.filter((s) => s === "repair").length, 2);
  for await (const _message of iterator) { /* drain the reviewed scene */ }
});

test("three rejected checklists exhaust bounded repairs without publishing any scene", async () => {
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist_review")
      value.scope = { verdict: "revise", reason: "Essential context remains unsupported." };
    return value;
  });
  const messages: unknown[] = [];
  await assert.rejects(async () => {
    for await (const message of generateScene("Synthetic rejection", p, new AbortController().signal, {
      cache: new ResearchCache(),
    })) messages.push(message);
  }, /did not pass its checks/);
  assert.deepEqual(messages, []);
  assert.equal(stages.filter((stage) => stage === "checklist").length, 3);
  assert.equal(stages.filter((stage) => stage === "checklist_review").length, 3);
  assert.ok(!stages.includes("event_plan"));
});

test("checklist repairs leave the separately bounded event-repair allowance available", async () => {
  let reviews = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist_review" && ++reviews <= 2)
      value.scope = { verdict: "revise", reason: "Repair essential context." };
    if (request.stage === "event_review")
      value.metadata = { verdict: "revise", reason: "The location remains unsupported." };
    return value;
  });
  await assert.rejects(async () => {
    for await (const _message of generateScene("Synthetic shared cap", p, new AbortController().signal, {
      cache: new ResearchCache(),
    })) assert.fail("Rejected stories must not publish.");
  }, /did not pass its checks/);
  assert.deepEqual(stages.slice(-4), ["event_plan", "event_review", "repair", "event_review"]);
  assert.equal(stages.filter((stage) => stage === "event_plan").length, 1);
  assert.equal(stages.filter((stage) => stage === "repair").length, 1);
});

test("invalid source-review references do not earn a second checklist repair", async () => {
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist_review") value.claims[0].passageIds = ["p99"];
    return value;
  });
  await assert.rejects(async () => {
    for await (const _message of generateScene("Synthetic invalid receipt", p, new AbortController().signal, {
      cache: new ResearchCache(),
    })) assert.fail("Invalid reviews must not publish.");
  }, /did not pass its checks/);
  assert.equal(stages.filter((stage) => stage === "checklist_review").length, 2);
  assert.ok(!stages.includes("event_plan"));
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

test("the harness patches a rejected date without rewriting the event or its chronology", async () => {
  let sawConstraint = false;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "event_plan") value.result.events[0].date = date(1400);
    if (request.stage === "repair") {
      const feedback = JSON.parse(request.input).repair;
      assert.equal(feedback.dateConstraint.eventIndex, 0);
      assert.equal(feedback.dateConstraint.requestedDate.start.year, 1400);
      assert.equal(feedback.dateConstraint.selectedClaims[0].id, "c1");
      sawConstraint = true;
      return { result: { status: "corrected", date: date(1300), claimIndices: [0] } };
    }
    if (request.stage === "event_review") {
      const current = JSON.parse(request.input).plan;
      assert.equal(current.events[0].kind, fixtureEventPlan.result.events[0].kind);
      assert.equal(current.events[0].statement, fixtureEventPlan.result.events[0].statement);
      assert.equal(current.events[0].date.start.year, 1300);
    }
    return value;
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic date repair", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.ok(sawConstraint);
  assert.deepEqual(stages.slice(-3), ["event_plan", "repair", "event_review"]);
});

test("a null-date repair is rejected before semantic review or publication", async () => {
  const { p, stages } = provider((request, value) => {
    if (request.stage === "event_plan") value.result.events[0].date = date(1400);
    if (request.stage === "repair")
      return { result: { status: "corrected", date: null, claimIndices: [0] } };
    return value;
  });
  await assert.rejects(async () => {
    for await (const _message of generateScene("Synthetic null-date bypass", p, new AbortController().signal, {
      cache: new ResearchCache(),
    })) assert.fail("Invalid repairs must not publish a scene.");
  }, /did not pass its checks/);
  assert.equal(stages.filter((stage) => stage === "repair").length, 1);
  assert.ok(!stages.includes("event_review"));
});

test("a missing-date repair adds only sourced relative aftermath without rewriting actors or promoting it to context", async () => {
  const { p, stages } = provider((request, value) => {
    if (request.stage === "event_plan") {
      value.result.events[2].date = null;
      value.result.events[2].kind = "outcome";
      value.result.events[2].participants = [{ name: "Guard troops", role: null }];
    }
    if (request.stage === "repair") {
      const feedback = JSON.parse(request.input).repair;
      assert.equal(feedback.dateConstraint.eventIndex, 2);
      assert.equal(feedback.dateConstraint.requestedDate, null);
      return { result: { status: "relative_outcome", afterEventIndex: 1, passageIds: ["p1"] } };
    }
    if (request.stage === "event_review") {
      const input = JSON.parse(request.input);
      assert.equal(input.plan.events[2].kind, "outcome");
      assert.equal(input.plan.events[2].participants[0].name, "Guard troops");
      assert.equal(input.plan.events[2].date, null);
      assert.deepEqual(input.rendered.playbackOrder, [0, 1, 2]);
      assert.match(input.rendered.events[2].date, /Undated aftermath/);
    }
    return value;
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic relative aftermath", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.deepEqual(stages.slice(-3), ["event_plan", "repair", "event_review"]);
});

test("an anchored undated outcome reaches full review without spending a repair", async () => {
  const { p, stages } = provider((request, value) => {
    if (request.stage === "event_plan") {
      value.result.events[2].date = null;
      value.result.events[2].kind = "outcome";
      value.result.relations = [{ beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] }];
    }
    return value;
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Synthetic initial aftermath", p, new AbortController().signal, {
    cache: new ResearchCache(),
  })) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.deepEqual(stages.slice(-2), ["event_plan", "event_review"]);
  assert.ok(!stages.includes("repair"));
});

test("a checklist repair still leaves one semantic repair for an actor label when aftermath needs no calendar invention", async () => {
  let checklistReviews = 0, eventReviews = 0;
  const { p, stages } = provider((request, value) => {
    if (request.stage === "checklist_review" && checklistReviews++ === 0)
      value.requirements[0] = { ...value.requirements[0], verdict: "revise", reason: "Clarify the sourced aims." };
    if (request.stage === "event_plan" || request.stage === "repair") {
      value.result.events[2].kind = "outcome";
      value.result.events[2].date = null;
      value.result.relations = [{ beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] }];
      value.result.events[1].participants = [{ name: request.stage === "event_plan" ? "Guard 3" : "Guard troops", role: null }];
    }
    if (request.stage === "event_review") {
      const input = JSON.parse(request.input);
      assert.deepEqual(input.rendered.playbackOrder, [0, 1, 2]);
      if (eventReviews++ === 0)
        value.events[1] = { ...value.events[1], verdict: "revise", reason: "Replace the malformed actor label with Guard troops." };
      else assert.equal(input.plan.events[1].participants[0].name, "Guard troops");
    }
    return value;
  });
  const iterator = generateScene("Synthetic repair budget regression", p, new AbortController().signal, {
    cache: new ResearchCache(),
  });
  const first = await iterator.next();
  assert.equal(first.value?.type, "focus");
  assert.equal(eventReviews, 2, "nothing is published until the repaired complete scene passes review");
  assert.equal(stages.filter((s) => s === "repair").length, 1);
  assert.equal(stages.filter((s) => s === "checklist").length, 2);
  const buffer = new SceneBuffer();
  buffer.ingest(first.value);
  for await (const message of iterator) buffer.ingest(message);
  assert.ok(buffer.complete);
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

test("eighteen fully populated events stay within protocol, duration and entity limits", () => {
  const p = plan();
  p.events = Array.from({ length: maxStoryEvents }, (_, index) => ({
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
  assert.equal(buffer.actions.filter((a) => a.type === "spawn").length, maxStoryEvents * 4);
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

test("the expanded record limit leaves batch capacity for long-role notes and every relation", () => {
  const p = plan();
  p.events = Array.from({ length: maxStoryEvents }, () => ({
    ...structuredClone(p.events[0]), title: "An event", statement: "A short occurrence.",
    qualification: "Note.", date: date(1300),
    participants: Array.from({ length: 3 }, () => ({ name: "N".repeat(40), role: "R".repeat(40) })),
  }));
  p.relations = Array.from({ length: 12 }, (_, index) => ({
    beforeIndex: index, afterIndex: maxStoryEvents - 1, kind: "before", passageIds: ["p1"],
  }));
  const compiled = compile(p), buffer = new SceneBuffer();
  compiled.messages.forEach((message) => buffer.ingest(message));
  assert.ok(buffer.complete && buffer.readyThrough <= 600);
  assert.ok(compiled.messages.every((message) => message.type !== "batch" || message.actions.length <= 100));
  assert.equal(compiled.events.flatMap((event) => event.participantNotes).length, maxStoryEvents * 3);
  assert.equal(compiled.events.flatMap((event) => event.relationText).length, 12);
  assert.throws(() => eventPlanSchema.parse({ result: { ...p, events: [...p.events, p.events[0]] } }));
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
