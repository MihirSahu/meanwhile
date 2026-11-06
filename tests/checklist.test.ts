import assert from "node:assert/strict";
import test from "node:test";
import {
  storyChecklistSchema,
  checkStoryChecklist,
  checkChecklistPlan,
  checkTemporalReview,
  type TemporalCheck,
} from "../src/lib/server/story-checklist";
import {
  fixtureChecklist,
  fixtureClaim,
  fixturePassage,
  fixtureRequirements,
  batchOutput,
  evidenceUrl,
} from "./fixtures/live-scene";
import type { SceneAction } from "../src/lib/scene-schema";

const research = {
  text: "Discovery only",
  sources: [{ id: "s1", title: "Fixture", url: evidenceUrl }],
  passages: [fixturePassage],
};
const checklist = storyChecklistSchema.parse(fixtureChecklist);
test("a scene planner cannot remove or weaken a frozen outcome requirement", () => {
  assert.equal(checklist.result.status, "ready");
  if (checklist.result.status !== "ready") return;
  assert.doesNotThrow(() =>
    checkChecklistPlan(fixtureRequirements as any, checklist.result as any),
  );
  assert.doesNotThrow(() =>
    checkChecklistPlan(
      [...fixtureRequirements, { ...fixtureRequirements[0], id: "r4" }] as any,
      checklist.result as any,
    ),
  );
  for (const altered of [
    fixtureRequirements.slice(0, 2),
    fixtureRequirements.map((r) =>
      r.kind === "outcome" ? { ...r, description: "A generic success." } : r,
    ),
    fixtureRequirements.map((r) =>
      r.kind === "outcome" ? { ...r, claimIds: ["c2"] } : r,
    ),
  ])
    assert.throws(
      () => checkChecklistPlan(altered as any, checklist.result as any),
      /frozen checklist/,
    );
});

test("checklist facts and temporal relations need fetched evidence and an acyclic order", () => {
  assert.doesNotThrow(() => checkStoryChecklist(checklist, research));
  const ready = checklist.result;
  if (ready.status !== "ready") return;
  const withOrder = {
    claims: [fixtureClaim, { ...fixtureClaim, id: "c2" }],
    result: {
      ...ready,
      requirements: ready.requirements.map((r) => ({
        ...r,
        claimIds: ["c1", "c2"],
      })),
      relations: [
        {
          id: "t1",
          beforeClaimId: "c1",
          afterClaimId: "c2",
          passageIds: ["p1"],
          qualification: null,
        },
      ],
    },
  };
  assert.doesNotThrow(() =>
    checkStoryChecklist(storyChecklistSchema.parse(withOrder), research),
  );
  for (const relations of [
    [{ ...withOrder.result.relations[0], passageIds: ["p99"] }],
    [{ ...withOrder.result.relations[0], afterClaimId: "c1" }],
    [
      ...withOrder.result.relations,
      {
        ...withOrder.result.relations[0],
        id: "t2",
        beforeClaimId: "c2",
        afterClaimId: "c1",
      },
    ],
  ])
    assert.throws(() =>
      checkStoryChecklist(
        storyChecklistSchema.parse({
          ...withOrder,
          result: { ...withOrder.result, relations },
        }),
        research,
      ),
    );
});

const relation = {
  id: "t1",
  beforeClaimId: "c1",
  afterClaimId: "c2",
  passageIds: ["p1"],
  qualification: "The continuation precedes the later death on the same day.",
};
const both = {
  ...batchOutput(2).actions[0],
  claimIds: ["c1", "c2"],
} as SceneAction;
const consistent: TemporalCheck = {
  id: "t1",
  support: "supported",
  status: "consistent",
  actionIds: [both.id],
  reason: "Explicitly ordered text.",
};
const context = {
  relations: [relation],
  ordered: [],
  committedActions: [],
  final: true,
};
test("same-day ordering must be reviewed even when individual dates and coverage pass", () => {
  assert.doesNotThrow(() => checkTemporalReview([consistent], [both], context));
  for (const checks of [
    [],
    [consistent, consistent],
    [{ ...consistent, status: "pending", actionIds: [] }],
    [{ ...consistent, support: "unsupported" }],
    [
      {
        ...consistent,
        status: "revise",
        reason:
          "The party continued before Huskisson later died, but the caption implies the reverse.",
      },
    ],
    [{ ...consistent, actionIds: ["planned_outline"] }],
  ] as TemporalCheck[][])
    assert.throws(() => checkTemporalReview(checks, [both], context));
  assert.throws(
    () =>
      checkTemporalReview(
        [consistent],
        [{ ...both, claimIds: ["c1"] }],
        context,
      ),
    /both event claims/,
  );
});
test("future temporal relations can remain pending and committed order cannot disappear", () => {
  const pending: TemporalCheck = {
    ...consistent,
    status: "pending",
    actionIds: [],
  };
  assert.doesNotThrow(() =>
    checkTemporalReview([pending], [], { ...context, final: false }),
  );
  assert.throws(
    () =>
      checkTemporalReview([pending], [], {
        ...context,
        final: false,
        ordered: [consistent],
        committedActions: [both],
      }),
    /Preserve committed/,
  );
  assert.doesNotThrow(() =>
    checkTemporalReview([consistent], [], {
      ...context,
      ordered: [consistent],
      committedActions: [both],
    }),
  );
});

test("checklist source review rejects unsupported premises and incomplete evidence before freezing", async () => {
  const { checkChecklistReview, checklistReviewSchema } =
    await import("../src/lib/server/checklist-review");
  const ready = checklist.result;
  if (ready.status !== "ready") return;
  const supported = checklistReviewSchema.parse({
    missingEvidence: [],
    claims: checklist.claims.map((c) => ({
      id: c.id,
      verdict: "supported",
      passageIds: c.passageIds,
      reason: "Fixture support.",
    })),
    requirements: ready.requirements.map((r) => ({
      id: r.id,
      verdict: "supported",
      reason: "Fixture support.",
    })),
    relations: [],
    scope: { verdict: "supported", reason: "Fixture scope." },
  });
  assert.doesNotThrow(() => checkChecklistReview(supported, checklist));
  for (const patch of [
    { missingEvidence: ["What source establishes the event order?"] },
    { requirements: [] },
    {
      scope: {
        verdict: "revise",
        reason: "Subdued mood does not establish a subdued reception.",
      },
    },
    { claims: [{ ...supported.claims[0], passageIds: ["p99"] }] },
  ])
    assert.throws(() =>
      checkChecklistReview(
        checklistReviewSchema.parse({ ...supported, ...patch }),
        checklist,
      ),
    );
});

test("temporal source review receives the complete fetched evidence of both event claims", () => {
  const candidate = storyChecklistSchema.parse(fixtureChecklist);
  if (candidate.result.status !== "ready") return;
  candidate.claims = [
    { ...fixtureClaim, passageIds: ["p1"] },
    { ...fixtureClaim, id: "c2", passageIds: ["p2"] },
  ];
  candidate.result.requirements = candidate.result.requirements.map((r) => ({
    ...r,
    claimIds: ["c1", "c2"],
  }));
  candidate.result.relations = [
    {
      id: "t1",
      beforeClaimId: "c1",
      afterClaimId: "c2",
      passageIds: ["p1"],
      qualification: null,
    },
  ];
  checkStoryChecklist(candidate, {
    ...research,
    passages: [fixturePassage, { ...fixturePassage, id: "p2" }],
  });
  assert.deepEqual(candidate.result.relations[0].passageIds, ["p1", "p2"]);
});
