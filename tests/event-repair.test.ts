import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import { eventPlanSchema, maxStoryEvents } from "../src/lib/server/event-plan";
import { eventRepairSchema, repairReviewedEvents } from "../src/lib/server/event-repair";
import type { SceneProvider } from "../src/lib/server/scene-provider";
import { fixtureEventPlan } from "./fixtures/live-scene";

const original = () => eventPlanSchema.parse(structuredClone(fixtureEventPlan));
function correction() {
  const plan = original();
  if (plan.result.status !== "resolved") throw new Error();
  const { kind: _kind, ...replacement } = plan.result.events[0];
  return { status: "corrected" as const, edits: [{ index: 0, replacement: { ...replacement, kind: null } }],
    additions: [] as typeof plan.result.events, removals: [] as number[], order: [0, 1, 2],
    relations: null as typeof plan.result.relations | null, metadata: null };
}
function provider(output: unknown): SceneProvider {
  return { cacheIdentity: "event-patch-test", async research() { throw new Error(); },
    async generate(request) { return request.schema.parse(output); } };
}
const repair = (patch: unknown) => repairReviewedEvents(provider({ result: patch }),
  new AbortController().signal, original(), "{}", 6000);

test("semantic repair changes only indexed records and leaves supported records intact", async () => {
  const patch = correction();
  patch.edits[0].replacement.title = "A corrected title";
  const result = await repair(patch), before = original();
  assert.ok(result.result.status === "resolved" && before.result.status === "resolved");
  assert.equal(result.result.events[0].kind, before.result.events[0].kind);
  assert.equal(result.result.events[0].title, "A corrected title");
  assert.deepEqual(result.result.events.slice(1), before.result.events.slice(1));
});

test("an ordinary field correction can retain server-owned order without re-enumerating records", async () => {
  const patch = { ...correction(), order: null };
  patch.edits[0].replacement.title = "Corrected wording";
  const result = await repair(patch), before = original();
  assert.ok(result.result.status === "resolved" && before.result.status === "resolved");
  assert.equal(result.result.events.length, before.result.events.length);
  assert.deepEqual(result.result.events.slice(1), before.result.events.slice(1));
});

test("semantic edits cannot relabel an outcome or erase a previously supplied date", async () => {
  const kindPatch = correction();
  Object.assign(kindPatch.edits[0].replacement, { kind: "outcome" });
  await assert.rejects(repair(kindPatch));
  const datePatch = correction(); datePatch.edits[0].replacement.date = null;
  await assert.rejects(repair(datePatch), /cannot erase/);
});

test("a reviewed event may become a dated context state while outcomes stay protected", async () => {
  const patch = correction();
  const context = { ...patch, edits: [{ ...patch.edits[0], replacement: {
    ...patch.edits[0].replacement, kind: "context" as const,
  } }] };
  const result = await repair(context), before = original();
  assert.ok(result.result.status === "resolved" && before.result.status === "resolved");
  assert.equal(result.result.events[0].kind, "context");
  assert.deepEqual(result.result.events[0].date, before.result.events[0].date);
  before.result.events[0].kind = "outcome";
  await assert.rejects(repairReviewedEvents(provider({ result: context }), new AbortController().signal,
    before, "{}", 6000), /outcome or caveat cannot be relabeled/);
});

test("splitting a record remaps every relation and focus after server-owned reordering", async () => {
  const patch = correction(), plan = original();
  if (plan.result.status !== "resolved") throw new Error();
  patch.additions.push({ ...plan.result.events[0], title: "A separate occurrence" });
  patch.order = [0, 3, 1, 2];
  patch.relations = [{ beforeIndex: 3, afterIndex: 1, kind: "before", passageIds: ["p1"] }];
  const result = await repair(patch);
  assert.ok(result.result.status === "resolved");
  assert.equal(result.result.events[1].title, "A separate occurrence");
  assert.deepEqual(result.result.events[2], plan.result.events[1]);
  assert.deepEqual(result.result.relations, [{ beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] }]);
  assert.equal(result.result.events[result.result.focusEventIndex].title,
    plan.result.events[plan.result.focusEventIndex].title);
});

test("semantic patch order cannot duplicate, drop or invent existing records", async () => {
  for (const order of [[0, 0, 2], [0, 1, 3], [0, 1, 2, 3]])
    await assert.rejects(repair({ ...correction(), order }), /every retained and added event/);
  await assert.rejects(repair({ ...correction(), edits: [
    correction().edits[0], correction().edits[0],
  ] }), /distinct existing indices/);
  assert.equal(zodTextFormat(eventRepairSchema, "event_patch").strict, true);
});

test("a full eighteen-record plan can make room for an atomic split using explicit optional removals", async () => {
  const plan = original();
  if (plan.result.status !== "resolved") throw new Error();
  const initial = structuredClone(plan.result.events);
  plan.result.events = Array.from({ length: maxStoryEvents }, (_, i) => structuredClone(initial[i % initial.length]));
  const patch = { ...correction(), edits: [], additions: [initial[0]], removals: [maxStoryEvents - 1],
    order: [0, 1, 2, 3, maxStoryEvents, ...Array.from({ length: maxStoryEvents - 5 }, (_, i) => i + 4)],
    relations: [{ beforeIndex: maxStoryEvents, afterIndex: 4, kind: "before" as const, passageIds: ["p1"] }],
    metadata: { title: plan.result.title, location: plan.result.location, presentation: plan.result.presentation,
      focusEventIndex: maxStoryEvents },
  };
  const result = await repairReviewedEvents(provider({ result: patch }), new AbortController().signal,
    plan, "{}", 6000);
  assert.ok(result.result.status === "resolved");
  assert.equal(result.result.events.length, maxStoryEvents);
  assert.deepEqual(result.result.events.slice(0, 4), plan.result.events.slice(0, 4));
  assert.deepEqual(result.result.events[4], initial[0]);
  assert.equal(result.result.focusEventIndex, 4);
  assert.deepEqual(result.result.relations[0], { beforeIndex: 4, afterIndex: 5,
    kind: "before", passageIds: ["p1"] });
  assert.equal(plan.result.events.length, maxStoryEvents);
});

test("removals cannot silently invalidate focus, relations or edited indices", async () => {
  const patch = { ...correction(), edits: [], additions: [fixtureEventPlan.result.events[0]], order: null };
  await assert.rejects(repair({ ...patch, removals: [0] }), /focus and relations/);
  await assert.rejects(repair({ ...patch, removals: [1, 1] }), /distinct existing indices/);
  await assert.rejects(repair({ ...patch, removals: [1], relations: [
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
  ] }), /focus and relations/);
});
