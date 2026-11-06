import assert from "node:assert/strict";
import test from "node:test";
import {
  SceneRequestBudget,
  reserveFor,
  stageAllowances,
  type BudgetStage,
} from "../src/lib/server/scene-budget";
import { mergeRecoveryResearch } from "../src/lib/server/evidence-recovery";
import { checkedClaimLedger } from "../src/lib/evidence-schema";
import { fixturePassage, evidenceUrl } from "./fixtures/live-scene";

test("the previously exhausted railway workload retains capacity for its thirteenth final review", () => {
  const b = new SceneRequestBudget();
  const input = [
    21391, 7495, 7736, 8564, 7847, 11034, 10216, 12805, 10225, 11641, 11042,
    11950, 12000,
  ];
  const stages: BudgetStage[] = [
    "research",
    "checklist",
    "checklist_review",
    "checklist",
    "checklist_review",
    "opening",
    "evidence_review",
    "opening",
    "evidence_review",
    "batch",
    "evidence_review",
    "batch",
    "evidence_review",
  ];
  const scene: BudgetStage[] = [
    "opening",
    "evidence_review",
    "batch",
    "evidence_review",
    "batch",
    "evidence_review",
  ];
  const remaining: BudgetStage[][] = [
    ["checklist", "checklist_review", ...scene],
    ["checklist_review", ...scene],
    scene,
    ["checklist_review", ...scene],
    scene,
    scene.slice(1),
    scene.slice(2),
    scene.slice(1),
    scene.slice(2),
    scene.slice(3),
    scene.slice(4),
    scene.slice(5),
    [],
  ];
  stages.forEach((s, i) => {
    b.reserve(reserveFor(remaining[i]));
    b.admit(s, input[i], stageAllowances[s].outputTokens);
    b.record(input[i], 700);
  });
  assert.equal(b.snapshot().used.calls, 13);
  assert.ok(b.snapshot().used.inputTokens > 120000);
  assert.deepEqual(b.snapshot().reserved, {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
});
test("optional work cannot spend calls, input or output reserved for completion", () => {
  for (const limits of [
    { calls: 2, inputTokens: 1000, outputTokens: 1000 },
    { calls: 10, inputTokens: 100, outputTokens: 1000 },
    { calls: 10, inputTokens: 1000, outputTokens: 100 },
  ]) {
    const b = new SceneRequestBudget(limits);
    b.admit("opening", 30, 30);
    b.record(30, 30);
    b.reserve({ calls: 1, inputTokens: 40, outputTokens: 40 });
    assert.throws(() => b.admit("repair", 40, 40), /preserving/);
    assert.equal(b.snapshot().used.calls, 1);
    b.reserve({ calls: 0, inputTokens: 0, outputTokens: 0 });
    assert.doesNotThrow(() => b.admit("evidence_review", 40, 40));
  }
});
test("oversized or invalid counted inputs cannot start a generation", () => {
  for (const n of [24001, -1, NaN, Infinity]) {
    const b = new SceneRequestBudget();
    assert.throws(() => b.admit("batch", n, 1000));
    assert.equal(b.snapshot().used.calls, 0);
  }
});
test("recovery merges actual receipts with fresh IDs, preserved offsets and bounded source counts", () => {
  const original = {
    text: "Discovery only",
    sources: [{ id: "s1", title: "Original", url: evidenceUrl }],
    passages: [fixturePassage],
  };
  const fresh = {
    text: "Not evidence",
    sources: [
      { id: "s1", title: "Targeted", url: "https://example.org/recovery" },
    ],
    passages: [{ ...fixturePassage, documentHash: "b".repeat(64) }],
  };
  const merged = mergeRecoveryResearch(original, fresh);
  assert.equal(merged.sources.length, 2);
  assert.deepEqual(
    merged.passages!.map((p) => p.id),
    ["p1", "p2"],
  );
  assert.equal(merged.passages![1].sourceId, "s2");
  assert.equal(merged.passages![1].start, fixturePassage.start);
  assert.equal(merged.passages![1].text, fixturePassage.text);
  assert.doesNotThrow(() =>
    checkedClaimLedger(
      [],
      [],
      merged.passages!,
      merged.sources.map((s) => s.id),
    ),
  );
  assert.equal(original.passages[0].id, "p1");
  const many = {
    ...fresh,
    sources: Array.from({ length: 8 }, (_, i) => ({
      id: `s${i + 1}`,
      title: `Source ${i}`,
      url: `https://example.org/recovery-${i}`,
    })),
    passages: Array.from({ length: 8 }, (_, i) => ({
      ...fixturePassage,
      id: `p${i + 1}`,
      sourceId: `s${i + 1}`,
    })),
  };
  assert.ok(mergeRecoveryResearch(many, many).sources.length <= 8);
  assert.ok(mergeRecoveryResearch(many, many).passages!.length <= 40);
});
