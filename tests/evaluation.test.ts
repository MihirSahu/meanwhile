import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalSource,
  checkScene,
  estimatedCost,
  evaluationHtml,
  percentile,
  summarizeEvaluation,
  type EvaluationRun,
} from "../src/lib/server/evaluation";
const run: EvaluationRun = {
  caseId: "test",
  category: "test",
  strategy: "opening",
  cache: "cold",
  outcome: "complete",
  elapsedMs: 100,
  firstFocusMs: 80,
  firstBatchMs: 80,
  cacheHit: false,
  readyThrough: 36,
  deterministic: { pass: true, errors: [] },
  review: null,
  reviewError: null,
  verifiedSourceCount: 0,
  usage: [],
  reviewUsage: [],
  estimatedUsd: 0.05,
  reviewEstimatedUsd: 0.02,
  artifact: "test/opening-cold",
};
test("rate card includes cached tokens and each search call", () => {
  assert.equal(
    estimatedCost([
      {
        stage: "research",
        responseId: "x",
        model: "fixture",
        inputTokens: 1e6,
        cachedInputTokens: 5e5,
        outputTokens: 1e6,
        toolCalls: 2,
        searchCalls: 1,
        elapsedMs: 1,
      },
    ]),
    5.535,
  );
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([], 0.95), null);
});
test("unreviewed and failed attempts cannot inflate quality acceptance", () => {
  const accepted = {
    ...run,
    verifiedSourceCount: 1,
    review: {
      verdict: "pass",
      sourceSupport: "supported",
      chronology: "pass",
      requestCoverage: "pass",
      uncertainty: "appropriate",
      staging: "appropriate",
      issues: [],
      rationale: "supported",
    },
  } as EvaluationRun;
  const report = summarizeEvaluation([
    run,
    accepted,
    {
      ...run,
      outcome: "provider",
      deterministic: { pass: false, errors: ["failed"] },
    },
  ]);
  assert.equal(report.reviewPass, 1);
  assert.equal(report.reviewUnavailable, 1);
  assert.ok(Math.abs(report.estimatedCostPerAcceptedStory! - 0.21) < 1e-9);
});
test("reports escape model text and normalize source tracking parameters", () => {
  assert.equal(
    canonicalSource("https://example.org/a/?utm_source=test#section"),
    "https://example.org/a",
  );
  const html = evaluationHtml({
    model: "<script>bad</script>",
    effort: "low",
    createdAt: "today",
    runs: [run],
    summary: summarizeEvaluation([run]),
  });
  assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(!html.includes("<script>bad"));
});
test("expected clarification and missing completed scenes are scored honestly", () => {
  const fixture = {
    id: "ambiguous",
    category: "ambiguity",
    prompt: "the war",
    expected: "clarification",
    years: null,
    checks: [],
    references: [],
  } as const;
  assert.equal(
    checkScene({ ...fixture, checks: [], references: [] }, [], "clarification")
      .pass,
    true,
  );
  assert.equal(
    checkScene(
      { ...fixture, expected: "resolved", checks: [], references: [] },
      [],
      "complete",
    ).pass,
    false,
  );
});

test("reference coverage cannot pass while omitting required historical anchors", async () => {
  const { readFile } = await import("node:fs/promises");
  const { referenceSetSchema, checkReferenceCoverage } = await import(
    "../src/lib/server/reference-stories"
  );
  const set = referenceSetSchema.parse(
    JSON.parse(await readFile("evals/reference-stories.json", "utf8")),
  );
  assert.equal(set.stories.length, 5);
  assert.ok(
    set.stories.every((story) => story.review.humanReview === "pending"),
  );
  const story = set.stories.find((story) => story.caseId === "waterloo")!;
  const checks = [
    ...story.facts.map((f) => ({
      id: f.id,
      status: "addressed" as const,
      reason: "Covered.",
    })),
    ...story.guards.map((_, i) => ({
      id: `guard-${i + 1}`,
      status: "addressed" as const,
      reason: "Respected.",
    })),
  ];
  assert.deepEqual(checkReferenceCoverage(story, checks), []);
  assert.ok(checkReferenceCoverage(story, checks.slice(1)).length);
  assert.ok(
    checkReferenceCoverage(
      story,
      checks.map((c, i) => (i === 0 ? { ...c, status: "not_required" } : c)),
    ).length,
  );
});
