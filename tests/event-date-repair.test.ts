import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import { compileEventPlan, EventDateEvidenceError } from "../src/lib/server/event-compiler";
import { eventPlanSchema, type EventDate, type EventPlan, type ResolvedEventPlan } from "../src/lib/server/event-plan";
import { eventDateRepairSchema, outcomeTimingRepairSchema, repairEventDate } from "../src/lib/server/event-date-repair";
import { storyChecklistSchema } from "../src/lib/server/story-checklist";
import type { GenerationRequest, SceneProvider } from "../src/lib/server/scene-provider";
import { fixtureEventPlan, fixtureChecklist, fixturePassage } from "./fixtures/live-scene";

const date = (year: number): EventDate => ({
  start: { year, month: null, day: null },
  end: { year, month: null, day: null },
  approximate: true,
  zone: null,
});

function fixture() {
  const candidate = eventPlanSchema.parse(structuredClone(fixtureEventPlan));
  if (candidate.result.status !== "resolved") throw new Error();
  const plan = candidate.result;
  plan.events.push(...structuredClone(plan.events));
  plan.events[5].date = date(1400);
  return {
    candidate,
    plan,
    checklist: storyChecklistSchema.parse(structuredClone(fixtureChecklist)),
    research: {
      text: "Synthetic date-repair fixture, not historical verification.",
      sources: [{ id: "s1", title: "Fixture", url: "https://example.org/history/silk-roads" }],
      passages: [fixturePassage],
    },
  };
}

function provider(output: unknown, inspect?: (request: GenerationRequest<unknown>) => void): SceneProvider {
  return {
    cacheIdentity: "date-repair-test",
    async research() { throw new Error("A date repair cannot replace frozen evidence."); },
    async generate<T>(request: GenerationRequest<T>) {
      inspect?.(request);
      return request.schema.parse(output);
    },
  };
}

test("date-range errors identify the occurrence, requested date and selected frozen bounds", () => {
  const f = fixture();
  assert.throws(() => compileEventPlan(f.plan, f.checklist, f.research), (error: unknown) => {
    assert.ok(error instanceof EventDateEvidenceError);
    assert.equal(error.eventIndex, 5);
    assert.deepEqual(error.requestedDate, date(1400));
    assert.deepEqual(error.selectedClaims, [{
      claimIndex: 0,
      id: "c1",
      yearRange: fixtureChecklist.claims[0].yearRange,
    }]);
    return true;
  });
});

test("a date repair changes only the selected occurrence's date and supporting claim indices", async () => {
  const f = fixture();
  const original = structuredClone(f.candidate);
  const p = provider({ result: { status: "corrected", date: date(1300), claimIndices: [0] } }, (request) => {
    assert.equal(request.stage, "repair");
    assert.match(request.instructions, /Never remove a date/);
  });
  const corrected = await repairEventDate(p, new AbortController().signal, f.candidate, 5, "{}", 6000);
  const expected = structuredClone(original);
  (expected.result as ResolvedEventPlan).events[5].date = date(1300);
  assert.deepEqual(corrected, expected);
  assert.deepEqual(f.candidate, original);
  assert.ok(corrected.result.status === "resolved");
  assert.equal(corrected.result.events[5].kind, f.plan.events[5].kind);
  compileEventPlan(corrected.result, f.checklist, f.research);
});

for (const patch of [
  { date: null, claimIndices: [0] },
  { date: date(1300), claimIndices: [0], kind: "context" },
  { date: date(1300), claimIndices: [0], statement: "A rewritten occurrence." },
]) test("date repair rejects an undated or narrative rewrite: " + JSON.stringify(patch), async () => {
  const f = fixture();
  await assert.rejects(repairEventDate(
    provider({ result: { status: "corrected", ...patch } }),
    new AbortController().signal, f.candidate, 5, "{}", 6000,
  ));
  assert.deepEqual(f.plan.events[5].date, date(1400));
});

test("date repair can select different frozen evidence but cannot mutate the rest of the event", async () => {
  const f = fixture();
  const corrected = await repairEventDate(
    provider({ result: { status: "corrected", date: date(1400), claimIndices: [1] } }),
    new AbortController().signal, f.candidate, 5, "{}", 6000,
  );
  assert.equal(corrected.result.status, "resolved");
  if (corrected.result.status !== "resolved") return;
  assert.deepEqual(corrected.result.events[5], { ...f.plan.events[5], claimIndices: [1] });
});

test("missing date evidence returns a clarification without hiding the occurrence as context", async () => {
  const f = fixture();
  const output = { result: { status: "clarification", question: "The sources do not establish this event’s date." } };
  assert.deepEqual(await repairEventDate(
    provider(output), new AbortController().signal, f.candidate, 5, "{}", 6000,
  ), { result: { ...output.result, reason: "missing_evidence" } });
});

test("the provider-facing correction schema requires a non-null date and permits no event-kind patch", () => {
  const format = zodTextFormat(eventDateRepairSchema, "meanwhile_repair");
  assert.equal(format.strict, true);
  assert.equal(eventDateRepairSchema.safeParse({
    result: { status: "corrected", date: null, claimIndices: [0] },
  }).success, false);
});

test("a missing event date uses the constrained date patch and cannot be relabeled as context", async () => {
  const f = fixture();
  f.plan.events[5].date = null;
  await assert.rejects(repairEventDate(provider({ result: {
    status: "relative_outcome", afterEventIndex: 1, passageIds: ["p1"],
  } }), new AbortController().signal, f.candidate, 5, "{}", 6000));
  const corrected = await repairEventDate(provider({ result: {
    status: "corrected", date: date(1300), claimIndices: [0],
  } }), new AbortController().signal, f.candidate, 5, "{}", 6000);
  assert.ok(corrected.result.status === "resolved");
  assert.equal(corrected.result.events[5].kind, f.plan.events[5].kind);
  assert.deepEqual(corrected.result.events[5].date, date(1300));
});

test("a rejected dated outcome cannot downgrade to relative or undated aftermath", async () => {
  const f = fixture();
  f.plan.events[5].kind = "outcome";
  await assert.rejects(repairEventDate(provider({ result: {
    status: "relative_outcome", afterEventIndex: 1, passageIds: ["p1"],
  } }), new AbortController().signal, f.candidate, 5, "{}", 6000));
});

test("only an initially undated outcome can add a relative placement while preserving the complete plan", async () => {
  const f = fixture();
  f.plan.events[5].kind = "outcome";
  f.plan.events[5].date = null;
  const original = structuredClone(f.candidate);
  const corrected = await repairEventDate(provider({ result: {
    status: "relative_outcome", afterEventIndex: 4, passageIds: ["p1"],
  } }), new AbortController().signal, f.candidate, 5, "{}", 6000);
  assert.ok(corrected.result.status === "resolved");
  assert.deepEqual(corrected.result.events, f.plan.events);
  assert.deepEqual(corrected.result.relations, [{
    beforeIndex: 4, afterIndex: 5, kind: "before", passageIds: ["p1"],
  }]);
  assert.deepEqual(f.candidate, original);
  assert.ok(zodTextFormat(outcomeTimingRepairSchema, "outcome_timing").strict);
  compileEventPlan(corrected.result, f.checklist, f.research);
});

test("cancellation after a date correction prevents application of the patch", async () => {
  const f = fixture();
  const original = structuredClone(f.candidate);
  const controller = new AbortController();
  const p = provider(
    { result: { status: "corrected", date: date(1300), claimIndices: [0] } },
    () => controller.abort(),
  );
  await assert.rejects(
    repairEventDate(p, controller.signal, f.candidate, 5, "{}", 6000),
    { name: "AbortError" },
  );
  assert.deepEqual(f.candidate, original);
});
