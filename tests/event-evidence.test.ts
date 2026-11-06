import { evidenceSchema } from "../src/lib/server/scene-preparation";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import saved from "./fixtures/event-failures.json";
import {
  eventPlanSchema,
  type ResolvedEventPlan,
} from "../src/lib/server/event-plan";
import { storyChecklistSchema } from "../src/lib/server/story-checklist";
import { compileEventPlan } from "../src/lib/server/event-compiler";
import {
  checkEventReview,
  reviewCompiledEvents,
  eventReviewSchema,
} from "../src/lib/server/event-review";
import type { SceneProvider } from "../src/lib/server/scene-provider";

function replay(name: keyof typeof saved) {
  const f = structuredClone(saved[name]);
  const parsed = eventPlanSchema.parse({
    result: {
      ...f.plan,
      focusEventIndex:
        f.plan.events.findIndex((e) => e.date?.start.day === 18) < 0
          ? 0
          : f.plan.events.findIndex((e) => e.date?.start.day === 18),
      events: f.plan.events.map((e) => ({ ...e, qualification: null })),
    },
  }).result;
  if (parsed.status !== "resolved") throw new Error();
  return {
    plan: parsed,
    checklist: storyChecklistSchema.parse(f.checklist),
    research: evidenceSchema.parse(f.research),
    recordedReview: f.recordedReview,
  };
}
function supported(
  p: ResolvedEventPlan,
  c: ReturnType<typeof storyChecklistSchema.parse>,
) {
  const ok = {
    verdict: "supported",
    reason: "Mocked semantic verdict; not historical certification.",
  };
  return eventReviewSchema.parse({
    events: p.events.map((e, index) => ({
      index,
      ...ok,
      passageIds: [
        ...new Set(e.claimIndices.flatMap((i) => c.claims[i].passageIds)),
      ],
    })),
    requirements:
      c.result.status === "ready"
        ? c.result.requirements.map((_, index) => ({ index, ...ok }))
        : [],
    relations: p.relations.map((r, index) => ({
      index,
      ...ok,
      passageIds: r.passageIds,
    })),
    metadata: ok,
    chronology: ok,
  });
}

test("saved Apollo recovery combines location and recovery evidence with exact citation unions", async () => {
  const f = replay("apollo-earth");
  f.plan.events[9].claimIndices = [4, 5];
  const compiled = compileEventPlan(f.plan, f.checklist, f.research),
    e = compiled.events.find((e) => e.index === 9)!;
  assert.deepEqual(e.claimIds, ["c5", "c6"]);
  const speech = compiled.messages
    .flatMap((m) => (m.type === "batch" ? m.actions : []))
    .find((a) => a.type === "speech" && a.id.endsWith("ev_9_speech"));
  assert.ok(speech?.type === "speech");
  assert.deepEqual(speech.claimIds, e.claimIds);
  const expected = [
    ...new Set(
      f.research.passages
        .filter((p) => ["p9", "p13"].includes(p.id))
        .map((p) => p.sourceId),
    ),
  ].sort();
  assert.deepEqual([...speech.sourceIds!].sort(), expected);
  const verdict = supported(f.plan, f.checklist);
  verdict.events[9].passageIds = ["p9", "p13"];
  checkEventReview(verdict, f.plan, f.checklist);
  verdict.events[9].passageIds = ["p99"];
  assert.throws(
    () => checkEventReview(verdict, f.plan, f.checklist),
    /own passages/,
  );
  let received: any;
  const provider: SceneProvider = {
    cacheIdentity: "saved-apollo",
    async research() {
      return f.research;
    },
    async generate(r) {
      received = JSON.parse(r.input);
      return r.schema.parse(supported(f.plan, f.checklist));
    },
  };
  await reviewCompiledEvents(provider, new AbortController().signal, {
    prompt: "Apollo",
    ...f,
    compiled,
  });
  assert.deepEqual(
    received.rendered.events[9].sourceClaims.map((c: any) => c.id),
    ["c5", "c6"],
  );
});

test("multiple claims reject duplicate/unknown selections and unsupported date gaps", () => {
  const f = replay("apollo-earth");
  f.plan.events[9].claimIndices = [4, 4];
  assert.throws(
    () => compileEventPlan(f.plan, f.checklist, f.research),
    /distinct/,
  );
  f.plan.events[9].claimIndices = [4, 7];
  assert.throws(
    () => compileEventPlan(f.plan, f.checklist, f.research),
    /unknown/,
  );
  f.plan.events[9].claimIndices = [4, 5];
  f.checklist.claims[4].yearRange = {
    startYear: 1960,
    endYear: 1962,
    approximate: false,
  };
  f.checklist.claims[5].yearRange = {
    startYear: 1970,
    endYear: 1972,
    approximate: false,
  };
  // Other records also reference these claims. Test the gap at the first shared record.
  f.plan.events[8].claimIndices = [4, 5];
  assert.throws(
    () => compileEventPlan(f.plan, f.checklist, f.research),
    /unsupported gap/,
  );
  assert.throws(() =>
    eventPlanSchema.parse({
      result: {
        ...f.plan,
        events: f.plan.events.map((e, i) =>
          i ? e : { ...e, claimIndices: [] },
        ),
      },
    }),
  );
});

test("saved Railway year headings contain their precise dates while semantic failures still block review", async () => {
  const f = replay("railway-1830"),
    compiled = compileEventPlan(f.plan, f.checklist, f.research);
  assert.equal(
    compiled.structuralValidation.dates.length,
    f.plan.events.length,
  );
  for (const d of compiled.structuralValidation.dates) {
    assert.equal(d.heading, "1830");
    assert.ok(d.contained);
    if (d.eventWindow) {
      assert.ok(d.chapterWindow.start <= d.eventWindow.start);
      assert.ok(d.chapterWindow.end >= d.eventWindow.end);
    }
  }
  let captured: any;
  const provider: SceneProvider = {
    cacheIdentity: "saved-railway",
    async research() {
      return f.research;
    },
    async generate(r) {
      captured = { input: JSON.parse(r.input), instructions: r.instructions };
      const v = supported(f.plan, f.checklist);
      v.events[1] = {
        ...v.events[1],
        verdict: "revise",
        reason: "Corrupted participant roles in saved record.",
      };
      return r.schema.parse(v);
    },
  };
  await assert.rejects(
    () =>
      reviewCompiledEvents(provider, new AbortController().signal, {
        prompt: "Railway",
        ...f,
        compiled,
      }),
    /Corrupted participant roles/,
  );
  assert.equal(captured.input.structuralValidation.protocol, "valid");
  assert.equal(captured.input.structuralValidation.citations, "valid");
  assert.match(captured.instructions, /1830 contains 15 September 1830/);
  const wrong = structuredClone(f.plan);
  wrong.events[1].statement = "On 15 September 1831, the procession began.";
  assert.throws(
    () => compileEventPlan(wrong, f.checklist, f.research),
    /outside the visible heading/,
  );
});

test("Waterloo disputed-location regression preserves qualification and reviewer veto", async () => {
  const f = replay("waterloo");
  assert.equal(saved.waterloo.audit?.verdict, "needs_review");
  // Synthetic disagreement receipt models the saved audit finding; it is not a newly fetched historical source.
  const text =
    "Accounts differ on the meeting location. La Belle Alliance is the traditional location, while another account suggests a different site.";
  const id = Array.from({ length: 99 }, (_, i) => `p${i + 1}`).find(
    (id) => !f.research.passages.some((p) => p.id === id),
  )!;
  f.research.passages.push({
    ...f.research.passages[0],
    id,
    text,
    start: 0,
    end: text.length,
    documentHash: createHash("sha256").update(text).digest("hex"),
  });
  f.checklist.claims.push({
    id: "c7",
    text,
    passageIds: [id],
    yearRange: { startYear: 1815, endYear: 1815, approximate: false },
    certainty: "contested",
  });
  const meeting = f.plan.events.findIndex((e) =>
    e.statement.includes("met Blücher"),
  );
  assert.ok(meeting >= 0);
  f.plan.events[meeting].claimIndices.push(6);
  f.plan.events[meeting].qualification =
    "Accounts differ on the precise location.";
  let calls = 0;
  const provider: SceneProvider = {
    cacheIdentity: "saved-waterloo",
    async research() {
      return f.research;
    },
    async generate(r) {
      const body = JSON.parse(r.input);
      const v = supported(f.plan, f.checklist);
      if (!body.rendered.events[meeting].statement.includes("traditionally"))
        v.events[meeting] = {
          ...v.events[meeting],
          verdict: "revise",
          reason: "Disputed meeting location is presented as certain.",
        };
      calls++;
      return r.schema.parse(v);
    },
  };
  await assert.rejects(
    () =>
      reviewCompiledEvents(provider, new AbortController().signal, {
        prompt: "Waterloo",
        ...f,
        compiled: compileEventPlan(f.plan, f.checklist, f.research),
      }),
    /Disputed meeting location/,
  );
  f.plan.events[meeting].statement =
    "Wellington met Blücher at a location traditionally identified as La Belle Alliance; accounts differ. Coalition forces had defeated Napoleon.";
  const compiled = compileEventPlan(f.plan, f.checklist, f.research);
  assert.match(
    compiled.events.find((e) => e.index === meeting)!.statement,
    /traditionally/,
  );
  await reviewCompiledEvents(provider, new AbortController().signal, {
    prompt: "Waterloo",
    ...f,
    compiled,
  });
  assert.equal(calls, 2);
});
