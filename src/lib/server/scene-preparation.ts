import {
  essentialChecklistSchema,
  normalizeEssentialChecklist,
  essentialInstructions,
  type EssentialChecklist,
} from "./essential-checklist";
import { z } from "zod";
import { assetCatalog } from "../scene-schema";
import { passageSchema } from "../evidence-schema";
import { discoveryPrompt, discoveryStoryPrompt, type DiscoveryContext } from "../discovery";
import { reserveFor, stageAllowances, type BudgetStage } from "./scene-budget";
import {
  MissingEvidenceError,
  mergeRecoveryResearch,
  unavailableEvidence,
  type EvidenceRecoveryRecord,
} from "./evidence-recovery";
import {
  storyChecklistSchema,
  checklistInstructions,
  checkStoryChecklist,
  ChecklistDateError,
  type StoryChecklist,
} from "./story-checklist";
import {
  reviewStoryChecklist,
  ChecklistRevisionError,
  type ChecklistReviewRecord,
} from "./checklist-review";
import type { GateRecord } from "./evidence-gate";
import { historicalClarification } from "./historical-intent";
import { ResearchCache, researchCache } from "./research-cache";
import { SceneServiceError } from "./scene-config";
import type { ResearchBundle, SceneProvider } from "./scene-provider";
import { EventDateEvidenceError } from "./event-compiler";
import { repairEventDate } from "./event-date-repair";
import { eventPlanSchema, EventPlanCapacityError, maxStoryEvents, type EventPlan } from "./event-plan";
import { EventRevisionError } from "./event-review";
import { repairReviewedEvents } from "./event-repair";
const sourceRef = z.string().regex(/^s[1-8]$/);
export const evidenceSchema = z.object({
  text: z.string().min(1).max(24000),
  passages: z.array(passageSchema).min(1).max(40),
  sourceChecks: z
    .array(
      z.object({
        sourceId: z.string(),
        status: z.enum(["readable", "unavailable"]),
        reason: z.string().nullable(),
        finalUrl: z.string().nullable(),
        documentHash: z.string().nullable(),
        retrievedAt: z.string(),
      }),
    )
    .optional(),
  sources: z
    .array(
      z.object({
        id: sourceRef,
        title: z.string().min(1).max(120),
        url: z
          .string()
          .url()
          .regex(/^https?:\/\//i),
      }),
    )
    .min(1)
    .max(8),
});
export type RejectionRecord = {
  stage: string;
  reason: string;
  candidate: unknown;
};
export type PreparationOptions = {
  cache?: ResearchCache;
  cacheTtlSeconds?: number;
  onCache?: (hit: boolean) => void;
  onResearch?: (research: ResearchBundle) => void;
  onGate?: (record: GateRecord) => void;
  onRejected?: (record: RejectionRecord) => void;
  onChecklist?: (checklist: StoryChecklist, elapsedMs: number) => void;
  onChecklistTiming?: (elapsedMs: number) => void;
  onChecklistReview?: (record: ChecklistReviewRecord) => void;
  onRecovery?: (record: EvidenceRecoveryRecord) => void;
  startupStrategy?: "opening" | "staged";
  discovery?: DiscoveryContext;
};

export async function prepareSceneEvidence(
  prompt: string,
  provider: SceneProvider,
  signal: AbortSignal,
  options: PreparationOptions,
  sceneSteps: BudgetStage[],
  atomicEvents = false,
) {
  signal.throwIfAborted();
  const researchPrompt = options.discovery ? discoveryPrompt(options.discovery) : prompt;
  const historicalPrompt = options.discovery ? discoveryStoryPrompt(options.discovery) : prompt;
  const clarification = historicalClarification(historicalPrompt);
  if (clarification)
    throw new SceneServiceError("clarification", clarification);
  const reserve = (stages: BudgetStage[]) =>
    provider.reserveCompletion?.(reserveFor(stages));
  let research: ResearchBundle | undefined;
  let recoverySearches = 0;
  const searchedTopics = new Set<string>();
  let rereads = 0;
  const coverageQuestions: string[] = [];
  function mergeEvidence(additional: ResearchBundle) {
    const original = research;
    const merged = original ? mergeRecoveryResearch(original, additional) : additional;
    const novel = merged.passages?.some((p) => !original?.passages?.some((old) =>
      old.documentHash === p.documentHash && old.start === p.start &&
      old.end === p.end && old.text === p.text,
    ));
    if (!novel) return false;
    research = evidenceSchema.parse(merged);
    options.onResearch?.(structuredClone(research));
    return true;
  }
  async function recover(topics: string[]) {
    cache.delete(cacheKey);
    for (const topic of topics)
      if (!coverageQuestions.includes(topic)) coverageQuestions.push(topic);
    if (provider.rereadEvidence && research && rereads++ < 2) {
      const started = performance.now(), before = research.passages?.length ?? 0;
      reserve(["checklist", "checklist_review", ...sceneSteps]);
      const additional = await provider.rereadEvidence(topics, signal, research);
      signal.throwIfAborted();
      const recovered = additional ? mergeEvidence(evidenceSchema.parse(additional)) : false;
      options.onRecovery?.({
        method: "reread", topics: [...topics], outcome: recovered ? "recovered" : "no_evidence",
        beforePassages: before, afterPassages: research.passages?.length ?? before,
        elapsedMs: Math.round(performance.now() - started),
      });
      if (recovered) return true;
    }
    const freshTopics = topics.filter((topic) => !searchedTopics.has(topic.trim().toLowerCase()));
    if (recoverySearches >= (atomicEvents ? 2 : 1) || !freshTopics.length) return false;
    recoverySearches++;
    freshTopics.forEach((topic) => searchedTopics.add(topic.trim().toLowerCase()));
    const started = performance.now(),
      before = research?.passages?.length ?? 0;
    let outcome: EvidenceRecoveryRecord["outcome"] = "failed",
      errorCode: string | undefined;
    try {
      reserve(["checklist", "checklist_review", ...sceneSteps]);
      const additional = evidenceSchema.parse(
        await provider.research(researchPrompt, signal, { recoveryTopics: freshTopics }),
      );
      signal.throwIfAborted();
      if (!mergeEvidence(additional)) {
        outcome = "no_evidence";
        return false;
      }
      outcome = "recovered";
      return true;
    } catch (error) {
      signal.throwIfAborted();
      errorCode =
        error instanceof SceneServiceError ? error.code : "recovery_failed";
      if (errorCode === "budget") {
        outcome = "budget";
        return false;
      }
      if (errorCode === "evidence") {
        outcome = "no_evidence";
        return false;
      }
      throw error;
    } finally {
      options.onRecovery?.({
        method: "search",
        topics: [...topics],
        outcome,
        beforePassages: before,
        afterPassages: research?.passages?.length ?? before,
        elapsedMs: Math.round(performance.now() - started),
        ...(errorCode ? { errorCode } : {}),
      });
    }
  }
  const cache = options.cache ?? researchCache;
  const cacheKey = `${provider.cacheIdentity}:${researchPrompt.trim().replace(/\s+/g, " ")}`;
  signal.throwIfAborted();
  const cached =
    (options.cacheTtlSeconds ?? 900) > 0 ? cache.get(cacheKey) : null;
  options.onCache?.(Boolean(cached));
  reserve(["checklist", "checklist_review", ...sceneSteps]);
  try {
    research = evidenceSchema.parse(
      cached ?? (await provider.research(researchPrompt, signal)),
    );
  } catch (error) {
    if (
      !(error instanceof SceneServiceError) ||
      error.code !== "evidence" ||
      !(await recover([
        "Find readable primary or institutional evidence for the requested context, essential dates and concrete outcome.",
      ]))
    )
      throw error;
  }
  if (!research)
    throw new SceneServiceError(
      "evidence",
      "The requested story could not be sourced.",
    );
  signal.throwIfAborted();
  if (
    new Set(research.sources.map((source) => source.id)).size !==
    research.sources.length
  )
    throw new SceneServiceError(
      "evidence",
      "The story research did not provide a usable source registry.",
    );
  options.onResearch?.(structuredClone(research));
  const generationEvidence = () => ({
    passages: research!.passages,
    sources: research!.sources.filter((source) =>
      research!.passages!.some((p) => p.sourceId === source.id),
    ),
    sourceChecks: research!.sourceChecks,
  });
  const repairsLeft = { checklist: 2, event_plan: 2,
    legacy: options.startupStrategy === "staged" ? 1 : 2 };
  let capacityRepairsLeft = 1;
  async function validated<T>(
    schema: z.ZodType<T>,
    stage: "checklist" | "focus" | "opening" | "batch" | "event_plan",
    instructions: string,
    input: unknown,
    validate: (value: T) => void | Promise<void>,
    remaining: BudgetStage[] = [],
  ): Promise<T> {
    let feedback: unknown = null;
    let stageRepairs = 0;
    const earlierIssues: string[] = [];
    let dateRepair: { plan: EventPlan; eventIndex: number } | null = null;
    let eventRepair: EventPlan | null = null;
    let lastReviewedPlan: EventPlan | null = null;
    let lastEventReview: unknown = null;
    while (true) {
      signal.throwIfAborted();
      let candidate: T | undefined;
      try {
        reserve(remaining);
        const serializedInput = JSON.stringify({
          request: input,
          repair: feedback,
        });
        if (dateRepair)
          candidate = (await repairEventDate(
            provider,
            signal,
            dateRepair.plan,
            dateRepair.eventIndex,
            serializedInput,
            stageAllowances[stage].outputTokens,
          )) as T;
        else if (eventRepair)
          candidate = (await repairReviewedEvents(provider, signal, eventRepair, serializedInput,
            stageAllowances[stage].outputTokens)) as T;
        else
          candidate = await provider.generate({
            stage: feedback && stage !== "checklist" ? "repair" : stage,
            schema,
            instructions,
            input: serializedInput,
            maxOutputTokens: stageAllowances[stage].outputTokens,
            signal,
          });
        signal.throwIfAborted();
        await validate(candidate);
        return candidate;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof SceneServiceError) throw error;
        const issues =
          error instanceof z.ZodError
            ? error.issues.map((issue) => ({
                path: issue.path,
                code: issue.code,
                message: issue.message,
              }))
            : error instanceof SyntaxError
              ? "Return valid JSON matching the schema."
              : error instanceof Error
                ? error.message
                : "The scene failed validation.";
        options.onRejected?.({
          stage,
          reason: typeof issues === "string" ? issues : JSON.stringify(issues),
          candidate: candidate ?? null,
        });
        if (error instanceof MissingEvidenceError) throw error;
        const checklistRevision =
          stage === "checklist" && error instanceof ChecklistRevisionError
            ? error
            : null;
        const eventRevision = stage === "event_plan" && error instanceof EventRevisionError;
        if (eventRevision) {
          lastEventReview = error.review;
          lastReviewedPlan = candidate ? eventPlanSchema.parse(candidate) : null;
        }
        const dateConstraint =
          stage === "event_plan" && error instanceof EventDateEvidenceError
            ? {
                eventIndex: error.eventIndex,
                requestedDate: error.requestedDate,
                selectedClaims: error.selectedClaims,
              }
            : null;
        // The atomic workflow can spend its second optional repair on a newly
        // rejected checklist. Completion reservations and the global cap still apply.
        const repairLimit = atomicEvents &&
          (checklistRevision || eventRevision || error instanceof EventPlanCapacityError ||
            (stage === "checklist" && error instanceof ChecklistDateError)) ? 2 : 1;
        if (eventRevision && earlierIssues.includes(error.message))
          stageRepairs = repairLimit;
        const phase = atomicEvents ? stage === "checklist" ? "checklist" : "event_plan" : "legacy";
        const exhausted = error instanceof EventPlanCapacityError
          ? capacityRepairsLeft-- <= 0
          : stageRepairs++ >= repairLimit || repairsLeft[phase]-- <= 0;
        if (exhausted)
          throw new SceneServiceError(
            "validation",
            atomicEvents
              ? "The generated story did not pass its checks. Please try again or choose a curated story."
              : "The generated story did not pass its checks. Any available chapters can still be played. Please try again or choose a curated story.",
          );
        feedback = {
          issues,
          rejectedCandidate: candidate ?? null,
          ...(error instanceof EventRevisionError ? { eventReview: error.review } : {}),
          ...(error instanceof EventPlanCapacityError && lastEventReview ? {
            eventReview: lastEventReview, reviewedPlan: lastReviewedPlan,
          } : {}),
          ...(dateConstraint ? { dateConstraint } : {}),
          ...(["checklist", "event_plan"].includes(stage)
            ? { earlierIssues: [...earlierIssues] } : {}),
          ...(checklistRevision ? {
            sourceReview: checklistRevision.review,
            reviewedRequirements:
              checklistRevision.candidate.result.status === "ready"
                ? checklistRevision.candidate.result.requirements
                : [],
          } : {}),
          instruction:
            error instanceof EventPlanCapacityError
              ? `The record limit stays fixed. Produce a concise plan of at most ${maxStoryEvents} records using the unchanged frozen checklist. Do not research or ask for a larger limit. Omit optional granularity, put principal actors in labels/notes, and use honest regional context states for broad phases. Preserve every essential requirement and source-qualified date; actual successive occurrences must stay distinct. Return a resolved plan that can be compiled and source-reviewed.`
              : error instanceof EventRevisionError
              ? "Repair the rejected event plan using eventReview, addressing every revise verdict together. Preserve supported records' wording, actors, dates and locations wherever possible; change only rejected records and dependent relations or metadata. Do not compress supported separate occurrences into a composite event while repairing another field. Split records when separate dates or successive phases require it, update every affected relation index and the focus index, and keep the proposed chronology. Preserve source-qualified timing: a by-date is a deadline, not an exact occurrence date. Use a coarser supported interval with explicit by-date wording if necessary. The entire resulting scene will be independently reviewed again; earlier reviews are fallible context, not evidence."
              : stage === "checklist"
              ? "This checklist has NOT frozen and no scene has been published. Correct the source review using only the fetched passages. reviewedRequirements maps server-assigned requirement IDs back to descriptions and claim IDs; rebuild those requirements in the requested response format. Prefer minimal edits to rejected claims and their dependent requirements; retain supported facts and address the current review, using earlierIssues to check regressions. Earlier feedback is fallible context, not evidence: verify every correction against the passages and do not manufacture a dispute merely because an earlier review requested one. Do not replace a rejected assertion with a different unsupported assertion. Remove unsupported clauses or use the precise attribution the passage establishes. Do not infer that a proposal belonged to a list of demands, that criticism was incorporated into a draft, or that an undated later outcome occurred in a particular year. Do not encode an unsupported before/after sequence in a requirement. Narrow dates only to what the passages establish, never invent dates to satisfy validation. Add essential context already established by the supplied passages. If an essential fact needs another source, return missing_evidence with a targeted lookup question; optional unsupported detail may be omitted. Do not merely attach more passage IDs to unchanged unsupported wording. The complete revised checklist will be source-reviewed again."
              : "Correct only uncommitted output. Uncommitted chapter outlines, summaries, captions and narration may all be rewritten, shortened or split into complete sentences. For evidence failures, narrow or remove rejected new claims and rewrite dependent text. When a frozen checklist is supplied, its claims, requirements and temporal relations cannot be changed or weakened: clarify if they cannot be supported. Do not merely append passage IDs to unsupported wording. Never change historical dates to fit constraints or alter committed actions/claims. Ask a clarification when evidence cannot support the request.",
        };
        dateRepair = dateConstraint && candidate
          ? { plan: eventPlanSchema.parse(candidate), eventIndex: dateConstraint.eventIndex }
          : null;
        eventRepair = eventRevision && candidate ? eventPlanSchema.parse(candidate) : null;
        earlierIssues.push(typeof issues === "string" ? issues : JSON.stringify(issues));
      }
    }
  }
  const checklistStarted = performance.now();
  async function prepareChecklist(): Promise<StoryChecklist> {
    let previousReviews: ChecklistReviewRecord[] = [];
    while (true) {
      try {
        const raw = await validated<StoryChecklist | EssentialChecklist>(
          atomicEvents ? essentialChecklistSchema : storyChecklistSchema,
          "checklist",
          `${
            atomicEvents
              ? checklistInstructions
                  .split("\n")
                  .filter(
                    (line) =>
                      !line.startsWith("Return ready with") &&
                      !line.startsWith("Extract up to 6"),
                  )
                  .join("\n") +
                "\n" +
                essentialInstructions
              : checklistInstructions
          }${atomicEvents ? "\nThis request uses an atomic-event compiler. Do not return claim-level relations; event-level relations will be reviewed after facts are split into atomic event records. Do not force whole composite claims into a before/after order. Preserve required scope and all essential sourced facts." : ""}`,
          {
            prompt: historicalPrompt,
            coverageQuestions,
            research: generationEvidence(),
            renderingCapabilities: assetCatalog.map((a) => ({
              id: a.id,
              description: a.description,
            })),
          },
          async (candidate) => {
            const value = atomicEvents
              ? normalizeEssentialChecklist(candidate as EssentialChecklist)
              : (candidate as StoryChecklist);
            checkStoryChecklist(value, research!);
            if (
              atomicEvents &&
              value.result.status === "ready" &&
              value.result.relations.length
            )
              throw new Error(
                "Leave claim-level relations empty; split occurrences into event records before relating them.",
              );
            if (value.result.status === "ready") {
              reserve(sceneSteps);
              await reviewStoryChecklist(
                provider,
                signal,
                { prompt: historicalPrompt, research: research!, candidate: value, previousReviews, coverageQuestions },
                (record) => {
                  previousReviews.push(structuredClone(record));
                  options.onChecklistReview?.(record);
                },
              );
            }
          },
          ["checklist_review", ...sceneSteps],
        );
        return atomicEvents
          ? normalizeEssentialChecklist(raw as EssentialChecklist)
          : (raw as StoryChecklist);
      } catch (error) {
        if (!(error instanceof MissingEvidenceError)) throw error;
        if (!(await recover(error.topics)))
          throw unavailableEvidence(error.message);
        // Recovery can reassign receipt IDs, so old verdicts cannot be carried
        // into a newly extracted checklist against the rebuilt evidence registry.
        previousReviews = [];
      }
    }
  }
  async function reviewedEvidence() {
    const prepared = await prepareChecklist().finally(() =>
      options.onChecklistTiming?.(
        Math.round(performance.now() - checklistStarted),
      ),
    );
    options.onChecklist?.(
      structuredClone(prepared),
      Math.round(performance.now() - checklistStarted),
    );
    if (prepared.result.status === "clarification")
      throw new SceneServiceError("clarification", prepared.result.question);
    // Preserve successful targeted research, rather than caching the incomplete
    // initial bundle before it has passed even the checklist's source review.
    cache.set(cacheKey, research!, options.cacheTtlSeconds ?? 900);
    return { research: research!, prepared };
  }
  const initial = await reviewedEvidence();
  return {
    ...initial, historicalPrompt, validated, generationEvidence,
    async recoverPreparedEvidence(topics: string[]) {
      // Nothing has been published by the atomic harness. Rebuild and review
      // against fresh receipts; never mutate the old frozen claim ledger.
      if (!(await recover(topics))) return null;
      return reviewedEvidence();
    },
  };
}
