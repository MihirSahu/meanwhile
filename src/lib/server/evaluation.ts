import type { EventPlan } from "./event-plan";
import type { EventReviewRecord } from "./event-review";
import { referenceCheckSchema, type ReferenceCheck } from "./reference-stories";
import type { GateRecord } from "./evidence-gate";
import type { StoryChecklist } from "./story-checklist";
import type { ChecklistReviewRecord } from "./checklist-review";
import type { EvidenceRecoveryRecord } from "./evidence-recovery";
import { z } from "zod";
import { SceneBuffer } from "../playback";
import { rangeContains } from "../historical-time";
import type { SceneMessage } from "../scene-schema";
import type { ModelUsage } from "./scene-provider";

export const evaluationCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.string(),
  prompt: z.string().min(3),
  expected: z.enum(["resolved", "clarification", "either"]),
  years: z.tuple([z.number().int(), z.number().int()]).nullable(),
  checks: z.array(z.string()),
  references: z.array(z.string().url()),
});
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;
export const reviewSchema = z
  .object({
    verdict: z.enum(["pass", "needs_review", "fail"]),
    sourceSupport: z.enum([
      "supported",
      "mixed",
      "unsupported",
      "not_verified",
    ]),
    chronology: z.enum(["pass", "fail", "uncertain"]),
    requestCoverage: z.enum(["pass", "fail", "uncertain"]),
    uncertainty: z.enum(["appropriate", "overstated", "not_applicable"]),
    staging: z.enum(["appropriate", "misleading", "uncertain"]),
    issues: z
      .array(
        z
          .object({
            severity: z.enum(["warning", "error"]),
            actionIds: z.array(z.string()),
            description: z.string().max(500),
          })
          .strict(),
      )
      .max(12),
    rationale: z.string().max(1500),
  })
  .strict();
export const referenceReviewSchema = reviewSchema
  .extend({ referenceChecks: z.array(referenceCheckSchema).max(20) })
  .strict();
export type SceneReview = z.infer<typeof reviewSchema> & {
  referenceChecks?: ReferenceCheck[];
};
export type Pricing = {
  input: number;
  cachedInput: number;
  output: number;
  search: number;
};
export const terraStandardPricing: Pricing = {
  input: 1,
  cachedInput: 0.05,
  output: 5,
  search: 0.01,
};
export function estimatedCost(
  usage: ModelUsage[],
  pricing: Pricing = terraStandardPricing,
) {
  return usage.reduce(
    (sum, item) =>
      sum +
      (Math.max(0, item.inputTokens - item.cachedInputTokens) * pricing.input +
        item.cachedInputTokens * pricing.cachedInput +
        item.outputTokens * pricing.output) /
        1e6 +
      item.searchCalls * pricing.search,
    0,
  );
}
export function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
export function canonicalSource(url: string) {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()])
    if (key.startsWith("utm_")) parsed.searchParams.delete(key);
  parsed.searchParams.sort();
  return parsed.toString().replace(/\/$/, "");
}
export function checkScene(
  test: EvaluationCase,
  messages: SceneMessage[],
  outcome: string,
) {
  const errors: string[] = [];
  const matched =
    test.expected === "either"
      ? outcome === "complete" || outcome === "clarification"
      : outcome ===
        (test.expected === "resolved" ? "complete" : "clarification");
  if (!matched) errors.push(`Expected ${test.expected}, observed ${outcome}.`);
  const buffer = new SceneBuffer();
  try {
    for (const message of messages) buffer.ingest(message);
  } catch {
    errors.push("The committed scene violates the streaming contract.");
  }
  if (outcome === "complete") {
    if (
      !buffer.complete ||
      !buffer.focus ||
      !buffer.actions.some((action) => action.type === "spawn")
    )
      errors.push("The scene must finish with a focus and visible entities.");
    if (buffer.focus?.mode === "live" && !buffer.focus.evidence)
      errors.push(
        "A direct live scene must carry fetched passages and reviewed claims.",
      );
    if (
      test.years &&
      (!buffer.focus?.yearRange ||
        !rangeContains(
          {
            startYear: test.years[0],
            endYear: test.years[1],
            approximate: true,
          },
          buffer.focus.yearRange,
        ))
    )
      errors.push(
        "The selected historical period leaves the requested benchmark range.",
      );
    for (const action of buffer.actions) {
      if (
        (action.type === "chapter" ||
          (action.type === "speech" && action.kind === "narration")) &&
        !action.sourceIds?.length
      )
        errors.push(`Factual action ${action.id} lacks source references.`);
      if (action.type === "speech" && action.kind === "quote")
        errors.push("This generator does not support documented quotations.");
    }
  }
  return { pass: errors.length === 0, errors: [...new Set(errors)] };
}
export type EvaluationRun = {
  eventPlan?: EventPlan | null;
  eventPlanMs?: number | null;
  eventReviews?: EventReviewRecord[];
  checklist?: StoryChecklist | null;
  checklistReviews?: ChecklistReviewRecord[];
  checklistMs?: number | null;
  checklistEstimatedUsd?: number;
  recoveries?: EvidenceRecoveryRecord[];
  recoveryEstimatedUsd?: number;
  serviceError?: {
    code: string;
    status?: number;
    providerCode?: string;
    requestId?: string;
    stage?: string;
  } | null;
  gateReviews?: GateRecord[];
  rejections?: { stage: string; reason: string; candidate: unknown }[];
  referenceCase?: string | null;
  caseId: string;
  category: string;
  strategy: "opening" | "staged";
  cache: "cold" | "warm";
  outcome: string;
  elapsedMs: number;
  firstFocusMs: number | null;
  firstBatchMs: number | null;
  cacheHit: boolean;
  readyThrough: number;
  deterministic: { pass: boolean; errors: string[] };
  review: SceneReview | null;
  reviewError: string | null;
  verifiedSourceCount: number;
  usage: ModelUsage[];
  reviewUsage: ModelUsage[];
  estimatedUsd: number;
  reviewEstimatedUsd: number;
  artifact: string;
};
export function summarizeEvaluation(runs: EvaluationRun[]) {
  const groups = [
    ...new Set(runs.map((run) => `${run.strategy}/${run.cache}`)),
  ].map((key) => {
    const selected = runs.filter(
        (run) => `${run.strategy}/${run.cache}` === key,
      ),
      complete = selected.filter((run) => run.outcome === "complete");
    const times = (field: "firstFocusMs" | "firstBatchMs") =>
      complete.flatMap((run) => (run[field] === null ? [] : [run[field]!]));
    return {
      group: key,
      samples: selected.length,
      completed: complete.length,
      clarifications: selected.filter((run) => run.outcome === "clarification")
        .length,
      checksPassed: selected.filter((run) => run.deterministic.pass).length,
      focusP50Ms: percentile(times("firstFocusMs"), 0.5),
      focusP95Ms: percentile(times("firstFocusMs"), 0.95),
      playableP50Ms: percentile(times("firstBatchMs"), 0.5),
      playableP95Ms: percentile(times("firstBatchMs"), 0.95),
      estimatedUsd: selected.reduce((sum, run) => sum + run.estimatedUsd, 0),
    };
  });
  const cold = runs.filter(
    (run) => run.strategy === "opening" && run.cache === "cold",
  );
  const reviewed = cold.filter((run) => run.review),
    accepted = reviewed.filter(
      (run) =>
        run.deterministic.pass &&
        run.review?.verdict === "pass" &&
        run.review.sourceSupport === "supported" &&
        run.verifiedSourceCount > 0,
    );
  const paired = runs
    .filter(
      (run) =>
        run.strategy === "staged" &&
        run.outcome === "complete" &&
        run.firstBatchMs !== null,
    )
    .flatMap((baseline) => {
      const current = runs.find(
        (run) =>
          run.caseId === baseline.caseId &&
          run.cache === baseline.cache &&
          run.strategy === "opening" &&
          run.outcome === "complete" &&
          run.firstBatchMs !== null,
      );
      return current
        ? [
            {
              caseId: baseline.caseId,
              cache: baseline.cache,
              baselineMs: baseline.firstBatchMs!,
              openingMs: current.firstBatchMs!,
              savedMs: baseline.firstBatchMs! - current.firstBatchMs!,
              savedPercent:
                ((baseline.firstBatchMs! - current.firstBatchMs!) /
                  baseline.firstBatchMs!) *
                100,
            },
          ]
        : [];
    });
  const coldCost = cold.reduce(
    (sum, run) => sum + run.estimatedUsd + run.reviewEstimatedUsd,
    0,
  );
  return {
    recoveryAttempts: runs.reduce(
      (sum, run) => sum + (run.recoveries?.length ?? 0),
      0,
    ),
    recoveriesWithNewEvidence: runs.reduce(
      (sum, run) =>
        sum +
        (run.recoveries?.filter((r) => r.outcome === "recovered").length ?? 0),
      0,
    ),
    recoveryEstimatedUsd: cold.reduce(
      (sum, run) => sum + (run.recoveryEstimatedUsd ?? 0),
      0,
    ),
    checklistReviews: runs.reduce(
      (sum, run) => sum + (run.checklistReviews?.length ?? 0),
      0,
    ),
    checklistReviewRejections: runs.reduce(
      (sum, run) =>
        sum + (run.checklistReviews?.filter((r) => !r.accepted).length ?? 0),
      0,
    ),
    checklistP50Ms: percentile(
      cold.flatMap((run) => (run.checklistMs == null ? [] : [run.checklistMs])),
      0.5,
    ),
    checklistEstimatedUsd: cold.reduce(
      (sum, run) => sum + (run.checklistEstimatedUsd ?? 0),
      0,
    ),
    candidateRejections: runs.reduce(
      (sum, run) => sum + (run.rejections?.length ?? 0),
      0,
    ),
    storiesWithFinalCoverage: runs.filter(
      (run) =>
        run.eventReviews?.some(
          (r) =>
            r.accepted &&
            r.review.requirements.every((c) => c.verdict === "supported"),
        ) ||
        run.gateReviews?.some(
          (gate) =>
            gate.accepted &&
            gate.story?.final &&
            gate.story.requirements.length > 0 &&
            gate.story.requirements.every((requirement) =>
              gate.review.coverage?.some(
                (check) =>
                  check.id === requirement.id && check.status === "covered",
              ),
            ),
        ),
    ).length,
    eventPlansReviewed: runs.reduce(
      (sum, run) => sum + (run.eventReviews?.length ?? 0),
      0,
    ),
    eventPlansRejected: runs.reduce(
      (sum, run) =>
        sum + (run.eventReviews?.filter((r) => !r.accepted).length ?? 0),
      0,
    ),
    gateProposalsReviewed: runs.reduce(
      (sum, run) => sum + (run.gateReviews?.length ?? 0),
      0,
    ),
    gateProposalsRejected: runs.reduce(
      (sum, run) =>
        sum + (run.gateReviews?.filter((g) => !g.accepted).length ?? 0),
      0,
    ),
    referenceCasesReviewed: reviewed.filter(
      (run) => run.referenceCase && run.review?.referenceChecks?.length,
    ).length,
    groups,
    reviewed: reviewed.length,
    reviewPass: accepted.length,
    needsReview: reviewed.filter(
      (run) => run.review?.verdict === "needs_review",
    ).length,
    reviewFailures: reviewed.filter((run) => run.review?.verdict === "fail")
      .length,
    reviewUnavailable: cold.filter(
      (run) => run.outcome === "complete" && !run.review,
    ).length,
    estimatedTotalUsd: runs.reduce(
      (sum, run) => sum + run.estimatedUsd + run.reviewEstimatedUsd,
      0,
    ),
    estimatedCostPerAcceptedStory: accepted.length
      ? coldCost / accepted.length
      : null,
    paired,
    pairedSavedP50Ms: percentile(
      paired.map((pair) => pair.savedMs),
      0.5,
    ),
    pairedSavedP50Percent: percentile(
      paired.map((pair) => pair.savedPercent),
      0.5,
    ),
  };
}
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function evaluationHtml(report: {
  model: string;
  effort: string;
  createdAt: string;
  runs: EvaluationRun[];
  summary: ReturnType<typeof summarizeEvaluation>;
}) {
  const seconds = (value: number | null) =>
    value === null ? "—" : `${(value / 1000).toFixed(1)}s`;
  const rows = report.summary.groups
    .map(
      (group) =>
        `<tr><td>${escapeHtml(group.group)}</td><td>${group.checksPassed}/${group.samples}</td><td>${seconds(group.focusP50Ms)}</td><td>${seconds(group.playableP50Ms)}</td><td>${seconds(group.playableP95Ms)}</td><td>$${group.estimatedUsd.toFixed(3)}</td></tr>`,
    )
    .join("");
  const max = Math.max(
    1,
    ...report.summary.groups.map((group) => group.playableP50Ms ?? 0),
  );
  const bars = report.summary.groups
    .map(
      (group) =>
        `<div class="bar-row"><span>${escapeHtml(group.group)}</span><div class="track"><div class="bar" style="width:${((group.playableP50Ms ?? 0) / max) * 100}%"></div></div><span>${seconds(group.playableP50Ms)}</span></div>`,
    )
    .join("");
  const cases = report.runs
    .map(
      (run) =>
        `<details data-result="${run.deterministic.pass && (!run.review || run.review.verdict === "pass") && !run.reviewError ? "pass" : "attention"}"><summary>${escapeHtml(run.caseId)} · ${run.strategy}/${run.cache} · ${escapeHtml(run.outcome)} · ${seconds(run.firstBatchMs)}</summary><p>Contract/expectation checks: ${run.deterministic.pass ? "pass" : escapeHtml(run.deterministic.errors.join(" "))}. Source review: ${escapeHtml(run.review?.verdict ?? run.reviewError ?? "not scheduled")}; cited pages also cited by the independent review: ${run.verifiedSourceCount}.</p>${run.review ? `<p>${escapeHtml(run.review.rationale)}</p><ul>${run.review.issues.map((issue) => `<li>${escapeHtml(issue.severity)}: ${escapeHtml(issue.description)}</li>`).join("")}</ul>` : ""}${run.checklist || run.checklistMs != null ? `<p>Independent checklist: ${escapeHtml(run.checklist?.result.status ?? "not approved")} · ${seconds(run.checklistMs ?? null)} · estimated $${(run.checklistEstimatedUsd ?? 0).toFixed(4)}.</p>${run.checklist?.result.status === "ready" ? `<ul>${run.checklist.result.requirements.map((r) => `<li>${escapeHtml(r.id)} (${escapeHtml(r.kind)}): ${escapeHtml(r.description)}</li>`).join("")}</ul><p>${run.checklist.result.relations.length} frozen temporal relations.</p>` : run.checklist?.result.status === "clarification" ? `<p>${escapeHtml(run.checklist.result.question)}</p>` : ""}` : ""}${run.recoveries?.length ? `<p>Targeted recovery: estimated $${(run.recoveryEstimatedUsd ?? 0).toFixed(4)}.</p><ul>${run.recoveries.map((r) => `<li>${escapeHtml(r.outcome)} · ${seconds(r.elapsedMs)} · ${r.beforePassages} → ${r.afterPassages} receipts: ${escapeHtml(r.topics.join("; "))}</li>`).join("")}</ul>` : ""}<p>Checklist source reviews: ${run.checklistReviews?.length ?? 0}; rejected: ${run.checklistReviews?.filter((r) => !r.accepted).length ?? 0}.</p><p>Compiled event reviews: ${run.eventReviews?.length ?? 0}; rejected: ${run.eventReviews?.filter((r) => !r.accepted).length ?? 0}. Event preparation: ${seconds(run.eventPlanMs ?? null)}. Accepted reviews check full requirement wording; server links are candidates, not coverage proof.</p><p>Legacy pre-commit proposals: ${run.gateReviews?.length ?? 0} reviewed, ${run.gateReviews?.filter((g) => !g.accepted).length ?? 0} rejected. Reference case: ${escapeHtml(run.referenceCase ?? "none")}.</p>${
          run.gateReviews?.some((gate) => gate.accepted && gate.story?.final)
            ? `<p>Final rendered coverage: ${
                run.gateReviews
                  .filter((gate) => gate.accepted && gate.story?.final)
                  .at(-1)!
                  .review.coverage.filter((check) => check.status === "covered")
                  .length
              } / ${run.gateReviews.filter((gate) => gate.accepted && gate.story?.final).at(-1)!.story!.requirements.length} requirements.</p>`
            : ""
        }${run.rejections?.length ? `<ul>${run.rejections.map((rejection) => `<li>${escapeHtml(rejection.stage)} rejection: ${escapeHtml(rejection.reason)}</li>`).join("")}</ul>` : ""}${run.review?.referenceChecks?.length ? `<ul>${run.review.referenceChecks.map((check) => `<li>${escapeHtml(check.id)}: ${escapeHtml(check.status)} — ${escapeHtml(check.reason)}</li>`).join("")}</ul>` : ""}<p><a href="${escapeHtml(run.artifact)}/scene.ndjson">Committed scene</a> · <a href="${escapeHtml(run.artifact)}/trace.json">Research, usage and review evidence</a></p></details>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Meanwhile evaluation</title><style>body{margin:0;font:14px var(--font-sans,system-ui);color:var(--foreground,#27382c)}p,small{color:var(--muted-foreground,#777);line-height:1.6}h1{font-size:22px}h2{font-size:16px;margin-top:25px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:10px 5px;border-bottom:1px solid var(--border,#ddd)}.scroll{overflow:auto}.chart{height:190px;display:flex;flex-direction:column;gap:15px;justify-content:center}.bar-row{display:grid;grid-template-columns:110px 1fr 50px;gap:10px;font-size:12px;align-items:center}.track{height:18px;background:var(--secondary,#ddd);border-radius:4px}.bar{height:18px;background:var(--chart-2,#43a8a0);border-radius:4px}details{padding:12px 0;border-bottom:1px solid var(--border,#ddd)}summary,select{cursor:pointer}details p,details li{font-size:12px}a{color:var(--primary,#426c99)}select{padding:7px;background:var(--card,transparent);color:inherit;border:1px solid var(--border,#ddd);border-radius:5px}ul{padding-left:20px}</style></head><body><h1>Meanwhile live evaluation</h1><p>${escapeHtml(report.model)} / ${escapeHtml(report.effort)} · ${escapeHtml(report.createdAt)}<br>Cold/warm refer to the application's research cache; provider prompt caching may still occur. Opening uses the current default harness; event-compiler runs finish whole-scene review before publishing. Staged uses the retained legacy resolution/opening workflow. See the saved report harnessVersion; historical reports retain their original workflow.</p><div class="chart" aria-label="Median time to first playable batch">${bars}</div><div class="scroll"><table><thead><tr><th>Workflow/cache</th><th>Checks</th><th>Focus p50</th><th>Playable p50</th><th>Playable p95</th><th>Est. generation cost</th></tr></thead><tbody>${rows}</tbody></table></div><p>Independent model-assisted source reviews: ${report.summary.reviewPass}/${report.summary.reviewed} accepted; ${report.summary.needsReview} need review, ${report.summary.reviewFailures} fail. Estimated total, including tools, failed attempts and review: $${report.summary.estimatedTotalUsd.toFixed(3)}. Estimated cold-workload cost per reviewed accepted story: ${report.summary.estimatedCostPerAcceptedStory === null ? "—" : "$" + report.summary.estimatedCostPerAcceptedStory.toFixed(3)}.</p><p>Independent checklist preparation: ${seconds(report.summary.checklistP50Ms)} median; estimated stage cost $${report.summary.checklistEstimatedUsd.toFixed(3)}. This cost is included in the workload total. Targeted recovery model cost: $${report.summary.recoveryEstimatedUsd.toFixed(3)} (${report.summary.recoveriesWithNewEvidence}/${report.summary.recoveryAttempts} attempts supplied new receipts), also included in workload totals. Preparation time includes recovery performed during checklist preparation. Historical acceptance still depends on the independent audit.</p><small>Acceptance is an automated rubric result, not a human historical-accuracy certification. Costs are estimates using the saved rate card; cache-write surcharges, taxes and hosting are excluded. Small paired samples are directional evidence, not a performance guarantee.</small><h2>Individual runs</h2><label>Show <select id="filter"><option value="all">All runs</option><option value="attention">Runs needing attention</option></select></label>${cases}<script>document.getElementById('filter').addEventListener('change',event=>{document.querySelectorAll('details[data-result]').forEach(node=>{node.hidden=event.target.value!=='all'&&node.dataset.result!==event.target.value})})</script></body></html>`;
}
