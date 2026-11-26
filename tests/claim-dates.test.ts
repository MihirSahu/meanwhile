import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { maxChecklistClaims } from "../src/lib/evidence-schema";
import { essentialChecklistSchema, normalizeEssentialChecklist } from "../src/lib/server/essential-checklist";
import { ChecklistDateError, checkStoryChecklist, storyChecklistSchema, type StoryChecklist } from "../src/lib/server/story-checklist";
import { eventDateRepairSchema } from "../src/lib/server/event-date-repair";
import { compileEventPlan, EventDateEvidenceError } from "../src/lib/server/event-compiler";
import { eventPlanSchema, type ResolvedEventPlan } from "../src/lib/server/event-plan";
import { prepareSceneEvidence } from "../src/lib/server/scene-preparation";
import { checkChecklistReview, checklistReviewSchema } from "../src/lib/server/checklist-review";
import type { GenerationRequest, SceneProvider } from "../src/lib/server/scene-provider";
import { ResearchCache } from "../src/lib/server/research-cache";
import { essentialFixture, fixtureChecklist, fixtureEventPlan, fixturePassage } from "./fixtures/live-scene";

// Synthetic receipts test temporal metadata and repair flow, not historical accuracy.
const text = "In September 1848 an army entered the region. A defense committee led by Mira was formed. The army later withdrew in 1848.";
const research = {
  text: "Synthetic evidence",
  sources: [{ id: "s1", title: "Synthetic receipt", url: "https://example.org/synthetic" }],
  passages: [{
    ...fixturePassage,
    text,
    end: text.length,
    documentHash: createHash("sha256").update(text).digest("hex"),
  }],
};
const year = { startYear: 1848, endYear: 1848, approximate: false };
const claim = (id: string, statement: string, dated = true) => ({
  id, text: statement, passageIds: ["p1"], yearRange: dated ? year : null,
  certainty: "established" as const,
});

function candidate(split = false) {
  return {
    claims: [
      claim("c1", split
        ? "In September 1848 an army entered the region."
        : "In September 1848 an army entered the region and a defense committee led by Mira was formed."),
      claim("c2", "The army withdrew in 1848."),
      ...(split ? [claim("c3", "A defense committee led by Mira was formed.", false)] : []),
    ],
    result: {
      status: "ready" as const,
      essentials: {
        context: { description: "Describe the invasion.", claimIds: ["c1"] },
        actors: { description: "Identify Mira as committee leader.", claimIds: [split ? "c3" : "c1"] },
        outcome: { description: "Describe the army's withdrawal.", claimIds: ["c2"] },
      },
      additional: [],
    },
  };
}

test("a compound claim cannot retain a dated occurrence while erasing its year bounds", () => {
  const value = candidate();
  value.claims[0].yearRange = null;
  const normalized = normalizeEssentialChecklist(essentialChecklistSchema.parse(value));
  assert.throws(() => checkStoryChecklist(normalized, research), (error: unknown) => {
    assert.ok(error instanceof ChecklistDateError);
    assert.deepEqual(error.claimIds, ["c1"]);
    assert.match(error.message, /Split mixed dated and undated assertions/);
    return true;
  });
});

test("split claims retain the dated occurrence, truly undated fact, and requirement links", () => {
  const normalized = normalizeEssentialChecklist(essentialChecklistSchema.parse(candidate(true)));
  checkStoryChecklist(normalized, research);
  assert.deepEqual(normalized.claims[0].yearRange, year);
  assert.equal(normalized.claims[2].yearRange, null);
  assert.ok(normalized.result.status === "ready");
  assert.deepEqual(normalized.result.requirements[1].claimIds, ["c3"]);
});

test("quantity counts and genuinely undated context do not become historical dates", () => {
  for (const statement of [
    "A force of 1848 soldiers guarded the region.",
    "A force of 1848 fighters guarded the region.",
    "The town consisted of 1848 houses.",
    "A convoy carried 1300–1400 tons of supplies.",
    "A committee coordinated the defense.",
  ]) {
    const value = normalizeEssentialChecklist(essentialChecklistSchema.parse(candidate(true)));
    value.claims[2].text = statement;
    assert.doesNotThrow(() => checkStoryChecklist(value, research), statement);
  }
});

test("explicit years, full dates, ranges and era labels require temporal metadata", () => {
  for (const statement of [
    "The invasion began in September 1848.",
    "The campaign continued during 1848.",
    "1848–1849: the campaign continued.",
    "The operation ended in 44 BCE.",
  ]) {
    const value = normalizeEssentialChecklist(essentialChecklistSchema.parse(candidate(true)));
    value.claims[2].text = statement;
    assert.throws(() => checkStoryChecklist(value, research), ChecklistDateError, statement);
  }
});

test("all checklist and event schemas support splitting into the bounded eighteen-claim ledger", () => {
  const raw = essentialFixture();
  raw.claims = Array.from({ length: maxChecklistClaims }, (_, index) => ({
    ...fixtureChecklist.claims[0], id: `c${index + 1}`,
  }));
  const checklist = normalizeEssentialChecklist(essentialChecklistSchema.parse(raw));
  storyChecklistSchema.parse(checklist);
  checkStoryChecklist(checklist, { ...research, passages: [fixturePassage] });
  if (checklist.result.status !== "ready") throw new Error();
  checklist.result.requirements.forEach((requirement) => { requirement.claimIds = [`c${maxChecklistClaims}`]; });
  checkChecklistReview(checklistReviewSchema.parse({
    missingEvidence: [],
    claims: checklist.claims.map((c) => ({ id: c.id, verdict: "supported", passageIds: c.passageIds, reason: "Synthetic support." })),
    requirements: checklist.result.requirements.map((r) => ({ id: r.id, verdict: "supported", reason: "Synthetic support." })),
    relations: [],
    scope: { verdict: "supported", reason: "Synthetic scope." },
  }), checklist);
  const plan = eventPlanSchema.parse(structuredClone(fixtureEventPlan)).result as ResolvedEventPlan;
  plan.events.forEach((event) => { event.claimIndices = [maxChecklistClaims - 1]; });
  compileEventPlan(eventPlanSchema.parse({ result: plan }).result as ResolvedEventPlan, checklist, {
    ...research, passages: [fixturePassage],
  });
  const patch = {
    result: { status: "corrected", date: plan.events[0].date, claimIndices: [maxChecklistClaims - 1] },
  };
  assert.ok(eventDateRepairSchema.safeParse(patch).success);
  patch.result.claimIndices = [maxChecklistClaims];
  assert.equal(eventDateRepairSchema.safeParse(patch).success, false);
  raw.claims.push({ ...raw.claims[0], id: `c${maxChecklistClaims + 1}` });
  assert.equal(essentialChecklistSchema.safeParse(raw).success, false);
});

test("a date-losing checklist repair gets corrected before review or freezing", async () => {
  let extractions = 0;
  const reviews: StoryChecklist[] = [];
  const repairs: any[] = [];
  const provider: SceneProvider = {
    cacheIdentity: "synthetic-claim-dates",
    async research() { return research; },
    async generate<T>(request: GenerationRequest<T>) {
      const input = JSON.parse(request.input);
      if (request.stage === "checklist") {
        extractions++;
        repairs.push(input.repair);
        const value = candidate(extractions === 3);
        if (extractions === 2) value.claims[0].yearRange = null;
        return request.schema.parse(value);
      }
      assert.equal(request.stage, "checklist_review");
      const checklist: StoryChecklist = input.checklist;
      assert.notEqual(checklist.claims[0].yearRange, null);
      reviews.push(checklist);
      if (checklist.result.status !== "ready") throw new Error();
      const verdict = {
        missingEvidence: [],
        claims: checklist.claims.map((c, index) => ({
          id: c.id,
          verdict: reviews.length === 1 && index === 0 ? "revise" : "supported",
          passageIds: c.passageIds,
          reason: reviews.length === 1 && index === 0
            ? "The invasion is dated September, but the committee appointment is not. Split the facts."
            : "Synthetic support.",
        })),
        requirements: checklist.result.requirements.map((r) => ({ id: r.id, verdict: "supported", reason: "Synthetic support." })),
        relations: [],
        scope: { verdict: "supported", reason: "Synthetic scope." },
      };
      return request.schema.parse(verdict);
    },
  };
  const prepared = await prepareSceneEvidence(
    "Synthetic mixed-date story", provider, new AbortController().signal,
    { cache: new ResearchCache() }, ["event_plan", "event_review"], true,
  );
  assert.equal(extractions, 3);
  assert.equal(reviews.length, 2);
  assert.equal(prepared.prepared.claims.length, 3);
  assert.deepEqual(prepared.prepared.claims[0].yearRange, year);
  assert.equal(prepared.prepared.claims[2].yearRange, null);
  assert.match(repairs[2].issues, /yearRange=null/);
  assert.match(repairs[2].earlierIssues[0], /committee appointment/);
  const plan = structuredClone(fixtureEventPlan).result;
  plan.events.forEach((event, index) => {
    event.date = { start: { year: 1848, month: null, day: null }, end: { year: 1848, month: null, day: null }, approximate: false, zone: null };
    event.claimIndices = index === 0 ? [0, 2] : [1];
    event.statement = index === 0 ? "The invasion occurred; Mira led a defense committee." : "The army withdrew.";
  });
  compileEventPlan(plan, prepared.prepared, research);
  plan.events[0].claimIndices = [2];
  assert.throws(() => compileEventPlan(plan, prepared.prepared, research), EventDateEvidenceError);
});
